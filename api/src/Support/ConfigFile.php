<?php

declare(strict_types=1);

namespace Kocluk\Api\Support;

/**
 * Configuration file resolution shared by the web front controller and the
 * CLI tools, so all of them talk to the same database.
 *
 * Precedence: KOCLUK_CONFIG, then the environment-specific file, then the
 * in-tree api/config.php development fallback for production only.
 *
 * Staging is fail-closed: the staging document root carries a
 * `.kocluk-staging` marker (created by .cpanel.yml when DEPLOYPATH is
 * /home/u2964068/staging/). When that marker exists, the only candidate is
 * /home/u2964068/kocluk-staging-config.php. A staging web request can never
 * fall back to the production config or the in-tree development config.
 */
final class ConfigFile
{
    public const PRODUCTION_PATH = '/home/u2964068/kocluk-config.php';

    public const STAGING_PATH = '/home/u2964068/kocluk-staging-config.php';

    public const STAGING_MARKER = '.kocluk-staging';

    /**
     * Candidate paths in precedence order.
     *
     * @param string $root the api/ directory (for the in-tree fallback)
     * @param string|null $productionPath override for tests/tooling
     * @param string|null $stagingPath override for tests/tooling
     * @param string|null $stagingMarker override for tests/tooling
     * @return list<string>
     */
    public static function candidates(
        string $root,
        ?string $productionPath = null,
        ?string $stagingPath = null,
        ?string $stagingMarker = null,
    ): array {
        $fromEnv = getenv('KOCLUK_CONFIG');

        if (is_string($fromEnv) && $fromEnv !== '') {
            return [$fromEnv];
        }

        if (self::isStagingRoot($root, $stagingMarker)) {
            return [$stagingPath ?? self::STAGING_PATH];
        }

        return [$productionPath ?? self::PRODUCTION_PATH, $root . '/config.php'];
    }

    /**
     * First existing candidate, or null when none exists.
     */
    public static function path(
        string $root,
        ?string $productionPath = null,
        ?string $stagingPath = null,
        ?string $stagingMarker = null,
    ): ?string {
        foreach (self::candidates($root, $productionPath, $stagingPath, $stagingMarker) as $candidate) {
            if (is_file($candidate)) {
                return $candidate;
            }
        }

        return null;
    }

    /**
     * True when the API root sits directly under a staging document root.
     */
    public static function isStagingRoot(string $root, ?string $stagingMarker = null): bool
    {
        return is_file($stagingMarker ?? dirname($root) . '/' . self::STAGING_MARKER);
    }
}
