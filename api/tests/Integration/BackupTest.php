<?php

declare(strict_types=1);

namespace Kocluk\Api\Tests\Integration;

use Kocluk\Api\Db\Database;
use Kocluk\Api\Support\Clock;
use Kocluk\Api\Tests\Support\TestDatabase;
use PHPUnit\Framework\TestCase;

/**
 * Exercises the real backup CLI against the migrated MariaDB test database.
 *
 * Only the PDO fallback is forced here: mysqldump is a server binary and its
 * availability differs between the CI runner and Natro. The fallback is the
 * path that must always work, including generated active_* columns.
 */
final class BackupTest extends TestCase
{
    private const USER_ID = '11111111-1111-4111-8111-111111111111';
    private const BOOK_ID = '33333333-3333-4333-8333-333333333333';
    private const USER_BOOK_ID = '44444444-4444-4444-8444-444444444444';

    private static Database $database;

    private string $root;

    private string $configPath;

    private string $backupDirectory;

    public static function setUpBeforeClass(): void
    {
        self::$database = TestDatabase::database();
    }

    protected function setUp(): void
    {
        TestDatabase::reset();

        $this->root = sys_get_temp_dir() . '/kocluk-backup-' . bin2hex(random_bytes(8));
        self::assertTrue(mkdir($this->root, 0700));

        $this->configPath = $this->root . '/config.php';
        $this->backupDirectory = $this->root . '/backups';
        self::assertTrue(mkdir($this->backupDirectory, 0700));

        $config = '<?php return ' . var_export([
            'db' => TestDatabase::config(),
            'backup' => [
                'dir' => $this->backupDirectory,
                'offsite_dir' => '',
                'keep_days' => 14,
            ],
        ], true) . ";\n";

        self::assertNotFalse(file_put_contents($this->configPath, $config));
        @chmod($this->configPath, 0600);
    }

    protected function tearDown(): void
    {
        $this->removeDirectory($this->root);
    }

    public function test_pdo_backup_writes_gzip_data_and_skips_generated_columns(): void
    {
        $this->insertUser('Çağrı Şen');
        $this->insertUserBook('İlk satır' . "\n" . 'İkinci "satır" \\ test');

        $old = $this->backupDirectory . '/kocluk-20000101-000000.sql.gz';
        self::assertNotFalse(file_put_contents($old, 'old'));
        self::assertTrue(touch($old, time() - 3 * 86400));

        [$exitCode, $stdout, $stderr] = $this->runBackup([
            '--pdo',
            '--keep-days=1',
            '--dir=' . $this->backupDirectory,
        ]);

        self::assertSame(0, $exitCode, $stderr);
        self::assertStringContainsString('Yedek tamam', $stdout);
        self::assertStringContainsString('Offsite dizini tanımlı değil', $stderr);
        self::assertFalse(is_file($old), 'Saklama süresi geçen yedek silinmedi.');

        $files = glob($this->backupDirectory . '/kocluk-*.sql.gz') ?: [];
        self::assertCount(1, $files);

        $compressed = file_get_contents($files[0]);
        self::assertIsString($compressed);

        $dump = gzdecode($compressed);
        self::assertIsString($dump);

        self::assertStringContainsString('CREATE TABLE `users`', $dump);
        self::assertStringContainsString('DROP TABLE IF EXISTS `users`;', $dump);
        self::assertStringContainsString('SET FOREIGN_KEY_CHECKS=0;', $dump);
        self::assertStringContainsString('Çağrı Şen', $dump);
        self::assertStringContainsString('İkinci "satır"', $dump);

        self::assertMatchesRegularExpression(
            '/INSERT INTO `user_books` \([^)]*`id`/',
            $dump,
        );
        self::assertDoesNotMatchRegularExpression(
            '/INSERT INTO `user_books` \([^)]*`active_book_id`/',
            $dump,
            'PERSISTENT generated kolon INSERT listesine girmemeli.',
        );

        self::assertSame(0600, fileperms($files[0]) & 0777);
        self::assertSame([], glob($this->backupDirectory . '/.kocluk-*') ?: []);
    }

    public function test_backup_refuses_a_directory_inside_public_html(): void
    {
        [$exitCode, , $stderr] = $this->runBackup([
            '--pdo',
            '--dir=/home/u2964068/public_html/backups',
        ]);

        self::assertSame(2, $exitCode);
        self::assertStringContainsString('public_html', $stderr);
    }

    public function test_backup_fails_clearly_when_the_config_is_missing(): void
    {
        [$exitCode, , $stderr] = $this->runBackup(
            ['--pdo'],
            $this->root . '/missing-config.php',
        );

        self::assertSame(1, $exitCode);
        self::assertStringContainsString('config.php bulunamadı', $stderr);
    }

    /**
     * @param list<string> $arguments
     * @return array{0: int, 1: string, 2: string}
     */
    private function runBackup(array $arguments, ?string $configPath = null): array
    {
        $command = escapeshellarg(PHP_BINARY)
            . ' ' . escapeshellarg(dirname(__DIR__, 2) . '/bin/backup.php');

        foreach ($arguments as $argument) {
            $command .= ' ' . escapeshellarg($argument);
        }

        $descriptors = [
            1 => ['pipe', 'w'],
            2 => ['pipe', 'w'],
        ];

        $environment = getenv();

        if (!is_array($environment)) {
            $environment = [];
        }

        $environment['KOCLUK_CONFIG'] = $configPath ?? $this->configPath;

        $process = proc_open($command, $descriptors, $pipes, null, $environment);
        self::assertIsResource($process);

        $stdout = stream_get_contents($pipes[1]);
        $stderr = stream_get_contents($pipes[2]);
        fclose($pipes[1]);
        fclose($pipes[2]);
        $exitCode = proc_close($process);

        return [$exitCode, (string) $stdout, (string) $stderr];
    }

    private function insertUser(string $displayName): void
    {
        $now = Clock::nowSql();

        self::$database->execute(
            'INSERT INTO `users`
                (`id`, `email`, `password_hash`, `display_name`, `privacy_version`, `consented_at`, `created_at`, `updated_at`)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
            [
                self::USER_ID,
                'yedek@example.com',
                '$2y$12$placeholderplaceholderplaceholderplaceholder',
                $displayName,
                '2026-11-24',
                $now,
                $now,
                $now,
            ],
        );
    }

    private function insertUserBook(string $note): void
    {
        $now = Clock::nowSql();

        self::$database->execute(
            'INSERT INTO `user_books`
                (`id`, `user_id`, `book_id`, `note`, `status`, `created_at`, `updated_at`)
             VALUES (?, ?, ?, ?, ?, ?, ?)',
            [self::USER_BOOK_ID, self::USER_ID, self::BOOK_ID, $note, 'active', $now, $now],
        );
    }

    private function removeDirectory(string $directory): void
    {
        if (!is_dir($directory)) {
            return;
        }

        foreach (scandir($directory) ?: [] as $entry) {
            if ($entry === '.' || $entry === '..') {
                continue;
            }

            $path = $directory . '/' . $entry;

            if (is_dir($path)) {
                $this->removeDirectory($path);
            } else {
                @unlink($path);
            }
        }

        @rmdir($directory);
    }
}
