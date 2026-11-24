<?php

declare(strict_types=1);

namespace Kocluk\Api\Http;

use Kocluk\Api\Support\Json;
use LogicException;

/**
 * Minimal exact-match router.
 *
 * Routes are registered with the public path including the /api prefix, e.g.
 * "GET /api/health". Query strings are handled by Request and never take part
 * in matching. An unknown path answers 404; a known path with another method
 * answers 405 with an Allow header. Both are JSON error envelopes.
 */
final class Router
{
    /** @var list<array{method: string, path: string, handler: callable}> */
    private array $routes = [];

    public function add(string $method, string $path, callable $handler): void
    {
        $this->routes[] = [
            'method' => strtoupper($method),
            'path' => $path,
            'handler' => $handler,
        ];
    }

    public function dispatch(Request $request): Response
    {
        $allowed = [];

        foreach ($this->routes as $route) {
            if ($route['path'] !== $request->path) {
                continue;
            }

            if ($route['method'] === $request->method) {
                $response = ($route['handler'])($request);

                if (!$response instanceof Response) {
                    throw new LogicException('Route handler must return ' . Response::class . '.');
                }

                return $response;
            }

            $allowed[] = $route['method'];
        }

        if ($allowed !== []) {
            $allowed = array_values(array_unique($allowed));
            sort($allowed);

            return Response::json(
                Json::error('method_not_allowed', 'Bu yol için HTTP yöntemi desteklenmiyor.'),
                405,
                ['Allow' => implode(', ', $allowed)],
            );
        }

        return Response::json(
            Json::error('not_found', 'Kaynak bulunamadı.'),
            404,
        );
    }
}
