<?php

declare(strict_types=1);

namespace Kocluk\Api\Tests\Unit;

use Kocluk\Api\Http\Request;
use Kocluk\Api\Http\Response;
use Kocluk\Api\Http\Router;
use LogicException;
use PHPUnit\Framework\TestCase;

final class RouterTest extends TestCase
{
    public function test_matching_route_returns_the_handler_response(): void
    {
        $router = new Router();
        $seen = null;

        $router->add('GET', '/api/health', static function (Request $request) use (&$seen): Response {
            $seen = $request;

            return Response::json(['ok' => true]);
        });

        $request = Request::create('GET', '/api/health');
        $response = $router->dispatch($request);

        self::assertSame($request, $seen);
        self::assertSame(200, $response->status());
        self::assertSame('{"ok":true}', $response->body());
        self::assertSame('application/json; charset=utf-8', $response->header('content-type'));
    }

    public function test_unknown_path_returns_404_with_error_envelope(): void
    {
        $router = new Router();
        $router->add('GET', '/api/health', static fn (Request $request): Response => Response::json(['ok' => true]));

        $response = $router->dispatch(Request::create('GET', '/api/unknown'));
        $payload = $this->payload($response);

        self::assertSame(404, $response->status());
        self::assertSame(['error'], array_keys($payload));
        self::assertSame(['code', 'message'], array_keys($payload['error']));
        self::assertSame('not_found', $payload['error']['code']);
        self::assertNotSame('', $payload['error']['message']);

        // Error responses are JSON too and keep the security headers.
        self::assertSame('application/json; charset=utf-8', $response->header('content-type'));
        self::assertSame('no-store', $response->header('cache-control'));
        self::assertSame('nosniff', $response->header('x-content-type-options'));
    }

    public function test_known_path_with_wrong_method_returns_405_and_allow(): void
    {
        $router = new Router();
        $router->add('GET', '/api/health', static fn (Request $request): Response => Response::json(['ok' => true]));
        $router->add('POST', '/api/health', static fn (Request $request): Response => Response::json(['ok' => true]));

        $response = $router->dispatch(Request::create('DELETE', '/api/health'));
        $payload = $this->payload($response);

        self::assertSame(405, $response->status());
        self::assertSame('GET, POST', $response->header('allow'));
        self::assertSame('method_not_allowed', $payload['error']['code']);
        self::assertSame('no-store', $response->header('cache-control'));
    }

    public function test_paths_are_matched_exactly(): void
    {
        $router = new Router();
        $router->add('GET', '/api/health', static fn (Request $request): Response => Response::json(['ok' => true]));

        self::assertSame(404, $router->dispatch(Request::create('GET', '/api/health/'))->status());
        self::assertSame(404, $router->dispatch(Request::create('GET', '/api/health2'))->status());
        self::assertSame(404, $router->dispatch(Request::create('GET', '/health'))->status());
    }

    public function test_method_registration_is_case_insensitive(): void
    {
        $router = new Router();
        $router->add('get', '/api/health', static fn (Request $request): Response => Response::json(['ok' => true]));

        self::assertSame(200, $router->dispatch(Request::create('GET', '/api/health'))->status());
    }

    public function test_handler_must_return_a_response(): void
    {
        $router = new Router();
        $router->add('GET', '/api/broken', static fn (Request $request): array => ['ok' => true]);

        $this->expectException(LogicException::class);

        $router->dispatch(Request::create('GET', '/api/broken'));
    }

    public function test_custom_headers_override_defaults_ignoring_case(): void
    {
        $response = Response::json(['ok' => true], 200, ['cache-control' => 'private', 'Allow' => 'GET']);

        self::assertSame('private', $response->header('Cache-Control'));
        self::assertSame('GET', $response->header('allow'));
        self::assertSame('no-store', Response::json([])->header('cache-control'));
    }

    /**
     * @return array<string, mixed>
     */
    private function payload(Response $response): array
    {
        $payload = json_decode($response->body(), true, 512, JSON_THROW_ON_ERROR);

        self::assertIsArray($payload);

        /** @var array<string, mixed> $payload */
        return $payload;
    }
}
