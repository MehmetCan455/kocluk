<?php

declare(strict_types=1);

namespace Kocluk\Api\Support;

/**
 * Configuration file resolution shared by the web front controller and the
 * migration CLI, so both always talk to the same database.
 *
 * Precedence: KOCLUK_CONFIG, then the file outside public_html, then the
 * in-tree api/config.php development fallback. An explicit KOCLUK_CONFIG is
 * authoritative: when it points at a missing file, resolution fails instead of
 * silently falling back to another configuration.
 */
final class ConfigFile
{
    public const PRODUCTION_PATH = '/home/u2964068/kocluk-config.php';

    /**
     * Candidate paths in precedence order.
     *
     * @param string $root the api/ directory (for the in-tree fallback)
     * @param string|null $productionPath override for tests/tooling; defaults
     *                                    to the cPanel path outside public_html
     * @return list<string>
     */
    public static function candidates(string $root, ?string $productionPath = null): array
    {
        $fromEnv = getenv('KOCLUK_CONFIG');

        if (is_string($fromEnv) && $fromEnv !== '') {
            return [$fromEnv];
        }

        return [$productionPath ?? self::PRODUCTION_PATH, $root . '/config.php'];
    }

    /**
     * First existing candidate, or null when none exists.
     */
    public static function path(string $root, ?string $productionPath = null): ?string
    {
        foreach (self::candidates($root, $productionPath) as $candidate) {
            if (is_file($candidate)) {
                return $candidate;
            }
        }

        return null;
    }
}
