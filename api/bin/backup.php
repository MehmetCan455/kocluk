<?php

declare(strict_types=1);

/**
 * Daily MariaDB backup CLI.
 *
 * Usage:
 *   php api/bin/backup.php [--dir=PATH] [--keep-days=14]
 *                          [--offsite-dir=PATH] [--pdo]
 *
 * The script prefers mysqldump with a temporary 0600 option file so the
 * database password never appears in the process list or in the repository.
 * When exec()/mysqldump is unavailable it falls back to a PDO dump that reads
 * information_schema, skips PERSISTENT/VIRTUAL generated columns and streams
 * rows into a gzip file. Both paths write kocluk-YYYYMMDD-HHMMSS.sql.gz under
 * a directory outside public_html, keep 14 daily files, keep an 8-week Sunday
 * copy in weekly/, and optionally copy the archive to backup.offsite_dir.
 *
 * Cron (03:00 server time, adjust the PHP path if needed):
 *   0 3 * * * KOCLUK_CONFIG=/home/u2964068/kocluk-config.php \
 *     /usr/local/bin/php /home/u2964068/public_html/api/bin/backup.php \
 *     >> /home/u2964068/kocluk-backups/cron.log 2>&1
 *
 * Restore steps live in README.md ("Sunucu yedeği ve geri yükleme").
 */

use Kocluk\Api\Db\Database;
use Kocluk\Api\Support\ConfigFile;

if (PHP_SAPI !== 'cli') {
    http_response_code(404);
    exit(1);
}

require dirname(__DIR__) . '/src/bootstrap.php';

const BACKUP_DEFAULT_DIR = '/home/u2964068/kocluk-backups';

const BACKUP_DEFAULT_KEEP_DAYS = 14;

/** Eight weekly Sunday copies, matching the design's weekly archive. */
const BACKUP_WEEKLY_KEEP_DAYS = 56;

function backupUsage(): string
{
    return <<<'TEXT'
Kullanım: php api/bin/backup.php [seçenekler]

  --dir=PATH          Yedek dizini (varsayılan: config backup.dir veya
                      /home/u2964068/kocluk-backups). public_html içinde olamaz.
  --keep-days=N       Günlük yedek saklama süresi (varsayılan: config
                      backup.keep_days veya 14).
  --offsite-dir=PATH  Yedeği ayrıca bu dizine kopyala. Boşsa yalnızca uyarı verir.
  --pdo               mysqldump olsa bile PDO dökümünü kullan (testler için).
  -h, --help          Bu metni göster.

Çıkış kodları: 0 başarılı, 1 yedek hatası, 2 kullanım hatası.

TEXT;
}

/**
 * @param list<string> $argv
 * @return array{dir: ?string, keep_days: ?int, offsite_dir: ?string, force_pdo: bool, help: bool}
 */
function backupParseOptions(array $argv): array
{
    $options = [
        'dir' => null,
        'keep_days' => null,
        'offsite_dir' => null,
        'force_pdo' => false,
        'help' => false,
    ];

    foreach (array_slice($argv, 1) as $argument) {
        if ($argument === '--help' || $argument === '-h') {
            $options['help'] = true;
            continue;
        }

        if ($argument === '--pdo') {
            $options['force_pdo'] = true;
            continue;
        }

        if (str_starts_with($argument, '--dir=')) {
            $value = substr($argument, strlen('--dir='));

            if ($value === '') {
                throw new InvalidArgumentException('--dir boş olamaz.');
            }

            $options['dir'] = $value;
            continue;
        }

        if (str_starts_with($argument, '--offsite-dir=')) {
            $value = substr($argument, strlen('--offsite-dir='));

            if ($value === '') {
                throw new InvalidArgumentException('--offsite-dir boş olamaz.');
            }

            $options['offsite_dir'] = $value;
            continue;
        }

        if (str_starts_with($argument, '--keep-days=')) {
            $value = substr($argument, strlen('--keep-days='));

            if ($value === '' || !ctype_digit($value)) {
                throw new InvalidArgumentException('--keep-days pozitif bir tam sayı olmalı.');
            }

            $options['keep_days'] = (int) $value;
            continue;
        }

        throw new InvalidArgumentException('Bilinmeyen seçenek: ' . $argument);
    }

    if (
        $options['keep_days'] !== null
        && ($options['keep_days'] < 1 || $options['keep_days'] > 3650)
    ) {
        throw new InvalidArgumentException('--keep-days 1 ile 3650 arasında olmalı.');
    }

    return $options;
}

function backupFail(string $message, int $exitCode = 1): never
{
    fwrite(STDERR, 'HATA: ' . $message . "\n");
    exit($exitCode);
}

/**
 * Normalises and validates a directory path before anything is written.
 */
function backupAssertDirectoryPath(string $path, string $label): string
{
    $path = rtrim(str_replace('\\', '/', trim($path)), '/');

    if ($path === '') {
        throw new InvalidArgumentException($label . ' boş olamaz.');
    }

    if ($path[0] !== '/') {
        throw new InvalidArgumentException($label . ' mutlak bir yol olmalı: ' . $path);
    }

    if (preg_match('#(^|/)public_html(/|$)#i', $path) === 1) {
        throw new InvalidArgumentException($label . ' public_html içinde olamaz: ' . $path);
    }

    return $path;
}

function backupEnsureDirectory(string $directory): void
{
    if (is_dir($directory)) {
        if (!is_writable($directory)) {
            throw new RuntimeException('Dizin yazılabilir değil: ' . $directory);
        }

        @chmod($directory, 0700);

        return;
    }

    if (!@mkdir($directory, 0700, true) && !is_dir($directory)) {
        throw new RuntimeException('Dizin oluşturulamadı: ' . $directory);
    }

    @chmod($directory, 0700);
}

function backupFindMysqldump(): ?string
{
    if (!function_exists('exec')) {
        return null;
    }

    $disabled = array_filter(array_map(
        'trim',
        explode(',', (string) ini_get('disable_functions')),
    ));

    if (in_array('exec', $disabled, true)) {
        return null;
    }

    $output = [];
    $status = 1;
    @exec('command -v mysqldump 2>/dev/null', $output, $status);

    if ($status === 0) {
        $candidate = trim((string) ($output[0] ?? ''));

        if ($candidate !== '' && is_file($candidate) && is_executable($candidate)) {
            return $candidate;
        }
    }

    foreach ([
        '/usr/bin/mysqldump',
        '/usr/local/bin/mysqldump',
        '/usr/local/mysql/bin/mysqldump',
    ] as $candidate) {
        if (is_file($candidate) && is_executable($candidate)) {
            return $candidate;
        }
    }

    return null;
}

/**
 * Quotes a value for a MySQL option file ([client] section).
 */
function backupOptionValue(string $value): string
{
    $value = str_replace(["\r", "\n"], '', $value);

    return '"' . str_replace(['\\', '"'], ['\\\\', '\\"'], $value) . '"';
}

/**
 * Runs mysqldump into a temporary .sql file. The caller compresses it.
 *
 * @param array<string, mixed> $databaseConfig
 */
function backupDumpWithMysqldump(string $binary, array $databaseConfig, string $targetSql): bool
{
    $defaults = tempnam(sys_get_temp_dir(), 'kocluk-mysql-');

    if ($defaults === false) {
        return false;
    }

    $database = (string) ($databaseConfig['database'] ?? '');
    $password = (string) ($databaseConfig['password'] ?? '');
    $errorFile = $targetSql . '.err';
    $ok = false;

    try {
        $contents = "[client]\n"
            . 'user=' . backupOptionValue((string) ($databaseConfig['username'] ?? '')) . "\n"
            . 'password=' . backupOptionValue($password) . "\n"
            . 'host=' . backupOptionValue((string) ($databaseConfig['host'] ?? 'localhost')) . "\n"
            . 'port=' . (int) ($databaseConfig['port'] ?? 3306) . "\n";

        if (file_put_contents($defaults, $contents) === false) {
            return false;
        }

        @chmod($defaults, 0600);

        $command = escapeshellarg($binary)
            . ' --defaults-extra-file=' . escapeshellarg($defaults)
            . ' --single-transaction --quick --routines --triggers --no-tablespaces'
            . ' --default-character-set=utf8mb4'
            . ' ' . escapeshellarg($database)
            . ' > ' . escapeshellarg($targetSql)
            . ' 2> ' . escapeshellarg($errorFile);

        $output = [];
        $status = 1;
        @exec($command, $output, $status);

        $size = is_file($targetSql) ? filesize($targetSql) : false;
        $ok = $status === 0 && $size !== false && $size > 0;

        if (!$ok) {
            $detail = is_file($errorFile)
                ? trim((string) file_get_contents($errorFile))
                : '';

            if ($password !== '') {
                $detail = str_replace($password, '***', $detail);
            }

            fwrite(
                STDERR,
                'mysqldump başarısız (kod ' . $status . ')'
                . ($detail !== '' ? ': ' . $detail : '')
                . "\n",
            );
        }
    } finally {
        @unlink($defaults);
        @unlink($errorFile);

        if (!$ok) {
            @unlink($targetSql);
        }
    }

    return $ok;
}

function backupCompress(string $source, string $target): void
{
    $input = @fopen($source, 'rb');

    if ($input === false) {
        throw new RuntimeException('Geçici döküm açılamadı: ' . $source);
    }

    $output = @gzopen($target, 'wb9');

    if ($output === false) {
        fclose($input);
        throw new RuntimeException('Sıkıştırılmış yedek açılamadı: ' . $target);
    }

    try {
        while (!feof($input)) {
            $chunk = fread($input, 1024 * 1024);

            if ($chunk === false) {
                throw new RuntimeException('Geçici döküm okunamadı.');
            }

            if ($chunk === '') {
                continue;
            }

            if (gzwrite($output, $chunk) === false) {
                throw new RuntimeException('Sıkıştırılmış yedeğe yazılamadı.');
            }
        }
    } finally {
        fclose($input);
        gzclose($output);
    }
}

function backupIdentifier(string $name): string
{
    return '`' . str_replace('`', '``', $name) . '`';
}

function backupSqlValue(Database $database, mixed $value): string
{
    if ($value === null) {
        return 'NULL';
    }

    if (is_bool($value)) {
        return $value ? '1' : '0';
    }

    if (is_int($value) || is_float($value)) {
        return (string) $value;
    }

    return $database->quote((string) $value);
}

/**
 * @param resource $handle
 */
function backupWrite($handle, string $data): void
{
    if (gzwrite($handle, $data) === false) {
        throw new RuntimeException('Yedek dosyasına yazılamadı.');
    }
}

function backupDumpWithPdo(Database $database, string $target): int
{
    $output = @gzopen($target, 'wb9');

    if ($output === false) {
        throw new RuntimeException('Sıkıştırılmış yedek açılamadı: ' . $target);
    }

    $rowsWritten = 0;

    try {
        backupWrite($output, "-- Kocluk MariaDB yedegi (PDO)\n");
        backupWrite($output, '-- Olusturulma: ' . gmdate('c') . " UTC\n");
        backupWrite(
            $output,
            "SET NAMES utf8mb4;\nSET time_zone = '+00:00';\nSET FOREIGN_KEY_CHECKS=0;\n\n",
        );

        $database->exec('SET SESSION TRANSACTION ISOLATION LEVEL REPEATABLE READ');
        $database->exec('START TRANSACTION WITH CONSISTENT SNAPSHOT');

        try {
            $tables = $database->fetchAll('SHOW TABLES');

            foreach ($tables as $tableRow) {
                $table = (string) array_values($tableRow)[0];
                $quotedTable = backupIdentifier($table);
                $create = $database->fetchOne('SHOW CREATE TABLE ' . $quotedTable);

                if ($create === null) {
                    throw new RuntimeException('Tablo yapısı okunamadı: ' . $table);
                }

                $createSql = (string) array_values($create)[1];

                backupWrite($output, '-- Tablo: ' . $table . "\n");
                backupWrite($output, 'DROP TABLE IF EXISTS ' . $quotedTable . ";\n");
                backupWrite($output, $createSql . ";\n\n");

                $columnRows = $database->fetchAll(
                    'SELECT `column_name` AS `column_name` FROM `information_schema`.`columns`'
                    . ' WHERE `table_schema` = DATABASE() AND `table_name` = ?'
                    . " AND `extra` NOT LIKE '%GENERATED%'"
                    . ' ORDER BY `ordinal_position`',
                    [$table],
                );

                $columns = [];

                foreach ($columnRows as $columnRow) {
                    $columns[] = (string) $columnRow['column_name'];
                }

                if ($columns === []) {
                    continue;
                }

                $columnList = implode(', ', array_map(
                    static fn (string $column): string => backupIdentifier($column),
                    $columns,
                ));
                $select = 'SELECT ' . $columnList . ' FROM ' . $quotedTable;
                $batch = [];
                $batchBytes = 0;

                foreach ($database->iterate($select) as $row) {
                    $values = [];

                    foreach ($columns as $column) {
                        $values[] = backupSqlValue($database, $row[$column] ?? null);
                    }

                    $tuple = '(' . implode(', ', $values) . ')';
                    $batch[] = $tuple;
                    $batchBytes += strlen($tuple);

                    if (count($batch) >= 100 || $batchBytes >= 1_000_000) {
                        backupWrite(
                            $output,
                            'INSERT INTO ' . $quotedTable . ' (' . $columnList . ") VALUES\n"
                            . implode(",\n", $batch) . ";\n",
                        );
                        $rowsWritten += count($batch);
                        $batch = [];
                        $batchBytes = 0;
                    }
                }

                if ($batch !== []) {
                    backupWrite(
                        $output,
                        'INSERT INTO ' . $quotedTable . ' (' . $columnList . ") VALUES\n"
                        . implode(",\n", $batch) . ";\n",
                    );
                    $rowsWritten += count($batch);
                }

                backupWrite($output, "\n");
            }

            $database->exec('COMMIT');
        } catch (Throwable $error) {
            try {
                $database->exec('ROLLBACK');
            } catch (Throwable) {
                // A failed ROLLBACK must not hide the original dump error.
            }

            throw $error;
        }

        backupWrite($output, "SET FOREIGN_KEY_CHECKS=1;\n");
    } finally {
        gzclose($output);
    }

    return $rowsWritten;
}

function backupPrune(string $directory, string $pattern, int $keepDays): int
{
    $deleted = 0;
    $cutoff = time() - ($keepDays * 86400);

    foreach (glob($directory . '/' . $pattern) ?: [] as $file) {
        if (!is_file($file)) {
            continue;
        }

        $modified = @filemtime($file);

        if ($modified === false || $modified >= $cutoff) {
            continue;
        }

        if (@unlink($file)) {
            $deleted++;
        } else {
            fwrite(STDERR, 'UYARI: Eski yedek silinemedi: ' . $file . "\n");
        }
    }

    return $deleted;
}

function backupFormatBytes(int $bytes): string
{
    if ($bytes >= 1048576) {
        return number_format($bytes / 1048576, 2, ',', '.') . ' MB';
    }

    if ($bytes >= 1024) {
        return number_format($bytes / 1024, 1, ',', '.') . ' KB';
    }

    return $bytes . ' B';
}

try {
    $options = backupParseOptions($argv);
} catch (InvalidArgumentException $error) {
    fwrite(STDERR, 'HATA: ' . $error->getMessage() . "\n\n" . backupUsage());
    exit(2);
}

if ($options['help']) {
    fwrite(STDOUT, backupUsage());
    exit(0);
}

$configPath = ConfigFile::path(dirname(__DIR__));

if ($configPath === null) {
    backupFail('config.php bulunamadı. KOCLUK_CONFIG ortam değişkenini ayarlayın.');
}

$config = require $configPath;

if (!is_array($config)) {
    backupFail('Yapılandırma bir dizi döndürmeli: ' . $configPath);
}

$databaseConfig = is_array($config['db'] ?? null) ? $config['db'] : [];
$backupConfig = is_array($config['backup'] ?? null) ? $config['backup'] : [];

$keepDays = $options['keep_days'];

if ($keepDays === null) {
    $configuredKeepDays = $backupConfig['keep_days'] ?? BACKUP_DEFAULT_KEEP_DAYS;

    if (is_string($configuredKeepDays) && ctype_digit($configuredKeepDays)) {
        $configuredKeepDays = (int) $configuredKeepDays;
    }

    if (!is_int($configuredKeepDays) || $configuredKeepDays < 1 || $configuredKeepDays > 3650) {
        backupFail('backup.keep_days 1 ile 3650 arasında bir tam sayı olmalı.', 2);
    }

    $keepDays = $configuredKeepDays;
}

try {
    $directory = backupAssertDirectoryPath(
        (string) ($options['dir'] ?? $backupConfig['dir'] ?? BACKUP_DEFAULT_DIR),
        'Yedek dizini',
    );
    $offsiteDirectory = (string) (
        $options['offsite_dir'] ?? $backupConfig['offsite_dir'] ?? ''
    );

    if ($offsiteDirectory !== '') {
        $offsiteDirectory = backupAssertDirectoryPath($offsiteDirectory, 'Offsite dizini');
    }
} catch (InvalidArgumentException $error) {
    backupFail($error->getMessage(), 2);
}

try {
    backupEnsureDirectory($directory);
} catch (Throwable $error) {
    backupFail($error->getMessage());
}

$stamp = gmdate('Ymd-His');
$target = $directory . '/kocluk-' . $stamp . '.sql.gz';

if (is_file($target)) {
    $target = $directory . '/kocluk-' . $stamp . '-'
        . bin2hex(random_bytes(3)) . '.sql.gz';
}

$temporarySql = $directory . '/.kocluk-' . bin2hex(random_bytes(6)) . '.sql';
$method = 'pdo';
$rows = null;

try {
    $binary = $options['force_pdo'] ? null : backupFindMysqldump();

    if ($binary !== null) {
        if (backupDumpWithMysqldump($binary, $databaseConfig, $temporarySql)) {
            backupCompress($temporarySql, $target);
            @unlink($temporarySql);
            $method = 'mysqldump';
        } else {
            fwrite(STDERR, "UYARI: mysqldump başarısız; PDO dökümüne geçiliyor.\n");
        }
    }

    if ($method !== 'mysqldump') {
        $database = Database::connect($databaseConfig);
        $rows = backupDumpWithPdo($database, $target);
    }
} catch (Throwable $error) {
    @unlink($temporarySql);
    @unlink($target);
    backupFail('Yedek oluşturulamadı: ' . $error->getMessage());
}

$size = @filesize($target);

if ($size === false || $size === 0) {
    @unlink($target);
    backupFail('Yedek dosyası boş kaldı: ' . $target);
}

@chmod($target, 0600);

$removed = backupPrune($directory, 'kocluk-*.sql.gz', $keepDays);
$warnings = [];

if (gmdate('N') === '7') {
    try {
        $weeklyDirectory = $directory . '/weekly';
        backupEnsureDirectory($weeklyDirectory);

        $weeklyTarget = $weeklyDirectory . '/kocluk-week-' . $stamp . '.sql.gz';

        if (!@copy($target, $weeklyTarget)) {
            throw new RuntimeException('Kopyalanamadı: ' . $weeklyTarget);
        }

        @chmod($weeklyTarget, 0600);
        $weeklyRemoved = backupPrune(
            $weeklyDirectory,
            'kocluk-week-*.sql.gz',
            BACKUP_WEEKLY_KEEP_DAYS,
        );

        fwrite(
            STDOUT,
            'Haftalık kopya: ' . $weeklyTarget
            . ' (' . $weeklyRemoved . " eski dosya silindi)\n",
        );
    } catch (Throwable $error) {
        $warnings[] = 'Haftalık kopya oluşturulamadı: ' . $error->getMessage();
    }
}

$offsiteFailed = false;

if ($offsiteDirectory !== '') {
    try {
        backupEnsureDirectory($offsiteDirectory);
        $offsiteTarget = $offsiteDirectory . '/' . basename($target);

        if (!@copy($target, $offsiteTarget)) {
            throw new RuntimeException('Kopyalanamadı: ' . $offsiteTarget);
        }

        @chmod($offsiteTarget, 0600);
        fwrite(STDOUT, 'Offsite kopya: ' . $offsiteTarget . "\n");
    } catch (Throwable $error) {
        $offsiteFailed = true;
        $warnings[] = 'Offsite kopya başarısız: ' . $error->getMessage();
    }
} else {
    $warnings[] = 'Offsite dizini tanımlı değil; yedeği haftalık olarak şifreli '
        . 'biçimde bilgisayarına indir.';
}

fwrite(STDOUT, 'Yedek tamam: ' . $target . ' (' . backupFormatBytes((int) $size)
    . ', ' . $method . ($rows !== null ? ', ' . $rows . ' satır' : '') . ")\n");
fwrite(STDOUT, 'Temizlik: ' . $removed . ' eski günlük yedek silindi (saklama: '
    . $keepDays . " gün).\n");

foreach ($warnings as $warning) {
    fwrite(STDERR, 'UYARI: ' . $warning . "\n");
}

exit($offsiteFailed ? 1 : 0);
