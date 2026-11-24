<?php

declare(strict_types=1);

namespace Kocluk\Api\Tests\Integration;

use Kocluk\Api\Http\Request;
use Kocluk\Api\Http\Response;
use Kocluk\Api\Support\Clock;
use Kocluk\Api\Support\Uuid;
use Kocluk\Api\Tests\Support\ApiTestCase;
use Kocluk\Api\Tests\Support\TestDatabase;

/**
 * KVKK account export and hard deletion (spec §11).
 *
 * Every assertion goes through the real HTTP kernel so status codes, headers
 * and isolation between two accounts match what a browser would observe.
 */
final class AccountTest extends ApiTestCase
{
    private const OTHER_EMAIL = 'beta@example.com';

    private const MARKER_A = 'KULLANICI-A';

    private const MARKER_B = 'KULLANICI-B';

    /** Tables that hold per-user rows and must be exported and deleted. */
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
        'topic_progress',
        'user_settings',
    ];

    public function test_export_contains_only_the_authenticated_users_rows(): void
    {
        $alpha = $this->register();
        $alphaId = $this->userId($alpha);

        $beta = $this->register(['email' => self::OTHER_EMAIL]);
        $betaId = $this->userId($beta);

        $this->seedSyncData($alphaId, self::MARKER_A);
        $this->seedSyncData($betaId, self::MARKER_B);

        // A GET download: the session cookie is enough, no CSRF token.
        $response = $this->export($this->jar($alpha));
        $body = $response->body();

        self::assertSame(200, $response->status());
        self::assertSame('application/json; charset=utf-8', $response->header('Content-Type'));
        self::assertMatchesRegularExpression(
            '/^attachment; filename="kocluk-hesap-\d{4}-\d{2}-\d{2}\.json"$/',
            (string) $response->header('Content-Disposition'),
        );

        // The other account's e-mail and every one of its rows stay out.
        self::assertStringNotContainsString(self::OTHER_EMAIL, $body);
        self::assertStringNotContainsString(self::MARKER_B, $body);
        self::assertStringNotContainsString('password_hash', $body);

        $payload = $this->payload($response);

        self::assertSame($alphaId, $payload['user']['id']);
        self::assertSame(self::EMAIL, $payload['user']['email']);
        self::assertSame(self::DISPLAY_NAME, $payload['user']['displayName']);
        self::assertSame('2026-11-24', $payload['user']['privacyVersion']);
        self::assertNotSame('', $payload['user']['consentedAt']);
        self::assertArrayNotHasKey('password_hash', $payload['user']);

        $tables = $payload['tables'];

        foreach (self::SYNC_TABLES as $key) {
            self::assertArrayHasKey($this->apiKey($key), $tables);
            self::assertCount(1, $tables[$this->apiKey($key)], $this->apiKey($key));
        }

        self::assertStringContainsString(
            self::MARKER_A,
            (string) $tables['notes'][0]['content_html'],
        );
        self::assertStringContainsString(
            self::MARKER_A,
            (string) $tables['catalogBooks'][0]['title'],
        );
        self::assertStringContainsString(
            self::MARKER_A,
            (string) $tables['scheduleTasks'][0]['title'],
        );
        $settings = $tables['settings'][0]['data'];

        self::assertSame(self::MARKER_A, $settings['marker']);
        self::assertSame('dark', $settings['theme']);
    }

    public function test_export_requires_a_session(): void
    {
        $response = $this->app()->handle(Request::create('GET', '/api/account/export'));

        self::assertSame(401, $response->status());
        self::assertSame('unauthenticated', $this->payload($response)['error']['code']);
    }

    public function test_delete_rejects_a_wrong_or_missing_password(): void
    {
        $device = $this->register();
        $this->seedSyncData($this->userId($device), self::MARKER_A);

        $wrong = $this->deleteAccount(
            'yanlis-sifre-123',
            ['X-CSRF-Token' => $this->csrf($device)],
            $this->jar($device),
        );

        self::assertSame(403, $wrong->status());
        self::assertSame('invalid_password', $this->payload($wrong)['error']['code']);
        self::assertStringNotContainsString('yanlis-sifre-123', $wrong->body());
        self::assertNull($wrong->header('Set-Cookie'));

        $missing = $this->deleteAccount(
            '',
            ['X-CSRF-Token' => $this->csrf($device)],
            $this->jar($device),
        );

        self::assertSame(403, $missing->status());
        self::assertSame(1, $this->countRows('users'));
        self::assertSame(1, $this->countRows('notes'));
        self::assertSame(200, $this->sessionStatus($this->jar($device)));
    }

    public function test_delete_requires_a_session_and_a_csrf_token(): void
    {
        $device = $this->register();
        $this->seedSyncData($this->userId($device), self::MARKER_A);

        $withoutCsrf = $this->deleteAccount(
            self::PASSWORD,
            [],
            $this->jar($device),
        );

        self::assertSame(403, $withoutCsrf->status());
        self::assertSame('csrf_failed', $this->payload($withoutCsrf)['error']['code']);
        self::assertSame(1, $this->countRows('users'));
        self::assertSame(1, $this->countRows('notes'));

        $withoutSession = $this->deleteAccount(
            self::PASSWORD,
            ['X-CSRF-Token' => $this->csrf($device)],
            [],
        );

        self::assertSame(401, $withoutSession->status());
        self::assertSame('unauthenticated', $this->payload($withoutSession)['error']['code']);
        self::assertSame(1, $this->countRows('users'));
        self::assertSame(1, $this->countRows('notes'));
    }

    public function test_delete_hard_deletes_every_account_row_and_frees_the_email(): void
    {
        $device = $this->register();
        $userId = $this->userId($device);
        $this->seedSyncData($userId, self::MARKER_A);

        // A second device, a password reset token and a user-linked
        // rate-limit row; registration already wrote an e-mail verification.
        self::assertSame(200, $this->login()->status());
        self::assertSame(2, $this->countRows('sessions'));
        self::assertSame(1, $this->countRows('email_verifications'));
        self::assertSame(1, $this->countRows('sync_changes'));

        $database = TestDatabase::database();
        $now = Clock::nowSql();

        $database->execute(
            'INSERT INTO `password_resets` (`id`, `user_id`, `expires_at`, `created_at`)'
            . ' VALUES (?, ?, ?, ?)',
            ['reset-hash-' . $userId, $userId, $now, $now],
        );
        $database->execute(
            'INSERT INTO `rate_limits` (`user_id`, `bucket`, `ip`, `created_at`)'
            . ' VALUES (?, ?, ?, ?)',
            [$userId, 'delete-account-test', '127.0.0.1', $now],
        );
        $database->execute(
            'INSERT INTO `rate_limits` (`bucket`, `ip`, `created_at`) VALUES (?, ?, ?)',
            ['ip-only-test', '10.9.9.9', $now],
        );

        $response = $this->deleteAccount(
            self::PASSWORD,
            ['X-CSRF-Token' => $this->csrf($device)],
            $this->jar($device),
        );

        self::assertSame(200, $response->status());
        self::assertTrue($this->payload($response)['ok']);

        $cookie = (string) $response->header('Set-Cookie');

        self::assertStringStartsWith('kocluk_session=;', $cookie);
        self::assertStringContainsString('Max-Age=0', $cookie);
        self::assertStringContainsString('HttpOnly', $cookie);

        self::assertSame(0, $this->countRows('users'));
        self::assertSame(0, $this->countRows('sessions'));
        self::assertSame(0, $this->countRows('password_resets'));
        self::assertSame(0, $this->countRows('email_verifications'));
        self::assertSame(0, $this->countRows('sync_changes'));

        foreach (self::SYNC_TABLES as $table) {
            self::assertSame(0, $this->countRows($table), $table . ' boş olmalı.');
        }

        self::assertSame(0, $this->countUserRows('rate_limits', $userId));
        self::assertSame(1, $this->countBucketRows('ip-only-test'));
        self::assertSame(401, $this->sessionStatus($this->jar($device)));

        // The hard delete freed the unique e-mail; the same address can
        // register again and sign in with the same password.
        $again = $this->register();

        self::assertSame(201, $again->status());
        self::assertNotSame($userId, $this->userId($again));
        self::assertSame(1, $this->countRows('users'));
        self::assertSame(200, $this->login()->status());
    }

    public function test_delete_leaves_another_users_rows_untouched(): void
    {
        $alpha = $this->register();
        $alphaId = $this->userId($alpha);
        $beta = $this->register(['email' => self::OTHER_EMAIL]);
        $betaId = $this->userId($beta);

        $this->seedSyncData($alphaId, self::MARKER_A);
        $this->seedSyncData($betaId, self::MARKER_B);

        $now = Clock::nowSql();
        $database = TestDatabase::database();

        foreach ([$alphaId, $betaId] as $index => $ownerId) {
            $database->execute(
                'INSERT INTO `password_resets` (`id`, `user_id`, `expires_at`, `created_at`)'
                . ' VALUES (?, ?, ?, ?)',
                ['reset-' . $index, $ownerId, $now, $now],
            );
            $database->execute(
                'INSERT INTO `rate_limits` (`user_id`, `bucket`, `ip`, `created_at`)'
                . ' VALUES (?, ?, ?, ?)',
                [$ownerId, 'isolation-limit', '127.0.0.1', $now],
            );
        }

        $response = $this->deleteAccount(
            self::PASSWORD,
            ['X-CSRF-Token' => $this->csrf($alpha)],
            $this->jar($alpha),
        );

        self::assertSame(200, $response->status());
        self::assertSame(1, $this->countRows('users'));

        foreach (self::SYNC_TABLES as $table) {
            self::assertSame(0, $this->countUserRows($table, $alphaId), $table . ' A satırı kalmamalı.');
            self::assertSame(1, $this->countUserRows($table, $betaId), $table . ' B satırı korunmalı.');
        }

        self::assertSame(0, $this->countUserRows('sync_changes', $alphaId));
        self::assertSame(1, $this->countUserRows('sync_changes', $betaId));
        self::assertSame(0, $this->countUserRows('sessions', $alphaId));
        self::assertSame(1, $this->countUserRows('sessions', $betaId));
        self::assertSame(0, $this->countUserRows('password_resets', $alphaId));
        self::assertSame(1, $this->countUserRows('password_resets', $betaId));
        self::assertSame(0, $this->countUserRows('email_verifications', $alphaId));
        self::assertSame(1, $this->countUserRows('email_verifications', $betaId));
        self::assertSame(0, $this->countUserRows('rate_limits', $alphaId));
        self::assertSame(1, $this->countUserRows('rate_limits', $betaId));
        self::assertSame(200, $this->sessionStatus($this->jar($beta)));

        // B's export still works and contains only B's rows.
        $export = $this->export($this->jar($beta));

        self::assertSame(200, $export->status());
        self::assertStringContainsString(self::MARKER_B, $export->body());
        self::assertStringNotContainsString(self::MARKER_A, $export->body());
        self::assertSame($betaId, $this->payload($export)['user']['id']);
    }

    public function test_delete_scopes_private_catalog_books_by_owner(): void
    {
        $alpha = $this->register();
        $alphaId = $this->userId($alpha);
        $beta = $this->register(['email' => self::OTHER_EMAIL]);
        $betaId = $this->userId($beta);

        // Row ids are only unique per owner, so both accounts can hold the
        // same private-book id. Deleting one owner must not remove the other.
        $sharedId = '11111111-1111-4111-8111-111111111111';
        $now = Clock::nowSql();

        foreach ([[$alphaId, 'Kitap A'], [$betaId, 'Kitap B']] as [$ownerId, $title]) {
            TestDatabase::database()->execute(
                'INSERT INTO `catalog_books` (`id`, `owner_id`, `title`, `publisher`, `exam`, `subject_slug`, `total_pages`, `edition`, `created_at`, `updated_at`)'
                . ' VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
                [$sharedId, $ownerId, $title, 'Yayın', 'TYT', 'matematik', 100, '1. Baskı', $now, $now],
            );
        }

        $response = $this->deleteAccount(
            self::PASSWORD,
            ['X-CSRF-Token' => $this->csrf($alpha)],
            $this->jar($alpha),
        );

        self::assertSame(200, $response->status());
        self::assertSame(0, $this->countUserRows('catalog_books', $alphaId));
        self::assertSame(1, $this->countUserRows('catalog_books', $betaId));

        $kept = TestDatabase::database()->fetchOne(
            'SELECT `title` FROM `catalog_books` WHERE `owner_id` = ? AND `id` = ?',
            [$betaId, $sharedId],
        );

        self::assertIsArray($kept);
        self::assertSame('Kitap B', $kept['title']);
    }

    public function test_registration_without_privacy_acceptance_is_rejected(): void
    {
        $response = $this->post('/api/auth/register', [
            'email' => self::EMAIL,
            'password' => self::PASSWORD,
            'displayName' => self::DISPLAY_NAME,
        ], ['Origin' => self::ORIGIN]);

        self::assertSame(422, $response->status());
        self::assertSame('validation_failed', $this->payload($response)['error']['code']);
        self::assertNull($response->header('Set-Cookie'));
        self::assertSame(0, $this->countRows('users'));
    }

    public function test_registration_records_the_privacy_version_and_consent_time(): void
    {
        $response = $this->register();

        self::assertSame(201, $response->status());

        $row = $this->userRow();

        self::assertSame('2026-11-24', $row['privacy_version']);
        self::assertNotNull($row['consented_at']);
        self::assertSame(
            (string) $row['created_at'],
            (string) $row['consented_at'],
            'Kayıt anındaki onay zamanı created_at ile aynı olmalı.',
        );
    }

    /**
     * @param array<string, string> $cookies
     */
    private function export(array $cookies): Response
    {
        return $this->app()->handle(
            Request::create('GET', '/api/account/export', [], '', $cookies),
        );
    }

    /**
     * @param array<string, string> $headers
     * @param array<string, string> $cookies
     */
    private function deleteAccount(string $password, array $headers, array $cookies): Response
    {
        return $this->post(
            '/api/auth/delete-account',
            ['password' => $password],
            $headers,
            $cookies,
        );
    }

    private function userId(Response $response): string
    {
        return (string) $this->payload($response)['user']['id'];
    }

    private function apiKey(string $table): string
    {
        return match ($table) {
            'exam_results' => 'examResults',
            'catalog_books' => 'catalogBooks',
            'user_books' => 'userBooks',
            'activity_logs' => 'activityLogs',
            'schedule_weeks' => 'scheduleWeeks',
            'schedule_rows' => 'scheduleRows',
            'schedule_tasks' => 'scheduleTasks',
            'topic_progress' => 'topicProgress',
            'user_settings' => 'settings',
            default => $table,
        };
    }

    private function countUserRows(string $table, string $userId): int
    {
        $owner = $table === 'catalog_books' ? 'owner_id' : 'user_id';
        $row = TestDatabase::database()->fetchOne(
            'SELECT COUNT(*) AS `total` FROM `' . $table . '` WHERE `' . $owner . '` = ?',
            [$userId],
        );

        return (int) ($row['total'] ?? 0);
    }

    private function countBucketRows(string $bucket): int
    {
        $row = TestDatabase::database()->fetchOne(
            'SELECT COUNT(*) AS `total` FROM `rate_limits` WHERE `bucket` = ?',
            [$bucket],
        );

        return (int) ($row['total'] ?? 0);
    }

    /**
     * Inserts one row into every synced table for the given account.
     */
    private function seedSyncData(string $userId, string $marker): void
    {
        $database = TestDatabase::database();
        $now = Clock::nowSql();
        $suffix = strtolower($marker);

        $subjectId = Uuid::v4();
        $topicId = Uuid::v4();
        $examId = Uuid::v4();
        $examResultId = Uuid::v4();
        $catalogBookId = Uuid::v4();
        $userBookId = Uuid::v4();
        $activityLogId = Uuid::v4();
        $weekId = Uuid::v4();
        $rowId = Uuid::v4();
        $taskId = Uuid::v4();
        $progressId = Uuid::v4();

        $database->execute(
            'INSERT INTO `subjects` (`id`, `user_id`, `seed_key`, `exam`, `name`, `slug`, `icon`, `sort_order`, `updated_at`)'
            . ' VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
            [$subjectId, $userId, 'subject-' . $suffix, 'TYT', 'Matematik ' . $marker, 'matematik-' . $suffix, 'book', 1, $now],
        );
        $database->execute(
            'INSERT INTO `topics` (`id`, `user_id`, `seed_key`, `subject_id`, `name`, `sort_order`, `is_custom`, `created_at`, `updated_at`)'
            . ' VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
            [$topicId, $userId, 'topic-' . $suffix, $subjectId, 'Konu ' . $marker, 1, 0, $now, $now],
        );
        $database->execute(
            'INSERT INTO `exams` (`id`, `user_id`, `type`, `name`, `date`, `alan`, `kind`, `branch`, `note`, `created_at`, `updated_at`)'
            . ' VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
            [$examId, $userId, 'TYT', 'Deneme ' . $marker, '2026-05-01', 'SAY', 'deneme', null, 'Not ' . $marker, $now, $now],
        );
        $database->execute(
            'INSERT INTO `exam_results` (`id`, `user_id`, `exam_id`, `subject_id`, `correct`, `wrong`, `blank`, `net`, `updated_at`)'
            . ' VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
            [$examResultId, $userId, $examId, $subjectId, 10, 2, 3, '7.50', $now],
        );
        $database->execute(
            'INSERT INTO `notes` (`user_id`, `topic_id`, `content_html`, `plain_text`, `updated_at`)'
            . ' VALUES (?, ?, ?, ?, ?)',
            [$userId, $topicId, '<p>Not ' . $marker . '</p>', 'Not ' . $marker, $now],
        );
        $database->execute(
            'INSERT INTO `catalog_books` (`id`, `owner_id`, `title`, `publisher`, `exam`, `subject_slug`, `total_pages`, `edition`, `created_at`, `updated_at`)'
            . ' VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
            [$catalogBookId, $userId, 'Özel Kitap ' . $marker, 'Yayın ' . $marker, 'TYT', 'matematik', 320, '1. Baskı', $now, $now],
        );
        $database->execute(
            'INSERT INTO `user_books` (`id`, `user_id`, `book_id`, `total_pages_override`, `note`, `status`, `started_at`, `created_at`, `updated_at`)'
            . ' VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
            [$userBookId, $userId, $catalogBookId, 300, 'Kitap notu ' . $marker, 'active', $now, $now, $now],
        );
        $database->execute(
            'INSERT INTO `activity_logs` (`id`, `user_id`, `type`, `user_book_id`, `topic_id`, `from_page`, `to_page`, `task_id`, `source`, `created_at`)'
            . ' VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
            [$activityLogId, $userId, 'study', $userBookId, $topicId, 1, 20, $taskId, 'manual', $now],
        );
        $database->execute(
            'INSERT INTO `schedule_weeks` (`id`, `user_id`, `week_start`, `note`, `created_at`, `updated_at`)'
            . ' VALUES (?, ?, ?, ?, ?, ?)',
            [$weekId, $userId, '2026-11-23', 'Hafta ' . $marker, $now, $now],
        );
        $database->execute(
            'INSERT INTO `schedule_rows` (`id`, `user_id`, `week_id`, `subject_id`, `label`, `sort_order`, `created_at`, `updated_at`)'
            . ' VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
            [$rowId, $userId, $weekId, $subjectId, 'Satır ' . $marker, 1, $now, $now],
        );
        $database->execute(
            'INSERT INTO `schedule_tasks` (`id`, `user_id`, `week_id`, `row_id`, `day_index`, `type`, `user_book_id`, `from_page`, `to_page`, `topic_id`, `title`, `created_at`, `updated_at`)'
            . ' VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
            [$taskId, $userId, $weekId, $rowId, 0, 'study', $userBookId, 1, 20, $topicId, 'Görev ' . $marker, $now, $now],
        );
        $database->execute(
            'INSERT INTO `topic_progress` (`id`, `user_id`, `topic_id`, `done`, `done_at`, `updated_at`)'
            . ' VALUES (?, ?, ?, ?, ?, ?)',
            [$progressId, $userId, $topicId, 1, $now, $now],
        );
        $database->execute(
            'INSERT INTO `user_settings` (`user_id`, `data`, `updated_at`) VALUES (?, ?, ?)',
            [$userId, json_encode(['marker' => $marker, 'theme' => 'dark'], JSON_THROW_ON_ERROR), $now],
        );
        $database->execute(
            'INSERT INTO `sync_changes` (`user_id`, `table_name`, `row_id`, `op`, `changed_at`)'
            . ' VALUES (?, ?, ?, ?, ?)',
            [$userId, 'notes', $topicId, 'upsert', $now],
        );
    }
}
