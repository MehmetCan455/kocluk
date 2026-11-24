<?php

declare(strict_types=1);

namespace Kocluk\Api\Tests\Unit;

use Kocluk\Api\Sync\InvalidRowValue;
use Kocluk\Api\Sync\TableMap;
use PHPUnit\Framework\TestCase;

/**
 * Wire <-> MariaDB mapping for the 13 synced tables (spec §8.1).
 *
 * The map is the single source for push, pull and account export, so these
 * tests pin the public field names, the row identity of the keyed tables, the
 * timestamp format and the refusal of unknown fields.
 */
final class TableMapTest extends TestCase
{
    private const USER_ID = '11111111-1111-4111-8111-111111111111';

    private const ID = '22222222-2222-4222-8222-222222222222';

    private const OTHER_ID = '44444444-4444-4444-8444-444444444444';

    private const CREATED_AT = '2026-11-24T10:00:00.000000Z';

    private const UPDATED_AT = '2026-11-24T11:00:00.000000Z';

    private const UPDATED_AT_SQL = '2026-11-24 11:00:00.000000';

    public function test_the_thirteen_api_keys_are_the_only_sync_tables(): void
    {
        $keys = TableMap::keys();
        sort($keys);

        self::assertSame([
            'activityLogs',
            'catalogBooks',
            'examResults',
            'exams',
            'notes',
            'scheduleRows',
            'scheduleTasks',
            'scheduleWeeks',
            'settings',
            'subjects',
            'topicProgress',
            'topics',
            'userBooks',
        ], $keys);

        foreach ($keys as $key) {
            $definition = TableMap::definition($key);

            self::assertIsString($definition['table']);
            self::assertIsArray($definition['columns']);
            self::assertIsArray($definition['required']);
            self::assertIsArray($definition['natural']);
            self::assertIsString($definition['pk']);
            self::assertIsArray($definition['immutable']);
            self::assertContains($definition['owner'], ['user_id', 'owner_id']);
        }
    }

    public function test_api_fields_map_to_snake_case_columns(): void
    {
        $db = TableMap::toDb('scheduleTasks', [
            'id' => self::ID,
            'weekId' => self::OTHER_ID,
            'rowId' => self::OTHER_ID,
            'dayIndex' => 3,
            'type' => 'book',
            'userBookId' => null,
            'fromPage' => 10,
            'toPage' => 20,
            'topicId' => null,
            'title' => 'Görev',
            'completedAt' => null,
            'missedAt' => '2026-11-24T10:30:00.000000Z',
            'createdAt' => self::CREATED_AT,
            'updatedAt' => self::UPDATED_AT,
        ]);

        self::assertSame(self::ID, $db['id']);
        self::assertSame(self::OTHER_ID, $db['week_id']);
        self::assertSame(self::OTHER_ID, $db['row_id']);
        self::assertSame(3, $db['day_index']);
        self::assertSame(10, $db['from_page']);
        self::assertSame(20, $db['to_page']);
        self::assertSame('2026-11-24 10:30:00.000000', $db['missed_at']);
        self::assertSame(self::UPDATED_AT_SQL, $db['updated_at']);
        self::assertSame('2026-11-24 10:00:00.000000', $db['created_at']);

        foreach (array_keys($db) as $column) {
            self::assertMatchesRegularExpression(
                '/^[a-z][a-z0-9_]*$/',
                (string) $column,
                'DB kolonları snake_case olmalı.',
            );
        }

        $api = TableMap::toApi('scheduleTasks', $db + [
            'user_id' => self::USER_ID,
            'server_updated_at' => self::UPDATED_AT_SQL,
        ]);

        self::assertSame(self::ID, $api['id']);
        self::assertSame(self::OTHER_ID, $api['weekId']);
        self::assertSame(3, $api['dayIndex']);
        self::assertSame(10, $api['fromPage']);
        self::assertSame('2026-11-24T10:30:00.000000Z', $api['missedAt']);
        self::assertSame(self::UPDATED_AT, $api['updatedAt']);
        self::assertArrayNotHasKey('user_id', $api);
        self::assertArrayNotHasKey('server_updated_at', $api);
        self::assertArrayNotHasKey('missed_at', $api);
    }

    public function test_row_ids_follow_the_table_identity(): void
    {
        self::assertSame(self::ID, TableMap::rowId('userBooks', ['id' => self::ID]));
        self::assertSame(self::ID, TableMap::rowId('notes', ['topicId' => self::ID]));
        self::assertSame(self::USER_ID, TableMap::rowId('settings', ['userId' => self::USER_ID]));
        self::assertSame('topicId', TableMap::definition('notes')['pk']);
        self::assertSame('userId', TableMap::definition('settings')['pk']);
    }

    public function test_catalog_book_ownership_is_never_mapped_from_the_row(): void
    {
        self::assertSame('ownerId', TableMap::ownerKey('catalogBooks'));
        self::assertSame('user_id', TableMap::definition('userBooks')['owner']);
        self::assertSame('owner_id', TableMap::definition('catalogBooks')['owner']);

        $db = TableMap::toDb('catalogBooks', [
            'id' => self::ID,
            'ownerId' => self::USER_ID,
            'title' => 'Özel Kitap',
            'totalPages' => 320,
            'createdAt' => self::CREATED_AT,
            'updatedAt' => self::UPDATED_AT,
        ]);

        self::assertArrayNotHasKey('owner_id', $db);
        self::assertArrayNotHasKey('userId', $db);

        $api = TableMap::toApi('catalogBooks', $db + ['owner_id' => self::USER_ID]);

        self::assertArrayNotHasKey('ownerId', $api);
        self::assertArrayNotHasKey('owner_id', $api);
    }

    public function test_unknown_tables_and_fields_are_rejected(): void
    {
        try {
            TableMap::definition('photos');
            self::fail('Bilinmeyen tablo kabul edilmemeli.');
        } catch (InvalidRowValue $error) {
            self::assertSame('unknown_table', $error->errorCode);
        }

        $this->expectException(InvalidRowValue::class);
        $this->expectExceptionMessage('Bilinmeyen alan');

        TableMap::toDb('userBooks', [
            'id' => self::ID,
            'bookId' => self::ID,
            'status' => 'active',
            'createdAt' => self::CREATED_AT,
            'updatedAt' => self::UPDATED_AT,
            'user_id' => self::USER_ID,
        ]);
    }

    public function test_required_fields_must_be_present(): void
    {
        $this->expectException(InvalidRowValue::class);
        $this->expectExceptionMessage('bookId');

        TableMap::toDb('userBooks', [
            'id' => self::ID,
            'status' => 'active',
            'createdAt' => self::CREATED_AT,
            'updatedAt' => self::UPDATED_AT,
        ]);
    }

    public function test_optional_fields_default_to_null(): void
    {
        $db = TableMap::toDb('userBooks', [
            'id' => self::ID,
            'bookId' => self::OTHER_ID,
            'status' => 'active',
            'createdAt' => self::CREATED_AT,
            'updatedAt' => self::UPDATED_AT,
        ]);

        self::assertNull($db['total_pages_override']);
        self::assertNull($db['note']);
        self::assertNull($db['started_at']);
        self::assertNull($db['deleted_at']);

        $api = TableMap::toApi('userBooks', $db);

        self::assertNull($api['totalPagesOverride']);
        self::assertNull($api['note']);
        self::assertNull($api['deletedAt']);
    }

    public function test_timestamps_round_trip_as_iso_utc(): void
    {
        $db = TableMap::toDb('userBooks', [
            'id' => self::ID,
            'bookId' => self::OTHER_ID,
            'status' => 'active',
            'createdAt' => self::CREATED_AT,
            'updatedAt' => '2026-11-24T11:00:00.123456Z',
        ]);

        self::assertSame('2026-11-24 11:00:00.123456', $db['updated_at']);

        $api = TableMap::toApi('userBooks', $db);

        self::assertSame('2026-11-24T11:00:00.123456Z', $api['updatedAt']);
        self::assertSame(self::CREATED_AT, $api['createdAt']);
    }

    public function test_invalid_timestamps_are_reported_separately(): void
    {
        try {
            TableMap::toDb('userBooks', [
                'id' => self::ID,
                'bookId' => self::OTHER_ID,
                'status' => 'active',
                'createdAt' => self::CREATED_AT,
                'updatedAt' => 'yarın',
            ]);
            self::fail('Geçersiz zaman kabul edilmemeli.');
        } catch (InvalidRowValue $error) {
            self::assertSame('invalid_timestamp', $error->errorCode);
        }
    }

    public function test_booleans_are_stored_as_tinyints(): void
    {
        $db = TableMap::toDb('topicProgress', [
            'id' => self::ID,
            'topicId' => self::OTHER_ID,
            'done' => true,
            'doneAt' => null,
            'updatedAt' => self::UPDATED_AT,
        ]);

        self::assertSame(1, $db['done']);

        $api = TableMap::toApi('topicProgress', array_replace($db, [
            'done_at' => self::UPDATED_AT_SQL,
        ]));

        self::assertTrue($api['done']);
        self::assertSame(self::UPDATED_AT, $api['doneAt']);
    }

    public function test_activity_logs_have_no_updated_at_column(): void
    {
        self::assertArrayNotHasKey('updatedAt', TableMap::definition('activityLogs')['columns']);

        $db = TableMap::toDb('activityLogs', [
            'id' => self::ID,
            'type' => 'book_pages',
            'taskId' => self::OTHER_ID,
            'source' => 'task',
            'createdAt' => self::CREATED_AT,
        ]);

        self::assertArrayNotHasKey('updated_at', $db);
        self::assertSame(self::OTHER_ID, $db['task_id']);
    }

    public function test_settings_are_stored_as_one_json_document_per_user(): void
    {
        $db = TableMap::toDb('settings', [
            'userId' => self::USER_ID,
            'profileName' => 'Ayşe',
            'examDate' => '2027-06-19',
            'examName' => 'YKS 2027',
            'onboardingDone' => true,
            'hiddenSubjects' => ['matematik'],
            'updatedAt' => self::UPDATED_AT,
        ]);

        self::assertArrayNotHasKey('user_id', $db);
        self::assertSame(self::UPDATED_AT_SQL, $db['updated_at']);
        self::assertIsString($db['data']);

        $data = json_decode($db['data'], true, 512, JSON_THROW_ON_ERROR);

        self::assertSame('Ayşe', $data['profileName']);
        self::assertTrue($data['onboardingDone']);
        self::assertSame(['matematik'], $data['hiddenSubjects']);

        $api = TableMap::toApi('settings', [
            'user_id' => self::USER_ID,
            'data' => $db['data'],
            'updated_at' => self::UPDATED_AT_SQL,
        ]);

        self::assertSame(self::USER_ID, $api['userId']);
        self::assertSame('Ayşe', $api['profileName']);
        self::assertTrue($api['onboardingDone']);
        self::assertSame(self::UPDATED_AT, $api['updatedAt']);
        self::assertArrayNotHasKey('data', $api);
    }

    public function test_stored_settings_cannot_spoof_the_owner_or_timestamp(): void
    {
        $api = TableMap::toApi('settings', [
            'user_id' => self::USER_ID,
            'data' => json_encode([
                'userId' => 'baska-hesap',
                'updatedAt' => '2000-01-01T00:00:00.000000Z',
                'profileName' => 'Ayşe',
                'accent' => '#3B82F6',
                'marker' => 'gizli',
            ], JSON_THROW_ON_ERROR),
            'updated_at' => self::UPDATED_AT_SQL,
        ]);

        self::assertSame(self::USER_ID, $api['userId']);
        self::assertSame(self::UPDATED_AT, $api['updatedAt']);
        self::assertSame('Ayşe', $api['profileName']);
        self::assertArrayNotHasKey('accent', $api);
        self::assertArrayNotHasKey('marker', $api);
    }

    public function test_settings_read_path_only_returns_account_level_fields(): void
    {
        $api = TableMap::toApi('settings', [
            'user_id' => self::USER_ID,
            'data' => json_encode([
                'profileName' => 'Ayşe',
                'examName' => 'YKS 2027',
                'accent' => '#3B82F6',
                'scheduleMode' => 'manual',
                'marker' => 'gizli',
            ], JSON_THROW_ON_ERROR),
            'updated_at' => self::UPDATED_AT_SQL,
        ]);

        self::assertSame([], array_values(array_diff(
            array_keys($api),
            array_merge(TableMap::settingsFields(), ['userId', 'updatedAt']),
        )));
        self::assertSame('Ayşe', $api['profileName']);
        self::assertSame('YKS 2027', $api['examName']);
        self::assertArrayNotHasKey('accent', $api);
        self::assertArrayNotHasKey('scheduleMode', $api);
        self::assertArrayNotHasKey('marker', $api);
    }

    public function test_required_fields_cannot_be_null(): void
    {
        self::assertRejected(fn () => TableMap::toDb('userBooks', [
            'id' => self::ID,
            'bookId' => null,
            'status' => 'active',
            'createdAt' => self::CREATED_AT,
            'updatedAt' => self::UPDATED_AT,
        ]));

        self::assertRejected(fn () => TableMap::toDb('userBooks', [
            'id' => self::ID,
            'bookId' => self::OTHER_ID,
            'status' => null,
            'createdAt' => self::CREATED_AT,
            'updatedAt' => self::UPDATED_AT,
        ]));

        self::assertRejected(fn () => TableMap::toDb('notes', [
            'topicId' => self::ID,
            'contentHtml' => '<p>Not</p>',
            'plainText' => 'Not',
            'updatedAt' => null,
        ]));
    }

    public function test_text_longer_than_the_column_is_rejected(): void
    {
        self::assertRejected(fn () => TableMap::toDb('subjects', [
            'id' => self::ID,
            'seedKey' => 'tyt-matematik',
            'exam' => 'TYT',
            'name' => str_repeat('a', 256),
            'slug' => 'matematik',
            'icon' => 'book',
            'order' => 0,
            'updatedAt' => self::UPDATED_AT,
        ]));

        // TEXT columns hold 65,535 bytes; a longer note must be a validation
        // error, never a MariaDB 22001 that aborts the batch with a 500.
        self::assertRejected(fn () => TableMap::toDb('userBooks', [
            'id' => self::ID,
            'bookId' => self::OTHER_ID,
            'note' => str_repeat('a', 65536),
            'status' => 'active',
            'createdAt' => self::CREATED_AT,
            'updatedAt' => self::UPDATED_AT,
        ]));
    }

    public function test_numbers_outside_the_column_range_are_rejected(): void
    {
        self::assertRejected(fn () => TableMap::toDb('userBooks', [
            'id' => self::ID,
            'bookId' => self::OTHER_ID,
            'totalPagesOverride' => -1,
            'status' => 'active',
            'createdAt' => self::CREATED_AT,
            'updatedAt' => self::UPDATED_AT,
        ]));

        self::assertRejected(fn () => TableMap::toDb('examResults', [
            'id' => self::ID,
            'examId' => self::OTHER_ID,
            'subjectId' => self::ID,
            'correct' => 70000,
            'wrong' => 0,
            'blank' => 0,
            'net' => 10,
            'updatedAt' => self::UPDATED_AT,
        ]));

        self::assertRejected(fn () => TableMap::toDb('scheduleTasks', [
            'id' => self::ID,
            'weekId' => self::OTHER_ID,
            'rowId' => self::ID,
            'dayIndex' => 8,
            'type' => 'book',
            'createdAt' => self::CREATED_AT,
            'updatedAt' => self::UPDATED_AT,
        ]));
    }

    public function test_enum_values_are_checked(): void
    {
        self::assertRejected(fn () => TableMap::toDb('userBooks', [
            'id' => self::ID,
            'bookId' => self::OTHER_ID,
            'status' => 'bogus',
            'createdAt' => self::CREATED_AT,
            'updatedAt' => self::UPDATED_AT,
        ]));

        self::assertRejected(fn () => TableMap::toDb('activityLogs', [
            'id' => self::ID,
            'type' => 'bogus',
            'source' => 'task',
            'createdAt' => self::CREATED_AT,
        ]));

        self::assertRejected(fn () => TableMap::toDb('subjects', [
            'id' => self::ID,
            'seedKey' => 'tyt-matematik',
            'exam' => 'YDS',
            'name' => 'Matematik',
            'slug' => 'matematik',
            'icon' => 'book',
            'order' => 0,
            'updatedAt' => self::UPDATED_AT,
        ]));
    }

    public function test_every_mapped_column_has_field_metadata(): void
    {
        foreach (TableMap::keys() as $apiKey) {
            $definition = TableMap::definition($apiKey);

            self::assertArrayHasKey('rules', $definition, $apiKey);

            foreach (array_keys($definition['columns']) as $field) {
                $field = (string) $field;

                self::assertArrayHasKey($field, $definition['rules'], $apiKey . '.' . $field);
                self::assertArrayHasKey('type', $definition['rules'][$field], $apiKey . '.' . $field);
            }
        }
    }

    public function test_device_level_settings_are_not_accepted(): void
    {
        $this->expectException(InvalidRowValue::class);
        $this->expectExceptionMessage('accent');

        TableMap::toDb('settings', [
            'userId' => self::USER_ID,
            'profileName' => 'Ayşe',
            'accent' => '#3B82F6',
            'updatedAt' => self::UPDATED_AT,
        ]);
    }

    public function test_natural_keys_are_declared_as_db_columns(): void
    {
        self::assertSame(['seed_key'], TableMap::definition('subjects')['natural']);
        self::assertSame(['seed_key'], TableMap::definition('topics')['natural']);
        self::assertSame(['exam_id', 'subject_id'], TableMap::definition('examResults')['natural']);
        self::assertSame(['book_id'], TableMap::definition('userBooks')['natural']);
        self::assertSame(['week_start'], TableMap::definition('scheduleWeeks')['natural']);
        self::assertSame(['topic_id'], TableMap::definition('topicProgress')['natural']);
        self::assertSame(['task_id'], TableMap::definition('activityLogs')['natural']);
        self::assertSame([], TableMap::definition('notes')['natural']);
    }

    private static function assertRejected(callable $callback): void
    {
        try {
            $callback();
            self::fail('Geçersiz satır kabul edilmemeli.');
        } catch (InvalidRowValue $error) {
            self::assertSame('validation_failed', $error->errorCode);
        }
    }
}
