<?php

declare(strict_types=1);

namespace Kocluk\Api\Db;

use RuntimeException;

/**
 * Applies api/migrations/*.sql in filename order.
 *
 * Applied filenames are recorded in schema_migrations, so running the
 * migrator again is a no-op. Every migration statement is written with
 * IF NOT EXISTS as well: MySQL commits DDL implicitly, so a failed file can
 * leave earlier tables behind, and the retry must tolerate that.
 */
final class Migrator
{
    private const SCHEMA_TABLE = <<<'SQL'
        CREATE TABLE IF NOT EXISTS `schema_migrations` (
            `version` VARCHAR(255) NOT NULL,
            `applied_at` DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
            PRIMARY KEY (`version`)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
        SQL;

    public function __construct(
        private readonly Database $db,
        private readonly string $directory,
    ) {
    }

    /**
     * @return list<string> migration versions applied by this run
     */
    public function run(): array
    {
        $applied = $this->appliedVersions();
        $justApplied = [];

        foreach ($this->files() as $path) {
            $version = basename($path);

            if (in_array($version, $applied, true)) {
                continue;
            }

            $this->apply($path, $version);
            $justApplied[] = $version;
        }

        return $justApplied;
    }

    /**
     * @return list<string>
     */
    public function appliedVersions(): array
    {
        $this->db->exec(self::SCHEMA_TABLE);

        $rows = $this->db->fetchAll('SELECT `version` FROM `schema_migrations` ORDER BY `version`');

        return array_map(
            static fn (array $row): string => (string) $row['version'],
            $rows,
        );
    }

    private function apply(string $path, string $version): void
    {
        $sql = file_get_contents($path);

        if ($sql === false) {
            throw new RuntimeException('Migration dosyası okunamadı: ' . $path);
        }

        $this->db->transaction(function () use ($sql, $version): void {
            foreach ($this->statements($sql) as $statement) {
                $this->db->exec($statement);
            }

            $this->db->execute(
                'INSERT INTO `schema_migrations` (`version`, `applied_at`) VALUES (?, UTC_TIMESTAMP(6))',
                [$version],
            );
        });
    }

    /**
     * @return list<string>
     */
    private function files(): array
    {
        $files = glob(rtrim($this->directory, '/\\') . DIRECTORY_SEPARATOR . '*.sql');

        if ($files === false || $files === []) {
            throw new RuntimeException('Migration bulunamadı: ' . $this->directory);
        }

        sort($files, SORT_STRING);

        return array_values($files);
    }

    /**
     * Splits a migration file into single statements, respecting quotes,
     * doubled quotes and `--` line comments.
     *
     * @return list<string>
     */
    private function statements(string $sql): array
    {
        $statements = [];
        $buffer = '';
        $length = strlen($sql);
        $quote = null;
        $inLineComment = false;

        for ($i = 0; $i < $length; $i++) {
            $char = $sql[$i];
            $next = $i + 1 < $length ? $sql[$i + 1] : '';

            if ($inLineComment) {
                $buffer .= $char;

                if ($char === "\n") {
                    $inLineComment = false;
                }

                continue;
            }

            if ($quote !== null) {
                $buffer .= $char;

                if ($char === '\\' && $quote === "'" && $next !== '') {
                    $buffer .= $next;
                    $i++;
                    continue;
                }

                if ($char === $quote) {
                    if ($next === $quote) {
                        $buffer .= $next;
                        $i++;
                        continue;
                    }

                    $quote = null;
                }

                continue;
            }

            if ($char === '-' && $next === '-') {
                $inLineComment = true;
                $buffer .= $char;
                continue;
            }

            if ($char === "'" || $char === '"' || $char === '`') {
                $quote = $char;
                $buffer .= $char;
                continue;
            }

            if ($char === ';') {
                $statements[] = trim($buffer);
                $buffer = '';
                continue;
            }

            $buffer .= $char;
        }

        $statements[] = trim($buffer);

        return array_values(array_filter(
            $statements,
            fn (string $statement): bool => $this->hasSql($statement),
        ));
    }

    private function hasSql(string $statement): bool
    {
        foreach (preg_split('/\R/', $statement) ?: [] as $line) {
            $line = trim($line);

            if ($line === '' || str_starts_with($line, '--')) {
                continue;
            }

            return true;
        }

        return false;
    }
}
