<?php

declare(strict_types=1);

namespace Kocluk\Api\Tests;

use PHPUnit\Framework\TestCase;

final class SmokeTest extends TestCase
{
    public function test_php_version_is_supported(): void
    {
        self::assertGreaterThanOrEqual(80400, PHP_VERSION_ID);
    }
}
