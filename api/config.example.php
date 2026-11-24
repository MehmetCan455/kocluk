<?php

declare(strict_types=1);

/**
 * Example configuration. Copy this file to api/config.php (gitignored) or put
 * it outside public_html and point KOCLUK_CONFIG at it. Real secrets never
 * enter the repository.
 */

return [
    'app' => [
        // "production", "staging" or "development".
        'env' => getenv('APP_ENV') ?: 'production',
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
        'cookie_name' => getenv('SESSION_COOKIE_NAME') ?: 'kocluk_session',
        'secure' => filter_var(getenv('SESSION_SECURE') ?: 'false', FILTER_VALIDATE_BOOL),
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
