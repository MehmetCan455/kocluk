<?php

declare(strict_types=1);

namespace Kocluk\Api\Tests\Unit;

use Kocluk\Api\Http\Response;
use PHPUnit\Framework\TestCase;

/**
 * A response can carry several Set-Cookie headers (a new session cookie plus a
 * cookie-clearing header), so headers are stored as ordered value lists rather
 * than a name => value map.
 */
final class ResponseTest extends TestCase
{
    public function test_json_keeps_the_default_security_headers(): void
    {
        $response = Response::json(['ok' => true], 201);

        self::assertSame(201, $response->status());
        self::assertSame('application/json; charset=utf-8', $response->header('content-type'));
        self::assertSame('nosniff', $response->header('X-Content-Type-Options'));
        self::assertSame('strict-origin-when-cross-origin', $response->header('Referrer-Policy'));
        self::assertSame('DENY', $response->header('X-Frame-Options'));
        self::assertSame('max-age=31536000', $response->header('Strict-Transport-Security'));
        self::assertSame('no-store', $response->header('Cache-Control'));
    }

    public function test_multiple_set_cookie_headers_are_preserved_in_order(): void
    {
        $response = Response::json([], 200, [
            'Set-Cookie' => ['a=1; Path=/', 'b=2; Path=/'],
        ]);

        self::assertSame(['a=1; Path=/', 'b=2; Path=/'], $response->cookies());
        self::assertSame(['a=1; Path=/', 'b=2; Path=/'], $response->headerValues('SET-COOKIE'));
        self::assertSame('a=1; Path=/', $response->header('set-cookie'));
    }

    public function test_single_valued_headers_still_work(): void
    {
        $response = Response::json([], 429, ['Retry-After' => '30']);

        self::assertSame('30', $response->header('Retry-After'));
        self::assertSame(['30'], $response->headerValues('retry-after'));
        self::assertSame([], $response->cookies());
    }

    public function test_header_override_is_case_insensitive(): void
    {
        $response = Response::json([], 200, ['cache-control' => 'private']);

        self::assertSame('private', $response->header('Cache-Control'));
    }
}
