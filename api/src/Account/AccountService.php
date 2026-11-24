<?php

declare(strict_types=1);

namespace Kocluk\Api\Account;

use DateTimeImmutable;
use DateTimeZone;
use Kocluk\Api\Auth\PasswordHasher;
use Kocluk\Api\Db\Database;
use Kocluk\Api\Support\ApiException;
use Kocluk\Api\Support\Clock;
use Kocluk\Api\Sync\SyncService;
use Kocluk\Api\Sync\TableMap;

/**
 * KVKK data export and hard account deletion (spec §11).
 *
 * Export is scoped by the user id taken from the authenticated session and
 * returns the public account fields plus every synced table. Rows come from
 * TableMap, so their shape is exactly the sync API shape (camelCase, no
 * server_updated_at, no generated active_* columns) and a table added to the
 * map can never be silently missing here.
 *
 * Delete is a hard delete, not a tombstone: synced rows, the change log,
 * sessions, reset/verification tokens, rate-limit rows linked by user_id, by
 * the deterministic login/forgot-password e-mail hash or by the sync push
 * bucket and finally the users row are removed in one transaction. The unique
 * e-mail is therefore free for a new registration immediately. Purely
 * IP-scoped rate-limit rows cannot be attributed to an account and are
 * deliberately left for the cleanup job.
 */
final class AccountService
{
    public function __construct(private readonly Database $database)
    {
    }

    /**
     * Complete data export for one account.
     *
     * Runs in one transaction so every table describes the same snapshot. Soft
     * deleted rows are included because they are still stored personal data.
     *
     * @return array{
     *     exportedAt: string,
     *     formatVersion: int,
     *     user: array<string, mixed>,
     *     tables: array<string, list<array<string, mixed>>>
     * }
     */
    public function export(string $userId): array
    {
        return $this->database->transaction(function () use ($userId): array {
            $user = $this->database->fetchOne(
                'SELECT `id`, `email`, `display_name`, `email_verified_at`, `privacy_version`,'
                . ' `consented_at`, `created_at`, `updated_at`'
                . ' FROM `users` WHERE `id` = ? AND `deleted_at` IS NULL',
                [$userId],
            );

            if ($user === null) {
                throw self::unauthenticated();
            }

            $tables = [];

            foreach (TableMap::keys() as $apiKey) {
                $definition = TableMap::definition($apiKey);
                $columns = array_values(array_unique(array_merge(
                    [(string) $definition['owner']],
                    TableMap::columns($apiKey),
                    ['server_updated_at'],
                )));

                $rows = $this->database->fetchAll(
                    sprintf(
                        'SELECT %s FROM `%s` WHERE `%s` = ? ORDER BY `server_updated_at`, `%s`',
                        self::columnList($columns),
                        $definition['table'],
                        $definition['owner'],
                        TableMap::idColumn($apiKey),
                    ),
                    [$userId],
                );

                $tables[$apiKey] = array_map(
                    static fn (array $row): array => TableMap::toApi($apiKey, $row),
                    $rows,
                );
            }

            return [
                'exportedAt' => Clock::iso(),
                'formatVersion' => 2,
                'user' => [
                    'id' => (string) $user['id'],
                    'email' => (string) $user['email'],
                    'displayName' => (string) $user['display_name'],
                    'emailVerifiedAt' => self::isoOrNull($user['email_verified_at'] ?? null),
                    'privacyVersion' => (string) $user['privacy_version'],
                    'consentedAt' => self::iso((string) $user['consented_at']),
                    'createdAt' => self::iso((string) $user['created_at']),
                    'updatedAt' => self::iso((string) $user['updated_at']),
                ],
                'tables' => $tables,
            ];
        });
    }

    /**
     * Hard-deletes an account after verifying its current password.
     *
     * The users row is locked FOR UPDATE so two concurrent deletes or a
     * concurrent password change cannot race the password check. Everything
     * runs in one transaction; a failure leaves the account untouched.
     */
    public function delete(string $userId, string $password): void
    {
        $this->database->transaction(function () use ($userId, $password): void {
            $user = $this->database->fetchOne(
                'SELECT `email`, `password_hash` FROM `users`'
                . ' WHERE `id` = ? AND `deleted_at` IS NULL FOR UPDATE',
                [$userId],
            );

            if ($user === null) {
                throw self::unauthenticated();
            }

            if (!PasswordHasher::verify($password, (string) $user['password_hash'])) {
                throw new ApiException('invalid_password', 'Şifre hatalı.', 403);
            }

            $email = self::normalizeEmail($user['email'] ?? null);

            foreach (TableMap::keys() as $apiKey) {
                $definition = TableMap::definition($apiKey);

                $this->database->execute(
                    sprintf(
                        'DELETE FROM `%s` WHERE `%s` = ?',
                        $definition['table'],
                        $definition['owner'],
                    ),
                    [$userId],
                );
            }

            $this->database->execute(
                'DELETE FROM `sync_changes` WHERE `user_id` = ?',
                [$userId],
            );
            $this->database->execute(
                'DELETE FROM `sessions` WHERE `user_id` = ?',
                [$userId],
            );
            $this->database->execute(
                'DELETE FROM `password_resets` WHERE `user_id` = ?',
                [$userId],
            );
            $this->database->execute(
                'DELETE FROM `email_verifications` WHERE `user_id` = ?',
                [$userId],
            );

            // Newer limiter rows can carry user_id; remove those first.
            $this->database->execute(
                'DELETE FROM `rate_limits` WHERE `user_id` = ?',
                [$userId],
            );

            // Sync endpoints keep per-user buckets whose key is a digest of the
            // user id; every one of them is still attributable to this account.
            $syncBuckets = SyncService::rateLimitBuckets($userId);

            $this->database->execute(
                sprintf(
                    'DELETE FROM `rate_limits` WHERE `bucket` IN (%s)',
                    implode(', ', array_fill(0, count($syncBuckets), '?')),
                ),
                $syncBuckets,
            );

            // Login and forgot-password use deterministic e-mail-hash buckets
            // instead of user_id. The hash still links the rows to this
            // account, so both buckets must go as well. IP-only buckets such
            // as forgot_password_ip and register are not attributable to one
            // account and remain until their window expires.
            if ($email !== '') {
                $this->database->execute(
                    'DELETE FROM `rate_limits` WHERE `bucket` IN (?, ?)',
                    [
                        'login:' . hash('sha256', $email),
                        'forgot_password:' . hash('sha256', $email),
                    ],
                );
            }

            $deleted = $this->database->execute(
                'DELETE FROM `users` WHERE `id` = ? AND `deleted_at` IS NULL',
                [$userId],
            );

            if ($deleted !== 1) {
                throw self::unauthenticated();
            }
        });
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
     * Same normalization as AuthService::normalizeEmail(), so the limiter
     * buckets this delete targets are exactly the ones login and
     * forgot-password create.
     */
    private static function normalizeEmail(mixed $value): string
    {
        return is_string($value) ? strtolower(trim($value)) : '';
    }

    private static function unauthenticated(): ApiException
    {
        return new ApiException(
            'unauthenticated',
            'Oturum bulunamadı veya süresi dolmuş.',
            401,
        );
    }

    private static function iso(string $sql): string
    {
        return Clock::iso(new DateTimeImmutable($sql, new DateTimeZone('UTC')));
    }

    private static function isoOrNull(mixed $value): ?string
    {
        return is_string($value) && $value !== '' ? self::iso($value) : null;
    }
}
