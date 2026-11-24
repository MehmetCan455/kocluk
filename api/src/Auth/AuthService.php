<?php

declare(strict_types=1);

namespace Kocluk\Api\Auth;

use DateTimeImmutable;
use DateTimeZone;
use Kocluk\Api\Db\Database;
use Kocluk\Api\Http\Request;
use Kocluk\Api\Mail\DeferredMailer;
use Kocluk\Api\Mail\Templates;
use Kocluk\Api\Support\ApiException;
use Kocluk\Api\Support\Clock;
use Kocluk\Api\Support\Uuid;
use PDOException;
use Throwable;

/**
 * Account and session use cases behind the /api/auth endpoints (spec §7).
 *
 * Invariants:
 *   * plaintext passwords are only passed to PasswordHasher and never stored,
 *     echoed or logged;
 *   * every user query filters soft-deleted rows and is keyed by the user id
 *     from the session, never by a client-supplied user id;
 *   * a login replaces only the session of the browser that is logging in,
 *     while a password change revokes every other device.
 */
final class AuthService
{
    public const LOGIN_LIMIT = 10;

    public const LOGIN_WINDOW_SECONDS = 900;

    public const REGISTER_LIMIT = 5;

    public const REGISTER_WINDOW_SECONDS = 3600;

    public const VERIFICATION_TTL_MINUTES = 1440;

    public const VERIFY_LIMIT = 10;

    public const VERIFY_WINDOW_SECONDS = 3600;

    public const PASSWORD_MIN_LENGTH = 8;

    public const PASSWORD_MAX_LENGTH = 200;

    public const DISPLAY_NAME_MAX_LENGTH = 80;

    private const DEFAULT_PRIVACY_VERSION = '2026-11-24';

    private const USER_COLUMNS = '`id`, `email`, `password_hash`, `display_name`, `email_verified_at`,'
        . ' `privacy_version`, `consented_at`, `created_at`';

    /**
     * @param array<string, mixed> $config
     */
    public function __construct(
        private readonly Database $database,
        private readonly SessionService $sessions,
        private readonly RateLimiter $rateLimiter,
        private readonly DeferredMailer $mailer,
        private readonly Templates $templates,
        private readonly array $config = [],
    ) {
    }

    /**
     * @param array<string, mixed> $input
     * @return array{user: array<string, mixed>, session: array{token: string, csrfToken: string, expiresAt: string, createdAt: string}}
     */
    public function register(array $input, Request $request): array
    {
        $this->rateLimiter->assert(
            'register',
            $request->ip,
            self::REGISTER_LIMIT,
            self::REGISTER_WINDOW_SECONDS,
        );

        $email = self::normalizeEmail($input['email'] ?? null);
        $password = is_string($input['password'] ?? null) ? $input['password'] : '';
        $displayName = is_string($input['displayName'] ?? null) ? trim($input['displayName']) : '';

        if ($email === '' || strlen($email) > 255 || filter_var($email, FILTER_VALIDATE_EMAIL) === false) {
            throw self::validationError('Geçerli bir e-posta adresi girin.');
        }

        self::assertPassword($password);

        if ($displayName === '' || mb_strlen($displayName) > self::DISPLAY_NAME_MAX_LENGTH) {
            throw self::validationError('Görünen ad 1 ile 80 karakter arasında olmalı.');
        }

        if (($input['privacyAccepted'] ?? null) !== true) {
            throw self::validationError('Gizlilik metni onayı zorunlu.');
        }

        $this->assertInviteCode($input['inviteCode'] ?? null);

        $now = Clock::nowSql();
        $userId = Uuid::v4();

        $result = $this->database->transaction(function () use ($userId, $email, $password, $displayName, $now, $request): array {
            try {
                $this->database->execute(
                    'INSERT INTO `users` (`id`, `email`, `password_hash`, `display_name`, `privacy_version`, `consented_at`, `created_at`, `updated_at`)'
                    . ' VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
                    [
                        $userId,
                        $email,
                        PasswordHasher::hash($password),
                        $displayName,
                        $this->privacyVersion(),
                        $now,
                        $now,
                        $now,
                    ],
                );
            } catch (PDOException $error) {
                if (self::isDuplicateKey($error)) {
                    throw new ApiException(
                        'email_taken',
                        'Bu e-posta adresi zaten kayıtlı.',
                        409,
                        [],
                        $error,
                    );
                }

                throw $error;
            }

            $session = $this->sessions->create($userId, $request);

            return [
                'user' => $this->publicUser($this->requireUser($userId)),
                'session' => $session,
            ];
        });

        // The account and its session are committed. A verification e-mail
        // failure is logged but never rolls the registration back (spec §7.4);
        // the user simply stays unverified.
        $this->sendVerificationEmail($userId, $email, $displayName);

        return $result;
    }

    /**
     * @param array<string, mixed> $input
     * @return array{user: array<string, mixed>, session: array{token: string, csrfToken: string, expiresAt: string, createdAt: string}}
     */
    public function login(array $input, Request $request): array
    {
        $email = self::normalizeEmail($input['email'] ?? null);
        $password = is_string($input['password'] ?? null) ? $input['password'] : '';

        // Count every attempt, valid or not, before touching the password
        // hash. The bucket includes a digest of the e-mail so the raw address
        // does not end up in the rate_limits table.
        $this->rateLimiter->assert(
            'login:' . hash('sha256', $email),
            $request->ip,
            self::LOGIN_LIMIT,
            self::LOGIN_WINDOW_SECONDS,
        );

        $user = $email === '' ? null : $this->findUserByEmail($email);

        if ($user === null || !PasswordHasher::verify($password, (string) $user['password_hash'])) {
            throw new ApiException('invalid_credentials', 'E-posta veya şifre hatalı.', 401);
        }

        if (PasswordHasher::needsRehash((string) $user['password_hash'])) {
            $this->database->execute(
                'UPDATE `users` SET `password_hash` = ?, `updated_at` = ? WHERE `id` = ?',
                [PasswordHasher::hash($password), Clock::nowSql(), (string) $user['id']],
            );
        }

        // Only this browser's previous session is replaced; sessions on other
        // devices must survive because multi-device sync depends on them.
        $previousToken = $this->sessions->tokenFrom($request);

        if ($previousToken !== null) {
            $this->sessions->revoke($previousToken);
        }

        $session = $this->sessions->create((string) $user['id'], $request);

        return ['user' => $this->publicUser($user), 'session' => $session];
    }

    /**
     * Revokes only the token carried by the current browser.
     */
    public function logout(Request $request): void
    {
        $token = $this->sessions->tokenFrom($request);

        if ($token !== null) {
            $this->sessions->revoke($token);
        }
    }

    /**
     * @return array{user: array<string, mixed>, csrfToken: string}|null
     */
    public function session(?string $token): ?array
    {
        $session = $this->sessions->validate($token);

        if ($session === null) {
            return null;
        }

        $user = $this->findUserById($session['userId']);

        if ($user === null) {
            return null;
        }

        return ['user' => $this->publicUser($user), 'csrfToken' => $session['csrfToken']];
    }

    /**
     * Consumes an e-mail verification token and fills users.email_verified_at.
     *
     * Verification is optional in this version: login never checks the flag.
     * The token is single use; a consumed, expired, unknown or soft-deleted
     * user's token all answer the same 410 from the route.
     */
    public function verifyEmail(string $token, Request $request): void
    {
        $this->rateLimiter->assert(
            'verify_email',
            $request->ip,
            self::VERIFY_LIMIT,
            self::VERIFY_WINDOW_SECONDS,
        );

        $token = trim($token);

        if ($token === '') {
            throw self::validationError('Doğrulama bağlantısı geçersiz.');
        }

        $hash = Uuid::hashToken($token);

        $row = $this->database->fetchOne(
            'SELECT `v`.`user_id` FROM `email_verifications` `v`'
            . ' JOIN `users` `u` ON `u`.`id` = `v`.`user_id`'
            . ' WHERE `v`.`id` = ? AND `v`.`used_at` IS NULL'
            . ' AND `v`.`expires_at` > ? AND `u`.`deleted_at` IS NULL',
            [$hash, Clock::nowSql()],
        );

        if ($row === null) {
            throw self::invalidToken();
        }

        $userId = (string) $row['user_id'];

        $this->database->transaction(function () use ($hash, $userId): void {
            $now = Clock::nowSql();

            $consumed = $this->database->execute(
                'UPDATE `email_verifications` SET `used_at` = ? WHERE `id` = ? AND `used_at` IS NULL',
                [$now, $hash],
            );

            if ($consumed !== 1) {
                throw self::invalidToken();
            }

            // Older links for the same account become useless.
            $this->database->execute(
                'UPDATE `email_verifications` SET `used_at` = ? WHERE `user_id` = ? AND `used_at` IS NULL',
                [$now, $userId],
            );

            $this->database->execute(
                'UPDATE `users` SET `email_verified_at` = ?, `updated_at` = ?'
                . ' WHERE `id` = ? AND `deleted_at` IS NULL',
                [$now, $now, $userId],
            );
        });
    }

    /**
     * Updates the display name only; the e-mail address is the login identity
     * and cannot change in this version (spec §3), so it is ignored here.
     *
     * @param array<string, mixed> $input
     * @return array<string, mixed>
     */
    public function updateProfile(string $userId, array $input): array
    {
        $this->requireUser($userId);

        $displayName = is_string($input['displayName'] ?? null) ? trim($input['displayName']) : '';

        if ($displayName === '' || mb_strlen($displayName) > self::DISPLAY_NAME_MAX_LENGTH) {
            throw self::validationError('Görünen ad 1 ile 80 karakter arasında olmalı.');
        }

        $this->database->execute(
            'UPDATE `users` SET `display_name` = ?, `updated_at` = ? WHERE `id` = ? AND `deleted_at` IS NULL',
            [$displayName, Clock::nowSql(), $userId],
        );

        return $this->publicUser($this->requireUser($userId));
    }

    /**
     * Verifies the current password, stores the new hash, revokes every other
     * session and rotates the session of the browser making the request.
     *
     * Returns the public user and the rotated session so the route can emit a
     * fresh Set-Cookie and the new CSRF token; the old token and CSRF token
     * are invalid immediately.
     *
     * @return array{user: array<string, mixed>, session: array{token: string, csrfToken: string, expiresAt: string, createdAt: string}}
     */
    public function changePassword(
        string $userId,
        string $currentPassword,
        string $newPassword,
        string $currentToken,
        Request $request,
    ): array {
        $user = $this->requireUser($userId);

        if (!PasswordHasher::verify($currentPassword, (string) $user['password_hash'])) {
            throw new ApiException('invalid_password', 'Mevcut şifre hatalı.', 422);
        }

        self::assertPassword($newPassword);

        $session = $this->database->transaction(function () use (
            $userId,
            $newPassword,
            $currentToken,
            $request,
        ): array {
            $this->database->execute(
                'UPDATE `users` SET `password_hash` = ?, `updated_at` = ? WHERE `id` = ?',
                [PasswordHasher::hash($newPassword), Clock::nowSql(), $userId],
            );

            $this->sessions->revokeOthers($userId, $currentToken);
            $this->sessions->revoke($currentToken);

            return $this->sessions->create($userId, $request);
        });

        return ['user' => $this->publicUser($user), 'session' => $session];
    }

    /**
     * @return array<string, mixed>|null
     */
    private function findUserById(string $userId): ?array
    {
        return $this->database->fetchOne(
            'SELECT ' . self::USER_COLUMNS . ' FROM `users` WHERE `id` = ? AND `deleted_at` IS NULL',
            [$userId],
        );
    }

    /**
     * @return array<string, mixed>|null
     */
    private function findUserByEmail(string $email): ?array
    {
        return $this->database->fetchOne(
            'SELECT ' . self::USER_COLUMNS . ' FROM `users` WHERE `email` = ? AND `deleted_at` IS NULL',
            [$email],
        );
    }

    /**
     * @return array<string, mixed>
     */
    private function requireUser(string $userId): array
    {
        $user = $this->findUserById($userId);

        if ($user === null) {
            throw new ApiException('unauthenticated', 'Oturum bulunamadı veya süresi dolmuş.', 401);
        }

        return $user;
    }

    /**
     * @param array<string, mixed> $user
     * @return array<string, mixed>
     */
    private function publicUser(array $user): array
    {
        return [
            'id' => (string) $user['id'],
            'email' => (string) $user['email'],
            'displayName' => (string) $user['display_name'],
            'emailVerifiedAt' => self::isoOrNull($user['email_verified_at'] ?? null),
            'createdAt' => self::iso((string) $user['created_at']),
        ];
    }

    private function privacyVersion(): string
    {
        $value = $this->config['privacy_version'] ?? null;

        return is_string($value) && $value !== '' ? $value : self::DEFAULT_PRIVACY_VERSION;
    }

    /**
     * Closed-beta gate (spec §7.5): an empty config value disables it, a
     * non-empty one must match exactly. hash_equals keeps the comparison
     * constant-time.
     */
    private function assertInviteCode(mixed $provided): void
    {
        $expected = $this->inviteCode();

        if ($expected === '') {
            return;
        }

        $code = is_string($provided) ? trim($provided) : '';

        if ($code === '') {
            throw self::validationError('Kayıt için davet kodu gerekli.');
        }

        if (!hash_equals($expected, $code)) {
            throw self::validationError('Davet kodu geçersiz.');
        }
    }

    private function inviteCode(): string
    {
        $value = $this->config['invite_code'] ?? null;

        return is_string($value) ? trim($value) : '';
    }

    /**
     * Mints a 24-hour verification token and queues its link. The caller has
     * already committed the account; registration never waits for SMTP. If
     * the deferred send fails, the token is removed and the failure logged;
     * the user simply stays unverified.
     */
    private function sendVerificationEmail(string $userId, string $email, string $displayName): void
    {
        $token = Uuid::token(32);
        $hash = Uuid::hashToken($token);
        $now = Clock::now();
        $nowSql = $now->format('Y-m-d H:i:s.u');
        $expiresAt = $now->modify('+' . self::VERIFICATION_TTL_MINUTES . ' minutes');

        try {
            $this->database->execute(
                'INSERT INTO `email_verifications` (`id`, `user_id`, `expires_at`, `created_at`)'
                . ' VALUES (?, ?, ?, ?)',
                [
                    $hash,
                    $userId,
                    $expiresAt->format('Y-m-d H:i:s.u'),
                    $nowSql,
                ],
            );

            $message = $this->templates->verify($displayName, $token);
        } catch (Throwable $error) {
            $this->discardVerificationToken($hash);
            self::logVerificationFailure($error);

            return;
        }

        try {
            $this->mailer->queue(
                $email,
                $message['subject'],
                $message['html'],
                function (Throwable $error) use ($hash): void {
                    $this->discardVerificationToken($hash);
                    self::logVerificationFailure($error);
                },
            );
        } catch (Throwable $error) {
            $this->discardVerificationToken($hash);
            self::logVerificationFailure($error);
        }
    }

    private function discardVerificationToken(string $hash): void
    {
        try {
            $this->database->execute(
                'DELETE FROM `email_verifications` WHERE `id` = ?',
                [$hash],
            );
        } catch (Throwable) {
            // The undelivered token expires unused; registration stands.
        }
    }

    private static function logVerificationFailure(Throwable $error): void
    {
        error_log(sprintf(
            'kocluk-api email verification failed: %s: %s',
            $error::class,
            mb_substr(self::redact((string) $error->getMessage()), 0, 200),
        ));
    }

    /**
     * Removes e-mail addresses from transport error messages before logging;
     * passwords and tokens are never part of those messages.
     */
    private static function redact(string $message): string
    {
        return preg_replace(
            '/[A-Z0-9._%+\-]+@[A-Z0-9.\-]+\.[A-Z]{2,}/i',
            '[adres]',
            $message,
        ) ?? '';
    }

    private static function normalizeEmail(mixed $value): string
    {
        return is_string($value) ? strtolower(trim($value)) : '';
    }

    /**
     * Shared password policy (registration, reset and change-password).
     */
    public static function assertPassword(string $password): void
    {
        // Leading/trailing spaces are significant and deliberately kept.
        $length = mb_strlen($password);

        if ($length < self::PASSWORD_MIN_LENGTH || $length > self::PASSWORD_MAX_LENGTH) {
            throw self::validationError('Şifre 8 ile 200 karakter arasında olmalı.');
        }
    }

    private static function validationError(string $message): ApiException
    {
        return new ApiException('validation_failed', $message, 422);
    }

    private static function invalidToken(): ApiException
    {
        return new ApiException('invalid_token', 'Bağlantı geçersiz veya süresi dolmuş.', 410);
    }

    private static function isDuplicateKey(PDOException $error): bool
    {
        return $error->getCode() === '23000' && (int) ($error->errorInfo[1] ?? 0) === 1062;
    }

    private static function iso(string $sql): string
    {
        return Clock::iso(new DateTimeImmutable($sql, new DateTimeZone('UTC')));
    }

    private static function isoOrNull(mixed $value): ?string
    {
        return is_string($value) && $value !== '' ? self::iso($value) : null;
    }
}
