<?php

declare(strict_types=1);

namespace Kocluk\Api\Tests\Unit;

use DateTimeImmutable;
use DateTimeZone;
use Kocluk\Api\Auth\SessionService;
use Kocluk\Api\Http\Request;
use Kocluk\Api\Support\Clock;
use Kocluk\Api\Support\Uuid;
use Kocluk\Api\Tests\Support\TestDatabase;
use PHPUnit\Framework\TestCase;

/**
 * Session storage and cookie policy (spec §7.2): the raw token only lives in
 * the cookie, expiry slides but never passes the 90-day cap, and Secure is
 * forced in production.
 */
final class SessionServiceTest extends TestCase
{
    private SessionService $sessions;

    protected function setUp(): void
    {
        TestDatabase::reset();
        $this->sessions = $this->service();
    }

    public function test_create_stores_only_the_token_hash(): void
    {
        $userId = Uuid::v4();
        $session = $this->sessions->create($userId, $this->request());

        self::assertMatchesRegularExpression('/^[A-Za-z0-9_-]{43}$/', $session['token']);
        self::assertNotSame($session['token'], $session['csrfToken']);

        $row = $this->row($session['token']);

        self::assertSame(hash('sha256', $session['token']), $row['id']);
        self::assertSame($userId, $row['user_id']);
        self::assertSame($session['csrfToken'], $row['csrf_token']);

        $days = ((new DateTimeImmutable((string) $row['expires_at'], new DateTimeZone('UTC')))->getTimestamp() - time()) / 86400;

        self::assertGreaterThan(29.9, $days);
        self::assertLessThan(30.1, $days);
    }

    public function test_validate_returns_the_identity_and_rejects_unknown_tokens(): void
    {
        $userId = Uuid::v4();
        $session = $this->sessions->create($userId, $this->request());

        $found = $this->sessions->validate($session['token']);

        self::assertIsArray($found);
        self::assertSame($userId, $found['userId']);
        self::assertSame($session['csrfToken'], $found['csrfToken']);

        self::assertNull($this->sessions->validate(null));
        self::assertNull($this->sessions->validate(''));
        self::assertNull($this->sessions->validate('bilinmeyen-token'));
    }

    public function test_last_seen_is_refreshed_at_most_once_every_five_minutes(): void
    {
        $session = $this->sessions->create(Uuid::v4(), $this->request());
        $tenMinutesAgo = Clock::now()->modify('-10 minutes');

        TestDatabase::database()->execute(
            'UPDATE `sessions` SET `last_seen_at` = ? WHERE `id` = ?',
            [self::sql($tenMinutesAgo), Uuid::hashToken($session['token'])],
        );

        $this->sessions->validate($session['token']);
        $afterFirstCall = (string) $this->row($session['token'])['last_seen_at'];

        self::assertGreaterThan($tenMinutesAgo->getTimestamp(), self::timestamp($afterFirstCall));

        $this->sessions->validate($session['token']);

        self::assertSame($afterFirstCall, $this->row($session['token'])['last_seen_at']);
    }

    public function test_sliding_expiry_stops_at_the_ninety_day_cap(): void
    {
        $session = $this->sessions->create(Uuid::v4(), $this->request());
        $createdAt = Clock::now()->modify('-89 days');

        TestDatabase::database()->execute(
            'UPDATE `sessions` SET `created_at` = ?, `last_seen_at` = ? WHERE `id` = ?',
            [self::sql($createdAt), self::sql(Clock::now()->modify('-10 minutes')), Uuid::hashToken($session['token'])],
        );

        $this->sessions->validate($session['token']);

        $expiresAt = self::timestamp((string) $this->row($session['token'])['expires_at']);
        $cap = $createdAt->modify('+' . SessionService::ABSOLUTE_TTL_DAYS . ' days');

        self::assertLessThanOrEqual($cap->getTimestamp() + 1, $expiresAt);
        self::assertGreaterThan(time(), $expiresAt);
    }

    public function test_revoke_scopes(): void
    {
        $firstUser = Uuid::v4();
        $secondUser = Uuid::v4();

        $first = $this->sessions->create($firstUser, $this->request());
        $second = $this->sessions->create($firstUser, $this->request());
        $other = $this->sessions->create($secondUser, $this->request());

        $this->sessions->revokeOthers($firstUser, $first['token']);

        self::assertNotNull($this->sessions->validate($first['token']));
        self::assertNull($this->sessions->validate($second['token']));
        self::assertNotNull($this->sessions->validate($other['token']));

        $this->sessions->revoke($first['token']);

        self::assertNull($this->sessions->validate($first['token']));
    }

    public function test_cookie_is_secure_over_https_and_plain_over_http(): void
    {
        $session = $this->sessions->create(Uuid::v4(), $this->request());

        $http = $this->sessions->cookie($session, $this->request());
        $https = $this->sessions->cookie($session, $this->request(true));

        self::assertStringStartsWith('kocluk_session=', $http);
        self::assertStringContainsString('HttpOnly', $http);
        self::assertStringContainsString('SameSite=Lax', $http);
        self::assertStringContainsString('Path=/', $http);
        self::assertStringNotContainsString('Secure', $http);
        self::assertStringContainsString('Secure', $https);
    }

    public function test_production_ignores_an_insecure_cookie_config(): void
    {
        $sessions = $this->service([
            'app' => ['env' => 'production'],
            'session' => ['cookie_name' => 'kocluk_session', 'secure' => false],
        ]);

        $session = $sessions->create(Uuid::v4(), $this->request());
        $header = $sessions->cookie($session, $this->request());

        self::assertStringStartsWith('__Host-kocluk_session=', $header);
        self::assertStringContainsString('Secure', $header);
    }

    /**
     * @param array<string, mixed> $config
     */
    private function service(array $config = []): SessionService
    {
        return new SessionService(TestDatabase::database(), array_replace_recursive([
            'app' => ['env' => 'test'],
            'session' => ['cookie_name' => 'kocluk_session', 'secure' => false],
        ], $config));
    }

    private function request(bool $secure = false): Request
    {
        return Request::create('POST', '/api/auth/login', [], '', [], '127.0.0.1', $secure);
    }

    /**
     * @return array<string, mixed>
     */
    private function row(string $token): array
    {
        $row = TestDatabase::database()->fetchOne(
            'SELECT * FROM `sessions` WHERE `id` = ?',
            [Uuid::hashToken($token)],
        );

        self::assertIsArray($row);

        return $row;
    }

    private static function sql(DateTimeImmutable $at): string
    {
        return $at->format('Y-m-d H:i:s.u');
    }

    private static function timestamp(string $sql): int
    {
        return (new DateTimeImmutable($sql, new DateTimeZone('UTC')))->getTimestamp();
    }
}
