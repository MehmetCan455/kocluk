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
 * Optional e-mail verification (spec §7.1, §7.4).
 *
 * Registration always mints a 24-hour token and tries to mail the link. The
 * token is single use and fills users.email_verified_at; an unverified user
 * can still sign in in this version. A failed e-mail must never roll the
 * registration back.
 */
final class EmailVerificationTest extends ApiTestCase
{
    public function test_registration_sends_a_verification_link(): void
    {
        $response = $this->register();

        self::assertSame(201, $response->status());
        self::assertNull($this->payload($response)['user']['emailVerifiedAt']);
        self::assertSame(1, $this->mailer->count());

        $mail = $this->mailer->last();
        self::assertIsArray($mail);
        self::assertSame(self::EMAIL, $mail['to']);
        self::assertStringContainsString('doğrula', mb_strtolower((string) $mail['subject']));
        self::assertStringContainsString(
            self::ORIGIN . '/#/eposta-dogrula?token=',
            (string) $mail['html'],
        );

        $token = $this->extractToken((string) $mail['html'], 'eposta-dogrula');

        self::assertMatchesRegularExpression('/^[A-Za-z0-9_-]{43}$/', $token);

        $row = TestDatabase::database()->fetchOne('SELECT * FROM `email_verifications`');

        self::assertIsArray($row);
        self::assertSame(hash('sha256', $token), $row['id']);
        self::assertNotSame($token, $row['id']);
        self::assertNull($row['used_at']);

        $expiresAt = new DateTimeImmutable((string) $row['expires_at'], new DateTimeZone('UTC'));
        $hours = ($expiresAt->getTimestamp() - time()) / 3600;

        self::assertGreaterThan(23.9, $hours);
        self::assertLessThanOrEqual(24, $hours);

        self::assertNull($this->userRow()['email_verified_at']);
    }

    public function test_verify_email_marks_the_user_and_consumes_the_token(): void
    {
        $this->register();

        $token = $this->sentToken('eposta-dogrula');
        $response = $this->verifyEmail($token);

        self::assertSame(200, $response->status());
        self::assertSame(['ok' => true], $this->payload($response));
        self::assertNotNull($this->userRow()['email_verified_at']);

        $row = TestDatabase::database()->fetchOne('SELECT `used_at` FROM `email_verifications`');

        self::assertIsArray($row);
        self::assertNotNull($row['used_at']);

        $reused = $this->verifyEmail($token);

        self::assertSame(410, $reused->status());
        self::assertSame('invalid_token', $this->payload($reused)['error']['code']);
    }

    public function test_an_unverified_user_can_still_sign_in(): void
    {
        $this->register();

        $response = $this->login();

        self::assertSame(200, $response->status());
        self::assertNull($this->payload($response)['user']['emailVerifiedAt']);
    }

    public function test_an_expired_verification_token_is_rejected(): void
    {
        $this->register();

        $token = $this->sentToken('eposta-dogrula');

        TestDatabase::database()->execute(
            'UPDATE `email_verifications` SET `expires_at` = ?',
            ['2020-01-01 00:00:00.000000'],
        );

        $response = $this->verifyEmail($token);

        self::assertSame(410, $response->status());
        self::assertSame('invalid_token', $this->payload($response)['error']['code']);
        self::assertNull($this->userRow()['email_verified_at']);
    }

    public function test_verify_email_rejects_missing_and_unknown_tokens(): void
    {
        $missing = $this->verifyEmail('');

        self::assertSame(422, $missing->status());
        self::assertSame('validation_failed', $this->payload($missing)['error']['code']);

        $unknown = $this->verifyEmail('bilinmeyen-token');

        self::assertSame(410, $unknown->status());
        self::assertSame('invalid_token', $this->payload($unknown)['error']['code']);
    }

    public function test_verify_email_requires_a_trusted_origin(): void
    {
        $this->register();

        $token = $this->sentToken('eposta-dogrula');

        $missing = $this->verifyEmail($token, []);
        self::assertSame(403, $missing->status());
        self::assertSame('csrf_failed', $this->payload($missing)['error']['code']);

        $foreign = $this->verifyEmail($token, ['Origin' => 'https://evil.example']);
        self::assertSame(403, $foreign->status());
        self::assertSame('csrf_failed', $this->payload($foreign)['error']['code']);
        self::assertNull($this->userRow()['email_verified_at']);
    }

    public function test_verify_email_is_rate_limited_per_ip(): void
    {
        for ($attempt = 1; $attempt <= 10; $attempt++) {
            $response = $this->verifyEmail('gecersiz-token-' . $attempt);

            self::assertSame(410, $response->status(), 'Deneme ' . $attempt . ' 410 dönmeli.');
        }

        $blocked = $this->verifyEmail('gecersiz-token-11');

        self::assertSame(429, $blocked->status());
        self::assertSame('rate_limited', $this->payload($blocked)['error']['code']);
        self::assertNotNull($blocked->header('Retry-After'));
        self::assertGreaterThan(0, (int) $blocked->header('Retry-After'));
        self::assertLessThanOrEqual(3600, (int) $blocked->header('Retry-After'));
    }

    public function test_registration_survives_a_failed_verification_email(): void
    {
        $app = $this->app([], new ThrowingMailer());

        $response = $this->register([], ['Origin' => self::ORIGIN], $app);

        self::assertSame(201, $response->status());
        self::assertNull($this->payload($response)['user']['emailVerifiedAt']);
        self::assertSame(1, $this->countRows('users'));
        self::assertSame(0, $this->countRows('email_verifications'));
        self::assertNull($this->userRow()['email_verified_at']);

        self::assertSame(200, $this->sessionStatus($this->jar($response), $app));
        self::assertSame(200, $this->login(self::PASSWORD, [], ['Origin' => self::ORIGIN], $app)->status());
    }

    public function test_registration_queues_the_verification_mail_until_flush(): void
    {
        $fake = new FakeMailer();
        $deferred = new DeferredMailer($fake);
        $app = $this->app([], $deferred);

        $response = $this->register([], ['Origin' => self::ORIGIN], $app);

        self::assertSame(201, $response->status());
        self::assertSame(0, $fake->count(), 'SMTP isteğin içinde çalışmamalı.');
        self::assertSame(1, $deferred->pending());
        self::assertSame(1, $this->countRows('email_verifications'));

        $deferred->flush();

        self::assertSame(0, $deferred->pending());
        self::assertSame(1, $fake->count());

        $mail = $fake->last();

        self::assertIsArray($mail);
        self::assertSame(self::EMAIL, $mail['to']);
        self::assertStringContainsString(
            self::ORIGIN . '/#/eposta-dogrula?token=',
            (string) $mail['html'],
        );

        $token = $this->extractToken((string) $mail['html'], 'eposta-dogrula');

        self::assertSame(200, $this->verifyEmail($token)->status());
        self::assertNotNull($this->userRow()['email_verified_at']);
    }

    public function test_a_deferred_verification_failure_discards_the_token(): void
    {
        $deferred = new DeferredMailer(new ThrowingMailer());
        $app = $this->app([], $deferred);

        $response = $this->register([], ['Origin' => self::ORIGIN], $app);

        self::assertSame(201, $response->status());
        self::assertSame(1, $this->countRows('email_verifications'));
        self::assertSame(1, $deferred->pending());

        $deferred->flush();

        self::assertSame(0, $deferred->pending());
        self::assertSame(0, $this->countRows('email_verifications'));
        self::assertNull($this->userRow()['email_verified_at']);
    }
}
