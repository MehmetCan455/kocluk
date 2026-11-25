<?php

declare(strict_types=1);

namespace Kocluk\Api\Tests\Integration;

use InvalidArgumentException;
use Kocluk\Api\Maintenance\MaintenanceService;
use Kocluk\Api\Support\Clock;
use Kocluk\Api\Support\Uuid;
use Kocluk\Api\Tests\Support\ApiTestCase;
use Kocluk\Api\Tests\Support\TestDatabase;

/**
 * Retention cron (design §6.4, §7.3).
 *
 * The 90-day change-log purge is what makes a stale cursor expire; the other
 * tables are small but must not grow forever on shared hosting. The tests pin
 * both sides of every cutoff.
 */
final class MaintenanceTest extends ApiTestCase
{
    public function test_retention_removes_only_rows_outside_their_window(): void
    {
        $database = TestDatabase::database();
        $now = Clock::now();
        $old = $now->modify('-100 days')->format('Y-m-d H:i:s.u');
        $recent = $now->modify('-10 days')->format('Y-m-d H:i:s.u');
        $userId = Uuid::v4();

        foreach ([$old, $recent] as $changedAt) {
            $database->execute(
                'INSERT INTO `sync_changes` (`user_id`, `table_name`, `row_id`, `op`, `changed_at`)'
                . ' VALUES (?, ?, ?, ?, ?)',
                [$userId, 'userBooks', Uuid::v4(), 'upsert', $changedAt],
            );
        }

        // rate_limits: one older than the 24-hour window, one inside it.
        $database->execute(
            'INSERT INTO `rate_limits` (`bucket`, `created_at`) VALUES (?, ?)',
            ['login:test', $now->modify('-25 hours')->format('Y-m-d H:i:s.u')],
        );
        $database->execute(
            'INSERT INTO `rate_limits` (`bucket`, `created_at`) VALUES (?, ?)',
            ['login:test', $now->modify('-1 hour')->format('Y-m-d H:i:s.u')],
        );

        $expired = $now->modify('-1 day')->format('Y-m-d H:i:s.u');
        $future = $now->modify('+1 day')->format('Y-m-d H:i:s.u');
        $createdAt = $now->format('Y-m-d H:i:s.u');

        // password_resets: used, expired and still valid.
        foreach ([
            [$future, $createdAt],
            [$expired, null],
            [$future, null],
        ] as $index => [$expiresAt, $usedAt]) {
            $database->execute(
                'INSERT INTO `password_resets` (`id`, `user_id`, `expires_at`, `used_at`, `created_at`)'
                . ' VALUES (?, ?, ?, ?, ?)',
                [hash('sha256', 'reset-' . $index), $userId, $expiresAt, $usedAt, $createdAt],
            );
        }

        // email_verifications: used, expired and still valid.
        foreach ([
            [$future, $createdAt],
            [$expired, null],
            [$future, null],
        ] as $index => [$expiresAt, $usedAt]) {
            $database->execute(
                'INSERT INTO `email_verifications` (`id`, `user_id`, `expires_at`, `used_at`, `created_at`)'
                . ' VALUES (?, ?, ?, ?, ?)',
                [hash('sha256', 'verify-' . $index), $userId, $expiresAt, $usedAt, $createdAt],
            );
        }

        // sessions: revoked, expired and active.
        foreach ([
            [$future, $createdAt],
            [$expired, null],
            [$future, null],
        ] as $index => [$expiresAt, $revokedAt]) {
            $database->execute(
                'INSERT INTO `sessions` (`id`, `user_id`, `csrf_token`, `expires_at`,'
                . ' `created_at`, `last_seen_at`, `revoked_at`) VALUES (?, ?, ?, ?, ?, ?, ?)',
                [hash('sha256', 'session-' . $index), $userId, 'csrf', $expiresAt, $createdAt, $createdAt, $revokedAt],
            );
        }

        $result = (new MaintenanceService($database))->run();

        self::assertFalse($result['dryRun']);
        self::assertSame(1, $result['syncChanges']);
        self::assertSame(2, $result['passwordResets']);
        self::assertSame(2, $result['emailVerifications']);
        self::assertSame(2, $result['sessions']);
        self::assertSame(1, $result['rateLimits']);

        self::assertSame(1, $this->countRows('sync_changes'));
        self::assertSame(1, $this->countRows('rate_limits'));
        self::assertSame(1, $this->countRows('password_resets'));
        self::assertSame(1, $this->countRows('email_verifications'));
        self::assertSame(1, $this->countRows('sessions'));

        $kept = $database->fetchOne('SELECT `changed_at` FROM `sync_changes`');
        self::assertIsArray($kept);
        self::assertSame($recent, (new \DateTimeImmutable((string) $kept['changed_at']))->format('Y-m-d H:i:s.u'));

        // Running again is a no-op.
        $again = (new MaintenanceService($database))->run();
        self::assertSame(0, $again['syncChanges']);
        self::assertSame(0, $again['rateLimits']);
    }

    public function test_dry_run_counts_without_deleting(): void
    {
        $database = TestDatabase::database();
        $old = Clock::now()->modify('-100 days')->format('Y-m-d H:i:s.u');

        $database->execute(
            'INSERT INTO `sync_changes` (`user_id`, `table_name`, `row_id`, `op`, `changed_at`)'
            . ' VALUES (?, ?, ?, ?, ?)',
            [Uuid::v4(), 'notes', Uuid::v4(), 'upsert', $old],
        );
        $database->execute(
            'INSERT INTO `rate_limits` (`bucket`, `created_at`) VALUES (?, ?)',
            ['general', $old],
        );

        $result = (new MaintenanceService($database))->run(['dry_run' => true]);

        self::assertTrue($result['dryRun']);
        self::assertSame(1, $result['syncChanges']);
        self::assertSame(1, $result['rateLimits']);
        self::assertSame(1, $this->countRows('sync_changes'));
        self::assertSame(1, $this->countRows('rate_limits'));
    }

    public function test_change_log_retention_cannot_be_shortened_below_ninety_days(): void
    {
        $this->expectException(InvalidArgumentException::class);
        (new MaintenanceService(TestDatabase::database()))->run(['change_log_days' => 30]);
    }

    public function test_rate_limit_retention_must_stay_inside_the_supported_range(): void
    {
        $this->expectException(InvalidArgumentException::class);
        (new MaintenanceService(TestDatabase::database()))->run(['rate_limit_hours' => 0]);
    }
}
