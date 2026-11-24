<?php

declare(strict_types=1);

namespace Kocluk\Api\Tests\Support;

use Kocluk\Api\App;
use Kocluk\Api\Http\Request;
use Kocluk\Api\Http\Response;
use Kocluk\Api\Mail\FakeMailer;
use Kocluk\Api\Mail\Mailer;
use PHPUnit\Framework\TestCase;

/**
 * Shared HTTP-level helpers for the auth integration tests.
 *
 * Every request goes through the real App/Request/Response kernel and the
 * migrated MariaDB test schema, so assertions describe what a browser sees.
 * The mailer is a FakeMailer unless a test injects another Mailer.
 */
abstract class ApiTestCase extends TestCase
{
    protected const ORIGIN = 'https://zirveacademy.com';

    protected const EMAIL = 'ayse@example.com';

    protected const PASSWORD = 'dogru-sifre-123';

    protected const DISPLAY_NAME = 'Ayşe';

    protected FakeMailer $mailer;

    protected function setUp(): void
    {
        TestDatabase::reset();
        $this->mailer = new FakeMailer();
    }

    /**
     * @param array<string, mixed> $config
     */
    protected function app(array $config = [], ?Mailer $mailer = null): App
    {
        return new App(
            TestDatabase::database(),
            array_replace_recursive([
                'app' => ['env' => 'test', 'base_url' => self::ORIGIN],
                'app_url' => self::ORIGIN,
                'session' => ['cookie_name' => 'kocluk_session', 'secure' => false],
                'privacy_version' => '2026-11-24',
                'invite_code' => '',
            ], $config),
            $mailer ?? $this->mailer,
        );
    }

    /**
     * @param array<string, mixed> $override
     * @param array<string, string> $headers
     */
    protected function register(
        array $override = [],
        array $headers = ['Origin' => self::ORIGIN],
        ?App $app = null,
    ): Response {
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
    protected function login(
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
     * @param array<string, string> $headers
     */
    protected function forgot(
        string $email = self::EMAIL,
        array $headers = ['Origin' => self::ORIGIN],
        ?App $app = null,
    ): Response {
        return $this->post('/api/auth/forgot-password', ['email' => $email], $headers, [], $app);
    }

    /**
     * @param array<string, string> $headers
     */
    protected function resetPassword(
        string $token,
        string $password,
        array $headers = ['Origin' => self::ORIGIN],
        ?App $app = null,
    ): Response {
        return $this->post(
            '/api/auth/reset-password',
            ['token' => $token, 'password' => $password],
            $headers,
            [],
            $app,
        );
    }

    /**
     * @param array<string, string> $headers
     */
    protected function verifyEmail(
        string $token,
        array $headers = ['Origin' => self::ORIGIN],
        ?App $app = null,
    ): Response {
        return $this->post('/api/auth/verify-email', ['token' => $token], $headers, [], $app);
    }

    /**
     * @param array<string, mixed> $payload
     * @param array<string, string> $headers
     * @param array<string, string> $cookies
     */
    protected function post(
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
    protected function sessionStatus(array $cookies, ?App $app = null): int
    {
        return ($app ?? $this->app())->handle(
            Request::create('GET', '/api/auth/session', [], '', $cookies),
        )->status();
    }

    /**
     * @return array<string, mixed>
     */
    protected function payload(Response $response): array
    {
        $payload = json_decode($response->body(), true, 512, JSON_THROW_ON_ERROR);

        self::assertIsArray($payload);

        /** @var array<string, mixed> $payload */
        return $payload;
    }

    protected function csrf(Response $response): string
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
    protected function cookie(Response $response): array
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
    protected function jar(Response $response): array
    {
        [$name, $value] = $this->cookie($response);

        return [$name => $value];
    }

    /**
     * Pulls the raw token out of the URL fragment in a captured e-mail.
     */
    protected function extractToken(string $html, string $route): string
    {
        $matched = preg_match(
            '/#\/' . preg_quote($route, '/') . '\?token=([A-Za-z0-9_-]+)/',
            $html,
            $matches,
        );

        self::assertSame(1, $matched, 'E-posta bağlantısı token içermeli.');

        return $matches[1];
    }

    /**
     * Token from the most recently captured e-mail.
     */
    protected function sentToken(string $route): string
    {
        $mail = $this->mailer->last();

        self::assertIsArray($mail, 'Bir e-posta gönderilmiş olmalı.');

        return $this->extractToken((string) $mail['html'], $route);
    }

    /**
     * @return array<string, mixed>
     */
    protected function userRow(string $email = self::EMAIL): array
    {
        $row = TestDatabase::database()->fetchOne(
            'SELECT * FROM `users` WHERE `email` = ?',
            [$email],
        );

        self::assertIsArray($row, 'Kullanıcı satırı bulunmalı.');

        return $row;
    }

    protected function countRows(string $table): int
    {
        $row = TestDatabase::database()->fetchOne(
            'SELECT COUNT(*) AS `total` FROM `' . $table . '`',
        );

        return (int) ($row['total'] ?? 0);
    }
}
