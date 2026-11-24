<?php

declare(strict_types=1);

namespace Kocluk\Api\Support;

use DateTimeImmutable;
use DateTimeZone;

/**
 * UTC clock. All database timestamps are UTC DATETIME(6).
 */
final class Clock
{
    public static function now(): DateTimeImmutable
    {
        return new DateTimeImmutable('now', new DateTimeZone('UTC'));
    }

    /**
     * DATETIME(6) literal, e.g. "2026-11-24 12:00:00.000000".
     */
    public static function nowSql(): string
    {
        return self::now()->format('Y-m-d H:i:s.u');
    }
}
