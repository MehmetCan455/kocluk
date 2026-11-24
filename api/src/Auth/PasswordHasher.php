<?php

declare(strict_types=1);

namespace Kocluk\Api\Auth;

/**
 * Password hashing with PHP's default algorithm (bcrypt on PHP 8.4).
 *
 * Plaintext passwords never leave this class: callers hand them in and only
 * the returned hash is stored. PASSWORD_DEFAULT is used so a future PHP
 * default can be adopted through needsRehash() without a schema change.
 */
final class PasswordHasher
{
    public static function hash(string $password): string
    {
        return password_hash($password, PASSWORD_DEFAULT);
    }

    public static function verify(string $password, string $hash): bool
    {
        if ($hash === '') {
            return false;
        }

        return password_verify($password, $hash);
    }

    public static function needsRehash(string $hash): bool
    {
        return password_needs_rehash($hash, PASSWORD_DEFAULT);
    }
}
