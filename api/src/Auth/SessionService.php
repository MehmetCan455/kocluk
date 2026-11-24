<?php

declare(strict_types=1);

namespace Kocluk\Api\Auth;

use DateTimeImmutable;
use DateTimeZone;
use Kocluk\Api\Db\Database;
use Kocluk\Api\Http\Request;
use Kocluk\Api\Support\Clock;
use Kocluk\Api\Support\Uuid;

/**
 * Server-side sessions with an HttpOnly cookie (spec §7.2).
 *
 * The browser receives a 32-byte random token; the sessions table stores only
 * its SHA-256 digest, so a database leak cannot be replayed as a logged-in
 * browser. The CSRF token is independent of the session token.
 *
 * Expiry is sliding: every validated request may push expires_at to 30 days
 * ahead, never beyond 90 days after the session was created. last_seen_at is
 * refreshed at most once every five minutes to keep writes rare.
 *
 * Cookie policy:
 *   * production: __Host-kocluk_session, always Secure (HttpOnly, Path=/,
 *     SameSite=Lax). The __Host- prefix itself requires Secure and Path=/.
 *   * test/development: kocluk_session, Secure only over HTTPS or when the
 *     operator opts in with session.secure.
 */
final class SessionService
{
    public const SLIDING_TTL_DAYS = 30;

    public const ABSOLUTE_TTL_DAYS = 90;

    public const LAST_SEEN_REFRESH_SECONDS = 300;

    private const PRODUCTION_COOKIE = '__Host-kocluk_session';

    private const DEVELOPMENT_COOKIE = 'kocluk_session';

    /** @var array<string, mixed> */
    private readonly array $sessionConfig;

    private readonly string $env;

    /**
     * @param array<string, mixed> $config
     */
    public function __construct(
        private readonly Database $database,
        array $config = [],
    ) {
        $session = $config['session'] ?? null;
        $this->sessionConfig = is_array($session) ? $session : [];

        $app = $config['app'] ?? null;
        $env = is_array($app) ? ($app['env'] ?? null) : null;
        $this->env = is_string($env) && $env !== '' ? $env : 'production';
    }

    /**
     * Creates a session row and returns the raw token for the cookie.
     *
     * @return array{token: string, csrfToken: string, expiresAt: string}
     */
    public function create(string $userId, Request $request): array
    {
        $token = Uuid::token(32);
        $csrfToken = Uuid::token(32);
        $now = Clock::now();
        $expiresAt = $now->modify('+' . self::SLIDING_TTL_DAYS . ' days');

        $this->database->execute(
            'INSERT INTO `sessions` (`id`, `user_id`, `csrf_token`, `expires_at`, `created_at`, `last_seen_at`, `ip`)'
            . ' VALUES (?, ?, ?, ?, ?, ?, ?)',
            [
                Uuid::hashToken($token),
                $userId,
                $csrfToken,
                self::sql($expiresAt),
                self::sql($now),
                self::sql($now),
                self::normaliseIp($request->ip),
            ],
        );

        return [
            'token' => $token,
            'csrfToken' => $csrfToken,
            'expiresAt' => self::sql($expiresAt),
        ];
    }

    /**
     * Validates a raw session token and returns its identity, or null when the
     * token is unknown, revoked or expired.
     *
     * @return array{userId: string, csrfToken: string, expiresAt: string}|null
     */
    public function validate(?string $token): ?array
    {
        if ($token === null || $token === '') {
            return null;
        }

        $hash = Uuid::hashToken($token);
        $now = Clock::now();

        $row = $this->database->fetchOne(
            'SELECT `user_id`, `csrf_token`, `expires_at`, `created_at`, `last_seen_at`'
            . ' FROM `sessions` WHERE `id` = ? AND `revoked_at` IS NULL AND `expires_at` > ?',
            [$hash, self::sql($now)],
        );

        if ($row === null) {
            return null;
        }

        $createdAt = self::parse((string) $row['created_at']);
        $lastSeenAt = self::parse((string) $row['last_seen_at']);
        $expiresAt = self::parse((string) $row['expires_at']);

        if ($lastSeenAt->getTimestamp() <= $now->getTimestamp() - self::LAST_SEEN_REFRESH_SECONDS) {
            $sliding = $now->modify('+' . self::SLIDING_TTL_DAYS . ' days');
            $absolute = $createdAt->modify('+' . self::ABSOLUTE_TTL_DAYS . ' days');

            if ($sliding > $absolute) {
                $sliding = $absolute;
            }

            $this->database->execute(
                'UPDATE `sessions` SET `last_seen_at` = ?, `expires_at` = ? WHERE `id` = ?',
                [self::sql($now), self::sql($sliding), $hash],
            );

            $expiresAt = $sliding;
        }

        return [
            'userId' => (string) $row['user_id'],
            'csrfToken' => (string) $row['csrf_token'],
            'expiresAt' => self::sql($expiresAt),
        ];
    }

    /**
     * Revokes one token (the browser that is signing out or logging in again).
     */
    public function revoke(string $token): void
    {
        $this->database->execute(
            'UPDATE `sessions` SET `revoked_at` = ? WHERE `id` = ? AND `revoked_at` IS NULL',
            [Clock::nowSql(), Uuid::hashToken($token)],
        );
    }

    public function revokeAll(string $userId): void
    {
        $this->database->execute(
            'UPDATE `sessions` SET `revoked_at` = ? WHERE `user_id` = ? AND `revoked_at` IS NULL',
            [Clock::nowSql(), $userId],
        );
    }

    /**
     * Revokes every session of the user except the one making the request;
     * used by password changes so other devices have to sign in again.
     */
    public function revokeOthers(string $userId, string $currentToken): void
    {
        $this->database->execute(
            'UPDATE `sessions` SET `revoked_at` = ?'
            . ' WHERE `user_id` = ? AND `id` <> ? AND `revoked_at` IS NULL',
            [Clock::nowSql(), $userId, Uuid::hashToken($currentToken)],
        );
    }

    /**
     * Raw session token from the request cookie, if present.
     */
    public function tokenFrom(Request $request): ?string
    {
        $token = $request->cookie($this->cookieName());

        return $token === null || $token === '' ? null : $token;
    }

    public function cookieName(): string
    {
        if ($this->isProduction()) {
            return self::PRODUCTION_COOKIE;
        }

        $configured = $this->sessionConfig['cookie_name'] ?? null;

        if (is_string($configured) && preg_match('/^[A-Za-z0-9_-]+$/', $configured) === 1) {
            return $configured;
        }

        return self::DEVELOPMENT_COOKIE;
    }

    /**
     * Set-Cookie value that stores the raw token.
     *
     * @param array{token: string, expiresAt?: string} $session
     */
    public function cookie(array $session, Request $request): string
    {
        $expiresAt = isset($session['expiresAt'])
            ? self::parse($session['expiresAt'])
            : Clock::now()->modify('+' . self::SLIDING_TTL_DAYS . ' days');

        $maxAge = max(0, $expiresAt->getTimestamp() - time());

        return $this->cookieHeader($session['token'], $maxAge, $request);
    }

    /**
     * Set-Cookie value that deletes the session cookie in the browser.
     */
    public function clearCookie(Request $request): string
    {
        return $this->cookieHeader('', 0, $request);
    }

    private function cookieHeader(string $value, int $maxAge, Request $request): string
    {
        $expires = gmdate('D, d M Y H:i:s \G\M\T', $maxAge > 0 ? time() + $maxAge : 1);

        $parts = [
            $this->cookieName() . '=' . $value,
            'Path=/',
            'Expires=' . $expires,
            'Max-Age=' . $maxAge,
            'HttpOnly',
            'SameSite=Lax',
        ];

        if ($this->secure($request)) {
            $parts[] = 'Secure';
        }

        return implode('; ', $parts);
    }

    private function secure(Request $request): bool
    {
        if ($this->isProduction()) {
            return true;
        }

        // A __Host- cookie is only accepted by browsers when it is Secure.
        if (str_starts_with($this->cookieName(), '__Host-')) {
            return true;
        }

        if ($request->isSecure()) {
            return true;
        }

        return ($this->sessionConfig['secure'] ?? false) === true;
    }

    /**
     * Only "production" is production. Anything else is a test, development
     * or staging environment that may run over plain HTTP.
     */
    private function isProduction(): bool
    {
        return $this->env === 'production';
    }

    private static function normaliseIp(string $ip): ?string
    {
        $ip = trim($ip);

        return $ip === '' ? null : substr($ip, 0, 45);
    }

    private static function sql(DateTimeImmutable $at): string
    {
        return $at->format('Y-m-d H:i:s.u');
    }

    private static function parse(string $value): DateTimeImmutable
    {
        return new DateTimeImmutable($value, new DateTimeZone('UTC'));
    }
}
