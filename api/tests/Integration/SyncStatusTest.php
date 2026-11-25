<?php

declare(strict_types=1);

namespace Kocluk\Api\Tests\Integration;

use Kocluk\Api\App;
use Kocluk\Api\Http\Request;
use Kocluk\Api\Http\Response;
use Kocluk\Api\Support\Clock;
use Kocluk\Api\Support\Uuid;
use Kocluk\Api\Sync\SyncService;
use Kocluk\Api\Sync\TableMap;
use Kocluk\Api\Tests\Support\ApiTestCase;
use Kocluk\Api\Tests\Support\TestDatabase;

/**
 * GET /api/sync/status and GET /api/sync/full (spec §8.5).
 *
 * status drives the onboarding migration gate: settings alone mean an empty
 * account. full is the fallback when a cursor expired, so it must carry every
 * synced table, tombstones included, and only the signed-in user's rows.
 */
final class SyncStatusTest extends ApiTestCase
{
    private const OTHER_EMAIL = 'beta@example.com';

    private const SERVER_TIME_PATTERN = '/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{6}Z$/';

    public function test_status_reports_an_empty_account(): void
    {
        $account = $this->account();

        $response = $this->get('/api/sync/status', $account['jar']);

        self::assertSame(200, $response->status());

        $payload = $this->payload($response);

        self::assertSame(
            ['hasData', 'hasUserData', 'counts', 'cursor', 'serverTime'],
            array_keys($payload),
        );
        self::assertFalse($payload['hasData']);
        self::assertFalse($payload['hasUserData']);
        self::assertSame(TableMap::keys(), array_keys($payload['counts']));

        foreach ($payload['counts'] as $table => $count) {
            self::assertSame(0, $count, $table . ' boş olmalı.');
        }

        self::assertSame(0, $payload['cursor']);
        self::assertMatchesRegularExpression(self::SERVER_TIME_PATTERN, (string) $payload['serverTime']);
    }

    public function test_settings_alone_do_not_make_the_account_non_empty(): void
    {
        $account = $this->account();

        $this->push(
            [['table' => 'settings', 'op' => 'upsert', 'row' => $this->settings($account['userId'], $this->minutesAgo(10))]],
            $account['csrf'],
            $account['jar'],
        );

        $payload = $this->payload($this->get('/api/sync/status', $account['jar']));

        self::assertFalse($payload['hasData']);
        self::assertFalse($payload['hasUserData']);
        self::assertSame(1, $payload['counts']['settings']);
        self::assertSame(0, $payload['counts']['userBooks']);

        $log = $this->changes($account['userId']);

        self::assertCount(1, $log);
        self::assertSame((int) $log[0]['id'], $payload['cursor']);
    }

    public function test_seeded_subjects_and_topics_do_not_count_as_user_data(): void
    {
        $account = $this->account();
        $subjectId = Uuid::v4();

        $this->push([
            [
                'table' => 'subjects',
                'op' => 'upsert',
                'row' => $this->subject($subjectId, 'tyt-matematik', 'Matematik', $this->minutesAgo(20)),
            ],
            [
                'table' => 'topics',
                'op' => 'upsert',
                'row' => $this->topic(Uuid::v4(), $subjectId, 'Temel Kavramlar', false, 'tyt-matematik-temel', $this->minutesAgo(10)),
            ],
            [
                'table' => 'topics',
                'op' => 'upsert',
                'row' => $this->topic(Uuid::v4(), $subjectId, 'İkinci Tohum', false, 'tyt-matematik-ikinci', $this->minutesAgo(5)),
            ],
        ], $account['csrf'], $account['jar']);

        $payload = $this->payload($this->get('/api/sync/status', $account['jar']));

        // General status still sees data; the transfer gate ignores seeds.
        self::assertTrue($payload['hasData']);
        self::assertFalse($payload['hasUserData']);
        self::assertSame(1, $payload['counts']['subjects']);
        self::assertSame(2, $payload['counts']['topics']);
    }

    public function test_custom_topics_count_as_user_data(): void
    {
        $account = $this->account();
        $subjectId = Uuid::v4();

        $this->push([
            [
                'table' => 'subjects',
                'op' => 'upsert',
                'row' => $this->subject($subjectId, 'tyt-matematik', 'Matematik', $this->minutesAgo(20)),
            ],
            [
                'table' => 'topics',
                'op' => 'upsert',
                'row' => $this->topic(Uuid::v4(), $subjectId, 'Kendi Konum', true, null, $this->minutesAgo(10)),
            ],
        ], $account['csrf'], $account['jar']);

        $payload = $this->payload($this->get('/api/sync/status', $account['jar']));

        self::assertTrue($payload['hasData']);
        self::assertTrue($payload['hasUserData']);
    }

    public function test_custom_catalog_books_count_as_user_data(): void
    {
        $account = $this->account();

        $this->push([
            [
                'table' => 'catalogBooks',
                'op' => 'upsert',
                'row' => [
                    'id' => Uuid::v4(),
                    'title' => 'Kendi Kitabım',
                    'totalPages' => 120,
                    'createdAt' => $this->minutesAgo(20),
                    'updatedAt' => $this->minutesAgo(10),
                    'deletedAt' => null,
                ],
            ],
        ], $account['csrf'], $account['jar']);

        $payload = $this->payload($this->get('/api/sync/status', $account['jar']));

        self::assertTrue($payload['hasData']);
        self::assertTrue($payload['hasUserData']);
        self::assertSame(1, $payload['counts']['catalogBooks']);
    }

    public function test_status_counts_data_rows_and_closes_the_migration_gate(): void
    {
        $account = $this->account();

        $this->push([
            ['table' => 'userBooks', 'op' => 'upsert', 'row' => $this->userBook(Uuid::v4(), Uuid::v4(), $this->minutesAgo(30))],
            ['table' => 'userBooks', 'op' => 'upsert', 'row' => $this->userBook(Uuid::v4(), Uuid::v4(), $this->minutesAgo(20))],
            ['table' => 'notes', 'op' => 'upsert', 'row' => $this->note(Uuid::v4(), $this->minutesAgo(10), '<p>Not</p>')],
        ], $account['csrf'], $account['jar']);

        $payload = $this->payload($this->get('/api/sync/status', $account['jar']));

        self::assertTrue($payload['hasData']);
        self::assertTrue($payload['hasUserData']);
        self::assertSame(2, $payload['counts']['userBooks']);
        self::assertSame(1, $payload['counts']['notes']);
        self::assertSame(0, $payload['counts']['subjects']);
        self::assertSame(0, $payload['counts']['settings']);

        $log = $this->changes($account['userId']);

        self::assertCount(3, $log);
        self::assertSame((int) $log[2]['id'], $payload['cursor']);
    }

    public function test_soft_deleted_rows_are_not_counted_and_do_not_close_the_gate(): void
    {
        $account = $this->account();
        $first = Uuid::v4();
        $second = Uuid::v4();
        $deletedAt = $this->minutesAgo(5);

        $this->push([
            ['table' => 'userBooks', 'op' => 'upsert', 'row' => $this->userBook($first, Uuid::v4(), $this->minutesAgo(30))],
            ['table' => 'userBooks', 'op' => 'upsert', 'row' => $this->userBook($second, Uuid::v4(), $this->minutesAgo(20))],
        ], $account['csrf'], $account['jar']);

        $active = $this->payload($this->get('/api/sync/status', $account['jar']));

        self::assertTrue($active['hasData']);
        self::assertTrue($active['hasUserData']);
        self::assertSame(2, $active['counts']['userBooks']);

        // One tombstone: only the remaining active row counts.
        $this->push(
            [['table' => 'userBooks', 'op' => 'delete', 'rowId' => $second, 'updatedAt' => $deletedAt]],
            $account['csrf'],
            $account['jar'],
        );

        $oneActive = $this->payload($this->get('/api/sync/status', $account['jar']));

        self::assertTrue($oneActive['hasData']);
        self::assertSame(1, $oneActive['counts']['userBooks']);
        self::assertGreaterThan($active['cursor'], $oneActive['cursor']);

        // Tombstones only: the account is empty for the migration gate even
        // though the rows and the change log still exist.
        $this->push(
            [['table' => 'userBooks', 'op' => 'delete', 'rowId' => $first, 'updatedAt' => $deletedAt]],
            $account['csrf'],
            $account['jar'],
        );

        $tombstones = $this->payload($this->get('/api/sync/status', $account['jar']));

        self::assertFalse($tombstones['hasData']);
        self::assertFalse($tombstones['hasUserData']);
        self::assertSame(0, $tombstones['counts']['userBooks']);
        self::assertSame(0, $tombstones['counts']['settings']);
        self::assertSame(0, $tombstones['counts']['notes']);
        self::assertGreaterThan(0, $tombstones['cursor']);

        // Pull still delivers both tombstones; status just does not count
        // them as data.
        $pull = $this->payload($this->get('/api/sync/pull?since=0', $account['jar']));

        self::assertCount(2, $pull['changes']);

        foreach ($pull['changes'] as $change) {
            self::assertSame('userBooks', $change['table']);
            self::assertNotNull($change['row']['deletedAt']);
        }
    }

    public function test_status_only_counts_the_signed_in_users_rows(): void
    {
        $alpha = $this->account();
        $beta = $this->account(['email' => self::OTHER_EMAIL]);

        $this->push(
            [['table' => 'userBooks', 'op' => 'upsert', 'row' => $this->userBook(Uuid::v4(), Uuid::v4(), $this->minutesAgo(10))]],
            $alpha['csrf'],
            $alpha['jar'],
        );

        $payload = $this->payload($this->get('/api/sync/status', $beta['jar']));

        self::assertFalse($payload['hasData']);
        self::assertSame(0, $payload['counts']['userBooks']);
        self::assertSame(0, $payload['cursor']);
    }

    public function test_status_requires_a_session(): void
    {
        $response = $this->get('/api/sync/status', []);

        self::assertSame(401, $response->status());
        self::assertSame('unauthenticated', $this->payload($response)['error']['code']);
    }

    public function test_status_is_limited_to_sixty_requests_per_hour(): void
    {
        $account = $this->account();
        $now = Clock::nowSql();
        $bucket = SyncService::statusRateLimitBucket($account['userId']);

        for ($index = 0; $index < SyncService::STATUS_RATE_LIMIT; $index++) {
            TestDatabase::database()->execute(
                'INSERT INTO `rate_limits` (`bucket`, `ip`, `created_at`) VALUES (?, NULL, ?)',
                [$bucket, $now],
            );
        }

        $response = $this->get('/api/sync/status', $account['jar']);

        self::assertSame(429, $response->status());
        self::assertSame('rate_limited', $this->payload($response)['error']['code']);
        self::assertNotSame('', (string) $response->header('Retry-After'));
    }

    public function test_full_returns_every_table_with_the_current_cursor(): void
    {
        $account = $this->account();
        $userBookId = Uuid::v4();
        $sourceBookId = Uuid::v4();
        $topicId = Uuid::v4();

        $this->push([
            ['table' => 'userBooks', 'op' => 'upsert', 'row' => $this->userBook($userBookId, $sourceBookId, $this->minutesAgo(20))],
            ['table' => 'notes', 'op' => 'upsert', 'row' => $this->note($topicId, $this->minutesAgo(10), '<p>Not</p>')],
        ], $account['csrf'], $account['jar']);

        $response = $this->get('/api/sync/full', $account['jar']);

        self::assertSame(200, $response->status());

        $payload = $this->payload($response);

        self::assertSame(['tables', 'cursor', 'serverTime'], array_keys($payload));
        self::assertSame(TableMap::keys(), array_keys($payload['tables']));
        self::assertMatchesRegularExpression(self::SERVER_TIME_PATTERN, (string) $payload['serverTime']);

        self::assertCount(1, $payload['tables']['userBooks']);
        self::assertSame($userBookId, $payload['tables']['userBooks'][0]['id']);
        self::assertSame($sourceBookId, $payload['tables']['userBooks'][0]['bookId']);
        self::assertNull($payload['tables']['userBooks'][0]['deletedAt']);

        self::assertCount(1, $payload['tables']['notes']);
        self::assertSame($topicId, $payload['tables']['notes'][0]['topicId']);

        self::assertSame([], $payload['tables']['subjects']);
        self::assertSame([], $payload['tables']['settings']);

        $log = $this->changes($account['userId']);

        self::assertCount(2, $log);
        self::assertSame((int) $log[1]['id'], $payload['cursor']);
    }

    public function test_full_contains_tombstones_for_soft_deleted_rows(): void
    {
        $account = $this->account();
        $id = Uuid::v4();
        $deletedAt = $this->minutesAgo(5);

        $this->push(
            [['table' => 'userBooks', 'op' => 'upsert', 'row' => $this->userBook($id, Uuid::v4(), $this->minutesAgo(20))]],
            $account['csrf'],
            $account['jar'],
        );
        $this->push(
            [['table' => 'userBooks', 'op' => 'delete', 'rowId' => $id, 'updatedAt' => $deletedAt]],
            $account['csrf'],
            $account['jar'],
        );

        $payload = $this->payload($this->get('/api/sync/full', $account['jar']));

        self::assertCount(1, $payload['tables']['userBooks']);
        self::assertSame($id, $payload['tables']['userBooks'][0]['id']);
        self::assertSame($deletedAt, $payload['tables']['userBooks'][0]['deletedAt']);
    }

    public function test_full_only_contains_the_signed_in_users_rows(): void
    {
        $alpha = $this->account();
        $beta = $this->account(['email' => self::OTHER_EMAIL]);
        $alphaBook = Uuid::v4();
        $betaBook = Uuid::v4();

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

        $response = $this->get('/api/sync/full', $alpha['jar']);

        self::assertSame(200, $response->status());

        $payload = $this->payload($response);

        self::assertCount(1, $payload['tables']['userBooks']);
        self::assertSame($alphaBook, $payload['tables']['userBooks'][0]['id']);
        self::assertStringNotContainsString($betaBook, $response->body());

        $alphaLog = $this->changes($alpha['userId']);

        self::assertSame((int) $alphaLog[0]['id'], $payload['cursor']);
    }

    public function test_full_is_rejected_when_the_payload_exceeds_the_size_limit(): void
    {
        $account = $this->account();
        $app = $this->app(['sync' => ['full_max_bytes' => 64]]);

        $this->push(
            [['table' => 'userBooks', 'op' => 'upsert', 'row' => $this->userBook(Uuid::v4(), Uuid::v4(), $this->minutesAgo(10))]],
            $account['csrf'],
            $account['jar'],
            $app,
        );

        $rejected = $this->get('/api/sync/full', $account['jar'], $app);

        self::assertSame(413, $rejected->status());
        self::assertSame('payload_too_large', $this->payload($rejected)['error']['code']);

        // The same account and the same rows fit under the default limit.
        $accepted = $this->get('/api/sync/full', $account['jar']);

        self::assertSame(200, $accepted->status());
        self::assertCount(1, $this->payload($accepted)['tables']['userBooks']);
    }

    public function test_full_requires_a_session(): void
    {
        $response = $this->get('/api/sync/full', []);

        self::assertSame(401, $response->status());
        self::assertSame('unauthenticated', $this->payload($response)['error']['code']);
    }

    public function test_full_is_limited_to_five_requests_per_hour(): void
    {
        $account = $this->account();
        $now = Clock::nowSql();
        $bucket = SyncService::fullRateLimitBucket($account['userId']);

        for ($index = 0; $index < SyncService::FULL_RATE_LIMIT; $index++) {
            TestDatabase::database()->execute(
                'INSERT INTO `rate_limits` (`bucket`, `ip`, `created_at`) VALUES (?, NULL, ?)',
                [$bucket, $now],
            );
        }

        $response = $this->get('/api/sync/full', $account['jar']);

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
            ['deviceId' => '55555555-5555-4555-8555-555555555555', 'changes' => $changes],
            ['X-CSRF-Token' => $csrf],
            $jar,
            $app,
        );
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
    private function topic(
        string $id,
        string $subjectId,
        string $name,
        bool $isCustom,
        ?string $seedKey,
        string $updatedAt,
    ): array {
        $row = [            'id' => $id,
            'subjectId' => $subjectId,
            'name' => $name,
            'order' => 1,
            'isCustom' => $isCustom,
            'createdAt' => $updatedAt,
            'updatedAt' => $updatedAt,
            'deletedAt' => null,
        ];

        if ($seedKey !== null) {
            $row['seedKey'] = $seedKey;
        }

        return $row;
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

    /**
     * @return array<string, mixed>
     */
    private function settings(string $userId, string $updatedAt): array
    {
        return [
            'userId' => $userId,
            'profileName' => 'Ayşe',
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
