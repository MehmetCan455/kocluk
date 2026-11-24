<?php

declare(strict_types=1);

namespace Kocluk\Api\Auth;

use Kocluk\Api\Db\Database;
use Kocluk\Api\Http\Request;
use Kocluk\Api\Mail\DeferredMailer;
use Kocluk\Api\Mail\Templates;
use Kocluk\Api\Support\ApiException;
use Kocluk\Api\Support\Clock;
use Kocluk\Api\Support\Uuid;
use Throwable;

/**
 * Password reset flow (spec §7.1, §7.4).
 *
 * Anti-enumeration invariant: request() never reveals whether the address
 * exists. It always returns normally (the route answers 202) and only sends a
 * message when a live account matches. A send failure is logged and the
 * undelivered token is discarded, but the response is the same 202 so a
 * broken SMTP server cannot be used to probe registered addresses.
 *
 * Tokens are 32 random bytes; only their SHA-256 digest is stored. They are
 * valid for 30 minutes and single use. A successful reset revokes every
 * session of the account, including the browser that requested it.
 */
final class PasswordResetService
{
    public const EMAIL_LIMIT = 3;

    public const IP_LIMIT = 10;

    public const RESET_IP_LIMIT = 5;

    public const WINDOW_SECONDS = 3600;

    public const TOKEN_TTL_MINUTES = 30;

    public function __construct(
        private readonly Database $database,
        private readonly SessionService $sessions,
        private readonly RateLimiter $rateLimiter,
        private readonly DeferredMailer $mailer,
        private readonly Templates $templates,
    ) {
    }

    /**
     * Sends a reset link when the address belongs to a live account. The
     * caller always answers 202, whatever happened here.
     */
    public function request(string $email, Request $request): void
    {
        $normalised = strtolower(trim($email));

        // Two budgets: 10/hour per IP and 3/hour per address. The address
        // scope uses a null IP in RateLimiter, so changing IPs cannot
        // multiply the three messages an address may receive per hour.
        $this->rateLimiter->assert(
            'forgot_password_ip',
            $request->ip,
            self::IP_LIMIT,
            self::WINDOW_SECONDS,
        );
        $this->rateLimiter->assert(
            'forgot_password:' . hash('sha256', $normalised),
            null,
            self::EMAIL_LIMIT,
            self::WINDOW_SECONDS,
        );

        if (
            $normalised === ''
            || strlen($normalised) > 255
            || filter_var($normalised, FILTER_VALIDATE_EMAIL) === false
        ) {
            throw self::validationError('Geçerli bir e-posta adresi girin.');
        }

        $user = $this->database->fetchOne(
            'SELECT `id`, `email`, `display_name` FROM `users`'
            . ' WHERE `email` = ? AND `deleted_at` IS NULL',
            [$normalised],
        );

        if ($user === null) {
            return;
        }

        $token = Uuid::token(32);
        $hash = Uuid::hashToken($token);
        $now = Clock::now();
        $nowSql = $now->format('Y-m-d H:i:s.u');
        $expiresAt = $now->modify('+' . self::TOKEN_TTL_MINUTES . ' minutes');

        $this->database->execute(
            'INSERT INTO `password_resets` (`id`, `user_id`, `expires_at`, `created_at`)'
            . ' VALUES (?, ?, ?, ?)',
            [
                $hash,
                (string) $user['id'],
                $expiresAt->format('Y-m-d H:i:s.u'),
                $nowSql,
            ],
        );

        try {
            $message = $this->templates->reset((string) $user['display_name'], $token);
        } catch (Throwable $error) {
            // The token never reached the user; remove it instead of leaving
            // a usable credential in the database.
            $this->discard($hash);
            self::logFailure('password reset', $error);

            return;
        }

        $onFailure = function (Throwable $error) use ($hash): void {
            $this->discard($hash);
            self::logFailure('password reset', $error);
        };

        try {
            // SMTP must not run before the 202 leaves the server: a known
            // address would otherwise take longer than an unknown one.
            $this->mailer->queue(
                (string) $user['email'],
                $message['subject'],
                $message['html'],
                $onFailure,
            );
        } catch (Throwable $error) {
            $this->discard($hash);
            self::logFailure('password reset', $error);
        }
    }

    /**
     * Consumes the token, stores the new password hash and revokes every
     * session. The token row is marked used in the same transaction, so two
     * concurrent requests cannot both succeed.
     */
    public function reset(string $token, string $password, Request $request): void
    {
        $this->rateLimiter->assert(
            'reset_password',
            $request->ip,
            self::RESET_IP_LIMIT,
            self::WINDOW_SECONDS,
        );

        $token = trim($token);

        if ($token === '') {
            throw self::validationError('Sıfırlama bağlantısı geçersiz.');
        }

        $hash = Uuid::hashToken($token);

        $row = $this->database->fetchOne(
            'SELECT `pr`.`user_id` FROM `password_resets` `pr`'
            . ' JOIN `users` `u` ON `u`.`id` = `pr`.`user_id`'
            . ' WHERE `pr`.`id` = ? AND `pr`.`used_at` IS NULL'
            . ' AND `pr`.`expires_at` > ? AND `u`.`deleted_at` IS NULL',
            [$hash, Clock::nowSql()],
        );

        if ($row === null) {
            throw self::invalidToken();
        }

        AuthService::assertPassword($password);

        $userId = (string) $row['user_id'];

        $this->database->transaction(function () use ($hash, $userId, $password): void {
            $now = Clock::nowSql();

            $consumed = $this->database->execute(
                'UPDATE `password_resets` SET `used_at` = ? WHERE `id` = ? AND `used_at` IS NULL',
                [$now, $hash],
            );

            if ($consumed !== 1) {
                throw self::invalidToken();
            }

            // Any other outstanding link for this account becomes useless.
            $this->database->execute(
                'UPDATE `password_resets` SET `used_at` = ? WHERE `user_id` = ? AND `used_at` IS NULL',
                [$now, $userId],
            );

            $this->database->execute(
                'UPDATE `users` SET `password_hash` = ?, `updated_at` = ?'
                . ' WHERE `id` = ? AND `deleted_at` IS NULL',
                [PasswordHasher::hash($password), $now, $userId],
            );

            $this->sessions->revokeAll($userId);
        });
    }

    private function discard(string $hash): void
    {
        try {
            $this->database->execute('DELETE FROM `password_resets` WHERE `id` = ?', [$hash]);
        } catch (Throwable) {
            // Best effort: an undelivered token expires unused.
        }
    }

    private static function logFailure(string $context, Throwable $error): void
    {
        // Passwords and tokens never reach this log. Transport messages can
        // echo the recipient, so addresses are redacted before writing.
        $message = preg_replace(
            '/[A-Z0-9._%+\-]+@[A-Z0-9.\-]+\.[A-Z]{2,}/i',
            '[adres]',
            $error->getMessage(),
        ) ?? '';

        error_log(sprintf(
            'kocluk-api %s mail failed: %s: %s',
            $context,
            $error::class,
            mb_substr($message, 0, 200),
        ));
    }

    private static function validationError(string $message): ApiException
    {
        return new ApiException('validation_failed', $message, 422);
    }

    private static function invalidToken(): ApiException
    {
        return new ApiException('invalid_token', 'Bağlantı geçersiz veya süresi dolmuş.', 410);
    }
}
