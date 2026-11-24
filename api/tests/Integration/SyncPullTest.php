<?php

declare(strict_types=1);

namespace Kocluk\Api\Tests\Integration;

use Kocluk\Api\App;
use Kocluk\Api\Http\Request;
use Kocluk\Api\Http\Response;
use Kocluk\Api\Support\Clock;
use Kocluk\Api\Support\Uuid;
use Kocluk\Api\Sync\SyncService;
use Kocluk\Api\Tests\Support\ApiTestCase;
use Kocluk\Api\Tests\Support\TestDatabase;

/**
 * GET /api/sync/pull (spec §8.3).
 *
 * Every test goes through the real HTTP kernel: the HttpOnly session cookie,
 * the per-user rate limit, the sync_changes cursor, tombstones, per-row
 * de-duplication and the cursor_expired fallback after the 90-day purge.
 */
final class SyncPullTest extends ApiTestCase
{
    private const OTHER_EMAIL = 'beta@example.com';

    public function test_pull_returns_a_pushed_row_as_the_current_canonical_state(): void
    {
        $account = $this->account();
        $id = Uuid::v4();
        $bookId = Uuid::v4();
        $updatedAt = $this->minutesAgo(10);

        $this->push(
            [['table' => 'userBooks', 'op' => 'upsert', 'row' => $this->userBook($id, $bookId, $updatedAt, 'İlk not')]],
            $account['csrf'],
            $account['jar'],
        );

        $response = $this->get('/api/sync/pull', $account['jar']);

        self::assertSame(200, $response->status());

        $payload = $this->payload($response);

        self::assertSame(['changes', 'nextCursor', 'hasMore'], array_keys($payload));
        self::assertCount(1, $payload['changes']);
        self::assertFalse($payload['hasMore']);

        $change = $payload['changes'][0];

        self::assertSame(['table', 'row'], array_keys($change));
        self::assertSame('userBooks', $change['table']);
        self::assertSame($id, $change['row']['id']);
        self::assertSame($bookId, $change['row']['bookId']);
        self::assertSame('İlk not', $change['row']['note']);
        self::assertSame($updatedAt, $change['row']['updatedAt']);
        self::assertNull($change['row']['deletedAt']);

        self::assertArrayNotHasKey('userId', $change['row']);
        self::assertArrayNotHasKey('user_id', $change['row']);
        self::assertArrayNotHasKey('server_updated_at', $change['row']);
        self::assertArrayNotHasKey('active_book_id', $change['row']);

        $log = $this->changes($account['userId']);

        self::assertCount(1, $log);
        self::assertSame((int) $log[0]['id'], $payload['nextCursor']);
    }

    public function test_pull_is_incremental_from_the_supplied_cursor(): void
    {
        $account = $this->account();
        $firstId = Uuid::v4();

        $this->push(
            [['table' => 'userBooks', 'op' => 'upsert', 'row' => $this->userBook($firstId, Uuid::v4(), $this->minutesAgo(20))]],
            $account['csrf'],
            $account['jar'],
        );

        $first = $this->payload($this->get('/api/sync/pull', $account['jar']));

        self::assertCount(1, $first['changes']);

        $cursor = $first['nextCursor'];

        $idle = $this->payload($this->get('/api/sync/pull?since=' . $cursor, $account['jar']));

        self::assertSame([], $idle['changes']);
        self::assertSame($cursor, $idle['nextCursor']);
        self::assertFalse($idle['hasMore']);

        $secondId = Uuid::v4();

        $this->push(
            [['table' => 'userBooks', 'op' => 'upsert', 'row' => $this->userBook($secondId, Uuid::v4(), $this->minutesAgo(10))]],
            $account['csrf'],
            $account['jar'],
        );

        $incremental = $this->payload($this->get('/api/sync/pull?since=' . $cursor, $account['jar']));

        self::assertCount(1, $incremental['changes']);
        self::assertSame($secondId, $incremental['changes'][0]['row']['id']);
        self::assertGreaterThan($cursor, $incremental['nextCursor']);
        self::assertFalse($incremental['hasMore']);

        // since=0 means "from the beginning" and still returns both rows.
        $all = $this->payload($this->get('/api/sync/pull?since=0', $account['jar']));

        self::assertCount(2, $all['changes']);
    }

    public function test_pull_paginates_with_limit_and_reports_has_more(): void
    {
        $account = $this->account();
        $ids = [];

        foreach (range(1, 3) as $index) {
            $ids[$index] = Uuid::v4();
        }

        $this->push([
            ['table' => 'userBooks', 'op' => 'upsert', 'row' => $this->userBook($ids[1], Uuid::v4(), $this->minutesAgo(30))],
            ['table' => 'userBooks', 'op' => 'upsert', 'row' => $this->userBook($ids[2], Uuid::v4(), $this->minutesAgo(20))],
            ['table' => 'userBooks', 'op' => 'upsert', 'row' => $this->userBook($ids[3], Uuid::v4(), $this->minutesAgo(10))],
        ], $account['csrf'], $account['jar']);

        $log = $this->changes($account['userId']);

        self::assertCount(3, $log);

        $first = $this->payload($this->get('/api/sync/pull?limit=2', $account['jar']));

        self::assertCount(2, $first['changes']);
        self::assertTrue($first['hasMore']);
        self::assertSame((int) $log[1]['id'], $first['nextCursor']);
        self::assertSame($ids[1], $first['changes'][0]['row']['id']);
        self::assertSame($ids[2], $first['changes'][1]['row']['id']);

        $second = $this->payload($this->get(
            '/api/sync/pull?since=' . $first['nextCursor'] . '&limit=2',
            $account['jar'],
        ));

        self::assertCount(1, $second['changes']);
        self::assertFalse($second['hasMore']);
        self::assertSame((int) $log[2]['id'], $second['nextCursor']);
        self::assertSame($ids[3], $second['changes'][0]['row']['id']);
    }

    public function test_pull_keeps_only_the_last_state_of_a_row_seen_twice(): void
    {
        $account = $this->account();
        $id = Uuid::v4();
        $bookId = Uuid::v4();
        $older = $this->minutesAgo(30);
        $newer = $this->minutesAgo(20);

        $this->push(
            [['table' => 'userBooks', 'op' => 'upsert', 'row' => $this->userBook($id, $bookId, $older, 'eski')]],
            $account['csrf'],
            $account['jar'],
        );
        $this->push(
            [['table' => 'userBooks', 'op' => 'upsert', 'row' => $this->userBook($id, $bookId, $newer, 'yeni')]],
            $account['csrf'],
            $account['jar'],
        );

        $payload = $this->payload($this->get('/api/sync/pull', $account['jar']));

        self::assertCount(1, $payload['changes']);
        self::assertSame($id, $payload['changes'][0]['row']['id']);
        self::assertSame('yeni', $payload['changes'][0]['row']['note']);
        self::assertSame($newer, $payload['changes'][0]['row']['updatedAt']);
        self::assertFalse($payload['hasMore']);

        $log = $this->changes($account['userId']);

        self::assertCount(2, $log);
        self::assertSame((int) $log[1]['id'], $payload['nextCursor']);
    }

    public function test_pull_returns_a_tombstone_for_a_deleted_row(): void
    {
        $account = $this->account();
        $topicId = Uuid::v4();
        $deletedAt = $this->minutesAgo(10);

        $this->push(
            [['table' => 'notes', 'op' => 'upsert', 'row' => $this->note($topicId, $this->minutesAgo(20), '<p>Not</p>')]],
            $account['csrf'],
            $account['jar'],
        );
        $this->push(
            [['table' => 'notes', 'op' => 'delete', 'rowId' => $topicId, 'updatedAt' => $deletedAt]],
            $account['csrf'],
            $account['jar'],
        );

        $payload = $this->payload($this->get('/api/sync/pull', $account['jar']));

        self::assertCount(1, $payload['changes']);

        $change = $payload['changes'][0];

        self::assertSame('notes', $change['table']);
        self::assertSame($topicId, $change['row']['topicId']);
        self::assertSame($deletedAt, $change['row']['deletedAt']);
        self::assertSame($deletedAt, $change['row']['updatedAt']);
    }

    public function test_pull_skips_changes_whose_row_no_longer_exists(): void
    {
        $account = $this->account();
        $id = Uuid::v4();
        $missingNote = Uuid::v4();

        $this->push(
            [['table' => 'userBooks', 'op' => 'upsert', 'row' => $this->userBook($id, Uuid::v4(), $this->minutesAgo(20))]],
            $account['csrf'],
            $account['jar'],
        );

        $database = TestDatabase::database();

        // A hard delete never happens through the API, but a row removed by
        // maintenance must not wedge the cursor: the change is skipped.
        $database->execute(
            'DELETE FROM `user_books` WHERE `user_id` = ? AND `id` = ?',
            [$account['userId'], $id],
        );

        // A log entry for a table the map no longer knows must be skipped too.
        $database->execute(
            'INSERT INTO `sync_changes` (`user_id`, `table_name`, `row_id`, `op`) VALUES (?, ?, ?, ?)',
            [$account['userId'], 'photos', Uuid::v4(), 'upsert'],
        );
        $database->execute(
            'INSERT INTO `sync_changes` (`user_id`, `table_name`, `row_id`, `op`) VALUES (?, ?, ?, ?)',
            [$account['userId'], 'notes', $missingNote, 'delete'],
        );

        $payload = $this->payload($this->get('/api/sync/pull', $account['jar']));

        self::assertSame([], $payload['changes']);
        self::assertFalse($payload['hasMore']);

        $log = $this->changes($account['userId']);

        self::assertCount(3, $log);
        self::assertSame((int) $log[2]['id'], $payload['nextCursor']);
    }

    public function test_pull_reports_cursor_expired_once_the_log_was_purged(): void
    {
        $account = $this->account();
        $ids = [];

        foreach (range(1, 3) as $index) {
            $ids[$index] = Uuid::v4();
        }

        $this->push([
            ['table' => 'userBooks', 'op' => 'upsert', 'row' => $this->userBook($ids[1], Uuid::v4(), $this->minutesAgo(30))],
            ['table' => 'userBooks', 'op' => 'upsert', 'row' => $this->userBook($ids[2], Uuid::v4(), $this->minutesAgo(20))],
            ['table' => 'userBooks', 'op' => 'upsert', 'row' => $this->userBook($ids[3], Uuid::v4(), $this->minutesAgo(10))],
        ], $account['csrf'], $account['jar']);

        $log = $this->changes($account['userId']);

        self::assertCount(3, $log);

        $firstId = (int) $log[0]['id'];
        $secondId = (int) $log[1]['id'];
        $thirdId = (int) $log[2]['id'];

        // The 90-day cron purge removed everything up to and including the
        // change the client has not seen yet.
        TestDatabase::database()->execute(
            'DELETE FROM `sync_changes` WHERE `user_id` = ? AND `id` <= ?',
            [$account['userId'], $secondId],
        );

        $expired = $this->get('/api/sync/pull?since=' . $firstId, $account['jar']);

        self::assertSame(410, $expired->status());
        self::assertSame('cursor_expired', $this->payload($expired)['error']['code']);

        // The oldest retained id minus one leaves no gap, so it is accepted.
        $boundary = $this->get('/api/sync/pull?since=' . $secondId, $account['jar']);

        self::assertSame(200, $boundary->status());

        $payload = $this->payload($boundary);

        self::assertCount(1, $payload['changes']);
        self::assertSame($ids[3], $payload['changes'][0]['row']['id']);
        self::assertSame($thirdId, $payload['nextCursor']);
        self::assertFalse($payload['hasMore']);
    }

    public function test_pull_only_returns_the_signed_in_users_changes(): void
    {
        $alpha = $this->account();
        $beta = $this->account(['email' => self::OTHER_EMAIL]);
        $alphaBook = Uuid::v4();

        $this->push(
            [['table' => 'userBooks', 'op' => 'upsert', 'row' => $this->userBook($alphaBook, Uuid::v4(), $this->minutesAgo(10))]],
            $alpha['csrf'],
            $alpha['jar'],
        );

        $betaResponse = $this->get('/api/sync/pull', $beta['jar']);
        $betaPayload = $this->payload($betaResponse);

        self::assertSame(200, $betaResponse->status());
        self::assertSame([], $betaPayload['changes']);
        self::assertSame(0, $betaPayload['nextCursor']);
        self::assertStringNotContainsString($alphaBook, $betaResponse->body());

        $alphaPayload = $this->payload($this->get('/api/sync/pull', $alpha['jar']));

        self::assertCount(1, $alphaPayload['changes']);
        self::assertSame($alphaBook, $alphaPayload['changes'][0]['row']['id']);

        // Another account's cursor stays inside this account's own log: no
        // rows leak, and a cursor past this account's max id is not an error
        // (cursor-ahead-of-maxId is deliberately not detected).
        $foreignCursor = $this->get('/api/sync/pull?since=' . $alphaPayload['nextCursor'], $beta['jar']);

        self::assertSame(200, $foreignCursor->status());

        $foreignPayload = $this->payload($foreignCursor);

        self::assertSame([], $foreignPayload['changes']);
        self::assertSame($alphaPayload['nextCursor'], $foreignPayload['nextCursor']);
        self::assertStringNotContainsString($alphaBook, $foreignCursor->body());
    }

    public function test_each_new_account_can_pull_its_first_changes_without_a_cursor(): void
    {
        $alpha = $this->account();
        $beta = $this->account(['email' => self::OTHER_EMAIL]);
        $alphaBook = Uuid::v4();
        $betaBook = Uuid::v4();

        // The change log id is global AUTO_INCREMENT, so beta's first change
        // does not start at 1. since=0 must still mean "from the start of the
        // retained log", not "expired".
        $this->push(
            [['table' => 'userBooks', 'op' => 'upsert', 'row' => $this->userBook($alphaBook, Uuid::v4(), $this->minutesAgo(20))]],
            $alpha['csrf'],
            $alpha['jar'],
        );
        $this->push(
            [['table' => 'userBooks', 'op' => 'upsert', 'row' => $this->userBook($betaBook, Uuid::v4(), $this->minutesAgo(10))]],
            $beta['csrf'],
            $beta['jar'],
        );

        $betaLog = $this->changes($beta['userId']);

        self::assertCount(1, $betaLog);
        self::assertGreaterThan(1, (int) $betaLog[0]['id']);

        $betaResponse = $this->get('/api/sync/pull', $beta['jar']);

        self::assertSame(200, $betaResponse->status());

        $betaPayload = $this->payload($betaResponse);

        self::assertCount(1, $betaPayload['changes']);
        self::assertSame($betaBook, $betaPayload['changes'][0]['row']['id']);
        self::assertSame((int) $betaLog[0]['id'], $betaPayload['nextCursor']);
        self::assertFalse($betaPayload['hasMore']);
        self::assertStringNotContainsString($alphaBook, $betaResponse->body());

        $alphaResponse = $this->get('/api/sync/pull', $alpha['jar']);

        self::assertSame(200, $alphaResponse->status());

        $alphaPayload = $this->payload($alphaResponse);

        self::assertCount(1, $alphaPayload['changes']);
        self::assertSame($alphaBook, $alphaPayload['changes'][0]['row']['id']);
    }

    public function test_pull_requires_a_session(): void
    {
        $response = $this->get('/api/sync/pull', []);

        self::assertSame(401, $response->status());
        self::assertSame('unauthenticated', $this->payload($response)['error']['code']);

        $bogus = $this->get('/api/sync/pull', ['kocluk_session' => 'uydurma-token']);

        self::assertSame(401, $bogus->status());
        self::assertSame('unauthenticated', $this->payload($bogus)['error']['code']);
    }

    public function test_pull_rejects_invalid_query_parameters(): void
    {
        $account = $this->account();

        foreach (['since=abc', 'since=1.5', 'since=-1', 'limit=0', 'limit=abc', 'limit=-5'] as $query) {
            $response = $this->get('/api/sync/pull?' . $query, $account['jar']);

            self::assertSame(422, $response->status(), $query);
            self::assertSame('validation_failed', $this->payload($response)['error']['code'], $query);
        }
    }

    public function test_pull_caps_the_limit_at_five_hundred_changes(): void
    {
        $account = $this->account();
        $database = TestDatabase::database();
        $total = 501;

        // Points at rows that do not exist, so the test measures pagination
        // only and every fetched change is skipped.
        for ($index = 1; $index <= $total; $index++) {
            $database->execute(
                'INSERT INTO `sync_changes` (`user_id`, `table_name`, `row_id`, `op`) VALUES (?, ?, ?, ?)',
                [$account['userId'], 'notes', sprintf('missing-%03d', $index), 'upsert'],
            );
        }

        $ids = array_map(
            static fn (array $row): int => (int) $row['id'],
            $database->fetchAll(
                'SELECT `id` FROM `sync_changes` WHERE `user_id` = ? ORDER BY `id`',
                [$account['userId']],
            ),
        );

        self::assertCount($total, $ids);

        $first = $this->payload($this->get('/api/sync/pull?limit=1000', $account['jar']));

        self::assertSame([], $first['changes']);
        self::assertTrue($first['hasMore']);
        self::assertSame($ids[499], $first['nextCursor']);

        $second = $this->payload($this->get(
            '/api/sync/pull?since=' . $first['nextCursor'] . '&limit=1000',
            $account['jar'],
        ));

        self::assertSame([], $second['changes']);
        self::assertFalse($second['hasMore']);
        self::assertSame($ids[500], $second['nextCursor']);
    }

    public function test_pull_is_limited_to_hundred_twenty_requests_per_hour(): void
    {
        $account = $this->account();
        $now = Clock::nowSql();
        $bucket = SyncService::pullRateLimitBucket($account['userId']);

        for ($index = 0; $index < SyncService::PULL_RATE_LIMIT; $index++) {
            TestDatabase::database()->execute(
                'INSERT INTO `rate_limits` (`bucket`, `ip`, `created_at`) VALUES (?, NULL, ?)',
                [$bucket, $now],
            );
        }

        $response = $this->get('/api/sync/pull', $account['jar']);

        self::assertSame(429, $response->status());
        self::assertSame('rate_limited', $this->payload($response)['error']['code']);
        self::assertNotSame('', (string) $response->header('Retry-After'));
    }

    /**
     * @param array<string, string> $jar
     */
    private function get(string $target, array $jar, ?App $app = null): Response
    {
        return ($app ?? $this->app())->handle(Request::create('GET', $target, [], '', $jar));
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
            ['deviceId' => '44444444-4444-4444-8444-444444444444', 'changes' => $changes],
            ['X-CSRF-Token' => $csrf],
            $jar,
            $app,
        );
    }

    /**
     * @return array<string, mixed>
     */
    private function userBook(string $id, string $bookId, string $updatedAt, string $note = 'Not'): array
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

    private function minutesAgo(int $minutes): string
    {
        return Clock::now()->modify(sprintf('-%d minutes', $minutes))->format('Y-m-d\TH:i:s.u\Z');
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
