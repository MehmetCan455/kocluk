<?php

declare(strict_types=1);

namespace Kocluk\Api\Tests\Unit;

use Kocluk\Api\Support\Uuid;
use PHPUnit\Framework\TestCase;

final class UuidTest extends TestCase
{
    public function test_v4_matches_rfc_4122_format(): void
    {
        self::assertMatchesRegularExpression(
            '/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/',
            Uuid::v4(),
        );
    }

    public function test_v4_values_differ(): void
    {
        self::assertNotSame(Uuid::v4(), Uuid::v4());
    }

    public function test_token_is_url_safe_without_padding(): void
    {
        $token = Uuid::token();

        self::assertMatchesRegularExpression('/^[A-Za-z0-9_-]+$/', $token);
        self::assertStringNotContainsString('=', $token);
        self::assertSame(43, strlen($token));
    }

    public function test_tokens_differ(): void
    {
        self::assertNotSame(Uuid::token(), Uuid::token());
    }

    public function test_hash_token_is_deterministic_sha256(): void
    {
        $token = Uuid::token();

        self::assertSame(hash('sha256', $token), Uuid::hashToken($token));
        self::assertSame(Uuid::hashToken($token), Uuid::hashToken($token));
        self::assertMatchesRegularExpression('/^[0-9a-f]{64}$/', Uuid::hashToken($token));
    }
}
