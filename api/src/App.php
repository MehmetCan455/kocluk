<?php

declare(strict_types=1);

namespace Kocluk\Api;

use Kocluk\Api\Db\Database;
use Kocluk\Api\Http\Request;
use Kocluk\Api\Http\Response;
use Kocluk\Api\Http\Router;
use Kocluk\Api\Support\ApiException;
use Kocluk\Api\Support\Clock;
use Kocluk\Api\Support\Json;
use Throwable;

/**
 * HTTP application.
 *
 * Owns the router and, as later tasks add them, the auth/mail/sync services.
 * Request failures (ApiException) are translated to the JSON error envelope
 * here; unexpected Throwables are turned into a generic 500 by the front
 * controller, which also logs them outside public_html.
 *
 * The health route does not touch the database, so uptime checks keep working
 * while MariaDB is unavailable.
 */
final class App
{
    private readonly Router $router;

    /**
     * @param array<string, mixed> $config
     */
    public function __construct(
        private readonly ?Database $database = null,
        private readonly array $config = [],
    ) {
        $this->router = new Router();
        $this->router->add('GET', '/api/health', $this->health(...));
    }

    public function handle(Request $request): Response
    {
        try {
            return $this->router->dispatch($request);
        } catch (ApiException $error) {
            return self::errorResponse($error);
        }
    }

    /**
     * Maps a failure to the JSON error envelope.
     *
     * ApiExceptions keep their code, status and headers (4xx/5xx by
     * construction). Anything else becomes a generic 500 whose body never
     * contains the original message, class or stack trace.
     */
    public static function errorResponse(?Throwable $error = null): Response
    {
        if ($error instanceof ApiException) {
            return Response::json(
                Json::error($error->errorCode, $error->getMessage()),
                $error->status,
                $error->headers,
            );
        }

        return Response::json(
            Json::error('internal_error', 'Sunucuda beklenmeyen bir hata oluştu.'),
            500,
        );
    }

    private function health(Request $request): Response
    {
        return Response::json([
            'ok' => true,
            'serverTime' => Clock::iso(),
        ]);
    }
}
