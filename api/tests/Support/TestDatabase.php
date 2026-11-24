<?php

declare(strict_types=1);

namespace Kocluk\Api\Tests\Support;

use Kocluk\Api\Db\Database;
use Kocluk\Api\Db\Migrator;

/**
 * Shared MariaDB connection for integration tests.
 *
 * The schema is migrated once per PHPUnit process and every test can call
 * reset() to truncate the data tables. Credentials come from the DB_*
 * environment variables that tests/bootstrap.php normalises.
 */
final class TestDatabase
{
    private static ?Database $database = null;

    /**
     * @return array{host: string, port: int, database: string, username: string, password: string}
     */
    public static function config(): array
    {
        return [
            'host' => (string) (getenv('DB_HOST') ?: '127.0.0.1'),
            'port' => (int) (getenv('DB_PORT') ?: 3306),
            'database' => (string) (getenv('DB_DATABASE') ?: 'kocluk_test'),
            'username' => (string) (getenv('DB_USERNAME') ?: 'root'),
            'password' => (string) (getenv('DB_PASSWORD') ?: ''),
        ];
    }

    public static function database(): Database
    {
        if (self::$database === null) {
            self::$database = Database::connect(self::config());
            self::migrate();
        }

        return self::$database;
    }

    /**
     * Applies pending migrations and returns the versions applied now.
     *
     * @return list<string>
     */
    public static function migrate(): array
    {
        $database = self::$database ??= Database::connect(self::config());

        return (new Migrator($database, self::migrationsDirectory()))->run();
    }

    /**
     * Truncates every table except schema_migrations so each test starts
     * from an empty database with fresh AUTO_INCREMENT counters.
     */
    public static function reset(): void
    {
        $database = self::database();

        foreach (self::tables($database) as $table) {
            if ($table === 'schema_migrations') {
                continue;
            }

            $database->exec('TRUNCATE TABLE `' . $table . '`');
        }
    }

    /**
     * @return list<string>
     */
    public static function tables(Database $database): array
    {
        $rows = $database->fetchAll('SHOW TABLES');

        return array_map(
            static fn (array $row): string => (string) array_values($row)[0],
            $rows,
        );
    }

    public static function migrationsDirectory(): string
    {
        return dirname(__DIR__, 2) . '/migrations';
    }
}
