<?php

declare(strict_types=1);

namespace Kocluk\Api\Tests\Unit;

use Kocluk\Api\Support\ConfigFile;
use Kocluk\Api\Support\ConfigGuard;
use PHPUnit\Framework\TestCase;
use RuntimeException;

/**
 * A staging web request must never load the production config or the live
 * database. The guard is the last line of defence if a path or environment
 * override is wrong.
 */
final class ConfigGuardTest extends TestCase
{
    public function test_staging_root_accepts_a_matching_staging_config(): void
    {
        ConfigGuard::assertSafe(
            [
                'app' => ['env' => 'staging'],
                'db' => ['database' => 'u2964068_staging'],
            ],
            true,
            '/home/u2964068/kocluk-staging-config.php',
        );

        self::assertTrue(true);
    }

    public function test_staging_root_rejects_the_production_config_path(): void
    {
        $this->expectException(RuntimeException::class);

        ConfigGuard::assertSafe(
            [
                'app' => ['env' => 'staging'],
                'db' => ['database' => 'u2964068_staging'],
            ],
            true,
            ConfigFile::PRODUCTION_PATH,
        );
    }

    public function test_staging_root_rejects_a_production_environment(): void
    {
        $this->expectException(RuntimeException::class);

        ConfigGuard::assertSafe(
            [
                'app' => ['env' => 'production'],
                'db' => ['database' => 'u2964068_staging'],
            ],
            true,
            '/home/u2964068/kocluk-staging-config.php',
        );
    }

    public function test_staging_environment_rejects_a_database_without_staging_suffix(): void
    {
        $this->expectException(RuntimeException::class);

        ConfigGuard::assertSafe(
            [
                'app' => ['env' => 'staging'],
                'db' => ['database' => 'u2964068_kocluk'],
            ],
            false,
            '/home/u2964068/kocluk-staging-config.php',
        );
    }

    public function test_staging_root_rejects_a_missing_app_environment(): void
    {
        $this->expectException(RuntimeException::class);

        ConfigGuard::assertSafe(
            ['db' => ['database' => 'u2964068_staging']],
            true,
            '/home/u2964068/kocluk-staging-config.php',
        );
    }

    public function test_staging_context_requires_the_staging_config_path(): void
    {
        $this->expectException(RuntimeException::class);

        ConfigGuard::assertSafe(
            [
                'app' => ['env' => 'staging'],
                'db' => ['database' => 'u2964068_staging'],
            ],
            true,
            '/home/u2964068/other-config.php',
        );
    }

    public function test_staging_config_path_alone_enforces_staging_environment(): void
    {
        $this->expectException(RuntimeException::class);

        ConfigGuard::assertSafe(
            [
                'app' => ['env' => 'production'],
                'db' => ['database' => 'u2964068_kocluk'],
            ],
            false,
            ConfigFile::STAGING_PATH,
        );
    }

    public function test_staging_startup_guard_refuses_a_production_database_without_a_marker(): void
    {
        $this->expectException(RuntimeException::class);

        ConfigGuard::assertSafe(
            [
                'app' => ['env' => 'staging'],
                'db' => ['database' => 'u2964068_kocluk'],
            ],
            true,
            ConfigFile::STAGING_PATH,
        );
    }

    public function test_staging_env_outside_staging_context_rejects_the_production_config(): void
    {
        $this->expectException(RuntimeException::class);

        ConfigGuard::assertSafe(
            [
                'app' => ['env' => 'staging'],
                'db' => ['database' => 'u2964068_staging'],
            ],
            false,
            ConfigFile::PRODUCTION_PATH,
        );
    }

    public function test_production_root_still_accepts_the_production_config(): void
    {
        ConfigGuard::assertSafe(
            [
                'app' => ['env' => 'production'],
                'db' => ['database' => 'u2964068_kocluk'],
            ],
            false,
            ConfigFile::PRODUCTION_PATH,
        );

        self::assertTrue(true);
    }
}
