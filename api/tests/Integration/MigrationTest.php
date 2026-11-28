<?php

declare(strict_types=1);

namespace Kocluk\Api\Tests\Integration;

use Kocluk\Api\Db\Database;
use Kocluk\Api\Support\Clock;
use Kocluk\Api\Tests\Support\TestDatabase;
use PDOException;
use PHPUnit\Framework\TestCase;

final class MigrationTest extends TestCase
{
    private const USER_ID = '11111111-1111-4111-8111-111111111111';
    private const OTHER_USER_ID = '22222222-2222-4222-8222-222222222222';
    private const BOOK_ID = '33333333-3333-4333-8333-333333333333';
    private const EXAM_ID = '66666666-6666-4666-8666-666666666666';
    private const SUBJECT_ID = '77777777-7777-4777-8777-777777777777';

    private const TABLES = [
        'schema_migrations',
        'users',
        'sessions',
        'password_resets',
        'email_verifications',
        'rate_limits',
        'subjects',
        'topics',
        'exams',
        'exam_results',
        'notes',
        'catalog_books',
        'user_books',
        'activity_logs',
        'schedule_weeks',
        'schedule_rows',
        'schedule_tasks',
        'schedule_page_chains',
        'topic_progress',
        'user_settings',
        'sync_changes',
    ];

    private const SYNC_TABLES = [
        'subjects',
        'topics',
        'exams',
        'exam_results',
        'notes',
        'catalog_books',
        'user_books',
        'activity_logs',
        'schedule_weeks',
        'schedule_rows',
        'schedule_tasks',
        'schedule_page_chains',
        'topic_progress',
        'user_settings',
    ];

    private static Database $db;

    public static function setUpBeforeClass(): void
    {
        self::$db = TestDatabase::database();
    }

    protected function setUp(): void
    {
        TestDatabase::reset();
    }

    public function test_expected_tables_exist(): void
    {
        $tables = TestDatabase::tables(self::$db);
        sort($tables);

        $expected = self::TABLES;
        sort($expected);

        self::assertSame($expected, $tables);
    }

    public function test_all_tables_are_innodb_utf8mb4(): void
    {
        $rows = self::$db->fetchAll(
            'SELECT `table_name` AS table_name, `engine` AS engine, `table_collation` AS table_collation
             FROM `information_schema`.`tables`
             WHERE `table_schema` = DATABASE()
             ORDER BY `table_name`',
        );

        self::assertCount(count(self::TABLES), $rows);

        foreach ($rows as $row) {
            self::assertSame('InnoDB', $row['engine'], (string) $row['table_name']);
            self::assertSame('utf8mb4_unicode_ci', $row['table_collation'], (string) $row['table_name']);
        }
    }

    public function test_connection_pins_utf8mb4_and_utc(): void
    {
        $charset = self::$db->fetchOne("SHOW VARIABLES LIKE 'character_set_connection'");
        self::assertNotNull($charset);
        self::assertSame('utf8mb4', strtolower((string) array_values($charset)[1]));

        $timeZone = self::$db->fetchOne("SHOW VARIABLES LIKE 'time_zone'");
        self::assertNotNull($timeZone);
        self::assertSame('+00:00', (string) array_values($timeZone)[1]);
    }

    public function test_users_insert_and_select_round_trips_utf8mb4(): void
    {
        $this->insertUser(self::USER_ID, 'cagri@example.com', 'Çağrı Şen');

        $row = self::$db->fetchOne(
            'SELECT `email`, `display_name` FROM `users` WHERE `id` = ?',
            [self::USER_ID],
        );

        self::assertNotNull($row);
        self::assertSame('cagri@example.com', $row['email']);
        self::assertSame('Çağrı Şen', $row['display_name']);
    }

    public function test_user_email_is_unique(): void
    {
        $this->insertUser(self::USER_ID, 'cagri@example.com', 'Çağrı Şen');

        try {
            $this->insertUser(self::OTHER_USER_ID, 'cagri@example.com', 'Başka Kişi');
            self::fail('Aynı e-posta ikinci kez eklenebildi.');
        } catch (PDOException $error) {
            self::assertSame('23000', (string) $error->getCode());
        }
    }

    public function test_subject_seed_key_is_required(): void
    {
        $this->insertSubject('cccccccc-cccc-4ccc-8ccc-cccccccccccc', 'matematik');

        try {
            self::$db->execute(
                'INSERT INTO `subjects`
                    (`id`, `user_id`, `exam`, `name`, `slug`, `icon`, `updated_at`)
                 VALUES (?, ?, ?, ?, ?, ?, ?)',
                [
                    'dddddddd-dddd-4ddd-8ddd-dddddddddddd',
                    self::USER_ID,
                    'TYT',
                    'Türkçe',
                    'turkce',
                    'book',
                    Clock::nowSql(),
                ],
            );
            self::fail('seed_key olmadan subject eklendi.');
        } catch (PDOException $error) {
            self::assertStringContainsString('seed_key', $error->getMessage());
        }

        $row = self::$db->fetchOne(
            'SELECT `seed_key` FROM `subjects` WHERE `user_id` = ?',
            [self::USER_ID],
        );

        self::assertNotNull($row);
        self::assertSame('matematik', $row['seed_key']);
    }

    public function test_second_active_user_book_is_rejected(): void
    {
        $this->insertUserBook('44444444-4444-4444-8444-444444444444');

        try {
            $this->insertUserBook('55555555-5555-4555-8555-555555555555');
            self::fail('Aynı (user_id, active_book_id) için ikinci aktif satır eklendi.');
        } catch (PDOException $error) {
            self::assertSame('23000', (string) $error->getCode());
        }

        self::assertSame(1, $this->activeUserBookCount());
    }

    public function test_soft_deleted_user_book_allows_new_active_row(): void
    {
        $now = Clock::nowSql();

        $this->insertUserBook('44444444-4444-4444-8444-444444444444');

        self::$db->execute(
            'UPDATE `user_books` SET `deleted_at` = ?, `updated_at` = ? WHERE `user_id` = ? AND `id` = ?',
            [$now, $now, self::USER_ID, '44444444-4444-4444-8444-444444444444'],
        );

        $this->insertUserBook('55555555-5555-4555-8555-555555555555');

        self::assertSame(1, $this->activeUserBookCount());
        self::assertSame(2, $this->userBookCount());
    }

    public function test_second_active_exam_result_for_same_subject_is_rejected(): void
    {
        $this->insertExamResult('88888888-8888-4888-8888-888888888888');

        try {
            $this->insertExamResult('99999999-9999-4999-8999-999999999999');
            self::fail('Aynı (user_id, exam_id, subject_id) için ikinci aktif sonuç eklendi.');
        } catch (PDOException $error) {
            self::assertSame('23000', (string) $error->getCode());
        }

        $now = Clock::nowSql();

        self::$db->execute(
            'UPDATE `exam_results` SET `deleted_at` = ?, `updated_at` = ? WHERE `user_id` = ? AND `id` = ?',
            [$now, $now, self::USER_ID, '88888888-8888-4888-8888-888888888888'],
        );

        $this->insertExamResult('99999999-9999-4999-8999-999999999999');

        $row = self::$db->fetchOne(
            'SELECT COUNT(*) AS total FROM `exam_results`
             WHERE `user_id` = ? AND `exam_id` = ? AND `subject_id` = ? AND `deleted_at` IS NULL',
            [self::USER_ID, self::EXAM_ID, self::SUBJECT_ID],
        );

        self::assertNotNull($row);
        self::assertSame(1, (int) $row['total']);
    }

    public function test_schedule_week_start_is_unique_while_active(): void
    {
        $this->insertScheduleWeek('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', '2026-11-23');

        try {
            $this->insertScheduleWeek('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', '2026-11-23');
            self::fail('Aynı user_id ve week_start için ikinci aktif hafta eklendi.');
        } catch (PDOException $error) {
            self::assertSame('23000', (string) $error->getCode());
        }

        $now = Clock::nowSql();

        self::$db->execute(
            'UPDATE `schedule_weeks` SET `deleted_at` = ?, `updated_at` = ? WHERE `user_id` = ? AND `id` = ?',
            [$now, $now, self::USER_ID, 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'],
        );

        $this->insertScheduleWeek('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', '2026-11-23');

        $row = self::$db->fetchOne(
            'SELECT COUNT(*) AS total FROM `schedule_weeks`
             WHERE `user_id` = ? AND `week_start` = ? AND `deleted_at` IS NULL',
            [self::USER_ID, '2026-11-23'],
        );

        self::assertNotNull($row);
        self::assertSame(1, (int) $row['total']);
    }

    public function test_sync_changes_id_is_auto_increment(): void
    {
        self::$db->execute(
            'INSERT INTO `sync_changes` (`user_id`, `table_name`, `row_id`, `op`) VALUES (?, ?, ?, ?)',
            [self::USER_ID, 'userBooks', '44444444-4444-4444-8444-444444444444', 'upsert'],
        );
        self::$db->execute(
            'INSERT INTO `sync_changes` (`user_id`, `table_name`, `row_id`, `op`) VALUES (?, ?, ?, ?)',
            [self::USER_ID, 'userBooks', '44444444-4444-4444-8444-444444444444', 'delete'],
        );

        $rows = self::$db->fetchAll('SELECT `id`, `op` FROM `sync_changes` ORDER BY `id`');

        self::assertCount(2, $rows);
        self::assertSame(1, (int) $rows[0]['id']);
        self::assertSame(2, (int) $rows[1]['id']);

        $column = self::$db->fetchOne(
            'SELECT `extra` AS extra FROM `information_schema`.`columns`
             WHERE `table_schema` = DATABASE() AND `table_name` = ? AND `column_name` = ?',
            ['sync_changes', 'id'],
        );

        self::assertNotNull($column);
        self::assertStringContainsString('auto_increment', strtolower((string) $column['extra']));
    }

    public function test_every_sync_table_has_server_updated_at_and_index(): void
    {
        foreach (self::SYNC_TABLES as $table) {
            $column = self::$db->fetchOne(
                'SELECT `column_name` AS column_name FROM `information_schema`.`columns`
                 WHERE `table_schema` = DATABASE() AND `table_name` = ? AND `column_name` = ?',
                [$table, 'server_updated_at'],
            );

            self::assertNotNull($column, $table . '.server_updated_at eksik.');

            $indexRows = self::$db->fetchAll(
                'SELECT `index_name` AS index_name, `column_name` AS column_name
                 FROM `information_schema`.`statistics`
                 WHERE `table_schema` = DATABASE() AND `table_name` = ? AND `index_name` <> \'PRIMARY\'
                 ORDER BY `index_name`, `seq_in_index`',
                [$table],
            );

            $columnsByIndex = [];

            foreach ($indexRows as $row) {
                $columnsByIndex[(string) $row['index_name']][] = (string) $row['column_name'];
            }

            $hasIndex = false;

            foreach ($columnsByIndex as $columns) {
                if (
                    count($columns) === 2
                    && in_array($columns[0], ['user_id', 'owner_id'], true)
                    && $columns[1] === 'server_updated_at'
                ) {
                    $hasIndex = true;
                    break;
                }
            }

            self::assertTrue($hasIndex, $table . ' için (user_id, server_updated_at) index yok.');
        }
    }

    public function test_schedule_page_chains_has_the_user_week_index(): void
    {
        $rows = self::$db->fetchAll(
            'SELECT `column_name` AS column_name
             FROM `information_schema`.`statistics`
             WHERE `table_schema` = DATABASE() AND `table_name` = ? AND `index_name` = ?
             ORDER BY `seq_in_index`',
            ['schedule_page_chains', 'idx_schedule_page_chains_user_week'],
        );

        self::assertSame(['user_id', 'week_id'], array_map(
            static fn (array $row): string => (string) $row['column_name'],
            $rows,
        ));
    }

    public function test_schedule_page_chains_skipped_chunks_is_required_text(): void
    {
        $column = self::$db->fetchOne(
            'SELECT `column_type` AS column_type, `is_nullable` AS is_nullable, `column_default` AS column_default
             FROM `information_schema`.`columns`
             WHERE `table_schema` = DATABASE() AND `table_name` = ? AND `column_name` = ?',
            ['schedule_page_chains', 'skipped_chunks'],
        );

        self::assertNotNull($column);
        self::assertSame('text', strtolower((string) $column['column_type']));
        self::assertSame('NO', $column['is_nullable']);
        self::assertSame('[]', trim((string) $column['column_default'], "'"));
    }

    public function test_schedule_page_chains_chunk_sizes_is_nullable_text(): void
    {
        $column = self::$db->fetchOne(
            'SELECT `data_type` AS data_type, `is_nullable` AS is_nullable
             FROM `information_schema`.`columns`
             WHERE `table_schema` = DATABASE() AND `table_name` = ? AND `column_name` = ?',
            ['schedule_page_chains', 'chunk_sizes'],
        );

        // Nullable because TableMap::toDb writes an absent optional field as
        // an explicit NULL; a legacy insert must still succeed.
        self::assertNotNull($column);
        self::assertSame('text', strtolower((string) $column['data_type']));
        self::assertSame('YES', $column['is_nullable']);
    }

    public function test_rate_limits_user_id_is_nullable(): void
    {
        $column = self::$db->fetchOne(
            'SELECT `is_nullable` AS is_nullable FROM `information_schema`.`columns`
             WHERE `table_schema` = DATABASE() AND `table_name` = ? AND `column_name` = ?',
            ['rate_limits', 'user_id'],
        );

        self::assertNotNull($column);
        self::assertSame('YES', $column['is_nullable']);
    }

    public function test_sync_changes_has_the_retention_index(): void
    {
        $row = self::$db->fetchOne(
            'SELECT `index_name` AS index_name FROM `information_schema`.`statistics`
             WHERE `table_schema` = DATABASE() AND `table_name` = ? AND `column_name` = ?',
            ['sync_changes', 'changed_at'],
        );

        self::assertIsArray($row);
        self::assertSame('idx_sync_changes_changed_at', $row['index_name']);
    }

    public function test_running_migrations_again_is_a_no_op(): void
    {
        self::assertSame([], TestDatabase::migrate());

        $expected = array_map(
            'basename',
            glob(TestDatabase::migrationsDirectory() . '/*.sql') ?: [],
        );
        sort($expected);

        $applied = array_map(
            static fn (array $row): string => (string) $row['version'],
            self::$db->fetchAll('SELECT `version` FROM `schema_migrations` ORDER BY `version`'),
        );

        self::assertSame($expected, $applied);
    }

    public function test_cli_migrate_script_reports_nothing_to_apply(): void
    {
        $configPath = tempnam(sys_get_temp_dir(), 'kocluk-config-');
        self::assertNotFalse($configPath);

        $config = '<?php return ' . var_export(['db' => TestDatabase::config()], true) . ";\n";
        self::assertNotFalse(file_put_contents($configPath, $config));
        @chmod($configPath, 0600);

        $command = escapeshellarg(PHP_BINARY)
            . ' ' . escapeshellarg(dirname(__DIR__, 2) . '/bin/migrate.php');

        $descriptors = [
            1 => ['pipe', 'w'],
            2 => ['pipe', 'w'],
        ];

        $process = proc_open(
            $command,
            $descriptors,
            $pipes,
            null,
            array_merge(getenv(), ['KOCLUK_CONFIG' => $configPath]),
        );

        self::assertIsResource($process);

        try {
            $stdout = stream_get_contents($pipes[1]);
            $stderr = stream_get_contents($pipes[2]);
            fclose($pipes[1]);
            fclose($pipes[2]);
            $exitCode = proc_close($process);
        } finally {
            @unlink($configPath);
        }

        self::assertSame(0, $exitCode, (string) $stderr);
        self::assertStringContainsString('Uygulanacak migration yok.', (string) $stdout);
    }

    private function insertUser(string $id, string $email, string $displayName): void
    {
        $now = Clock::nowSql();

        self::$db->execute(
            'INSERT INTO `users`
                (`id`, `email`, `password_hash`, `display_name`, `privacy_version`, `consented_at`, `created_at`, `updated_at`)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
            [$id, $email, '$2y$12$placeholderplaceholderplaceholderplaceholder', $displayName, '2026-11-24', $now, $now, $now],
        );
    }

    private function insertUserBook(string $id): void
    {
        $now = Clock::nowSql();

        self::$db->execute(
            'INSERT INTO `user_books`
                (`id`, `user_id`, `book_id`, `status`, `created_at`, `updated_at`)
             VALUES (?, ?, ?, ?, ?, ?)',
            [$id, self::USER_ID, self::BOOK_ID, 'active', $now, $now],
        );
    }

    private function insertSubject(string $id, string $seedKey): void
    {
        $now = Clock::nowSql();

        self::$db->execute(
            'INSERT INTO `subjects`
                (`id`, `user_id`, `seed_key`, `exam`, `name`, `slug`, `icon`, `updated_at`)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
            [$id, self::USER_ID, $seedKey, 'TYT', 'Matematik', 'matematik', 'calculator', $now],
        );
    }

    private function insertExamResult(string $id): void
    {
        $now = Clock::nowSql();

        self::$db->execute(
            'INSERT INTO `exam_results`
                (`id`, `user_id`, `exam_id`, `subject_id`, `correct`, `wrong`, `blank`, `net`, `updated_at`)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
            [$id, self::USER_ID, self::EXAM_ID, self::SUBJECT_ID, 10, 2, 1, 8.75, $now],
        );
    }

    private function insertScheduleWeek(string $id, string $weekStart): void
    {
        $now = Clock::nowSql();

        self::$db->execute(
            'INSERT INTO `schedule_weeks`
                (`id`, `user_id`, `week_start`, `note`, `created_at`, `updated_at`)
             VALUES (?, ?, ?, ?, ?, ?)',
            [$id, self::USER_ID, $weekStart, 'Hafta notu', $now, $now],
        );
    }

    private function activeUserBookCount(): int
    {
        $row = self::$db->fetchOne(
            'SELECT COUNT(*) AS total FROM `user_books`
             WHERE `user_id` = ? AND `book_id` = ? AND `deleted_at` IS NULL',
            [self::USER_ID, self::BOOK_ID],
        );

        self::assertNotNull($row);

        return (int) $row['total'];
    }

    private function userBookCount(): int
    {
        $row = self::$db->fetchOne(
            'SELECT COUNT(*) AS total FROM `user_books` WHERE `user_id` = ?',
            [self::USER_ID],
        );

        self::assertNotNull($row);

        return (int) $row['total'];
    }
}
