<?php

declare(strict_types=1);

/**
 * CLI migration runner: php api/bin/migrate.php
 *
 * Applies api/migrations/*.sql in filename order and records each applied
 * file in schema_migrations, so repeated runs are safe.
 */

if (PHP_SAPI !== 'cli') {
    http_response_code(404);
    exit(1);
}

$root = dirname(__DIR__);

$composerAutoload = $root . '/vendor/autoload.php';

if (is_file($composerAutoload)) {
    require $composerAutoload;
} else {
    // The shared host has no Composer; load the few API classes directly.
    spl_autoload_register(static function (string $class) use ($root): void {
        $prefix = 'Kocluk\\Api\\';

        if (!str_starts_with($class, $prefix)) {
            return;
        }

        $path = $root . '/src/' . str_replace('\\', '/', substr($class, strlen($prefix))) . '.php';

        if (is_file($path)) {
            require $path;
        }
    });
}

$candidates = array_filter([
    getenv('KOCLUK_CONFIG') ?: null,
    $root . '/config.php',
    '/home/u2964068/kocluk-config.php',
]);

$configPath = null;

foreach ($candidates as $candidate) {
    if (is_file($candidate)) {
        $configPath = $candidate;
        break;
    }
}

if ($configPath === null) {
    fwrite(STDERR, "config.php bulunamadı. KOCLUK_CONFIG ortam değişkenini ayarlayın.\n");
    exit(1);
}

/** @var array<string, mixed> $config */
$config = require $configPath;

try {
    $dbConfig = is_array($config['db'] ?? null) ? $config['db'] : [];
    $database = \Kocluk\Api\Db\Database::connect($dbConfig);
    $migrator = new \Kocluk\Api\Db\Migrator($database, $root . '/migrations');
    $applied = $migrator->run();

    if ($applied === []) {
        fwrite(STDOUT, "Uygulanacak migration yok.\n");
    } else {
        foreach ($applied as $version) {
            fwrite(STDOUT, 'Uygulandı: ' . $version . "\n");
        }
    }

    exit(0);
} catch (Throwable $error) {
    fwrite(STDERR, 'Migration hatası: ' . $error->getMessage() . "\n");
    exit(1);
}
