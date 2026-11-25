<?php

declare(strict_types=1);

namespace Kocluk\Api\Support;

use RuntimeException;

/**
 * Refuses configuration that would mix staging and production data.
 *
 * This runs in the web front controller and in every CLI tool that opens the
 * database. It is intentionally strict:
 *   * a staging context may load only the staging config path (the marker is
 *     not required for the context, and its absence cannot relax this rule);
 *   * app.env=staging always requires a database whose name contains
 *     "_staging", even outside the staging docroot;
 *   * the production config path is never accepted in a staging context or
 *     when app.env=staging.
 */
final class ConfigGuard
{
    /**
     * @param array<string, mixed> $config
     */
    public static function assertSafe(
        array $config,
        bool $stagingContext,
        ?string $configPath = null,
        ?string $stagingPath = null,
    ): void {
        $app = is_array($config['app'] ?? null) ? $config['app'] : [];
        $env = is_string($app['env'] ?? null) && $app['env'] !== ''
            ? $app['env']
            : 'production';
        $expectedStagingPath = $stagingPath ?? ConfigFile::STAGING_PATH;

        // A staging config path is itself a staging context, even when the
        // caller could not infer one from the docroot/Host (CLI clone).
        if ($configPath !== null && $configPath === $expectedStagingPath) {
            $stagingContext = true;
        }

        if ($stagingContext) {
            if ($configPath === null || $configPath !== $expectedStagingPath) {
                throw new RuntimeException(
                    'Staging bağlamında yalnızca staging config dosyası kullanılabilir.',
                );
            }
        }

        if (
            $configPath !== null
            && $configPath === ConfigFile::PRODUCTION_PATH
            && ($stagingContext || $env === 'staging')
        ) {
            throw new RuntimeException(
                'Production config dosyası staging bağlamında kullanılamaz.',
            );
        }

        if (!$stagingContext && $env !== 'staging') {
            return;
        }

        if ($env !== 'staging') {
            throw new RuntimeException(
                'Staging bağlamındaki config app.env=staging olmalı.',
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
