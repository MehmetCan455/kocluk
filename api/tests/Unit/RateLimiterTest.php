<?php

declare(strict_types=1);

namespace Kocluk\Api\Tests\Unit;

use DateTimeImmutable;
use DateTimeZone;
use Kocluk\Api\Auth\RateLimiter;
use Kocluk\Api\Support\ApiException;
use Kocluk\Api\Tests\Support\TestDatabase;
use PHPUnit\Framework\TestCase;

/**
 * The rate limiter counts attempts per bucket and IP inside a rolling window.
 * Attempts at the limit are rejected with 429 and a Retry-After hint; once the
 * window has passed the bucket is usable again.
 */
final class RateLimiterTest extends TestCase
{
    private RateLimiter $limiter;

    protected function setUp(): void
    {
        TestDatabase::reset();
        $this->limiter = new RateLimiter(TestDatabase::database());
    }

    public function test_attempts_below_the_limit_pass(): void
    {
        $this->limiter->assert('login:abc', '1.2.3.4', 3, 900);
        $this->limiter->assert('login:abc', '1.2.3.4', 3, 900);
        $this->limiter->assert('login:abc', '1.2.3.4', 3, 900);

        $row = TestDatabase::database()->fetchOne('SELECT COUNT(*) AS `attempts` FROM `rate_limits`');

        self::assertSame(3, (int) ($row['attempts'] ?? 0));
    }

    public function test_the_attempt_at_the_limit_is_rejected(): void
    {
        $this->limiter->assert('register', '1.2.3.4', 2, 3600);
        $this->limiter->assert('register', '1.2.3.4', 2, 3600);

        try {
            $this->limiter->assert('register', '1.2.3.4', 2, 3600);
            self::fail('Sınır aşıldığında rate_limited hatası beklenir.');
        } catch (ApiException $error) {
            self::assertSame(429, $error->status);
            self::assertSame('rate_limited', $error->errorCode);
            self::assertArrayHasKey('Retry-After', $error->headers);
            self::assertGreaterThan(0, (int) $error->headers['Retry-After']);
            self::assertLessThanOrEqual(3600, (int) $error->headers['Retry-After']);
        }
    }

    public function test_other_ips_and_buckets_have_their_own_counter(): void
    {
        $this->limiter->assert('register', '1.1.1.1', 1, 3600);
        $this->limiter->assert('register', '2.2.2.2', 1, 3600);
        $this->limiter->assert('login:abc', '1.1.1.1', 1, 3600);

        $this->expectException(ApiException::class);
        $this->limiter->assert('register', '1.1.1.1', 1, 3600);
    }

    public function test_attempts_are_accepted_again_after_the_window_passes(): void
    {
        $this->limiter->assert('register', '1.2.3.4', 1, 3600);

        $old = (new DateTimeImmutable('-3700 seconds', new DateTimeZone('UTC')))
            ->format('Y-m-d H:i:s.u');

        TestDatabase::database()->execute('UPDATE `rate_limits` SET `created_at` = ?', [$old]);

        $this->limiter->assert('register', '1.2.3.4', 1, 3600);

        $row = TestDatabase::database()->fetchOne('SELECT COUNT(*) AS `attempts` FROM `rate_limits`');

        // The expired row was pruned; only the fresh attempt remains.
        self::assertSame(1, (int) ($row['attempts'] ?? 0));
    }

    public function test_a_missing_ip_is_its_own_scope(): void
    {
        $this->limiter->assert('sync', null, 1, 60);
        $this->limiter->assert('sync', '1.2.3.4', 1, 60);

        $this->expectException(ApiException::class);
        $this->limiter->assert('sync', null, 1, 60);
    }
}
