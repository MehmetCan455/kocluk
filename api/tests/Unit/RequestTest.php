<?php

declare(strict_types=1);

namespace Kocluk\Api\Tests\Unit;

use Kocluk\Api\Http\Request;
use Kocluk\Api\Support\ApiException;
use PHPUnit\Framework\TestCase;

final class RequestTest extends TestCase
{
    /** @var array<string, mixed> */
    private array $serverBackup = [];

    /** @var array<string, mixed> */
    private array $cookieBackup = [];

    protected function setUp(): void
    {
        $this->serverBackup = $_SERVER;
        $this->cookieBackup = $_COOKIE;
        $_COOKIE = [];
    }

    protected function tearDown(): void
    {
        $_SERVER = $this->serverBackup;
        $_COOKIE = $this->cookieBackup;
    }

    public function test_from_globals_reads_method_path_query_and_ip(): void
    {
        $_SERVER = [
            'REQUEST_METHOD' => 'POST',
            'REQUEST_URI' => '/api/health?trace=1',
            'REMOTE_ADDR' => '203.0.113.9',
        ];

        $request = Request::fromGlobals();

        self::assertSame('POST', $request->method);
        self::assertSame('/api/health', $request->path);
        self::assertSame('203.0.113.9', $request->ip);
        self::assertSame('1', $request->query('trace'));
    }

    public function test_forwarded_for_header_is_not_trusted_for_the_client_ip(): void
    {
        $_SERVER = [
            'REQUEST_METHOD' => 'GET',
            'REQUEST_URI' => '/api/health',
            'REMOTE_ADDR' => '198.51.100.7',
            'HTTP_X_FORWARDED_FOR' => '10.0.0.1, 203.0.113.5',
        ];

        $request = Request::fromGlobals();

        self::assertSame('198.51.100.7', $request->ip);
        // The header is still readable; it is simply never used as the IP.
        self::assertSame('10.0.0.1, 203.0.113.5', $request->header('x-forwarded-for'));
    }

    public function test_defaults_when_superglobals_are_empty(): void
    {
        $_SERVER = [];

        $request = Request::fromGlobals();

        self::assertSame('GET', $request->method);
        self::assertSame('/', $request->path);
        self::assertSame('', $request->ip);
        self::assertSame([], $request->json());
    }

    public function test_header_lookup_is_case_insensitive(): void
    {
        $request = Request::create('GET', '/api/health', [
            'Content-Type' => 'application/json',
            'X-CSRF-Token' => 'token-123',
        ]);

        self::assertSame('application/json', $request->header('Content-Type'));
        self::assertSame('application/json', $request->header('content-type'));
        self::assertSame('token-123', $request->header('x-csrf-token'));
        self::assertNull($request->header('Authorization'));
    }

    public function test_cookies_are_read(): void
    {
        $_SERVER = ['REQUEST_METHOD' => 'GET', 'REQUEST_URI' => '/api/auth/session'];
        $_COOKIE = ['kocluk_session' => 'cookie-token'];

        $request = Request::fromGlobals();

        self::assertSame('cookie-token', $request->cookie('kocluk_session'));
        self::assertNull($request->cookie('missing'));
    }

    public function test_json_body_is_decoded_preserving_utf8(): void
    {
        $body = '{"email":"cagri@example.com","displayName":"Çağrı Şen","privacyAccepted":true,"topics":["matematik",1]}';

        $request = Request::create('POST', '/api/auth/register', ['Content-Type' => 'application/json'], $body);

        self::assertSame([
            'email' => 'cagri@example.com',
            'displayName' => 'Çağrı Şen',
            'privacyAccepted' => true,
            'topics' => ['matematik', 1],
        ], $request->json());
    }

    public function test_empty_body_decodes_to_an_empty_array(): void
    {
        $request = Request::create('POST', '/api/auth/logout');

        self::assertSame([], $request->json());
    }

    public function test_invalid_json_body_throws_400(): void
    {
        $request = Request::create('POST', '/api/auth/login', [], '{"broken":');

        try {
            $request->json();
            self::fail('Bozuk JSON gövdesi kabul edildi.');
        } catch (ApiException $error) {
            self::assertSame(400, $error->status);
            self::assertSame('invalid_json', $error->errorCode);
        }
    }

    public function test_scalar_json_body_throws_400(): void
    {
        $request = Request::create('POST', '/api/auth/login', [], '"just a string"');

        try {
            $request->json();
            self::fail('JSON skaler gövdesi kabul edildi.');
        } catch (ApiException $error) {
            self::assertSame(400, $error->status);
            self::assertSame('invalid_json', $error->errorCode);
        }
    }

    public function test_body_of_exactly_one_megabyte_is_accepted(): void
    {
        $request = Request::create('POST', '/api/sync/push', [], str_repeat('a', Request::MAX_BODY_BYTES));

        self::assertSame(Request::MAX_BODY_BYTES, strlen($request->body()));
    }

    public function test_body_over_one_megabyte_throws_413(): void
    {
        try {
            Request::create('POST', '/api/sync/push', [], str_repeat('a', Request::MAX_BODY_BYTES + 1));
            self::fail('1 MB üstü gövde kabul edildi.');
        } catch (ApiException $error) {
            self::assertSame(413, $error->status);
            self::assertSame('payload_too_large', $error->errorCode);
        }
    }

    public function test_content_length_over_one_megabyte_throws_413_before_reading(): void
    {
        $_SERVER = [
            'REQUEST_METHOD' => 'POST',
            'REQUEST_URI' => '/api/sync/push',
            'CONTENT_LENGTH' => (string) (Request::MAX_BODY_BYTES + 1),
        ];

        try {
            Request::fromGlobals();
            self::fail('1 MB üstü Content-Length kabul edildi.');
        } catch (ApiException $error) {
            self::assertSame(413, $error->status);
            self::assertSame('payload_too_large', $error->errorCode);
        }
    }

    public function test_query_string_exposes_scalars_only(): void
    {
        $_SERVER = [
            'REQUEST_METHOD' => 'GET',
            'REQUEST_URI' => '/api/sync/pull?since=12&limit=500&tags[]=a',
        ];

        $request = Request::fromGlobals();

        self::assertSame('12', $request->query('since'));
        self::assertSame('500', $request->query('limit'));
        self::assertNull($request->query('tags'));
        self::assertSame('fallback', $request->query('missing', 'fallback'));
    }
}
