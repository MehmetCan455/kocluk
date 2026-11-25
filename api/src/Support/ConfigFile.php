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
 * Staging is detected independently of the marker:
 *   * the API root's parent directory contains an exact "staging" segment
 *     (the documented /home/u2964068/staging docroot), or
 *   * the web request Host is staging.zirveacademy.com.
 *
 * In a staging context the only candidate is
 * /home/u2964068/kocluk-staging-config.php. A staging request can never fall
 * back to the production config or the in-tree development config; when the
 * staging config is missing the resolution returns null and the API fails
 * closed. The .kocluk-staging marker is only an extra assertion, not the
 * selector; its absence does not make a staging docroot production.
 */
final class ConfigFile
{
    public const PRODUCTION_PATH = '/home/u2964068/kocluk-config.php';

    public const STAGING_PATH = '/home/u2964068/kocluk-staging-config.php';

    public const STAGING_MARKER = '.kocluk-staging';

    public const STAGING_HOST = 'staging.zirveacademy.com';

    /**
     * Candidate paths in precedence order.
     *
     * @param string $root the api/ directory (for the in-tree fallback)
     * @param string|null $productionPath override for tests/tooling
     * @param string|null $stagingPath override for tests/tooling
     * @param string|null $stagingMarker override for tests/tooling
     * @param string|null $host HTTP Host or SERVER_NAME for web requests
     * @return list<string>
     */
    public static function candidates(
        string $root,
        ?string $productionPath = null,
        ?string $stagingPath = null,
        ?string $stagingMarker = null,
        ?string $host = null,
    ): array {
        $fromEnv = getenv('KOCLUK_CONFIG');

        if (is_string($fromEnv) && $fromEnv !== '') {
            return [$fromEnv];
        }

        if (self::isStagingContext($root, $host, $stagingMarker)) {
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
        ?string $host = null,
    ): ?string {
        foreach (self::candidates($root, $productionPath, $stagingPath, $stagingMarker, $host) as $candidate) {
            if (is_file($candidate)) {
                return $candidate;
            }
        }

        return null;
    }

    /**
     * True when this request must use the staging configuration.
     *
     * The path segment check is authoritative for the documented cPanel
     * layout. The Host check covers a staging vhost whose document root is
     * laid out differently; it is never allowed to select production.
     */
    public static function isStagingContext(
        string $root,
        ?string $host = null,
        ?string $stagingMarker = null,
    ): bool {
        if (self::pathHasStagingSegment($root)) {
            return true;
        }

        if (self::isStagingHost($host)) {
            return true;
        }

        return self::hasStagingMarker($root, $stagingMarker);
    }

    /**
     * Marker-only check, kept as an extra assertion for tooling/tests.
     */
    public static function isStagingRoot(string $root, ?string $stagingMarker = null): bool
    {
        return self::hasStagingMarker($root, $stagingMarker);
    }

    private static function pathHasStagingSegment(string $root): bool
    {
        $docRoot = str_replace('\\', '/', dirname($root));
        $segments = array_values(array_filter(
            explode('/', $docRoot),
            static fn (string $segment): bool => $segment !== '',
        ));

        return in_array('staging', $segments, true);
    }

    private static function isStagingHost(?string $host): bool
    {
        if ($host === null) {
            return false;
        }

        $host = strtolower(trim($host));

        if ($host === '') {
            return false;
        }

        if (preg_match('/^\[([^\]]+)\](?::\d+)?$/', $host, $matches) === 1) {
            $host = $matches[1];
        } elseif (preg_match('/^([^:]+):\d+$/', $host, $matches) === 1) {
            $host = $matches[1];
        }

        return $host === self::STAGING_HOST;
    }

    private static function hasStagingMarker(string $root, ?string $stagingMarker = null): bool
    {
        return is_file($stagingMarker ?? dirname($root) . '/' . self::STAGING_MARKER);
    }
}
