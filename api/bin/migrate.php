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

require $root . '/src/bootstrap.php';

// Same candidate order as api/index.php (src/Support/ConfigFile.php):
// KOCLUK_CONFIG, then the file outside public_html, then api/config.php.
$configPath = \Kocluk\Api\Support\ConfigFile::path($root);

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
