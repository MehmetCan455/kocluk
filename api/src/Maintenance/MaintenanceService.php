<?php

declare(strict_types=1);

namespace Kocluk\Api\Maintenance;

use DateTimeImmutable;
use DateTimeZone;
use InvalidArgumentException;
use Kocluk\Api\Db\Database;
use Kocluk\Api\Support\Clock;

/**
 * Periodic retention job (design §6.4, §7.3).
 *
 * Grow-only tables are pruned here so the shared hosting database stays
 * bounded and personal data does not live forever:
 *
 *   * `sync_changes` older than 90 days. A client whose cursor is older than
 *     the retained log gets `410 cursor_expired` and performs a full pull.
 *   * used/expired password reset and e-mail verification tokens.
 *   * revoked/expired sessions.
 *   * rate-limit rows older than every configured window.
 *
 * Deletes run in bounded batches so a large first run cannot hold one long
 * transaction or lock the table for the whole purge. The service only removes
 * operational rows; user content is never touched.
 */
final class MaintenanceService
{
    public const DEFAULT_CHANGE_LOG_DAYS = 90;

    public const MIN_CHANGE_LOG_DAYS = 90;

    public const MAX_CHANGE_LOG_DAYS = 365;

    public const DEFAULT_RATE_LIMIT_HOURS = 24;

    public const MAX_RATE_LIMIT_HOURS = 168;

    private const BATCH_SIZE = 5000;

    public function __construct(private readonly Database $database)
    {
    }

    /**
     * @param array{
     *     change_log_days?: int,
     *     rate_limit_hours?: int,
     *     dry_run?: bool
     * } $options
     * @return array{
     *     dryRun: bool,
     *     syncChanges: int,
     *     passwordResets: int,
     *     emailVerifications: int,
     *     sessions: int,
     *     rateLimits: int
     * }
     */
    public function run(array $options = []): array
    {
        $days = $options['change_log_days'] ?? self::DEFAULT_CHANGE_LOG_DAYS;
        $hours = $options['rate_limit_hours'] ?? self::DEFAULT_RATE_LIMIT_HOURS;
        $dryRun = ($options['dry_run'] ?? false) === true;

        if (!is_int($days) || $days < self::MIN_CHANGE_LOG_DAYS || $days > self::MAX_CHANGE_LOG_DAYS) {
            throw new InvalidArgumentException(sprintf(
                'change_log_days %d ile %d arasında olmalı.',
                self::MIN_CHANGE_LOG_DAYS,
                self::MAX_CHANGE_LOG_DAYS,
            ));
        }

        if (!is_int($hours) || $hours < 1 || $hours > self::MAX_RATE_LIMIT_HOURS) {
            throw new InvalidArgumentException(sprintf(
                'rate_limit_hours 1 ile %d arasında olmalı.',
                self::MAX_RATE_LIMIT_HOURS,
            ));
        }

        $now = Clock::now();
        $changeCutoff = self::sql($now->modify('-' . $days . ' days'));
        $rateCutoff = self::sql($now->modify('-' . $hours . ' hours'));
        $nowSql = self::sql($now);

        return [
            'dryRun' => $dryRun,
            'syncChanges' => $this->purge(
                '`sync_changes`',
                '`changed_at` < ?',
                [$changeCutoff],
                $dryRun,
            ),
            'passwordResets' => $this->purge(
                '`password_resets`',
                '`used_at` IS NOT NULL OR `expires_at` < ?',
                [$nowSql],
                $dryRun,
            ),
            'emailVerifications' => $this->purge(
                '`email_verifications`',
                '`used_at` IS NOT NULL OR `expires_at` < ?',
                [$nowSql],
                $dryRun,
            ),
            'sessions' => $this->purge(
                '`sessions`',
                '`revoked_at` IS NOT NULL OR `expires_at` < ?',
                [$nowSql],
                $dryRun,
            ),
            'rateLimits' => $this->purge(
                '`rate_limits`',
                '`created_at` < ?',
                [$rateCutoff],
                $dryRun,
            ),
        ];
    }

    /**
     * @param list<mixed> $params
     */
    private function purge(string $table, string $where, array $params, bool $dryRun): int
    {
        if ($dryRun) {
            $row = $this->database->fetchOne(
                'SELECT COUNT(*) AS `total` FROM ' . $table . ' WHERE ' . $where,
                $params,
            );

            return (int) ($row['total'] ?? 0);
        }

        $deleted = 0;

        do {
            $affected = $this->database->execute(
                'DELETE FROM ' . $table . ' WHERE ' . $where . ' LIMIT ' . self::BATCH_SIZE,
                $params,
            );
            $deleted += $affected;
        } while ($affected === self::BATCH_SIZE);

        return $deleted;
    }

    private static function sql(DateTimeImmutable $at): string
    {
        return $at
            ->setTimezone(new DateTimeZone('UTC'))
            ->format('Y-m-d H:i:s.u');
    }
}
