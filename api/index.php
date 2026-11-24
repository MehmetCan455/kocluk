<?php

declare(strict_types=1);

/**
 * Front controller for https://zirveacademy.com/api/*.
 *
 * .htaccess rewrites every /api request here. Configuration is loaded from
 * outside public_html (KOCLUK_CONFIG or /home/u2964068/kocluk-config.php), so
 * the repository never contains real credentials. Error output is disabled and
 * details go to a log file next to the configuration; the client only ever
 * sees the JSON error envelope.
 */

use Kocluk\Api\App;
use Kocluk\Api\Http\Request;
use Kocluk\Api\Support\ApiException;
use Kocluk\Api\Support\ConfigFile;

ini_set('display_errors', '0');
ini_set('log_errors', '1');
date_default_timezone_set('UTC');

require __DIR__ . '/src/bootstrap.php';

try {
    // Same candidate order as api/bin/migrate.php (src/Support/ConfigFile.php):
    // KOCLUK_CONFIG, then the file outside public_html, then api/config.php.
    $configPath = ConfigFile::path(__DIR__);

    if ($configPath === null) {
        throw new RuntimeException('Kocluk yapılandırması bulunamadı (KOCLUK_CONFIG).');
    }

    $config = require $configPath;

    if (!is_array($config)) {
        throw new RuntimeException('Yapılandırma bir dizi döndürmeli: ' . $configPath);
    }

    $appConfig = is_array($config['app'] ?? null) ? $config['app'] : [];
    $logFile = $appConfig['log_file'] ?? dirname($configPath) . '/kocluk-api-error.log';

    if (is_string($logFile) && $logFile !== '') {
        ini_set('error_log', $logFile);
    }

    $app = new App(null, $config);

    $response = $app->handle(Request::fromGlobals());
} catch (ApiException $error) {
    // Expected request failure (bad JSON, oversized body, ...): no logging.
    $response = App::errorResponse($error);
} catch (Throwable $error) {
    // Unexpected failure: log class, message and location only. Request
    // bodies, headers and credentials are never logged.
    error_log(sprintf(
        'kocluk-api %s: %s in %s:%d',
        $error::class,
        $error->getMessage(),
        $error->getFile(),
        $error->getLine(),
    ));

    $response = App::errorResponse();
}

$response->send();
