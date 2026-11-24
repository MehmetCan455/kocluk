<?php

declare(strict_types=1);

/**
 * Runtime bootstrap for the PHP API.
 *
 * The cPanel host has no Composer, so a small PSR-4 autoloader for
 * Kocluk\Api\ is registered here. It is prepended to the autoload stack, so
 * this production code path is the one exercised in CI as well; Composer's
 * autoloader is still loaded when it exists (local development, PHPUnit) and
 * handles anything this loader does not find (e.g. test support classes).
 *
 * Everything runs in UTC; the database connection pins time_zone = '+00:00'
 * separately.
 */

date_default_timezone_set('UTC');

$composerAutoload = dirname(__DIR__) . '/vendor/autoload.php';

if (is_file($composerAutoload)) {
    require_once $composerAutoload;
}

spl_autoload_register(static function (string $class): void {
    $prefix = 'Kocluk\\Api\\';

    if (!str_starts_with($class, $prefix)) {
        return;
    }

    $relative = substr($class, strlen($prefix));

    // Class names never come from user input, but a path separator or ".."
    // would escape src/ if a future caller used a request value as a class
    // name; refuse them outright.
    if (str_contains($relative, '..')) {
        return;
    }

    $path = __DIR__ . '/' . str_replace('\\', '/', $relative) . '.php';

    if (is_file($path)) {
        require $path;
    }
}, true, true);

unset($composerAutoload);
