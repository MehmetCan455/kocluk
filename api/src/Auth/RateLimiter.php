<?php

declare(strict_types=1);

namespace Kocluk\Api\Auth;

use DateTimeImmutable;
use DateTimeZone;
use InvalidArgumentException;
use Kocluk\Api\Db\Database;
use Kocluk\Api\Support\ApiException;
use Kocluk\Api\Support\Clock;

/**
 * Rolling-window rate limiter backed by the rate_limits table (spec §7.3).
 *
 * Every allowed attempt is recorded as a row; a request is rejected once the
 * bucket already holds `$limit` rows inside the window. Buckets are scoped by
 * IP, so a shared host cannot exhaust another client's budget. The row that
 * blocked the request is not written, which also keeps the table small.
 *
 * Rows older than the window are pruned for the touched bucket on each call;
 * other buckets are cleaned by the maintenance cron planned in a later task.
 */
final class RateLimiter
{
    private const MAX_BUCKET_LENGTH = 128;

    public function __construct(private readonly Database $database)
    {
    }

    public function assert(string $bucket, ?string $ip, int $limit, int $windowSeconds): void
    {
        if ($bucket === '' || strlen($bucket) > self::MAX_BUCKET_LENGTH) {
            throw new InvalidArgumentException('Hız sınırı anahtarı 1-128 karakter olmalı.');
        }

        if ($limit < 1 || $windowSeconds < 1) {
            throw new InvalidArgumentException('Hız sınırı ve pencere pozitif olmalı.');
        }

        $now = Clock::now();
        $cutoff = $now->modify('-' . $windowSeconds . ' seconds');
        $ip = self::normaliseIp($ip);

        $this->database->execute(
            'DELETE FROM `rate_limits` WHERE `bucket` = ? AND `created_at` < ?',
            [$bucket, self::sql($cutoff)],
        );

        $row = $this->database->fetchOne(
            'SELECT COUNT(*) AS `attempts`, MIN(`created_at`) AS `oldest`'
            . ' FROM `rate_limits` WHERE `bucket` = ? AND `ip` <=> ? AND `created_at` >= ?',
            [$bucket, $ip, self::sql($cutoff)],
        );

        $attempts = (int) ($row['attempts'] ?? 0);

        if ($attempts >= $limit) {
            $oldest = is_string($row['oldest'] ?? null)
                ? new DateTimeImmutable($row['oldest'], new DateTimeZone('UTC'))
                : $now;

            $retryAfter = max(1, $windowSeconds - ($now->getTimestamp() - $oldest->getTimestamp()));

            throw new ApiException(
                'rate_limited',
                'Çok fazla deneme yapıldı. Lütfen biraz sonra tekrar deneyin.',
                429,
                ['Retry-After' => (string) $retryAfter],
            );
        }

        $this->database->execute(
            'INSERT INTO `rate_limits` (`bucket`, `ip`, `created_at`) VALUES (?, ?, ?)',
            [$bucket, $ip, self::sql($now)],
        );
    }

    private static function normaliseIp(?string $ip): ?string
    {
        if ($ip === null) {
            return null;
        }

        $ip = trim($ip);

        return $ip === '' ? null : substr($ip, 0, 45);
    }

    private static function sql(DateTimeImmutable $at): string
    {
        return $at->format('Y-m-d H:i:s.u');
    }
}
