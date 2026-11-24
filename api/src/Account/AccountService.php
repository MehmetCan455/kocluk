<?php

declare(strict_types=1);

namespace Kocluk\Api\Account;

use DateTimeImmutable;
use DateTimeZone;
use Kocluk\Api\Auth\PasswordHasher;
use Kocluk\Api\Db\Database;
use Kocluk\Api\Support\ApiException;
use Kocluk\Api\Support\Clock;

/**
 * KVKK data export and hard account deletion (spec §11).
 *
 * Export is scoped by the user id taken from the authenticated session and
 * returns the public account fields plus every synced table. It never reads
 * another account's rows and never exposes password_hash, sessions or
 * reset/verification tokens.
 *
 * Delete is a hard delete, not a tombstone: synced rows, the change log,
 * sessions, reset/verification tokens, rate-limit rows linked by user_id or by
 * the deterministic login/forgot-password e-mail hash and finally the users
 * row are removed in one transaction. The unique e-mail is therefore free for
 * a new registration immediately. Purely IP-scoped rate-limit rows cannot be
 * attributed to an account and are deliberately left for the cleanup job.
 */
final class AccountService
{
    /**
     * API key => storage table, owner column and ordering column.
     *
     * Table and column names are trusted constants; the only value bound into
     * the statements is the authenticated user id.
     *
     * @var array<string, array{table: string, owner: string, order: string}>
     */
    private const SYNC_TABLES = [
        'subjects' => ['table' => 'subjects', 'owner' => 'user_id', 'order' => 'id'],
        'topics' => ['table' => 'topics', 'owner' => 'user_id', 'order' => 'id'],
        'exams' => ['table' => 'exams', 'owner' => 'user_id', 'order' => 'id'],
        'examResults' => ['table' => 'exam_results', 'owner' => 'user_id', 'order' => 'id'],
        'notes' => ['table' => 'notes', 'owner' => 'user_id', 'order' => 'topic_id'],
        'catalogBooks' => ['table' => 'catalog_books', 'owner' => 'owner_id', 'order' => 'id'],
        'userBooks' => ['table' => 'user_books', 'owner' => 'user_id', 'order' => 'id'],
        'activityLogs' => ['table' => 'activity_logs', 'owner' => 'user_id', 'order' => 'id'],
        'scheduleWeeks' => ['table' => 'schedule_weeks', 'owner' => 'user_id', 'order' => 'id'],
        'scheduleRows' => ['table' => 'schedule_rows', 'owner' => 'user_id', 'order' => 'id'],
        'scheduleTasks' => ['table' => 'schedule_tasks', 'owner' => 'user_id', 'order' => 'id'],
        'topicProgress' => ['table' => 'topic_progress', 'owner' => 'user_id', 'order' => 'id'],
        'settings' => ['table' => 'user_settings', 'owner' => 'user_id', 'order' => 'user_id'],
    ];

    public function __construct(private readonly Database $database)
    {
    }

    /**
     * Complete data export for one account.
     *
     * Row columns keep their database names so nothing is silently dropped;
     * soft-deleted rows are included because they are still stored personal
     * data. `user_settings.data` is decoded from its JSON column.
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

        foreach (self::SYNC_TABLES as $apiKey => $definition) {
            $rows = $this->database->fetchAll(
                sprintf(
                    'SELECT * FROM `%s` WHERE `%s` = ? ORDER BY `server_updated_at`, `%s`',
                    $definition['table'],
                    $definition['owner'],
                    $definition['order'],
                ),
                [$userId],
            );

            if ($apiKey === 'settings') {
                $rows = array_map(
                    static fn (array $row): array => self::decodeSettings($row),
                    $rows,
                );
            }

            $tables[$apiKey] = $rows;
        }

        return [
            'exportedAt' => Clock::iso(),
            'formatVersion' => 1,
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

            foreach (self::SYNC_TABLES as $definition) {
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
     * @param array<string, mixed> $row
     * @return array<string, mixed>
     */
    private static function decodeSettings(array $row): array
    {
        if (isset($row['data']) && is_string($row['data'])) {
            /** @var mixed $decoded */
            $decoded = json_decode($row['data'], true, 512, JSON_THROW_ON_ERROR);
            $row['data'] = $decoded;
        }

        return $row;
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
