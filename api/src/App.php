<?php

declare(strict_types=1);

namespace Kocluk\Api;

use Kocluk\Api\Auth\AuthService;
use Kocluk\Api\Auth\RateLimiter;
use Kocluk\Api\Auth\SessionService;
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
 * Owns the router and the auth services. The database is injected by tests and
 * lazily opened from config in production, so construction never touches
 * MariaDB: the health route keeps answering while the database is down.
 *
 * CSRF policy (spec §7.2): every state-changing request to a registered route
 * needs a valid session and an X-CSRF-Token that matches it. Login and
 * register work without a session but then require an Origin header equal to
 * the configured site origin. Unknown paths and wrong verbs are left to the
 * router so 404/405 keep their meaning.
 *
 * Request failures (ApiException) are translated to the JSON error envelope
 * here; unexpected Throwables are turned into a generic 500 by the front
 * controller, which also logs them outside public_html.
 */
final class App
{
    private const STATE_CHANGING_METHODS = ['POST', 'PUT', 'PATCH', 'DELETE'];

    /**
     * Writes that must work before a session exists. When the browser is
     * already signed in they still require the CSRF token. Task 5 adds the
     * password reset/verification endpoints to this list.
     */
    private const PUBLIC_WRITES = ['/api/auth/register', '/api/auth/login'];

    private const DEFAULT_ORIGIN = 'https://zirveacademy.com';

    private readonly Router $router;

    private ?Database $database;

    private ?SessionService $sessions = null;

    private ?RateLimiter $rateLimiter = null;

    private ?AuthService $auth = null;

    /** @var array<string, true> registered "METHOD /path" pairs */
    private array $registered = [];

    /**
     * @param array<string, mixed> $config
     */
    public function __construct(
        ?Database $database = null,
        private readonly array $config = [],
    ) {
        $this->database = $database;
        $this->router = new Router();

        $this->addRoute('GET', '/api/health', $this->health(...));
        $this->addRoute('POST', '/api/auth/register', $this->register(...));
        $this->addRoute('POST', '/api/auth/login', $this->login(...));
        $this->addRoute('POST', '/api/auth/logout', $this->logout(...));
        $this->addRoute('GET', '/api/auth/session', $this->session(...));
        $this->addRoute('POST', '/api/auth/update-profile', $this->updateProfile(...));
        $this->addRoute('POST', '/api/auth/change-password', $this->changePassword(...));
    }

    public function handle(Request $request): Response
    {
        try {
            $this->guard($request);

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

    private function guard(Request $request): void
    {
        if (!in_array($request->method, self::STATE_CHANGING_METHODS, true)) {
            return;
        }

        if (!isset($this->registered[$request->method . ' ' . $request->path])) {
            return;
        }

        $sessions = $this->sessions();
        $token = $sessions->tokenFrom($request);
        $session = $token !== null ? $sessions->validate($token) : null;

        if ($session === null && in_array($request->path, self::PUBLIC_WRITES, true)) {
            $this->requireTrustedOrigin($request);

            return;
        }

        if ($session === null) {
            throw new ApiException(
                'unauthenticated',
                'Oturum bulunamadı veya süresi dolmuş.',
                401,
            );
        }

        $this->requireCsrf($request, $session);
    }

    private function requireTrustedOrigin(Request $request): void
    {
        $origin = $request->header('Origin');

        if (
            $origin === null
            || !hash_equals(
                strtolower(rtrim($this->siteOrigin(), '/')),
                strtolower(rtrim($origin, '/')),
            )
        ) {
            throw new ApiException('csrf_failed', 'İstek kaynağı doğrulanamadı.', 403);
        }
    }

    /**
     * @param array{userId: string, csrfToken: string, expiresAt: string} $session
     */
    private function requireCsrf(Request $request, array $session): void
    {
        $provided = $request->header('X-CSRF-Token') ?? '';

        if ($provided === '' || !hash_equals($session['csrfToken'], $provided)) {
            throw new ApiException('csrf_failed', 'Oturum doğrulaması başarısız.', 403);
        }
    }

    /**
     * @return array{userId: string, csrfToken: string, expiresAt: string}
     */
    private function currentSession(Request $request): array
    {
        $token = $this->sessions()->tokenFrom($request);
        $session = $token !== null ? $this->sessions()->validate($token) : null;

        if ($session === null) {
            throw new ApiException(
                'unauthenticated',
                'Oturum bulunamadı veya süresi dolmuş.',
                401,
            );
        }

        return $session;
    }

    private function health(Request $request): Response
    {
        return Response::json([
            'ok' => true,
            'serverTime' => Clock::iso(),
        ]);
    }

    private function register(Request $request): Response
    {
        $result = $this->auth()->register($request->json(), $request);

        return Response::json(
            ['user' => $result['user'], 'csrfToken' => $result['session']['csrfToken']],
            201,
            ['Set-Cookie' => $this->sessions()->cookie($result['session'], $request)],
        );
    }

    private function login(Request $request): Response
    {
        $result = $this->auth()->login($request->json(), $request);

        return Response::json(
            ['user' => $result['user'], 'csrfToken' => $result['session']['csrfToken']],
            200,
            ['Set-Cookie' => $this->sessions()->cookie($result['session'], $request)],
        );
    }

    private function logout(Request $request): Response
    {
        $this->auth()->logout($request);

        return Response::json(
            ['ok' => true],
            200,
            ['Set-Cookie' => $this->sessions()->clearCookie($request)],
        );
    }

    private function session(Request $request): Response
    {
        $token = $this->sessions()->tokenFrom($request);
        $session = $token !== null ? $this->auth()->session($token) : null;

        if ($session === null) {
            throw new ApiException(
                'unauthenticated',
                'Oturum bulunamadı veya süresi dolmuş.',
                401,
            );
        }

        return Response::json($session);
    }

    private function updateProfile(Request $request): Response
    {
        $session = $this->currentSession($request);

        return Response::json([
            'user' => $this->auth()->updateProfile($session['userId'], $request->json()),
        ]);
    }

    private function changePassword(Request $request): Response
    {
        $session = $this->currentSession($request);
        $input = $request->json();

        $rotated = $this->auth()->changePassword(
            $session['userId'],
            is_string($input['currentPassword'] ?? null) ? $input['currentPassword'] : '',
            is_string($input['newPassword'] ?? null) ? $input['newPassword'] : '',
            (string) $this->sessions()->tokenFrom($request),
            $request,
        );

        return Response::json(
            ['ok' => true],
            200,
            ['Set-Cookie' => $this->sessions()->cookie($rotated, $request)],
        );
    }

    private function addRoute(string $method, string $path, callable $handler): void
    {
        $this->registered[$method . ' ' . $path] = true;
        $this->router->add($method, $path, $handler);
    }

    private function database(): Database
    {
        if ($this->database === null) {
            $config = $this->config['db'] ?? null;
            $this->database = Database::connect(is_array($config) ? $config : []);
        }

        return $this->database;
    }

    private function sessions(): SessionService
    {
        return $this->sessions ??= new SessionService($this->database(), $this->config);
    }

    private function rateLimiter(): RateLimiter
    {
        return $this->rateLimiter ??= new RateLimiter($this->database());
    }

    private function auth(): AuthService
    {
        return $this->auth ??= new AuthService(
            $this->database(),
            $this->sessions(),
            $this->rateLimiter(),
            $this->config,
        );
    }

    private function siteOrigin(): string
    {
        $app = $this->config['app'] ?? null;
        $baseUrl = is_array($app) ? ($app['base_url'] ?? null) : null;

        return is_string($baseUrl) && $baseUrl !== '' ? $baseUrl : self::DEFAULT_ORIGIN;
    }
}
