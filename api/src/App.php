<?php

declare(strict_types=1);

namespace Kocluk\Api;

use Kocluk\Api\Account\AccountService;
use Kocluk\Api\Auth\AuthService;
use Kocluk\Api\Auth\PasswordResetService;
use Kocluk\Api\Auth\RateLimiter;
use Kocluk\Api\Auth\SessionService;
use Kocluk\Api\Db\Database;
use Kocluk\Api\Http\Request;
use Kocluk\Api\Http\Response;
use Kocluk\Api\Http\Router;
use Kocluk\Api\Mail\DeferredMailer;
use Kocluk\Api\Mail\Mailer;
use Kocluk\Api\Mail\PhpMailerMailer;
use Kocluk\Api\Mail\Templates;
use Kocluk\Api\Support\ApiException;
use Kocluk\Api\Support\Clock;
use Kocluk\Api\Support\Json;
use Kocluk\Api\Sync\ChangeLog;
use Kocluk\Api\Sync\SyncService;
use Throwable;

/**
 * HTTP application.
 *
 * Owns the router and the auth services. The database is injected by tests and
 * lazily opened from config in production, so construction never touches
 * MariaDB: the health route keeps answering while the database is down.
 *
 * CSRF policy (spec §7.2): every state-changing request to a registered route
 * needs a valid session and an X-CSRF-Token that matches it. Public auth
 * writes (register, login, forgot/reset password, verify e-mail) also work
 * without a session, but then require an Origin header equal to the
 * configured site origin. Unknown paths and wrong verbs are left to the
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
     * Design §7.3: a general 300 requests/hour/IP ceiling on top of the
     * narrower per-route limits. Health is exempt so the load balancer can
     * still probe the API while the database is unavailable.
     */
    private const GENERAL_RATE_LIMIT = 300;

    private const GENERAL_RATE_WINDOW_SECONDS = 3600;

    private const GENERAL_RATE_EXEMPT_PATHS = ['/api/health'];

    /**
     * Writes that must work before a session exists. When the browser is
     * already signed in they still require the CSRF token.
     */
    private const PUBLIC_WRITES = [
        '/api/auth/register',
        '/api/auth/login',
        '/api/auth/forgot-password',
        '/api/auth/reset-password',
        '/api/auth/verify-email',
    ];

    private const DEFAULT_ORIGIN = 'https://zirveacademy.com';

    private readonly Router $router;

    private ?Database $database;

    private ?SessionService $sessions = null;

    private ?RateLimiter $rateLimiter = null;

    private ?AuthService $auth = null;

    private ?DeferredMailer $mailer;

    private ?Templates $templates = null;

    private ?PasswordResetService $passwordResets = null;

    private ?AccountService $accounts = null;

    private ?SyncService $sync = null;

    /** @var array<string, true> registered "METHOD /path" pairs */
    private array $registered = [];

    /**
     * @param array<string, mixed> $config
     */
    public function __construct(
        ?Database $database = null,
        private readonly array $config = [],
        ?Mailer $mailer = null,
    ) {
        $this->database = $database;
        $this->mailer = $mailer instanceof DeferredMailer
            ? $mailer
            : ($mailer !== null ? new DeferredMailer($mailer, true) : null);
        $this->router = new Router();

        $this->addRoute('GET', '/api/health', $this->health(...));
        $this->addRoute('POST', '/api/auth/register', $this->register(...));
        $this->addRoute('POST', '/api/auth/login', $this->login(...));
        $this->addRoute('POST', '/api/auth/logout', $this->logout(...));
        $this->addRoute('GET', '/api/auth/session', $this->session(...));
        $this->addRoute('POST', '/api/auth/update-profile', $this->updateProfile(...));
        $this->addRoute('POST', '/api/auth/change-password', $this->changePassword(...));
        $this->addRoute('POST', '/api/auth/forgot-password', $this->forgotPassword(...));
        $this->addRoute('POST', '/api/auth/reset-password', $this->resetPassword(...));
        $this->addRoute('POST', '/api/auth/verify-email', $this->verifyEmail(...));
        $this->addRoute('POST', '/api/auth/delete-account', $this->deleteAccount(...));
        $this->addRoute('GET', '/api/account/export', $this->exportAccount(...));
        $this->addRoute('POST', '/api/sync/push', $this->syncPush(...));
        $this->addRoute('GET', '/api/sync/pull', $this->syncPull(...));
        $this->addRoute('GET', '/api/sync/status', $this->syncStatus(...));
        $this->addRoute('GET', '/api/sync/full', $this->syncFull(...));
    }

    public function handle(Request $request): Response
    {
        try {
            // Unknown paths and wrong verbs keep their stateless 404/405
            // behaviour; the general budget protects the real API surface.
            if (
                !in_array($request->path, self::GENERAL_RATE_EXEMPT_PATHS, true)
                && isset($this->registered[$request->method . ' ' . $request->path])
            ) {
                $this->rateLimiter()->assert(
                    'general',
                    $request->ip,
                    self::GENERAL_RATE_LIMIT,
                    self::GENERAL_RATE_WINDOW_SECONDS,
                );
            }

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
        $app = is_array($this->config['app'] ?? null) ? $this->config['app'] : [];
        $environment = is_string($app['env'] ?? null) && $app['env'] !== ''
            ? $app['env']
            : 'production';

        $payload = [
            'ok' => true,
            'serverTime' => Clock::iso(),
            'environment' => $environment,
        ];

        // Non-production health output is the staging smoke check: it proves
        // the web request loaded the staging config and its database, without
        // exposing any production database name.
        if ($environment === 'staging') {
            $db = is_array($this->config['db'] ?? null) ? $this->config['db'] : [];
            $payload['database'] = is_string($db['database'] ?? null)
                ? $db['database']
                : '';
        }

        return Response::json($payload);
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

        $result = $this->auth()->changePassword(
            $session['userId'],
            is_string($input['currentPassword'] ?? null) ? $input['currentPassword'] : '',
            is_string($input['newPassword'] ?? null) ? $input['newPassword'] : '',
            (string) $this->sessions()->tokenFrom($request),
            $request,
        );

        return Response::json(
            ['user' => $result['user'], 'csrfToken' => $result['session']['csrfToken']],
            200,
            ['Set-Cookie' => $this->sessions()->cookie($result['session'], $request)],
        );
    }

    private function forgotPassword(Request $request): Response
    {
        $input = $request->json();

        $this->passwordResets()->request(
            is_string($input['email'] ?? null) ? $input['email'] : '',
            $request,
        );

        // Same 202 whether or not the address exists, and even when the mail
        // transport failed; enumeration must stay impossible.
        return Response::json(['ok' => true], 202);
    }

    private function resetPassword(Request $request): Response
    {
        $input = $request->json();

        $this->passwordResets()->reset(
            is_string($input['token'] ?? null) ? $input['token'] : '',
            is_string($input['password'] ?? null) ? $input['password'] : '',
            $request,
        );

        // Every session was revoked, including this browser's.
        return Response::json(
            ['ok' => true],
            200,
            ['Set-Cookie' => $this->sessions()->clearCookie($request)],
        );
    }

    private function verifyEmail(Request $request): Response
    {
        $input = $request->json();

        $this->auth()->verifyEmail(
            is_string($input['token'] ?? null) ? $input['token'] : '',
            $request,
        );

        return Response::json(['ok' => true]);
    }

    private function deleteAccount(Request $request): Response
    {
        $session = $this->currentSession($request);
        $input = $request->json();

        $this->accounts()->delete(
            $session['userId'],
            is_string($input['password'] ?? null) ? $input['password'] : '',
        );

        // Every session row is gone; drop the browser cookie as well so a
        // stale token is not retried on the next request.
        return Response::json(
            ['ok' => true],
            200,
            ['Set-Cookie' => $this->sessions()->clearCookie($request)],
        );
    }

    /**
     * JSON download of the signed-in user's data (KVKK, spec §11).
     *
     * A GET needs no CSRF token; the HttpOnly session cookie authenticates it.
     */
    private function exportAccount(Request $request): Response
    {
        $session = $this->currentSession($request);

        return Response::json(
            $this->accounts()->export($session['userId']),
            200,
            [
                'Content-Disposition' => sprintf(
                    'attachment; filename="kocluk-hesap-%s.json"',
                    gmdate('Y-m-d'),
                ),
            ],
        );
    }

    /**
     * Applies a batch of offline changes (spec §8.2).
     *
     * The session and CSRF token are already checked by guard(); this handler
     * adds the per-user hourly budget and delegates the row-level work.
     */
    private function syncPush(Request $request): Response
    {
        $session = $this->currentSession($request);

        $this->rateLimiter()->assert(
            SyncService::rateLimitBucket($session['userId']),
            null,
            SyncService::RATE_LIMIT,
            SyncService::RATE_WINDOW_SECONDS,
            $session['userId'],
        );

        return Response::json(
            $this->sync()->push($session['userId'], $request->json()),
        );
    }

    /**
     * Incremental pull from the last sync_changes id the client applied
     * (spec §8.3). A GET needs no CSRF token; the session cookie authenticates
     * it.
     */
    private function syncPull(Request $request): Response
    {
        $session = $this->currentSession($request);

        $this->rateLimiter()->assert(
            SyncService::pullRateLimitBucket($session['userId']),
            null,
            SyncService::PULL_RATE_LIMIT,
            SyncService::RATE_WINDOW_SECONDS,
            $session['userId'],
        );

        return Response::json($this->sync()->pull(
            $session['userId'],
            self::queryInteger($request, 'since'),
            self::queryInteger($request, 'limit') ?? SyncService::PULL_LIMIT,
        ));
    }

    /**
     * Account data status for the migration gate (spec §8.5).
     */
    private function syncStatus(Request $request): Response
    {
        $session = $this->currentSession($request);

        $this->rateLimiter()->assert(
            SyncService::statusRateLimitBucket($session['userId']),
            null,
            SyncService::STATUS_RATE_LIMIT,
            SyncService::RATE_WINDOW_SECONDS,
            $session['userId'],
        );

        return Response::json($this->sync()->status($session['userId']));
    }

    /**
     * Complete snapshot for a client whose cursor expired (spec §8.5).
     */
    private function syncFull(Request $request): Response
    {
        $session = $this->currentSession($request);

        $this->rateLimiter()->assert(
            SyncService::fullRateLimitBucket($session['userId']),
            null,
            SyncService::FULL_RATE_LIMIT,
            SyncService::RATE_WINDOW_SECONDS,
            $session['userId'],
        );

        return Response::json($this->sync()->full($session['userId']));
    }

    /**
     * Optional non-negative integer query parameter; null when absent.
     */
    private static function queryInteger(Request $request, string $name): ?int
    {
        $value = $request->query($name);

        if ($value === null || $value === '') {
            return null;
        }

        // ASCII digits only, so "-1", "1.5" and "1e3" are all rejected.
        if (preg_match('/^\d{1,18}$/', $value) !== 1) {
            throw new ApiException(
                'validation_failed',
                $name . ' negatif olmayan bir tam sayı olmalı.',
                422,
            );
        }

        return (int) $value;
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
            $this->mailer(),
            $this->templates(),
            $this->config,
        );
    }

    private function passwordResets(): PasswordResetService
    {
        return $this->passwordResets ??= new PasswordResetService(
            $this->database(),
            $this->sessions(),
            $this->rateLimiter(),
            $this->mailer(),
            $this->templates(),
        );
    }

    private function accounts(): AccountService
    {
        return $this->accounts ??= new AccountService($this->database());
    }

    private function sync(): SyncService
    {
        return $this->sync ??= new SyncService(
            $this->database(),
            new ChangeLog($this->database()),
            $this->fullPayloadLimit(),
        );
    }

    /**
     * Optional tuning for the full-snapshot guard; defaults to the 20 MB the
     * spec requires. Tests lower it instead of building a 20 MB fixture.
     */
    private function fullPayloadLimit(): int
    {
        $sync = $this->config['sync'] ?? null;
        $limit = is_array($sync) ? ($sync['full_max_bytes'] ?? null) : null;

        return is_int($limit) && $limit > 0 ? $limit : SyncService::MAX_FULL_PAYLOAD_BYTES;
    }

    private function mailer(): DeferredMailer
    {
        return $this->mailer ??= new DeferredMailer(new PhpMailerMailer($this->config));
    }

    private function templates(): Templates
    {
        return $this->templates ??= new Templates($this->appUrl());
    }

    private function siteOrigin(): string
    {
        return $this->appUrl();
    }

    /**
     * Public URL of the SPA. config.app_url wins; app.base_url is the older
     * key and stays a fallback so existing configurations keep working.
     */
    private function appUrl(): string
    {
        $configured = $this->config['app_url'] ?? null;

        if (is_string($configured) && trim($configured) !== '') {
            return trim($configured);
        }

        $app = $this->config['app'] ?? null;
        $baseUrl = is_array($app) ? ($app['base_url'] ?? null) : null;

        return is_string($baseUrl) && trim($baseUrl) !== ''
            ? trim($baseUrl)
            : self::DEFAULT_ORIGIN;
    }
}
