<?php

declare(strict_types=1);

/**
 * PHPUnit bootstrap.
 *
 * Loads the Composer autoloader and normalises the test database settings.
 * GitHub Actions provides them through the mariadb service container; locally
 * they can be exported in the shell before running PHPUnit.
 */

require __DIR__ . '/../vendor/autoload.php';

$dbEnv = [
    'DB_HOST' => '127.0.0.1',
    'DB_PORT' => '3306',
    'DB_DATABASE' => 'kocluk_test',
    'DB_USERNAME' => 'root',
    'DB_PASSWORD' => '',
];

foreach ($dbEnv as $name => $default) {
    $value = getenv($name);

    if ($value === false || $value === '') {
        $value = $default;
    }

    putenv($name . '=' . $value);
    $_ENV[$name] = $value;
    $_SERVER[$name] = $value;
}

unset($dbEnv, $name, $default, $value);
