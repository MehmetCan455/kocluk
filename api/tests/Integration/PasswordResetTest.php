<?php

declare(strict_types=1);

namespace Kocluk\Api\Tests\Integration;

use DateTimeImmutable;
use DateTimeZone;
use Kocluk\Api\Mail\DeferredMailer;
use Kocluk\Api\Mail\FakeMailer;
use Kocluk\Api\Tests\Support\ApiTestCase;
use Kocluk\Api\Tests\Support\TestDatabase;
use Kocluk\Api\Tests\Support\ThrowingMailer;

/**
 * Password reset flow (spec §7.1, §7.4).
 *
 * The endpoint always answers 202, so the tests never learn from the status
 * whether an address exists. Tokens are 32 random bytes, stored only as a
 * SHA-256 digest, valid for 30 minutes, single use, and a successful reset
 * revokes every session.
 */
final class PasswordResetTest extends ApiTestCase
{
    public function test_forgot_password_sends_a_reset_link_for_a_known_address(): void
    {
        $this->register();
        $this->mailer->clear();

        $response = $this->forgot();

        self::assertSame(202, $response->status());
        self::assertSame(['ok' => true], $this->payload($response));
        self::assertSame(1, $this->mailer->count());

        $mail = $this->mailer->last();
        self::assertIsArray($mail);
        self::assertSame(self::EMAIL, $mail['to']);
        self::assertStringContainsString('şifre', mb_strtolower((string) $mail['subject']));
        self::assertStringContainsString(
            self::ORIGIN . '/#/sifre-sifirla?token=',
            (string) $mail['html'],
        );

        $token = $this->extractToken((string) $mail['html'], 'sifre-sifirla');

        self::assertMatchesRegularExpression('/^[A-Za-z0-9_-]{43}$/', $token);

        $row = TestDatabase::database()->fetchOne('SELECT * FROM `password_resets`');

        self::assertIsArray($row);
        self::assertSame(hash('sha256', $token), $row['id']);
        self::assertNotSame($token, $row['id']);
        self::assertNull($row['used_at']);

        $expiresAt = new DateTimeImmutable((string) $row['expires_at'], new DateTimeZone('UTC'));
        $minutes = ($expiresAt->getTimestamp() - time()) / 60;

        self::assertGreaterThan(29, $minutes);
        self::assertLessThanOrEqual(30, $minutes);
    }

    public function test_forgot_password_answers_the_same_for_unknown_addresses(): void
    {
        $this->register();
        $this->mailer->clear();

        $known = $this->forgot(self::EMAIL);
        $unknown = $this->forgot('olmayan@example.com');

        self::assertSame(202, $known->status());
        self::assertSame(202, $unknown->status());
        self::assertSame($known->body(), $unknown->body());
        self::assertSame(1, $this->mailer->count());
        self::assertSame(1, $this->countRows('password_resets'));
    }

    public function test_reset_password_is_single_use(): void
    {
        $this->register();
        $this->mailer->clear();
        $this->forgot();

        $token = $this->sentToken('sifre-sifirla');
        $newPassword = 'yeni-sifre-456';

        $response = $this->resetPassword($token, $newPassword);

        self::assertSame(200, $response->status());
        self::assertSame(['ok' => true], $this->payload($response));

        $cookie = (string) $response->header('Set-Cookie');

        self::assertStringStartsWith('kocluk_session=;', $cookie);
        self::assertStringContainsString('Max-Age=0', $cookie);

        self::assertSame(401, $this->login(self::PASSWORD)->status());
        self::assertSame(200, $this->login($newPassword)->status());

        $reused = $this->resetPassword($token, 'ucuncu-sifre-789');

        self::assertSame(410, $reused->status());
        self::assertSame('invalid_token', $this->payload($reused)['error']['code']);

        $row = TestDatabase::database()->fetchOne('SELECT `used_at` FROM `password_resets`');

        self::assertIsArray($row);
        self::assertNotNull($row['used_at']);
    }

    public function test_reset_password_revokes_every_session(): void
    {
        $deviceA = $this->register();
        $deviceB = $this->login();

        $this->mailer->clear();
        $this->forgot();

        $token = $this->sentToken('sifre-sifirla');

        self::assertSame(200, $this->resetPassword($token, 'yeni-sifre-456')->status());

        self::assertSame(401, $this->sessionStatus($this->jar($deviceA)));
        self::assertSame(401, $this->sessionStatus($this->jar($deviceB)));

        $row = TestDatabase::database()->fetchOne(
            'SELECT COUNT(*) AS `active` FROM `sessions` WHERE `revoked_at` IS NULL',
        );

        self::assertIsArray($row);
        self::assertSame(0, (int) $row['active']);
    }

    public function test_an_expired_reset_token_is_rejected(): void
    {
        $this->register();
        $this->mailer->clear();
        $this->forgot();

        $token = $this->sentToken('sifre-sifirla');

        TestDatabase::database()->execute(
            'UPDATE `password_resets` SET `expires_at` = ?',
            ['2020-01-01 00:00:00.000000'],
        );

        $response = $this->resetPassword($token, 'yeni-sifre-456');

        self::assertSame(410, $response->status());
        self::assertSame('invalid_token', $this->payload($response)['error']['code']);
        self::assertSame(200, $this->login(self::PASSWORD)->status());
        self::assertSame(401, $this->login('yeni-sifre-456')->status());
    }

    public function test_a_weak_password_does_not_consume_the_token(): void
    {
        $this->register();
        $this->mailer->clear();
        $this->forgot();

        $token = $this->sentToken('sifre-sifirla');

        $rejected = $this->resetPassword($token, 'kisa');

        self::assertSame(422, $rejected->status());
        self::assertSame('validation_failed', $this->payload($rejected)['error']['code']);
        self::assertSame(200, $this->login(self::PASSWORD)->status());

        self::assertSame(200, $this->resetPassword($token, 'yeni-sifre-456')->status());
        self::assertSame(200, $this->login('yeni-sifre-456')->status());
    }

    public function test_reset_password_rejects_missing_and_unknown_tokens(): void
    {
        $missing = $this->resetPassword('', 'yeni-sifre-456');

        self::assertSame(422, $missing->status());
        self::assertSame('validation_failed', $this->payload($missing)['error']['code']);

        $unknown = $this->resetPassword('bilinmeyen-token', 'yeni-sifre-456');

        self::assertSame(410, $unknown->status());
        self::assertSame('invalid_token', $this->payload($unknown)['error']['code']);
    }

    public function test_forgot_password_is_rate_limited_per_email(): void
    {
        for ($attempt = 1; $attempt <= 3; $attempt++) {
            self::assertSame(202, $this->forgot(self::EMAIL)->status(), 'Deneme ' . $attempt . ' 202 dönmeli.');
        }

        $blocked = $this->forgot(self::EMAIL);
        $payload = $this->payload($blocked);

        self::assertSame(429, $blocked->status());
        self::assertSame('rate_limited', $payload['error']['code']);
        self::assertNotNull($blocked->header('Retry-After'));
        self::assertGreaterThan(0, (int) $blocked->header('Retry-After'));
        self::assertLessThanOrEqual(3600, (int) $blocked->header('Retry-After'));
        self::assertSame(0, $this->countRows('password_resets'));
    }

    public function test_forgot_password_is_rate_limited_per_ip(): void
    {
        for ($attempt = 1; $attempt <= 10; $attempt++) {
            $response = $this->forgot('kullanici' . $attempt . '@example.com');

            self::assertSame(202, $response->status(), 'Deneme ' . $attempt . ' 202 dönmeli.');
        }

        $blocked = $this->forgot('kullanici11@example.com');

        self::assertSame(429, $blocked->status());
        self::assertSame('rate_limited', $this->payload($blocked)['error']['code']);
        self::assertNotNull($blocked->header('Retry-After'));
        self::assertLessThanOrEqual(3600, (int) $blocked->header('Retry-After'));
    }

    public function test_reset_password_is_rate_limited_per_ip(): void
    {
        for ($attempt = 1; $attempt <= 5; $attempt++) {
            $response = $this->resetPassword('gecersiz-token-' . $attempt, 'yeni-sifre-456');

            self::assertSame(410, $response->status(), 'Deneme ' . $attempt . ' 410 dönmeli.');
        }

        $blocked = $this->resetPassword('gecersiz-token-6', 'yeni-sifre-456');

        self::assertSame(429, $blocked->status());
        self::assertSame('rate_limited', $this->payload($blocked)['error']['code']);
        self::assertNotNull($blocked->header('Retry-After'));
    }

    public function test_public_reset_writes_require_a_trusted_origin(): void
    {
        $missingForgot = $this->forgot(self::EMAIL, []);

        self::assertSame(403, $missingForgot->status());
        self::assertSame('csrf_failed', $this->payload($missingForgot)['error']['code']);

        $foreignForgot = $this->forgot(self::EMAIL, ['Origin' => 'https://evil.example']);

        self::assertSame(403, $foreignForgot->status());
        self::assertSame('csrf_failed', $this->payload($foreignForgot)['error']['code']);

        $missingReset = $this->resetPassword('bilinmeyen-token', 'yeni-sifre-456', []);

        self::assertSame(403, $missingReset->status());
        self::assertSame('csrf_failed', $this->payload($missingReset)['error']['code']);
        self::assertSame(0, $this->countRows('password_resets'));
    }

    public function test_a_signed_in_browser_needs_csrf_for_reset_writes(): void
    {
        $device = $this->register();

        $withoutToken = $this->post(
            '/api/auth/forgot-password',
            ['email' => self::EMAIL],
            [],
            $this->jar($device),
        );

        self::assertSame(403, $withoutToken->status());
        self::assertSame('csrf_failed', $this->payload($withoutToken)['error']['code']);

        $withToken = $this->post(
            '/api/auth/forgot-password',
            ['email' => self::EMAIL],
            ['X-CSRF-Token' => $this->csrf($device)],
            $this->jar($device),
        );

        self::assertSame(202, $withToken->status());
    }

    public function test_a_mail_failure_still_answers_202_and_drops_the_token(): void
    {
        $app = $this->app([], new ThrowingMailer());

        self::assertSame(201, $this->register([], ['Origin' => self::ORIGIN], $app)->status());

        $response = $this->forgot(self::EMAIL, ['Origin' => self::ORIGIN], $app);

        self::assertSame(202, $response->status());
        self::assertSame(['ok' => true], $this->payload($response));
        self::assertSame(0, $this->countRows('password_resets'));
    }

    public function test_forgot_password_queues_mail_without_waiting_for_smtp(): void
    {
        $this->register();
        $this->mailer->clear();

        $fake = new FakeMailer();
        $deferred = new DeferredMailer($fake);
        $app = $this->app([], $deferred);

        $response = $this->forgot(self::EMAIL, ['Origin' => self::ORIGIN], $app);

        self::assertSame(202, $response->status());
        self::assertSame(['ok' => true], $this->payload($response));
        self::assertSame(0, $fake->count(), 'SMTP isteğin içinde çalışmamalı.');
        self::assertSame(1, $deferred->pending());
        self::assertSame(1, $this->countRows('password_resets'));

        $deferred->flush();

        self::assertSame(0, $deferred->pending());
        self::assertSame(1, $fake->count());

        $mail = $fake->last();

        self::assertIsArray($mail);
        self::assertSame(self::EMAIL, $mail['to']);
        self::assertStringContainsString(
            self::ORIGIN . '/#/sifre-sifirla?token=',
            (string) $mail['html'],
        );
        self::assertSame(1, $this->countRows('password_resets'));
    }

    public function test_a_deferred_mail_failure_discards_the_token(): void
    {
        $this->register();
        $this->mailer->clear();

        $deferred = new DeferredMailer(new ThrowingMailer());
        $app = $this->app([], $deferred);

        $response = $this->forgot(self::EMAIL, ['Origin' => self::ORIGIN], $app);

        self::assertSame(202, $response->status());
        self::assertSame(1, $this->countRows('password_resets'));
        self::assertSame(1, $deferred->pending());

        $deferred->flush();

        self::assertSame(0, $deferred->pending());
        self::assertSame(0, $this->countRows('password_resets'));
    }
}
