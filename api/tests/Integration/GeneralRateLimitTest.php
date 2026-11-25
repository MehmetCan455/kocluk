<?php

declare(strict_types=1);

namespace Kocluk\Api\Tests\Integration;

use Kocluk\Api\Db\Database;
use Kocluk\Api\Http\Request;
use Kocluk\Api\Support\Clock;
use Kocluk\Api\Tests\Support\ApiTestCase;
use Kocluk\Api\Tests\Support\TestDatabase;

/**
 * Design §7.3: a general 300 requests/hour/IP limit sits in front of every
 * registered API route. Health is deliberately exempt so a probe still works
 * while the database is unavailable.
 */
final class GeneralRateLimitTest extends ApiTestCase
{
    public function test_general_ip_limit_blocks_the_301st_request_and_health_is_exempt(): void
    {
        $database = TestDatabase::database();
        $now = Clock::nowSql();

        for ($attempt = 0; $attempt < 299; $attempt++) {
            $database->execute(
                'INSERT INTO `rate_limits` (`bucket`, `ip`, `created_at`) VALUES (?, ?, ?)',
                ['general', '127.0.0.1', $now],
            );
        }

        $app = $this->app();

        $allowed = $app->handle(Request::create('GET', '/api/auth/session'));
        self::assertSame(401, $allowed->status());
        self::assertSame(300, $this->generalRows($database));

        $blocked = $app->handle(Request::create('GET', '/api/auth/session'));
        $payload = $this->payload($blocked);

        self::assertSame(429, $blocked->status());
        self::assertSame('rate_limited', $payload['error']['code']);
        self::assertNotSame('', (string) $blocked->header('Retry-After'));
        self::assertSame(300, $this->generalRows($database));

        $health = $app->handle(Request::create('GET', '/api/health'));

        self::assertSame(200, $health->status());
        self::assertSame(300, $this->generalRows($database));
    }

    public function test_general_limit_is_scoped_by_ip(): void
    {
        $database = TestDatabase::database();
        $now = Clock::nowSql();

        for ($attempt = 0; $attempt < 300; $attempt++) {
            $database->execute(
                'INSERT INTO `rate_limits` (`bucket`, `ip`, `created_at`) VALUES (?, ?, ?)',
                ['general', '203.0.113.10', $now],
            );
        }

        $app = $this->app();
        $response = $app->handle(Request::create(
            'GET',
            '/api/auth/session',
            [],
            '',
            [],
            '127.0.0.1',
        ));

        self::assertSame(401, $response->status());
    }

    private function generalRows(Database $database): int
    {
        $row = $database->fetchOne(
            'SELECT COUNT(*) AS `total` FROM `rate_limits` WHERE `bucket` = ?',
            ['general'],
        );

        return (int) ($row['total'] ?? 0);
    }
}
