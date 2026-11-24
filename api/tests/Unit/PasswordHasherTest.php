<?php

declare(strict_types=1);

namespace Kocluk\Api\Tests\Unit;

use Kocluk\Api\Auth\PasswordHasher;
use PHPUnit\Framework\TestCase;

/**
 * Password hashes must be salted, verifiable and upgradeable.
 *
 * The plaintext password never appears in the hash, and two hashes of the same
 * password differ so a leaked database cannot be attacked with one rainbow
 * table entry per password.
 */
final class PasswordHasherTest extends TestCase
{
    private const PASSWORD = 'gizli-sifre-123';

    public function test_a_hash_verifies_the_original_password(): void
    {
        $hash = PasswordHasher::hash(self::PASSWORD);

        self::assertNotSame(self::PASSWORD, $hash);
        self::assertTrue(PasswordHasher::verify(self::PASSWORD, $hash));
        self::assertFalse(PasswordHasher::verify('baska-sifre-123', $hash));
    }

    public function test_two_hashes_of_the_same_password_differ(): void
    {
        self::assertNotSame(
            PasswordHasher::hash(self::PASSWORD),
            PasswordHasher::hash(self::PASSWORD),
        );
    }

    public function test_a_fresh_hash_does_not_need_rehashing(): void
    {
        self::assertFalse(PasswordHasher::needsRehash(PasswordHasher::hash(self::PASSWORD)));
    }

    public function test_a_hash_with_an_old_cost_needs_rehashing(): void
    {
        $old = password_hash(self::PASSWORD, PASSWORD_BCRYPT, ['cost' => 4]);

        self::assertIsString($old);
        self::assertTrue(PasswordHasher::needsRehash($old));
    }

    public function test_an_empty_hash_never_verifies(): void
    {
        self::assertFalse(PasswordHasher::verify(self::PASSWORD, ''));
    }
}
