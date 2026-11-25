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
$appUrl = getenv('APP_URL') ?: (getenv('APP_BASE_URL') ?: 'https://zirveacademy.com');
$cookieName = getenv('SESSION_COOKIE_NAME');
$sessionSecure = getenv('SESSION_SECURE');

$config = [
    'app' => [
        // "production", "staging" or "development".
        'env' => $env,
        'base_url' => $appUrl,
    ],
    // Public SPA URL used in e-mail links; the token stays in the fragment.
    'app_url' => $appUrl,
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
        // tls/starttls, ssl/smtps, or none/off; empty infers from the port.
        'encryption' => getenv('MAIL_ENCRYPTION') ?: '',
        'from_address' => getenv('MAIL_FROM_ADDRESS') ?: 'no-reply@zirveacademy.com',
        'from_name' => getenv('MAIL_FROM_NAME') ?: 'Zirve Academy',
    ],
    'privacy_version' => getenv('PRIVACY_VERSION') ?: '2026-11-24',
    // Server backups (api/bin/backup.php). Keep the directory outside
    // public_html; the CLI refuses a path inside it. offsite_dir is optional:
    // point it at a mounted/second location, or download the archive weekly.
    'backup' => [
        'dir' => getenv('KOCLUK_BACKUP_DIR') ?: '/home/u2964068/kocluk-backups',
        'offsite_dir' => getenv('KOCLUK_BACKUP_OFFSITE_DIR') ?: '',
        'keep_days' => 14,
    ],
    // Retention cron (api/bin/maintenance.php). The 90-day change log is a
    // client contract: do not shorten it, or every device with an older cursor
    // would be forced into a full pull. Rate-limit rows only need to outlive
    // the longest window (1 hour); 24 hours leaves room for debugging.
    'maintenance' => [
        'change_log_days' => 90,
        'rate_limit_hours' => 24,
    ],
    // Optional sync tuning. The default matches the design spec (20 MB); lower
    // it to fail GET /api/sync/full with payload_too_large earlier. Tests set
    // this through the App config instead of building a 20 MB fixture.
    'sync' => [
        'full_max_bytes' => 20 * 1024 * 1024,
    ],
];

unset($env, $production, $appUrl, $cookieName, $sessionSecure);

return $config;
