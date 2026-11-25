<?php

declare(strict_types=1);

namespace Kocluk\Api\Support;

use RuntimeException;

/**
 * Refuses configuration that would mix staging and production data.
 *
 * This runs in the web front controller and in every CLI tool that opens the
 * database. It is intentionally strict: a staging document root must load a
 * config with app.env=staging and a database whose name contains "_staging";
 * the production config path is never accepted there. A config that declares
 * app.env=staging is also checked outside the web root, so a mistyped
 * KOCLUK_CONFIG cannot point the staging back up at the live database.
 */
final class ConfigGuard
{
    /**
     * @param array<string, mixed> $config
     */
    public static function assertSafe(
        array $config,
        bool $stagingRoot,
        ?string $configPath = null,
    ): void {
        $app = is_array($config['app'] ?? null) ? $config['app'] : [];
        $env = is_string($app['env'] ?? null) && $app['env'] !== ''
            ? $app['env']
            : 'production';

        if (
            $stagingRoot
            && $configPath !== null
            && $configPath === ConfigFile::PRODUCTION_PATH
        ) {
            throw new RuntimeException(
                'Staging belge kökü production config dosyasını kullanmayı reddetti.',
            );
        }

        if (!$stagingRoot && $env !== 'staging') {
            return;
        }

        if ($env !== 'staging') {
            throw new RuntimeException(
                'Staging belge kökündeki config app.env=staging olmalı.',
            );
        }

        $database = is_array($config['db'] ?? null)
            ? ($config['db']['database'] ?? null)
            : null;

        if (
            !is_string($database)
            || $database === ''
            || !str_contains(strtolower($database), '_staging')
        ) {
            throw new RuntimeException(
                'Staging config veritabanı adı "_staging" içermeli.',
            );
        }
    }
}
