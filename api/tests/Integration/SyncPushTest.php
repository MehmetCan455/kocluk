<?php

declare(strict_types=1);

namespace Kocluk\Api\Tests\Integration;

use DateTimeImmutable;
use DateTimeZone;
use Kocluk\Api\App;
use Kocluk\Api\Http\Response;
use Kocluk\Api\Support\Clock;
use Kocluk\Api\Support\Uuid;
use Kocluk\Api\Sync\ChangeLog;
use Kocluk\Api\Sync\SyncService;
use Kocluk\Api\Tests\Support\ApiTestCase;
use Kocluk\Api\Tests\Support\TestDatabase;

/**
 * POST /api/sync/push (spec §8.2, §8.4).
 *
 * The tests go through the real HTTP kernel: session, CSRF, row-level
 * transactions, last-writer-wins, future-date clamping, natural-key conflicts,
 * insert-only activity logs and the change log.
 */
final class SyncPushTest extends ApiTestCase
{
    private const DEVICE_ID = '33333333-3333-4333-8333-333333333333';

    private const OTHER_EMAIL = 'beta@example.com';

    public function test_upsert_inserts_a_row_and_appends_one_change(): void
    {
        $account = $this->account();
        $updatedAt = $this->minutesAgo(10);
        $id = Uuid::v4();
        $bookId = Uuid::v4();

        $response = $this->push(
            [['table' => 'userBooks', 'op' => 'upsert', 'row' => $this->userBook($id, $bookId, $updatedAt, 'İlk not')]],
            $account['csrf'],
            $account['jar'],
        );

        self::assertSame(200, $response->status());

        $payload = $this->payload($response);

        self::assertArrayHasKey('serverTime', $payload);
        self::assertMatchesRegularExpression('/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{6}Z$/', (string) $payload['serverTime']);
        self::assertCount(1, $payload['results']);

        $result = $payload['results'][0];

        self::assertSame('userBooks', $result['table']);
        self::assertSame($id, $result['rowId']);
        self::assertSame('applied', $result['status']);
        self::assertArrayNotHasKey('timeAdjusted', $result);
        self::assertSame($id, $result['row']['id']);
        self::assertSame($bookId, $result['row']['bookId']);
        self::assertSame('İlk not', $result['row']['note']);
        self::assertSame($updatedAt, $result['row']['updatedAt']);
        self::assertNull($result['row']['deletedAt']);
        self::assertArrayNotHasKey('user_id', $result['row']);
        self::assertArrayNotHasKey('server_updated_at', $result['row']);
        self::assertArrayNotHasKey('active_book_id', $result['row']);

        $row = $this->syncRow('user_books', $account['userId'], $id);

        self::assertIsArray($row);
        self::assertSame($account['userId'], $row['user_id']);
        self::assertSame($bookId, $row['book_id']);
        self::assertSame('active', $row['status']);
        self::assertSame($this->sql($updatedAt), $row['updated_at']);

        $changes = $this->changes($account['userId']);

        self::assertCount(1, $changes);
        self::assertSame('userBooks', $changes[0]['table_name']);
        self::assertSame($id, $changes[0]['row_id']);
        self::assertSame('upsert', $changes[0]['op']);
        self::assertNotSame('', (string) $changes[0]['changed_at']);
    }

    public function test_newer_updates_win_and_older_or_equal_updates_conflict(): void
    {
        $account = $this->account();
        $id = Uuid::v4();
        $bookId = Uuid::v4();
        $older = $this->minutesAgo(30);
        $newer = $this->minutesAgo(20);

        $first = $this->push(
            [['table' => 'userBooks', 'op' => 'upsert', 'row' => $this->userBook($id, $bookId, $older, 'eski')]],
            $account['csrf'],
            $account['jar'],
        );

        self::assertSame('applied', $this->payload($first)['results'][0]['status']);

        $second = $this->push(
            [['table' => 'userBooks', 'op' => 'upsert', 'row' => $this->userBook($id, $bookId, $newer, 'yeni')]],
            $account['csrf'],
            $account['jar'],
        );

        $applied = $this->payload($second)['results'][0];

        self::assertSame('applied', $applied['status']);
        self::assertSame('yeni', $applied['row']['note']);
        self::assertSame($newer, $applied['row']['updatedAt']);

        $equal = $this->push(
            [['table' => 'userBooks', 'op' => 'upsert', 'row' => $this->userBook($id, $bookId, $newer, 'eşit')]],
            $account['csrf'],
            $account['jar'],
        );

        $equalResult = $this->payload($equal)['results'][0];

        self::assertSame('conflict', $equalResult['status']);
        self::assertSame('yeni', $equalResult['row']['note']);
        self::assertSame($newer, $equalResult['row']['updatedAt']);

        $olderResponse = $this->push(
            [['table' => 'userBooks', 'op' => 'upsert', 'row' => $this->userBook($id, $bookId, $older, 'çok eski')]],
            $account['csrf'],
            $account['jar'],
        );

        $olderResult = $this->payload($olderResponse)['results'][0];

        self::assertSame('conflict', $olderResult['status']);
        self::assertSame('yeni', $olderResult['row']['note']);
        self::assertSame($newer, $olderResult['row']['updatedAt']);

        $row = $this->syncRow('user_books', $account['userId'], $id);

        self::assertIsArray($row);
        self::assertSame('yeni', $row['note']);
        self::assertCount(2, $this->changes($account['userId']));
    }

    public function test_future_timestamps_are_clamped_to_five_minutes_ahead(): void
    {
        $account = $this->account();
        $id = Uuid::v4();
        $future = $this->iso(Clock::now()->modify('+1 day'));

        $response = $this->push(
            [['table' => 'userBooks', 'op' => 'upsert', 'row' => $this->userBook($id, Uuid::v4(), $future, 'gelecek')]],
            $account['csrf'],
            $account['jar'],
        );

        self::assertSame(200, $response->status());

        $result = $this->payload($response)['results'][0];

        self::assertSame('applied', $result['status']);
        self::assertTrue($result['timeAdjusted'] ?? false);

        $returned = new DateTimeImmutable((string) $result['row']['updatedAt'], new DateTimeZone('UTC'));
        $upper = Clock::now()->modify('+5 minutes')->modify('+2 seconds');
        $lower = Clock::now()->modify('+4 minutes');

        self::assertLessThanOrEqual($upper->getTimestamp(), $returned->getTimestamp());
        self::assertGreaterThanOrEqual($lower->getTimestamp(), $returned->getTimestamp());

        $row = $this->syncRow('user_books', $account['userId'], $id);

        self::assertIsArray($row);
        self::assertSame($this->sql((string) $result['row']['updatedAt']), $row['updated_at']);
    }

    public function test_a_different_id_with_the_same_seed_key_returns_the_canonical_row(): void
    {
        $account = $this->account();
        $firstId = Uuid::v4();
        $secondId = Uuid::v4();
        $updatedAt = $this->minutesAgo(15);

        $first = $this->push(
            [['table' => 'subjects', 'op' => 'upsert', 'row' => $this->subject($firstId, 'tyt-matematik', 'Matematik', $updatedAt)]],
            $account['csrf'],
            $account['jar'],
        );

        self::assertSame('applied', $this->payload($first)['results'][0]['status']);

        $second = $this->push(
            [['table' => 'subjects', 'op' => 'upsert', 'row' => $this->subject($secondId, 'tyt-matematik', 'Kopya Matematik', $updatedAt)]],
            $account['csrf'],
            $account['jar'],
        );

        $result = $this->payload($second)['results'][0];

        self::assertSame('conflict', $result['status']);
        self::assertSame($firstId, $result['row']['id']);
        self::assertSame('Matematik', $result['row']['name']);
        self::assertSame('tyt-matematik', $result['row']['seedKey']);

        self::assertSame(1, $this->userRowCount('subjects', $account['userId']));
        self::assertCount(1, $this->changes($account['userId']));
    }

    public function test_activity_logs_keep_one_active_row_per_task(): void
    {
        $account = $this->account();
        $taskId = Uuid::v4();
        $firstId = Uuid::v4();
        $secondId = Uuid::v4();
        $createdAt = $this->minutesAgo(60);

        $first = $this->push(
            [['table' => 'activityLogs', 'op' => 'upsert', 'row' => $this->activityLog($firstId, $taskId, $createdAt)]],
            $account['csrf'],
            $account['jar'],
        );

        $firstResult = $this->payload($first)['results'][0];

        self::assertSame('applied', $firstResult['status']);
        self::assertArrayNotHasKey('updatedAt', $firstResult['row']);

        $second = $this->push(
            [['table' => 'activityLogs', 'op' => 'upsert', 'row' => $this->activityLog($secondId, $taskId, $createdAt)]],
            $account['csrf'],
            $account['jar'],
        );

        $secondResult = $this->payload($second)['results'][0];

        self::assertSame('conflict', $secondResult['status']);
        self::assertSame($firstId, $secondResult['row']['id']);
        self::assertSame(1, $this->userRowCount('activity_logs', $account['userId']));
        self::assertSame(1, $this->activeTaskCount($account['userId'], $taskId));

        // A delete is the only allowed mutation; without updatedAt the server
        // stamps the tombstone with its own clock.
        $deleted = $this->push(
            [['table' => 'activityLogs', 'op' => 'delete', 'rowId' => $firstId]],
            $account['csrf'],
            $account['jar'],
        );

        $deletedResult = $this->payload($deleted)['results'][0];

        self::assertSame('applied', $deletedResult['status']);
        self::assertNotNull($deletedResult['row']['deletedAt']);
        self::assertSame(0, $this->activeTaskCount($account['userId'], $taskId));

        $row = $this->syncRow('activity_logs', $account['userId'], $firstId);

        self::assertIsArray($row);
        self::assertNotNull($row['deleted_at']);

        // Once the previous activity is a tombstone the same task may get a
        // new active row.
        $third = $this->push(
            [['table' => 'activityLogs', 'op' => 'upsert', 'row' => $this->activityLog($secondId, $taskId, $createdAt)]],
            $account['csrf'],
            $account['jar'],
        );

        self::assertSame('applied', $this->payload($third)['results'][0]['status']);
        self::assertSame(2, $this->userRowCount('activity_logs', $account['userId']));
        self::assertSame(1, $this->activeTaskCount($account['userId'], $taskId));
    }

    public function test_push_cannot_write_into_another_account(): void
    {
        $other = $this->account();
        $account = $this->account(['email' => 'gama@example.com']);
        $id = Uuid::v4();
        $updatedAt = $this->minutesAgo(5);

        $userBook = $this->userBook($id, Uuid::v4(), $updatedAt);
        $userBook['userId'] = $other['userId'];

        $response = $this->push(
            [['table' => 'userBooks', 'op' => 'upsert', 'row' => $userBook]],
            $account['csrf'],
            $account['jar'],
        );

        $result = $this->payload($response)['results'][0];

        self::assertSame('error', $result['status']);
        self::assertSame('forbidden', $result['error']['code']);
        self::assertArrayHasKey('message', $result['error']);
        self::assertArrayNotHasKey('note', $result['error']);
        self::assertSame(0, $this->userRowCount('user_books', $other['userId']));
        self::assertSame(0, $this->userRowCount('user_books', $account['userId']));
        self::assertCount(0, $this->changes($account['userId']));

        $bookId = Uuid::v4();
        $catalogBook = [
            'id' => $bookId,
            'ownerId' => $other['userId'],
            'title' => 'Başkasının kitabı',
            'totalPages' => 100,
            'createdAt' => $updatedAt,
            'updatedAt' => $updatedAt,
            'deletedAt' => null,
        ];

        $catalog = $this->push(
            [['table' => 'catalogBooks', 'op' => 'upsert', 'row' => $catalogBook]],
            $account['csrf'],
            $account['jar'],
        );

        $catalogResult = $this->payload($catalog)['results'][0];

        self::assertSame('error', $catalogResult['status']);
        self::assertSame('forbidden', $catalogResult['error']['code']);
        self::assertSame(0, $this->userRowCount('catalog_books', $other['userId']));
        self::assertSame(0, $this->userRowCount('catalog_books', $account['userId']));
    }

    public function test_row_ids_are_scoped_per_user(): void
    {
        $alpha = $this->account();
        $beta = $this->account(['email' => self::OTHER_EMAIL]);
        $sharedId = Uuid::v4();
        $older = $this->minutesAgo(20);
        $newer = $this->minutesAgo(10);

        $this->push(
            [['table' => 'userBooks', 'op' => 'upsert', 'row' => $this->userBook($sharedId, Uuid::v4(), $older, 'Alfa')]],
            $alpha['csrf'],
            $alpha['jar'],
        );

        $this->push(
            [['table' => 'userBooks', 'op' => 'upsert', 'row' => $this->userBook($sharedId, Uuid::v4(), $newer, 'Beta')]],
            $beta['csrf'],
            $beta['jar'],
        );

        $alphaRow = $this->syncRow('user_books', $alpha['userId'], $sharedId);
        $betaRow = $this->syncRow('user_books', $beta['userId'], $sharedId);

        self::assertIsArray($alphaRow);
        self::assertIsArray($betaRow);
        self::assertSame('Alfa', $alphaRow['note']);
        self::assertSame('Beta', $betaRow['note']);
    }

    public function test_more_than_hundred_changes_are_rejected(): void
    {
        $account = $this->account();
        $updatedAt = $this->minutesAgo(5);
        $changes = [];

        for ($index = 0; $index < 101; $index++) {
            $changes[] = [
                'table' => 'userBooks',
                'op' => 'upsert',
                'row' => $this->userBook(Uuid::v4(), Uuid::v4(), $updatedAt),
            ];
        }

        $response = $this->push($changes, $account['csrf'], $account['jar']);

        self::assertSame(422, $response->status());
        self::assertSame('payload_too_large', $this->payload($response)['error']['code']);
        self::assertSame(0, $this->userRowCount('user_books', $account['userId']));
        self::assertCount(0, $this->changes($account['userId']));
    }

    public function test_unknown_tables_and_fields_are_row_errors_and_valid_rows_continue(): void
    {
        $account = $this->account();
        $updatedAt = $this->minutesAgo(5);
        $validId = Uuid::v4();

        $invalidRow = $this->userBook(Uuid::v4(), Uuid::v4(), $updatedAt);
        $invalidRow['hacked'] = true;

        $response = $this->push([
            ['table' => 'photos', 'op' => 'upsert', 'row' => ['id' => Uuid::v4()]],
            ['table' => 'userBooks', 'op' => 'upsert', 'row' => $invalidRow],
            ['table' => 'userBooks', 'op' => 'upsert', 'row' => $this->userBook($validId, Uuid::v4(), $updatedAt, 'Geçerli')],
        ], $account['csrf'], $account['jar']);

        self::assertSame(200, $response->status());

        $results = $this->payload($response)['results'];

        self::assertCount(3, $results);
        self::assertSame('error', $results[0]['status']);
        self::assertSame('unknown_table', $results[0]['error']['code']);
        self::assertSame('photos', $results[0]['table']);
        self::assertSame('error', $results[1]['status']);
        self::assertSame('validation_failed', $results[1]['error']['code']);
        self::assertSame('userBooks', $results[1]['table']);
        self::assertSame('applied', $results[2]['status']);
        self::assertSame($validId, $results[2]['row']['id']);

        self::assertSame(1, $this->userRowCount('user_books', $account['userId']));
        self::assertCount(1, $this->changes($account['userId']));
    }

    public function test_invalid_rows_are_row_errors_and_the_batch_continues(): void
    {
        $account = $this->account();
        $updatedAt = $this->minutesAgo(5);
        $validId = Uuid::v4();

        $nullRequired = $this->userBook(Uuid::v4(), Uuid::v4(), $updatedAt);
        $nullRequired['bookId'] = null;

        $oversized = $this->userBook(Uuid::v4(), Uuid::v4(), $updatedAt);
        $oversized['note'] = str_repeat('a', 65536);

        $badEnum = $this->userBook(Uuid::v4(), Uuid::v4(), $updatedAt);
        $badEnum['status'] = 'bogus';

        $negative = $this->userBook(Uuid::v4(), Uuid::v4(), $updatedAt);
        $negative['totalPagesOverride'] = -1;

        $response = $this->push([
            ['table' => 'userBooks', 'op' => 'upsert', 'row' => $nullRequired],
            ['table' => 'userBooks', 'op' => 'upsert', 'row' => $oversized],
            ['table' => 'userBooks', 'op' => 'upsert', 'row' => $badEnum],
            ['table' => 'userBooks', 'op' => 'upsert', 'row' => $negative],
            ['table' => 'examResults', 'op' => 'upsert', 'row' => [
                'id' => Uuid::v4(),
                'examId' => Uuid::v4(),
                'subjectId' => Uuid::v4(),
                'correct' => 70000,
                'wrong' => 0,
                'blank' => 0,
                'net' => 10,
                'updatedAt' => $updatedAt,
                'deletedAt' => null,
            ]],
            ['table' => 'scheduleTasks', 'op' => 'upsert', 'row' => [
                'id' => Uuid::v4(),
                'weekId' => Uuid::v4(),
                'rowId' => Uuid::v4(),
                'dayIndex' => 8,
                'type' => 'book',
                'createdAt' => $updatedAt,
                'updatedAt' => $updatedAt,
                'deletedAt' => null,
            ]],
            ['table' => 'userBooks', 'op' => 'upsert', 'row' => $this->userBook($validId, Uuid::v4(), $updatedAt, 'Geçerli')],
        ], $account['csrf'], $account['jar']);

        self::assertSame(200, $response->status());

        $results = $this->payload($response)['results'];

        self::assertCount(7, $results);

        for ($index = 0; $index < 6; $index++) {
            self::assertSame('error', $results[$index]['status'], (string) $index);
            self::assertSame('validation_failed', $results[$index]['error']['code'], (string) $index);
        }

        self::assertSame('applied', $results[6]['status']);
        self::assertSame($validId, $results[6]['row']['id']);
        self::assertSame(1, $this->userRowCount('user_books', $account['userId']));
        self::assertSame(0, $this->userRowCount('exam_results', $account['userId']));
        self::assertSame(0, $this->userRowCount('schedule_tasks', $account['userId']));
        self::assertCount(1, $this->changes($account['userId']));
    }

    public function test_push_is_forbidden_after_the_account_is_deleted(): void
    {
        $account = $this->account();
        $database = TestDatabase::database();

        // The request validated its session before the delete committed; the
        // users row is gone by the time the row transaction starts.
        $database->execute('DELETE FROM `users` WHERE `id` = ?', [$account['userId']]);

        $sync = new SyncService($database, new ChangeLog($database));
        $result = $sync->push($account['userId'], [
            'deviceId' => self::DEVICE_ID,
            'changes' => [[
                'table' => 'userBooks',
                'op' => 'upsert',
                'row' => $this->userBook(Uuid::v4(), Uuid::v4(), $this->minutesAgo(5)),
            ]],
        ]);

        $row = $result['results'][0];

        self::assertSame('error', $row['status']);
        self::assertSame('forbidden', $row['error']['code']);
        self::assertSame(0, $this->userRowCount('user_books', $account['userId']));
        self::assertCount(0, $this->changes($account['userId']));
        self::assertSame(1, $this->sessionCountForUser($account['userId']));
    }

    public function test_database_data_errors_become_row_validation_errors(): void
    {
        $account = $this->account();
        $database = TestDatabase::database();

        $database->exec('DROP TRIGGER IF EXISTS `test_force_data_error`');
        $database->exec(
            "CREATE TRIGGER `test_force_data_error` BEFORE INSERT ON `user_books`"
            . " FOR EACH ROW SIGNAL SQLSTATE '22003' SET MESSAGE_TEXT = 'forced data error'",
        );

        try {
            $response = $this->push(
                [['table' => 'userBooks', 'op' => 'upsert', 'row' => $this->userBook(Uuid::v4(), Uuid::v4(), $this->minutesAgo(5))]],
                $account['csrf'],
                $account['jar'],
            );

            self::assertSame(200, $response->status());

            $result = $this->payload($response)['results'][0];

            self::assertSame('error', $result['status']);
            self::assertSame('validation_failed', $result['error']['code']);
            self::assertSame(0, $this->userRowCount('user_books', $account['userId']));
            self::assertCount(0, $this->changes($account['userId']));
        } finally {
            $database->exec('DROP TRIGGER IF EXISTS `test_force_data_error`');
        }
    }

    public function test_delete_sets_a_tombstone_and_logs_the_change(): void
    {
        $account = $this->account();
        $topicId = Uuid::v4();
        $first = $this->minutesAgo(30);
        $deletedAt = $this->minutesAgo(20);
        $later = $this->minutesAgo(10);

        $this->push(
            [['table' => 'notes', 'op' => 'upsert', 'row' => $this->note($topicId, $first, '<p>Not</p>')]],
            $account['csrf'],
            $account['jar'],
        );

        $delete = $this->push(
            [['table' => 'notes', 'op' => 'delete', 'rowId' => $topicId, 'updatedAt' => $deletedAt]],
            $account['csrf'],
            $account['jar'],
        );

        $result = $this->payload($delete)['results'][0];

        self::assertSame('applied', $result['status']);
        self::assertSame($topicId, $result['row']['topicId']);
        self::assertSame($deletedAt, $result['row']['deletedAt']);
        self::assertSame($deletedAt, $result['row']['updatedAt']);

        $row = $this->syncRow('notes', $account['userId'], $topicId);

        self::assertIsArray($row);
        self::assertSame($this->sql($deletedAt), $row['deleted_at']);
        self::assertSame($this->sql($deletedAt), $row['updated_at']);

        $changes = $this->changes($account['userId']);

        self::assertCount(2, $changes);
        self::assertSame('delete', $changes[1]['op']);
        self::assertSame('notes', $changes[1]['table_name']);
        self::assertSame($topicId, $changes[1]['row_id']);

        // Deleting an already deleted row is idempotent and writes no new log.
        $again = $this->push(
            [['table' => 'notes', 'op' => 'delete', 'rowId' => $topicId, 'updatedAt' => $later]],
            $account['csrf'],
            $account['jar'],
        );

        $againResult = $this->payload($again)['results'][0];

        self::assertSame('applied', $againResult['status']);
        self::assertSame($deletedAt, $againResult['row']['deletedAt']);
        self::assertCount(2, $this->changes($account['userId']));

        // Tombstone wins over a newer update (spec §8.4).
        $revive = $this->push(
            [['table' => 'notes', 'op' => 'upsert', 'row' => $this->note($topicId, $later, '<p>Yeni</p>')]],
            $account['csrf'],
            $account['jar'],
        );

        $reviveResult = $this->payload($revive)['results'][0];

        self::assertSame('conflict', $reviveResult['status']);
        self::assertSame($deletedAt, $reviveResult['row']['deletedAt']);
        self::assertCount(2, $this->changes($account['userId']));

        $row = $this->syncRow('notes', $account['userId'], $topicId);

        self::assertIsArray($row);
        self::assertNotNull($row['deleted_at']);
        self::assertSame('<p>Not</p>', $row['content_html']);

        // A delete of a row the server never saw is a harmless no-op.
        $unknown = $this->push(
            [['table' => 'notes', 'op' => 'delete', 'rowId' => Uuid::v4(), 'updatedAt' => $later]],
            $account['csrf'],
            $account['jar'],
        );

        $unknownResult = $this->payload($unknown)['results'][0];

        self::assertSame('applied', $unknownResult['status']);
        self::assertNull($unknownResult['row']);
        self::assertCount(2, $this->changes($account['userId']));
    }

    public function test_invalid_timestamps_are_reported_per_row(): void
    {
        $account = $this->account();
        $id = Uuid::v4();
        $row = $this->userBook($id, Uuid::v4(), $this->minutesAgo(5));
        $row['updatedAt'] = 'yarın';

        $response = $this->push(
            [['table' => 'userBooks', 'op' => 'upsert', 'row' => $row]],
            $account['csrf'],
            $account['jar'],
        );

        self::assertSame(200, $response->status());

        $result = $this->payload($response)['results'][0];

        self::assertSame('error', $result['status']);
        self::assertSame('invalid_timestamp', $result['error']['code']);
        self::assertSame(0, $this->userRowCount('user_books', $account['userId']));
        self::assertCount(0, $this->changes($account['userId']));
    }

    public function test_settings_are_one_account_level_row_per_user(): void
    {
        $account = $this->account();
        $updatedAt = $this->minutesAgo(10);
        $newer = $this->minutesAgo(5);

        $settings = $this->settings($account['userId'], $updatedAt, 'Ayşe');

        $response = $this->push(
            [['table' => 'settings', 'op' => 'upsert', 'row' => $settings]],
            $account['csrf'],
            $account['jar'],
        );

        $result = $this->payload($response)['results'][0];

        self::assertSame('applied', $result['status']);
        self::assertSame($account['userId'], $result['row']['userId']);
        self::assertSame('Ayşe', $result['row']['profileName']);
        self::assertTrue($result['row']['onboardingDone']);
        self::assertArrayNotHasKey('data', $result['row']);

        self::assertSame(1, $this->userRowCount('user_settings', $account['userId']));

        $stored = TestDatabase::database()->fetchOne(
            'SELECT `data` FROM `user_settings` WHERE `user_id` = ?',
            [$account['userId']],
        );

        self::assertIsArray($stored);
        $data = json_decode((string) $stored['data'], true, 512, JSON_THROW_ON_ERROR);

        self::assertSame('Ayşe', $data['profileName']);
        self::assertSame('2027-06-19', $data['examDate']);
        self::assertArrayNotHasKey('accent', $data);
        self::assertArrayNotHasKey('scheduleMode', $data);

        // Device-level settings are not part of the account row.
        $withDevice = $this->settings($account['userId'], $newer, 'Ayşe');
        $withDevice['accent'] = '#3B82F6';

        $rejected = $this->push(
            [['table' => 'settings', 'op' => 'upsert', 'row' => $withDevice]],
            $account['csrf'],
            $account['jar'],
        );

        self::assertSame(422, $rejected->status());
        self::assertSame('validation_failed', $this->payload($rejected)['error']['code']);

        // A body cannot address another account's settings row.
        $foreign = $this->settings($account['userId'], $newer, 'Beta');
        $foreign['userId'] = Uuid::v4();

        $forbidden = $this->push(
            [['table' => 'settings', 'op' => 'upsert', 'row' => $foreign]],
            $account['csrf'],
            $account['jar'],
        );

        $forbiddenResult = $this->payload($forbidden)['results'][0];

        self::assertSame('error', $forbiddenResult['status']);
        self::assertSame('forbidden', $forbiddenResult['error']['code']);

        $update = $this->push(
            [['table' => 'settings', 'op' => 'upsert', 'row' => $this->settings($account['userId'], $newer, 'Ayşe Yılmaz')]],
            $account['csrf'],
            $account['jar'],
        );

        $updateResult = $this->payload($update)['results'][0];

        self::assertSame('applied', $updateResult['status']);
        self::assertSame('Ayşe Yılmaz', $updateResult['row']['profileName']);
        self::assertSame(1, $this->userRowCount('user_settings', $account['userId']));
        self::assertCount(2, $this->changes($account['userId']));
    }

    public function test_push_requires_a_session_and_a_csrf_token(): void
    {
        $account = $this->account();
        $change = ['table' => 'userBooks', 'op' => 'upsert', 'row' => $this->userBook(Uuid::v4(), Uuid::v4(), $this->minutesAgo(5))];

        $withoutSession = $this->post(
            '/api/sync/push',
            ['deviceId' => self::DEVICE_ID, 'changes' => [$change]],
            ['X-CSRF-Token' => $account['csrf']],
        );

        self::assertSame(401, $withoutSession->status());
        self::assertSame('unauthenticated', $this->payload($withoutSession)['error']['code']);

        $withoutCsrf = $this->post(
            '/api/sync/push',
            ['deviceId' => self::DEVICE_ID, 'changes' => [$change]],
            [],
            $account['jar'],
        );

        self::assertSame(403, $withoutCsrf->status());
        self::assertSame('csrf_failed', $this->payload($withoutCsrf)['error']['code']);
        self::assertSame(0, $this->userRowCount('user_books', $account['userId']));
    }

    public function test_push_is_limited_to_hundred_twenty_requests_per_hour(): void
    {
        $account = $this->account();
        $now = Clock::nowSql();
        $bucket = SyncService::rateLimitBucket($account['userId']);

        for ($index = 0; $index < SyncService::RATE_LIMIT; $index++) {
            TestDatabase::database()->execute(
                'INSERT INTO `rate_limits` (`bucket`, `ip`, `created_at`) VALUES (?, NULL, ?)',
                [$bucket, $now],
            );
        }

        $response = $this->push(
            [['table' => 'userBooks', 'op' => 'upsert', 'row' => $this->userBook(Uuid::v4(), Uuid::v4(), $this->minutesAgo(5))]],
            $account['csrf'],
            $account['jar'],
        );

        self::assertSame(429, $response->status());
        self::assertSame('rate_limited', $this->payload($response)['error']['code']);
        self::assertNotSame('', (string) $response->header('Retry-After'));
        self::assertSame(0, $this->userRowCount('user_books', $account['userId']));
    }

    /**
     * @param array<string, mixed> $override
     * @return array{csrf: string, jar: array<string, string>, userId: string}
     */
    private function account(array $override = []): array
    {
        $response = $this->register(array_merge(['email' => self::EMAIL], $override));

        self::assertSame(201, $response->status());

        return [
            'csrf' => $this->csrf($response),
            'jar' => $this->jar($response),
            'userId' => (string) $this->payload($response)['user']['id'],
        ];
    }

    /**
     * @param list<array<string, mixed>> $changes
     * @param array<string, string> $jar
     */
    private function push(array $changes, string $csrf, array $jar, ?App $app = null): Response
    {
        return $this->post(
            '/api/sync/push',
            ['deviceId' => self::DEVICE_ID, 'changes' => $changes],
            ['X-CSRF-Token' => $csrf],
            $jar,
            $app,
        );
    }

    /**
     * @return array<string, mixed>
     */
    private function userBook(string $id, string $bookId, string $updatedAt, string $note = 'Not', ?string $deletedAt = null): array
    {
        return [
            'id' => $id,
            'bookId' => $bookId,
            'totalPagesOverride' => null,
            'note' => $note,
            'status' => 'active',
            'startedAt' => null,
            'createdAt' => $updatedAt,
            'updatedAt' => $updatedAt,
            'deletedAt' => $deletedAt,
        ];
    }

    /**
     * @return array<string, mixed>
     */
    private function subject(string $id, string $seedKey, string $name, string $updatedAt): array
    {
        return [
            'id' => $id,
            'seedKey' => $seedKey,
            'exam' => 'TYT',
            'name' => $name,
            'slug' => 'matematik',
            'icon' => 'book',
            'order' => 1,
            'updatedAt' => $updatedAt,
            'deletedAt' => null,
        ];
    }

    /**
     * @return array<string, mixed>
     */
    private function activityLog(string $id, string $taskId, string $createdAt): array
    {
        return [
            'id' => $id,
            'type' => 'book_pages',
            'userBookId' => null,
            'topicId' => null,
            'fromPage' => 1,
            'toPage' => 10,
            'taskId' => $taskId,
            'source' => 'task',
            'createdAt' => $createdAt,
            'deletedAt' => null,
        ];
    }

    /**
     * @return array<string, mixed>
     */
    private function note(string $topicId, string $updatedAt, string $html): array
    {
        return [
            'topicId' => $topicId,
            'contentHtml' => $html,
            'plainText' => strip_tags($html),
            'updatedAt' => $updatedAt,
            'deletedAt' => null,
        ];
    }

    /**
     * @return array<string, mixed>
     */
    private function settings(string $userId, string $updatedAt, string $profileName): array
    {
        return [
            'userId' => $userId,
            'profileName' => $profileName,
            'examDate' => '2027-06-19',
            'examName' => 'YKS 2027',
            'onboardingDone' => true,
            'lastBackupAt' => null,
            'schemaVersion' => 1,
            'seedVersion' => 1,
            'aytAlan' => 'tumu',
            'hiddenSubjects' => [],
            'geometryMode' => 'separate',
            'updatedAt' => $updatedAt,
        ];
    }

    private function minutesAgo(int $minutes): string
    {
        return $this->iso(Clock::now()->modify(sprintf('-%d minutes', $minutes)));
    }

    private function iso(DateTimeImmutable $at): string
    {
        return $at->format('Y-m-d\TH:i:s.u\Z');
    }

    private function sql(string $iso): string
    {
        return (new DateTimeImmutable($iso, new DateTimeZone('UTC')))->format('Y-m-d H:i:s.u');
    }

    /**
     * @return array<string, mixed>|null
     */
    private function syncRow(string $table, string $userId, string $rowId): ?array
    {
        $key = $table === 'notes' ? 'topic_id' : 'id';

        return TestDatabase::database()->fetchOne(
            sprintf('SELECT * FROM `%s` WHERE `user_id` = ? AND `%s` = ?', $table, $key),
            [$userId, $rowId],
        );
    }

    private function userRowCount(string $table, string $userId): int
    {
        $owner = $table === 'catalog_books' ? 'owner_id' : 'user_id';
        $row = TestDatabase::database()->fetchOne(
            sprintf('SELECT COUNT(*) AS `total` FROM `%s` WHERE `%s` = ?', $table, $owner),
            [$userId],
        );

        return (int) ($row['total'] ?? 0);
    }

    private function activeTaskCount(string $userId, string $taskId): int
    {
        $row = TestDatabase::database()->fetchOne(
            'SELECT COUNT(*) AS `total` FROM `activity_logs`'
            . ' WHERE `user_id` = ? AND `task_id` = ? AND `deleted_at` IS NULL',
            [$userId, $taskId],
        );

        return (int) ($row['total'] ?? 0);
    }

    private function sessionCountForUser(string $userId): int
    {
        $row = TestDatabase::database()->fetchOne(
            'SELECT COUNT(*) AS `total` FROM `sessions` WHERE `user_id` = ?',
            [$userId],
        );

        return (int) ($row['total'] ?? 0);
    }

    /**
     * @return list<array<string, mixed>>
     */
    private function changes(string $userId): array
    {
        return TestDatabase::database()->fetchAll(
            'SELECT * FROM `sync_changes` WHERE `user_id` = ? ORDER BY `id`',
            [$userId],
        );
    }
}
