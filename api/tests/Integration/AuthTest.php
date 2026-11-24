<?php

declare(strict_types=1);

namespace Kocluk\Api\Tests\Integration;

use Kocluk\Api\App;
use Kocluk\Api\Http\Request;
use Kocluk\Api\Http\Response;
use Kocluk\Api\Tests\Support\TestDatabase;
use PHPUnit\Framework\TestCase;

/**
 * End-to-end auth flows over the real HTTP kernel and the MariaDB test schema.
 *
 * Every test starts from an empty database and talks to the API through
 * Request/Response only, so the assertions describe what a browser sees:
 * status codes, the JSON body, the Set-Cookie header and the rows that end up
 * in the database.
 */
final class AuthTest extends TestCase
{
    private const ORIGIN = 'https://zirveacademy.com';
    private const EMAIL = 'ayse@example.com';
    private const PASSWORD = 'dogru-sifre-123';
    private const DISPLAY_NAME = 'Ayşe';

    protected function setUp(): void
    {
        TestDatabase::reset();
    }

    public function test_register_creates_an_account_and_starts_a_session(): void
    {
        $response = $this->register();

        self::assertSame(201, $response->status());

        $payload = $this->payload($response);

        self::assertSame(self::EMAIL, $payload['user']['email']);
        self::assertSame(self::DISPLAY_NAME, $payload['user']['displayName']);
        self::assertArrayHasKey('id', $payload['user']);
        self::assertArrayNotHasKey('password_hash', $payload['user']);
        self::assertArrayNotHasKey('passwordHash', $payload['user']);
        self::assertStringNotContainsString('password_hash', $response->body());
        self::assertNotSame('', $this->csrf($response));

        $header = (string) $response->header('Set-Cookie');

        self::assertStringStartsWith('kocluk_session=', $header);
        self::assertStringContainsString('HttpOnly', $header);
        self::assertStringContainsString('SameSite=Lax', $header);
        self::assertStringContainsString('Path=/', $header);
        self::assertStringNotContainsString('Secure', $header);

        $row = TestDatabase::database()->fetchOne(
            'SELECT `password_hash`, `privacy_version`, `consented_at` FROM `users` WHERE `email` = ?',
            [self::EMAIL],
        );

        self::assertIsArray($row);
        self::assertNotSame(self::PASSWORD, (string) $row['password_hash']);
        self::assertTrue(password_verify(self::PASSWORD, (string) $row['password_hash']));
        self::assertSame('2026-11-24', $row['privacy_version']);
        self::assertNotNull($row['consented_at']);

        [, $token] = $this->cookie($response);

        $session = TestDatabase::database()->fetchOne(
            'SELECT `id` FROM `sessions` WHERE `user_id` = (SELECT `id` FROM `users` WHERE `email` = ?)',
            [self::EMAIL],
        );

        self::assertIsArray($session);
        self::assertSame(hash('sha256', $token), $session['id']);
        self::assertNotSame($token, $session['id']);
    }

    public function test_register_rejects_a_duplicate_email(): void
    {
        $this->register();

        $response = $this->register();
        $payload = $this->payload($response);

        self::assertSame(409, $response->status());
        self::assertSame('email_taken', $payload['error']['code']);
        self::assertNull($response->header('Set-Cookie'));
    }

    public function test_register_rejects_a_weak_password(): void
    {
        $response = $this->register(['password' => 'kisa']);
        $payload = $this->payload($response);

        self::assertSame(422, $response->status());
        self::assertSame('validation_failed', $payload['error']['code']);
        self::assertNull($response->header('Set-Cookie'));
    }

    public function test_register_requires_explicit_privacy_consent(): void
    {
        $response = $this->register(['privacyAccepted' => false]);
        $payload = $this->payload($response);

        self::assertSame(422, $response->status());
        self::assertSame('validation_failed', $payload['error']['code']);
    }

    public function test_register_without_a_session_requires_a_trusted_origin(): void
    {
        $missing = $this->register([], []);
        self::assertSame(403, $missing->status());
        self::assertSame('csrf_failed', $this->payload($missing)['error']['code']);

        $foreign = $this->register([], ['Origin' => 'https://evil.example']);
        self::assertSame(403, $foreign->status());
        self::assertSame('csrf_failed', $this->payload($foreign)['error']['code']);
    }

    public function test_login_succeeds_with_the_right_password(): void
    {
        $this->register();

        $response = $this->login();
        $payload = $this->payload($response);

        self::assertSame(200, $response->status());
        self::assertSame(self::EMAIL, $payload['user']['email']);
        self::assertArrayNotHasKey('password_hash', $payload['user']);
        self::assertNotSame('', $this->csrf($response));

        $header = (string) $response->header('Set-Cookie');

        self::assertStringStartsWith('kocluk_session=', $header);
        self::assertStringContainsString('HttpOnly', $header);
        self::assertStringContainsString('SameSite=Lax', $header);
    }

    public function test_login_with_a_wrong_password_fails_with_a_generic_message(): void
    {
        $this->register();

        $response = $this->login('yanlis-sifre-123');
        $payload = $this->payload($response);

        self::assertSame(401, $response->status());
        self::assertSame('invalid_credentials', $payload['error']['code']);
        self::assertStringNotContainsString(self::EMAIL, $payload['error']['message']);
        self::assertStringNotContainsString('yanlis-sifre-123', $response->body());
        self::assertNull($response->header('Set-Cookie'));
    }

    public function test_session_endpoint_returns_the_user_and_csrf_token(): void
    {
        $register = $this->register();
        $csrf = $this->csrf($register);

        $response = $this->app()->handle(
            Request::create('GET', '/api/auth/session', [], '', $this->jar($register)),
        );

        $payload = $this->payload($response);

        self::assertSame(200, $response->status());
        self::assertSame(self::EMAIL, $payload['user']['email']);
        self::assertSame($csrf, $payload['csrfToken']);
    }

    public function test_session_endpoint_requires_a_cookie(): void
    {
        $response = $this->app()->handle(Request::create('GET', '/api/auth/session'));
        $payload = $this->payload($response);

        self::assertSame(401, $response->status());
        self::assertSame('unauthenticated', $payload['error']['code']);
    }

    public function test_an_expired_session_is_rejected(): void
    {
        $register = $this->register();

        TestDatabase::database()->execute(
            'UPDATE `sessions` SET `expires_at` = ?',
            ['2020-01-01 00:00:00.000000'],
        );

        $response = $this->app()->handle(
            Request::create('GET', '/api/auth/session', [], '', $this->jar($register)),
        );

        self::assertSame(401, $response->status());
        self::assertSame('unauthenticated', $this->payload($response)['error']['code']);
    }

    public function test_logout_clears_the_cookie_and_revokes_the_session(): void
    {
        $register = $this->register();

        $response = $this->post(
            '/api/auth/logout',
            [],
            ['X-CSRF-Token' => $this->csrf($register)],
            $this->jar($register),
        );

        self::assertSame(200, $response->status());

        $header = (string) $response->header('Set-Cookie');

        self::assertStringStartsWith('kocluk_session=;', $header);
        self::assertStringContainsString('Max-Age=0', $header);
        self::assertStringContainsString('HttpOnly', $header);

        $after = $this->app()->handle(
            Request::create('GET', '/api/auth/session', [], '', $this->jar($register)),
        );

        self::assertSame(401, $after->status());
    }

    public function test_logging_in_again_only_revokes_this_browsers_session(): void
    {
        $deviceA = $this->register();
        $deviceB = $this->login();

        $reloginA = $this->login(
            self::PASSWORD,
            $this->jar($deviceA),
            ['Origin' => self::ORIGIN, 'X-CSRF-Token' => $this->csrf($deviceA)],
        );

        self::assertSame(200, $reloginA->status());

        self::assertSame(200, $this->sessionStatus($this->jar($deviceB)));
        self::assertSame(200, $this->sessionStatus($this->jar($reloginA)));
        self::assertSame(401, $this->sessionStatus($this->jar($deviceA)));
    }

    public function test_logout_keeps_other_devices_signed_in(): void
    {
        $deviceA = $this->register();
        $deviceB = $this->login();

        $logout = $this->post(
            '/api/auth/logout',
            [],
            ['X-CSRF-Token' => $this->csrf($deviceB)],
            $this->jar($deviceB),
        );

        self::assertSame(200, $logout->status());
        self::assertSame(200, $this->sessionStatus($this->jar($deviceA)));
    }

    public function test_change_password_revokes_other_sessions_and_rotates_the_current_one(): void
    {
        $deviceA = $this->register();
        $deviceB = $this->login();
        $oldCsrf = $this->csrf($deviceA);
        $newPassword = 'yeni-sifre-456';

        $response = $this->post(
            '/api/auth/change-password',
            ['currentPassword' => self::PASSWORD, 'newPassword' => $newPassword],
            ['X-CSRF-Token' => $oldCsrf],
            $this->jar($deviceA),
        );

        self::assertSame(200, $response->status());
        self::assertStringStartsWith('kocluk_session=', (string) $response->header('Set-Cookie'));
        self::assertSame(self::EMAIL, $this->payload($response)['user']['email']);

        $newCsrf = $this->csrf($response);

        self::assertNotSame($oldCsrf, $newCsrf);

        self::assertSame(401, $this->sessionStatus($this->jar($deviceA)));
        self::assertSame(401, $this->sessionStatus($this->jar($deviceB)));
        self::assertSame(200, $this->sessionStatus($this->jar($response)));

        // The rotated CSRF token works immediately with the new cookie; the
        // token minted for the revoked session is rejected.
        $fresh = $this->post(
            '/api/auth/update-profile',
            ['displayName' => 'Yeni Ad'],
            ['X-CSRF-Token' => $newCsrf],
            $this->jar($response),
        );

        self::assertSame(200, $fresh->status());
        self::assertSame('Yeni Ad', $this->payload($fresh)['user']['displayName']);

        $stale = $this->post(
            '/api/auth/update-profile',
            ['displayName' => 'Eski Ad'],
            ['X-CSRF-Token' => $oldCsrf],
            $this->jar($response),
        );

        self::assertSame(403, $stale->status());
        self::assertSame('csrf_failed', $this->payload($stale)['error']['code']);

        self::assertSame(401, $this->login(self::PASSWORD)->status());
        self::assertSame(200, $this->login($newPassword)->status());
    }

    public function test_change_password_requires_the_current_password(): void
    {
        $device = $this->register();

        $response = $this->post(
            '/api/auth/change-password',
            ['currentPassword' => 'yanlis-sifre-123', 'newPassword' => 'yeni-sifre-456'],
            ['X-CSRF-Token' => $this->csrf($device)],
            $this->jar($device),
        );

        self::assertSame(422, $response->status());
        self::assertSame('invalid_password', $this->payload($response)['error']['code']);
        self::assertSame(200, $this->sessionStatus($this->jar($device)));
    }

    public function test_login_attempts_are_rate_limited(): void
    {
        $this->register();

        for ($attempt = 1; $attempt <= 10; $attempt++) {
            $failed = $this->login('yanlis-sifre-123');
            self::assertSame(401, $failed->status(), 'Deneme ' . $attempt . ' 401 dönmeli.');
        }

        $blocked = $this->login('yanlis-sifre-123');
        $payload = $this->payload($blocked);

        self::assertSame(429, $blocked->status());
        self::assertSame('rate_limited', $payload['error']['code']);
        self::assertNotNull($blocked->header('Retry-After'));
        self::assertGreaterThan(0, (int) $blocked->header('Retry-After'));
        self::assertLessThanOrEqual(900, (int) $blocked->header('Retry-After'));
    }

    public function test_authenticated_writes_require_a_csrf_token(): void
    {
        $device = $this->register();

        $missing = $this->post(
            '/api/auth/update-profile',
            ['displayName' => 'Yeni Ad'],
            [],
            $this->jar($device),
        );

        self::assertSame(403, $missing->status());
        self::assertSame('csrf_failed', $this->payload($missing)['error']['code']);

        $wrong = $this->post(
            '/api/auth/update-profile',
            ['displayName' => 'Yeni Ad'],
            ['X-CSRF-Token' => 'yanlis-token'],
            $this->jar($device),
        );

        self::assertSame(403, $wrong->status());

        $ok = $this->post(
            '/api/auth/update-profile',
            ['displayName' => 'Yeni Ad'],
            ['X-CSRF-Token' => $this->csrf($device)],
            $this->jar($device),
        );

        self::assertSame(200, $ok->status());
        self::assertSame('Yeni Ad', $this->payload($ok)['user']['displayName']);
    }

    public function test_update_profile_does_not_change_the_email(): void
    {
        $device = $this->register();

        $response = $this->post(
            '/api/auth/update-profile',
            ['displayName' => 'Yeni Ad', 'email' => 'baska@example.com'],
            ['X-CSRF-Token' => $this->csrf($device)],
            $this->jar($device),
        );

        self::assertSame(200, $response->status());
        self::assertSame(self::EMAIL, $this->payload($response)['user']['email']);

        $row = TestDatabase::database()->fetchOne(
            'SELECT `email` FROM `users` WHERE `display_name` = ?',
            ['Yeni Ad'],
        );

        self::assertIsArray($row);
        self::assertSame(self::EMAIL, $row['email']);
    }

    public function test_production_forces_a_host_prefixed_secure_cookie(): void
    {
        $app = $this->app([
            'app' => ['env' => 'production'],
            'session' => ['cookie_name' => 'kocluk_session', 'secure' => false],
        ]);

        $response = $this->register([], ['Origin' => self::ORIGIN], $app);
        $header = (string) $response->header('Set-Cookie');

        self::assertSame(201, $response->status());
        self::assertStringStartsWith('__Host-kocluk_session=', $header);
        self::assertStringContainsString('Secure', $header);
        self::assertStringContainsString('Path=/', $header);
    }

    /**
     * @param array<string, mixed> $override
     * @param array<string, string> $headers
     */
    private function register(array $override = [], array $headers = ['Origin' => self::ORIGIN], ?App $app = null): Response
    {
        return $this->post('/api/auth/register', array_merge([
            'email' => self::EMAIL,
            'password' => self::PASSWORD,
            'displayName' => self::DISPLAY_NAME,
            'privacyAccepted' => true,
        ], $override), $headers, [], $app);
    }

    /**
     * @param array<string, string> $cookies
     * @param array<string, string> $headers
     */
    private function login(
        string $password = self::PASSWORD,
        array $cookies = [],
        array $headers = ['Origin' => self::ORIGIN],
        ?App $app = null,
    ): Response {
        return $this->post(
            '/api/auth/login',
            ['email' => self::EMAIL, 'password' => $password],
            $headers,
            $cookies,
            $app,
        );
    }

    /**
     * @param array<string, mixed> $payload
     * @param array<string, string> $headers
     * @param array<string, string> $cookies
     */
    private function post(
        string $path,
        array $payload,
        array $headers = [],
        array $cookies = [],
        ?App $app = null,
    ): Response {
        $body = $payload === [] ? '' : json_encode($payload, JSON_THROW_ON_ERROR);

        return ($app ?? $this->app())->handle(Request::create(
            'POST',
            $path,
            array_merge(['Content-Type' => 'application/json'], $headers),
            $body,
            $cookies,
        ));
    }

    /**
     * @param array<string, string> $cookies
     */
    private function sessionStatus(array $cookies): int
    {
        return $this->app()->handle(
            Request::create('GET', '/api/auth/session', [], '', $cookies),
        )->status();
    }

    /**
     * @param array<string, mixed> $config
     */
    private function app(array $config = []): App
    {
        return new App(TestDatabase::database(), array_replace_recursive([
            'app' => ['env' => 'test', 'base_url' => self::ORIGIN],
            'session' => ['cookie_name' => 'kocluk_session', 'secure' => false],
            'privacy_version' => '2026-11-24',
        ], $config));
    }

    /**
     * @return array<string, mixed>
     */
    private function payload(Response $response): array
    {
        $payload = json_decode($response->body(), true, 512, JSON_THROW_ON_ERROR);

        self::assertIsArray($payload);

        /** @var array<string, mixed> $payload */
        return $payload;
    }

    private function csrf(Response $response): string
    {
        $payload = $this->payload($response);

        self::assertArrayHasKey('csrfToken', $payload);
        self::assertIsString($payload['csrfToken']);
        self::assertNotSame('', $payload['csrfToken']);

        return $payload['csrfToken'];
    }

    /**
     * Name and value of the first Set-Cookie header.
     *
     * @return array{0: string, 1: string}
     */
    private function cookie(Response $response): array
    {
        $header = $response->header('Set-Cookie');

        self::assertIsString($header, 'Yanıt Set-Cookie başlığı taşımalı.');

        $parts = explode('=', explode(';', $header, 2)[0], 2);

        self::assertCount(2, $parts, 'Set-Cookie "ad=değer" biçiminde olmalı.');

        return [$parts[0], $parts[1]];
    }

    /**
     * @return array<string, string>
     */
    private function jar(Response $response): array
    {
        [$name, $value] = $this->cookie($response);

        return [$name => $value];
    }
}
