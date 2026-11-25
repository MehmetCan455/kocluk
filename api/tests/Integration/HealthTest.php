<?php

declare(strict_types=1);

namespace Kocluk\Api\Tests\Integration;

use DateTimeImmutable;
use Kocluk\Api\App;
use Kocluk\Api\Http\Request;
use Kocluk\Api\Support\ApiException;
use PHPUnit\Framework\TestCase;
use RuntimeException;

final class HealthTest extends TestCase
{
    public function test_health_returns_ok_and_an_iso_server_time(): void
    {
        $response = $this->app()->handle(Request::create('GET', '/api/health'));
        $payload = $this->payload($response->body());

        self::assertSame(200, $response->status());
        self::assertSame(['ok', 'serverTime', 'environment'], array_keys($payload));
        self::assertTrue($payload['ok']);
        self::assertSame('test', $payload['environment']);

        $serverTime = (string) $payload['serverTime'];

        self::assertMatchesRegularExpression(
            '/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{6}Z$/',
            $serverTime,
        );

        $parsed = new DateTimeImmutable($serverTime);

        self::assertSame(0, $parsed->getOffset());
        self::assertLessThanOrEqual(5, abs($parsed->getTimestamp() - time()));
    }

    public function test_staging_health_reports_the_staging_database(): void
    {
        $engine = new App(null, [
            'app' => ['env' => 'staging'],
            'db' => ['database' => 'u2964068_staging'],
        ]);

        $response = $engine->handle(Request::create('GET', '/api/health'));
        $payload = $this->payload($response->body());

        self::assertSame(200, $response->status());
        self::assertSame('staging', $payload['environment']);
        self::assertSame('u2964068_staging', $payload['database']);
    }

    public function test_front_controller_refuses_staging_env_with_a_production_database(): void
    {
        $configPath = $this->configFile([
            'app' => ['env' => 'staging'],
            'db' => ['database' => 'u2964068_kocluk'],
        ]);

        try {
            $result = $this->runFrontController($configPath, 'GET', '/api/health');
        } finally {
            @unlink($configPath);
        }

        self::assertSame(0, $result['exit'], $result['stderr']);

        $payload = $this->payload($result['stdout']);

        self::assertSame('internal_error', $payload['error']['code']);
        self::assertStringNotContainsString('u2964068_kocluk', $result['stdout']);
    }

    public function test_health_carries_json_and_security_headers(): void
    {
        $response = $this->app()->handle(Request::create('GET', '/api/health'));

        self::assertSame('application/json; charset=utf-8', $response->header('Content-Type'));
        self::assertSame('nosniff', $response->header('X-Content-Type-Options'));
        self::assertSame('strict-origin-when-cross-origin', $response->header('Referrer-Policy'));
        self::assertSame('DENY', $response->header('X-Frame-Options'));
        self::assertSame('no-store', $response->header('Cache-Control'));
    }

    public function test_health_is_served_by_the_real_front_controller(): void
    {
        $configPath = $this->configFile(['app' => ['env' => 'test']]);

        try {
            $result = $this->runFrontController($configPath, 'GET', '/api/health');
        } finally {
            @unlink($configPath);
        }

        self::assertSame('', $result['stderr']);
        self::assertSame(0, $result['exit'], $result['stderr']);
        self::assertStringNotContainsString('Warning', $result['stdout']);
        self::assertStringNotContainsString('Deprecated', $result['stdout']);
        self::assertStringNotContainsString('Fatal error', $result['stdout']);

        $payload = $this->payload($result['stdout']);

        self::assertTrue($payload['ok']);
        self::assertArrayHasKey('serverTime', $payload);
    }

    public function test_unknown_route_returns_404_without_internals(): void
    {
        $response = $this->app()->handle(Request::create('GET', '/api/does-not-exist'));
        $payload = $this->payload($response->body());

        self::assertSame(404, $response->status());
        self::assertSame('not_found', $payload['error']['code']);
        self::assertArrayNotHasKey('trace', $payload);
        self::assertArrayNotHasKey('file', $payload['error']);
        self::assertStringNotContainsString('index.php', $response->body());
    }

    public function test_wrong_method_returns_405_with_allow(): void
    {
        $response = $this->app()->handle(Request::create('POST', '/api/health'));
        $payload = $this->payload($response->body());

        self::assertSame(405, $response->status());
        self::assertSame('GET', $response->header('Allow'));
        self::assertSame('method_not_allowed', $payload['error']['code']);
    }

    public function test_api_exception_keeps_status_code_and_headers(): void
    {
        $response = App::errorResponse(
            new ApiException('validation_failed', 'E-posta zorunlu.', 422, ['Retry-After' => '5']),
        );
        $payload = $this->payload($response->body());

        self::assertSame(422, $response->status());
        self::assertSame('validation_failed', $payload['error']['code']);
        self::assertSame('E-posta zorunlu.', $payload['error']['message']);
        self::assertSame('5', $response->header('Retry-After'));
        self::assertSame('no-store', $response->header('Cache-Control'));
    }

    public function test_unexpected_throwable_becomes_a_generic_500(): void
    {
        $secret = 'db-password-should-never-leak';

        $response = App::errorResponse(new RuntimeException('Connection failed: ' . $secret));
        $payload = $this->payload($response->body());

        self::assertSame(500, $response->status());
        self::assertSame('internal_error', $payload['error']['code']);
        self::assertStringNotContainsString($secret, $response->body());
        self::assertStringNotContainsString('RuntimeException', $response->body());
        self::assertSame('no-store', $response->header('Cache-Control'));
    }

    public function test_invalid_config_returns_a_generic_500_from_the_front_controller(): void
    {
        $configPath = $this->configFile('not-an-array');

        try {
            $result = $this->runFrontController($configPath, 'GET', '/api/health');
        } finally {
            @unlink($configPath);
        }

        self::assertSame(0, $result['exit'], $result['stderr']);

        $payload = $this->payload($result['stdout']);

        self::assertSame('internal_error', $payload['error']['code']);
        self::assertStringNotContainsString('not-an-array', $result['stdout']);
        self::assertStringNotContainsString($configPath, $result['stdout']);
    }

    private function app(): App
    {
        return new App(null, ['app' => ['env' => 'test']]);
    }

    /**
     * @return array<string, mixed>
     */
    private function payload(string $body): array
    {
        $payload = json_decode($body, true, 512, JSON_THROW_ON_ERROR);

        self::assertIsArray($payload);

        /** @var array<string, mixed> $payload */
        return $payload;
    }

    private function configFile(mixed $config): string
    {
        $path = tempnam(sys_get_temp_dir(), 'kocluk-config-');
        self::assertNotFalse($path);
        self::assertNotFalse(file_put_contents($path, '<?php return ' . var_export($config, true) . ";\n"));
        @chmod($path, 0600);

        return $path;
    }

    /**
     * Runs api/index.php through a tiny wrapper that supplies the web server
     * variables (CLI does not populate REQUEST_URI/REQUEST_METHOD itself).
     *
     * @return array{exit: int, stdout: string, stderr: string}
     */
    private function runFrontController(string $configPath, string $method, string $uri): array
    {
        $wrapper = tempnam(sys_get_temp_dir(), 'kocluk-request-');
        self::assertNotFalse($wrapper);

        $script = "<?php\n"
            . '$_SERVER["REQUEST_METHOD"] = ' . var_export($method, true) . ";\n"
            . '$_SERVER["REQUEST_URI"] = ' . var_export($uri, true) . ";\n"
            . '$_SERVER["REMOTE_ADDR"] = "127.0.0.1";' . "\n"
            . 'require ' . var_export(dirname(__DIR__, 2) . '/index.php', true) . ";\n";

        self::assertNotFalse(file_put_contents($wrapper, $script));

        $command = escapeshellarg(PHP_BINARY) . ' ' . escapeshellarg($wrapper);

        $descriptors = [
            1 => ['pipe', 'w'],
            2 => ['pipe', 'w'],
        ];

        $process = proc_open(
            $command,
            $descriptors,
            $pipes,
            null,
            array_merge(getenv(), ['KOCLUK_CONFIG' => $configPath]),
        );

        self::assertIsResource($process);

        try {
            $stdout = (string) stream_get_contents($pipes[1]);
            $stderr = (string) stream_get_contents($pipes[2]);
            fclose($pipes[1]);
            fclose($pipes[2]);
            $exit = proc_close($process);
        } finally {
            @unlink($wrapper);
        }

        return ['exit' => $exit, 'stdout' => $stdout, 'stderr' => $stderr];
    }
}
