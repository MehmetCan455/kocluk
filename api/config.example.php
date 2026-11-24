<?php

declare(strict_types=1);

/**
 * Example configuration. Copy this file to api/config.php (gitignored) or put
 * it outside public_html and point KOCLUK_CONFIG at it. Real secrets never
 * enter the repository.
 *
 * app.env defaults to production, so the session cookie defaults to the
 * Secure, __Host- prefixed form. Local development must set APP_ENV=development
 * to get a cookie that works over plain HTTP.
 */

$env = getenv('APP_ENV') ?: 'production';
$production = $env === 'production';
$cookieName = getenv('SESSION_COOKIE_NAME');
$sessionSecure = getenv('SESSION_SECURE');

$config = [
    'app' => [
        // "production", "staging" or "development".
        'env' => $env,
        'base_url' => getenv('APP_BASE_URL') ?: 'https://zirveacademy.com',
    ],
    'db' => [
        'host' => getenv('DB_HOST') ?: 'localhost',
        'port' => (int) (getenv('DB_PORT') ?: 3306),
        'database' => getenv('DB_DATABASE') ?: 'kocluk',
        'username' => getenv('DB_USERNAME') ?: 'kocluk',
        'password' => getenv('DB_PASSWORD') ?: '',
    ],
    'session' => [
        // __Host- requires Secure and Path=/; it cannot be used over HTTP.
        'cookie_name' => is_string($cookieName) && $cookieName !== ''
            ? $cookieName
            : ($production ? '__Host-kocluk_session' : 'kocluk_session'),
        // Production is always Secure; SESSION_SECURE only overrides other envs.
        'secure' => is_string($sessionSecure) && $sessionSecure !== ''
            ? filter_var($sessionSecure, FILTER_VALIDATE_BOOL)
            : $production,
    ],
    // Empty disables the closed-beta invite code.
    'invite_code' => getenv('REGISTRATION_INVITE_CODE') ?: '',
    'mail' => [
        'host' => getenv('MAIL_HOST') ?: 'localhost',
        'port' => (int) (getenv('MAIL_PORT') ?: 587),
        'username' => getenv('MAIL_USERNAME') ?: '',
        'password' => getenv('MAIL_PASSWORD') ?: '',
        'from_address' => getenv('MAIL_FROM_ADDRESS') ?: 'no-reply@zirveacademy.com',
        'from_name' => getenv('MAIL_FROM_NAME') ?: 'Zirve Academy',
    ],
    'privacy_version' => getenv('PRIVACY_VERSION') ?: '2026-11-24',
];

unset($env, $production, $cookieName, $sessionSecure);

return $config;

