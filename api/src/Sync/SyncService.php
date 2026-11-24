<?php

declare(strict_types=1);

namespace Kocluk\Api\Sync;

use DateTimeImmutable;
use DateTimeZone;
use Kocluk\Api\Db\Database;
use Kocluk\Api\Support\ApiException;
use Kocluk\Api\Support\Clock;
use PDOException;

/**
 * Batch push (spec §8.2, §8.4).
 *
 * One row per transaction: a failed row never rolls back its neighbours. The
 * authenticated user id is the only owner ever written; a body-supplied
 * userId/ownerId is accepted only as an assertion and rejected as `forbidden`
 * when it names somebody else.
 *
 * Conflict rules:
 *   * last writer wins on updated_at; equality keeps the server row;
 *   * a future updated_at is clamped to now + 5 minutes and the result says
 *     timeAdjusted so the client can correct its clock;
 *   * a natural-key collision returns `conflict` with the canonical row, not
 *     an error;
 *   * a tombstone never loses to a newer update; it is returned as `conflict`;
 *   * activityLogs is insert-only and one active row per taskId; only
 *     deleted_at may be set afterwards;
 *   * settings is one JSON row per user and cannot be deleted through push.
 */
final class SyncService
{
    public const MAX_CHANGES = 100;

    public const RATE_LIMIT = 120;

    public const RATE_WINDOW_SECONDS = 3600;

    public const FUTURE_TOLERANCE_SECONDS = 300;

    private const RATE_BUCKET_PREFIX = 'sync_push';

    public function __construct(
        private readonly Database $database,
        private readonly ChangeLog $changeLog,
    ) {
    }

    /**
     * Per-user limiter bucket. The raw user id is hashed so the rate_limits
     * table never stores an account identifier; account deletion can still
     * remove the row because the hash is derived from the same id.
     */
    public static function rateLimitBucket(string $userId): string
    {
        return self::RATE_BUCKET_PREFIX . ':' . hash('sha256', $userId);
    }

    /**
     * @param array<string, mixed> $input
     * @return array{results: list<array<string, mixed>>, serverTime: string}
     */
    public function push(string $userId, array $input): array
    {
        $deviceId = $input['deviceId'] ?? null;

        if ($deviceId !== null && (!is_string($deviceId) || strlen($deviceId) > 64)) {
            throw self::requestError('validation_failed', 'deviceId geçersiz.');
        }

        $changes = $input['changes'] ?? null;

        if (!is_array($changes) || !array_is_list($changes)) {
            throw self::requestError('validation_failed', 'changes bir dizi olmalı.');
        }

        if (count($changes) > self::MAX_CHANGES) {
            throw self::requestError(
                'payload_too_large',
                'Tek istekte en fazla 100 değişiklik gönderilebilir.',
            );
        }

        foreach ($changes as $change) {
            $this->assertChangeShape($change);
        }

        $results = [];

        foreach ($changes as $change) {
            /** @var array<string, mixed> $change */
            $results[] = $this->apply($userId, $change);
        }

        return ['results' => $results, 'serverTime' => Clock::iso()];
    }

    /**
     * @param array<string, mixed> $change
     * @return array<string, mixed>
     */
    private function apply(string $userId, array $change): array
    {
        $table = (string) $change['table'];
        $op = (string) $change['op'];
        $definition = TableMap::definition($table);
        $ownerKey = (string) $definition['ownerKey'];
        $row = is_array($change['row'] ?? null) ? $change['row'] : null;

        if ($row !== null && array_key_exists($ownerKey, $row)) {
            $claimed = $row[$ownerKey];

            if (!is_string($claimed) || !hash_equals($userId, $claimed)) {
                return self::errorRow($table, null, 'forbidden', 'Bu satır başka bir hesaba ait.');
            }
        }

        if ($row === null) {
            try {
                $rowId = TableMap::assertRowId($change['rowId'] ?? null);
            } catch (InvalidRowValue $error) {
                return self::errorRow($table, null, $error->errorCode, $error->getMessage());
            }
        } else {
            // The settings row id is the account itself; the body can only
            // assert it, never choose it.
            if ($table === 'settings') {
                $row[$ownerKey] = $userId;
            }

            try {
                $rowId = TableMap::rowId($table, $row);
            } catch (InvalidRowValue $error) {
                return self::errorRow($table, null, $error->errorCode, $error->getMessage());
            }
        }

        $tombstone = $row !== null
            && array_key_exists('deletedAt', $row)
            && $row['deletedAt'] !== null;

        try {
            if ($op === 'delete' || $tombstone) {
                return $this->applyDelete($userId, $table, $rowId, $row, $change);
            }

            if (($definition['insertOnly'] ?? false) === true) {
                return $this->applyActivityLogUpsert($userId, $table, $rowId, $row);
            }

            return $this->applyUpsert($userId, $table, $rowId, $row);
        } catch (InvalidRowValue $error) {
            return self::errorRow($table, $rowId, $error->errorCode, $error->getMessage());
        }
    }

    /**
     * @param array<string, mixed> $row
     * @return array<string, mixed>
     */
    private function applyUpsert(string $userId, string $table, string $rowId, array $row): array
    {
        $definition = TableMap::definition($table);
        $dbRow = TableMap::toDb($table, $row);

        [$updatedAt, $adjusted] = $this->clamp($dbRow['updated_at'] ?? null, 'updatedAt');

        if ($updatedAt === null) {
            throw new InvalidRowValue('validation_failed', 'Zorunlu alan eksik: updatedAt');
        }

        $timestamp = self::toSql($updatedAt);

        $dbRow['updated_at'] = $timestamp;

        return $this->database->transaction(function () use (
            $userId,
            $table,
            $rowId,
            $definition,
            $dbRow,
            $timestamp,
            $adjusted,
        ): array {
            $existing = $this->fetchExisting($userId, $table, $rowId);

            if ($existing === null) {
                return $this->insert($userId, $table, $rowId, $dbRow, 'upsert', $adjusted);
            }

            if (($existing['deleted_at'] ?? null) !== null) {
                return self::conflictRow($table, $rowId, $existing);
            }

            if (!self::isNewer($timestamp, (string) ($existing['updated_at'] ?? ''))) {
                return self::conflictRow($table, $rowId, $existing);
            }

            $this->update($userId, $table, $rowId, $dbRow, $definition);
            $this->changeLog->append($userId, $table, $rowId, 'upsert');

            $canonical = $dbRow;
            $canonical[(string) $definition['owner']] = $userId;

            return self::appliedRow($table, $rowId, $canonical, $adjusted);
        });
    }

    /**
     * activityLogs is insert-only: an existing row is never rewritten, and a
     * second active row for the same taskId is a natural-key conflict.
     *
     * @param array<string, mixed> $row
     * @return array<string, mixed>
     */
    private function applyActivityLogUpsert(string $userId, string $table, string $rowId, array $row): array
    {
        $dbRow = TableMap::toDb($table, $row);

        return $this->database->transaction(function () use ($userId, $table, $rowId, $dbRow): array {
            $existing = $this->fetchExisting($userId, $table, $rowId);

            if ($existing !== null) {
                return self::conflictRow($table, $rowId, $existing);
            }

            $canonical = $this->findCanonical($userId, $table, $dbRow);

            if ($canonical !== null) {
                return self::conflictRow($table, $rowId, $canonical);
            }

            return $this->insert($userId, $table, $rowId, $dbRow, 'upsert');
        });
    }

    /**
     * @param array<string, mixed>|null $row
     * @param array<string, mixed> $change
     * @return array<string, mixed>
     */
    private function applyDelete(
        string $userId,
        string $table,
        string $rowId,
        ?array $row,
        array $change,
    ): array {
        $definition = TableMap::definition($table);

        if ($table === 'settings') {
            throw new InvalidRowValue('validation_failed', 'Ayarlar satırı silinemez.');
        }

        $dbRow = $row !== null ? TableMap::toDb($table, $row) : null;

        $provided = $dbRow !== null
            ? ($dbRow['deleted_at'] ?? $dbRow['updated_at'] ?? null)
            : null;

        if ($provided === null && is_string($change['updatedAt'] ?? null)) {
            $provided = TableMap::timestampSql($change['updatedAt']);
        }

        $provided ??= Clock::nowSql();

        [$deletedAt, $adjusted] = $this->clamp($provided, 'deletedAt');

        if ($deletedAt === null) {
            throw new InvalidRowValue('invalid_timestamp', 'Geçersiz zaman damgası: deletedAt');
        }

        $timestamp = self::toSql($deletedAt);

        if ($dbRow !== null) {
            $dbRow['deleted_at'] = $timestamp;

            if (isset($definition['columns']['updatedAt'])) {
                $dbRow['updated_at'] = $timestamp;
            }
        }

        return $this->database->transaction(function () use (
            $userId,
            $table,
            $rowId,
            $definition,
            $dbRow,
            $timestamp,
            $adjusted,
        ): array {
            $existing = $this->fetchExisting($userId, $table, $rowId);

            if ($existing === null) {
                if ($dbRow === null) {
                    return self::appliedRow($table, $rowId, null, false);
                }

                return $this->insert($userId, $table, $rowId, $dbRow, 'delete', $adjusted);
            }

            if (($existing['deleted_at'] ?? null) !== null) {
                return self::appliedRow($table, $rowId, $existing, false);
            }

            // activity_logs has no updated_at; a delete is the only mutation.
            if ($table !== 'activityLogs' && !self::isNewer($timestamp, (string) ($existing['updated_at'] ?? ''))) {
                return self::conflictRow($table, $rowId, $existing);
            }

            if ($dbRow !== null && $table !== 'activityLogs') {
                $this->update($userId, $table, $rowId, $dbRow, $definition);
            } else {
                $this->updateTombstone($userId, $table, $rowId, $timestamp, $definition);
            }

            $this->changeLog->append($userId, $table, $rowId, 'delete');

            if ($dbRow !== null && $table !== 'activityLogs') {
                $canonical = $dbRow;
                $canonical[(string) $definition['owner']] = $userId;
            } else {
                $canonical = $existing;
                $canonical['deleted_at'] = $timestamp;

                if (isset($definition['columns']['updatedAt'])) {
                    $canonical['updated_at'] = $timestamp;
                }
            }

            return self::appliedRow($table, $rowId, $canonical, $adjusted);
        });
    }

    /**
     * @param array<string, mixed> $dbRow
     * @return array<string, mixed>
     */
    private function insert(
        string $userId,
        string $table,
        string $rowId,
        array $dbRow,
        string $op,
        bool $adjusted = false,
    ): array {
        $definition = TableMap::definition($table);
        $columns = array_keys($dbRow);
        $params = array_values($dbRow);

        $columns[] = (string) $definition['owner'];
        $params[] = $userId;
        $columns[] = 'server_updated_at';
        $params[] = Clock::nowSql();

        try {
            $this->database->execute(
                sprintf(
                    'INSERT INTO `%s` (%s) VALUES (%s)',
                    $definition['table'],
                    self::columnList($columns),
                    implode(', ', array_fill(0, count($columns), '?')),
                ),
                $params,
            );
        } catch (PDOException $error) {
            if (!self::isDuplicate($error)) {
                throw $error;
            }

            // A natural-key collision (or a concurrent insert of the same id)
            // returns the canonical row; it is a conflict, not an error.
            $canonical = $this->findCanonical($userId, $table, $dbRow)
                ?? $this->fetchExisting($userId, $table, $rowId);

            if ($canonical !== null) {
                return self::conflictRow($table, $rowId, $canonical);
            }

            throw $error;
        }

        $this->changeLog->append($userId, $table, $rowId, $op);

        $canonical = $dbRow;
        $canonical[(string) $definition['owner']] = $userId;

        return self::appliedRow($table, $rowId, $canonical, $adjusted);
    }

    /**
     * @param array<string, mixed> $dbRow
     * @param array<string, mixed> $definition
     */
    private function update(string $userId, string $table, string $rowId, array $dbRow, array $definition): void
    {
        $immutable = [];

        foreach ($definition['immutable'] as $field) {
            if (isset($definition['columns'][$field])) {
                $immutable[] = (string) $definition['columns'][$field];
            }
        }

        $sets = [];
        $params = [];

        foreach ($dbRow as $column => $value) {
            if (in_array((string) $column, $immutable, true)) {
                continue;
            }

            $sets[] = '`' . $column . '` = ?';
            $params[] = $value;
        }

        $sets[] = '`server_updated_at` = ?';
        $params[] = Clock::nowSql();
        $params[] = $userId;
        $params[] = $rowId;

        $this->database->execute(
            sprintf(
                'UPDATE `%s` SET %s WHERE `%s` = ? AND `%s` = ?',
                $definition['table'],
                implode(', ', $sets),
                $definition['owner'],
                TableMap::idColumn($table),
            ),
            $params,
        );
    }

    /**
     * @param array<string, mixed> $definition
     */
    private function updateTombstone(
        string $userId,
        string $table,
        string $rowId,
        string $timestamp,
        array $definition,
    ): void {
        $sets = ['`deleted_at` = ?'];
        $params = [$timestamp];

        if (isset($definition['columns']['updatedAt'])) {
            $sets[] = '`updated_at` = ?';
            $params[] = $timestamp;
        }

        $sets[] = '`server_updated_at` = ?';
        $params[] = Clock::nowSql();
        $params[] = $userId;
        $params[] = $rowId;

        $this->database->execute(
            sprintf(
                'UPDATE `%s` SET %s WHERE `%s` = ? AND `%s` = ?',
                $definition['table'],
                implode(', ', $sets),
                $definition['owner'],
                TableMap::idColumn($table),
            ),
            $params,
        );
    }

    /**
     * @return array<string, mixed>|null
     */
    private function fetchExisting(string $userId, string $table, string $rowId): ?array
    {
        $definition = TableMap::definition($table);
        $columns = self::selectColumns($table);

        return $this->database->fetchOne(
            sprintf(
                'SELECT %s FROM `%s` WHERE `%s` = ? AND `%s` = ? LIMIT 1 FOR UPDATE',
                self::columnList($columns),
                $definition['table'],
                $definition['owner'],
                TableMap::idColumn($table),
            ),
            [$userId, $rowId],
        );
    }

    /**
     * Canonical active row for the incoming natural key, if any.
     *
     * @param array<string, mixed> $dbRow
     * @return array<string, mixed>|null
     */
    private function findCanonical(string $userId, string $table, array $dbRow): ?array
    {
        $definition = TableMap::definition($table);
        $natural = $definition['natural'];

        if ($natural === []) {
            return null;
        }

        $where = [];
        $params = [$userId];

        foreach ($natural as $column) {
            $value = $dbRow[$column] ?? null;

            if ($value === null) {
                return null;
            }

            $where[] = '`' . $column . '` <=> ?';
            $params[] = $value;
        }

        return $this->database->fetchOne(
            sprintf(
                'SELECT %s FROM `%s` WHERE `%s` = ? AND %s AND `deleted_at` IS NULL'
                . ' ORDER BY `server_updated_at` DESC LIMIT 1',
                self::columnList(self::selectColumns($table)),
                $definition['table'],
                $definition['owner'],
                implode(' AND ', $where),
            ),
            $params,
        );
    }

    /**
     * @return list<string>
     */
    private static function selectColumns(string $table): array
    {
        $definition = TableMap::definition($table);

        return array_values(array_unique(array_merge(
            [(string) $definition['owner']],
            TableMap::columns($table),
        )));
    }

    /**
     * @param list<string> $columns
     */
    private static function columnList(array $columns): string
    {
        return implode(', ', array_map(
            static fn (string $column): string => '`' . $column . '`',
            $columns,
        ));
    }

    /**
     * @param array<string, mixed> $change
     */
    private function assertChangeShape(mixed $change): void
    {
        if (!is_array($change)) {
            throw self::requestError('validation_failed', 'Değişiklik nesnesi bekleniyordu.');
        }

        $table = $change['table'] ?? null;

        if (!is_string($table)) {
            throw self::requestError('validation_failed', 'table alanı zorunlu.');
        }

        try {
            TableMap::definition($table);
        } catch (InvalidRowValue $error) {
            throw self::requestError($error->errorCode, $error->getMessage());
        }

        $op = $change['op'] ?? null;

        if (!in_array($op, ['upsert', 'delete'], true)) {
            throw self::requestError('validation_failed', 'op upsert veya delete olmalı.');
        }

        $row = $change['row'] ?? null;

        if ($op === 'upsert' && !is_array($row)) {
            throw self::requestError('validation_failed', 'upsert için row zorunlu.');
        }

        if (is_array($row)) {
            try {
                TableMap::assertFields($table, $row);
            } catch (InvalidRowValue $error) {
                throw self::requestError($error->errorCode, $error->getMessage());
            }
        }

        if ($op === 'delete' && !is_array($row) && !is_string($change['rowId'] ?? null)) {
            throw self::requestError('validation_failed', 'delete için rowId zorunlu.');
        }
    }

    /**
     * @return array{0: DateTimeImmutable|null, 1: bool}
     */
    private function clamp(mixed $sql, string $field): array
    {
        if (!is_string($sql) || $sql === '') {
            return [null, false];
        }

        $at = self::fromSql($sql);
        $limit = Clock::now()->modify('+' . self::FUTURE_TOLERANCE_SECONDS . ' seconds');

        return $at > $limit ? [$limit, true] : [$at, false];
    }

    private static function isNewer(string $incoming, string $existing): bool
    {
        if ($existing === '') {
            return true;
        }

        return self::fromSql($incoming) > self::fromSql($existing);
    }

    private static function fromSql(string $value): DateTimeImmutable
    {
        return new DateTimeImmutable($value, new DateTimeZone('UTC'));
    }

    private static function toSql(DateTimeImmutable $at): string
    {
        return $at
            ->setTimezone(new DateTimeZone('UTC'))
            ->format('Y-m-d H:i:s.u');
    }

    /**
     * @param array<string, mixed>|null $dbRow
     * @return array<string, mixed>
     */
    private static function appliedRow(string $table, string $rowId, ?array $dbRow, bool $adjusted): array
    {
        $result = [
            'table' => $table,
            'rowId' => $rowId,
            'status' => 'applied',
            'row' => $dbRow === null ? null : TableMap::toApi($table, $dbRow),
        ];

        if ($adjusted) {
            $result['timeAdjusted'] = true;
        }

        return $result;
    }

    /**
     * @param array<string, mixed> $dbRow
     * @return array<string, mixed>
     */
    private static function conflictRow(string $table, string $rowId, array $dbRow): array
    {
        return [
            'table' => $table,
            'rowId' => $rowId,
            'status' => 'conflict',
            'row' => TableMap::toApi($table, $dbRow),
        ];
    }

    /**
     * @return array<string, mixed>
     */
    private static function errorRow(string $table, ?string $rowId, string $code, string $message): array
    {
        return [
            'table' => $table,
            'rowId' => $rowId,
            'status' => 'error',
            'error' => ['code' => $code, 'message' => $message],
        ];
    }

    private static function requestError(string $code, string $message): ApiException
    {
        return new ApiException($code, $message, 422);
    }

    private static function isDuplicate(PDOException $error): bool
    {
        return $error->getCode() === '23000' && (int) ($error->errorInfo[1] ?? 0) === 1062;
    }
}
