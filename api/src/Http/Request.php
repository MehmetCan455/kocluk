<?php

declare(strict_types=1);

namespace Kocluk\Api\Http;

use Kocluk\Api\Support\ApiException;
use Kocluk\Api\Support\Json;

/**
 * Read-only HTTP request built from the PHP superglobals.
 *
 * The client IP is always REMOTE_ADDR. X-Forwarded-For is deliberately not
 * trusted: the API runs behind the shared host's front proxy, so a
 * client-supplied header must never decide rate-limit or audit identities.
 *
 * Request bodies are capped at 1 MB by the API design (§8.2); a larger body
 * raises payload_too_large (413).
 */
final class Request
{
    public const MAX_BODY_BYTES = 1048576;

    /**
     * @param array<string, string> $headers lower-case header names
     * @param array<string, string> $cookies
     * @param array<string, string> $query
     */
    private function __construct(
        public readonly string $method,
        public readonly string $path,
        private readonly array $headers,
        private readonly array $cookies,
        private readonly array $query,
        private readonly string $body,
        public readonly string $ip,
        private readonly bool $secure = false,
    ) {
        if (strlen($body) > self::MAX_BODY_BYTES) {
            throw self::bodyTooLarge();
        }
    }

    public static function fromGlobals(): self
    {
        [$path, $query] = self::parseTarget((string) ($_SERVER['REQUEST_URI'] ?? '/'));

        // Reject an oversized upload before reading it into memory. The
        // constructor re-checks the bytes that were actually read.
        if ((int) ($_SERVER['CONTENT_LENGTH'] ?? 0) > self::MAX_BODY_BYTES) {
            throw self::bodyTooLarge();
        }

        $cookies = [];

        foreach ($_COOKIE as $name => $value) {
            if (is_string($value)) {
                $cookies[(string) $name] = $value;
            }
        }

        return new self(
            strtoupper((string) ($_SERVER['REQUEST_METHOD'] ?? 'GET')),
            $path,
            self::collectHeaders(),
            $cookies,
            $query,
            self::readBody(),
            (string) ($_SERVER['REMOTE_ADDR'] ?? ''),
            self::detectSecure(),
        );
    }

    /**
     * Builds a request without touching the superglobals; used by tests and
     * by internal callers.
     *
     * @param array<string, string> $headers
     * @param array<string, string> $cookies
     */
    public static function create(
        string $method,
        string $target,
        array $headers = [],
        string $body = '',
        array $cookies = [],
        string $ip = '127.0.0.1',
        bool $secure = false,
    ): self {
        [$path, $query] = self::parseTarget($target);

        $normalised = [];

        foreach ($headers as $name => $value) {
            $normalised[strtolower($name)] = $value;
        }

        return new self(strtoupper($method), $path, $normalised, $cookies, $query, $body, $ip, $secure);
    }

    /**
     * Whether the request reached PHP over TLS. Session cookies use Secure in
     * production regardless; this covers staging/development over HTTPS.
     */
    public function isSecure(): bool
    {
        return $this->secure;
    }

    /**
     * Decoded JSON object body; an empty body is an empty array.
     *
     * @return array<string, mixed>
     */
    public function json(): array
    {
        if ($this->body === '') {
            return [];
        }

        return Json::decode($this->body);
    }

    public function body(): string
    {
        return $this->body;
    }

    public function header(string $name): ?string
    {
        return $this->headers[strtolower($name)] ?? null;
    }

    public function cookie(string $name): ?string
    {
        return $this->cookies[$name] ?? null;
    }

    public function query(string $name, ?string $default = null): ?string
    {
        return $this->query[$name] ?? $default;
    }

    /**
     * @return array{0: string, 1: array<string, string>}
     */
    private static function parseTarget(string $target): array
    {
        $path = parse_url($target, PHP_URL_PATH);
        $queryString = parse_url($target, PHP_URL_QUERY);

        $query = [];

        if (is_string($queryString) && $queryString !== '') {
            parse_str($queryString, $parsed);

            foreach ($parsed as $name => $value) {
                // Nested arrays are not used by the API; drop them so query()
                // always returns a string.
                if (is_string($value)) {
                    $query[(string) $name] = $value;
                }
            }
        }

        return [is_string($path) && $path !== '' ? $path : '/', $query];
    }

    /**
     * @return array<string, string>
     */
    private static function collectHeaders(): array
    {
        $raw = [];

        if (function_exists('getallheaders')) {
            $headers = getallheaders();

            if (is_array($headers)) {
                foreach ($headers as $name => $value) {
                    if (is_string($value)) {
                        $raw[(string) $name] = $value;
                    }
                }
            }
        }

        if ($raw === []) {
            foreach ($_SERVER as $name => $value) {
                if (!is_string($value)) {
                    continue;
                }

                if (str_starts_with($name, 'HTTP_')) {
                    $raw[str_replace('_', '-', substr($name, 5))] = $value;
                }
            }

            // CONTENT_TYPE and CONTENT_LENGTH have no HTTP_ prefix.
            foreach (['CONTENT_TYPE', 'CONTENT_LENGTH'] as $name) {
                if (isset($_SERVER[$name]) && is_string($_SERVER[$name])) {
                    $raw[str_replace('_', '-', $name)] = $_SERVER[$name];
                }
            }
        }

        $headers = [];

        foreach ($raw as $name => $value) {
            $headers[strtolower($name)] = $value;
        }

        return $headers;
    }

    private static function readBody(): string
    {
        $handle = fopen('php://input', 'rb');

        if ($handle === false) {
            return '';
        }

        // Read one byte past the limit so an oversized body is detectable
        // without buffering the whole upload.
        $body = stream_get_contents($handle, self::MAX_BODY_BYTES + 1);
        fclose($handle);

        return $body === false ? '' : $body;
    }

    /**
     * TLS is reported by the web server itself ($_SERVER['HTTPS'] or the
     * listening port); proxy headers such as X-Forwarded-Proto are not trusted.
     */
    private static function detectSecure(): bool
    {
        $https = $_SERVER['HTTPS'] ?? '';

        if (is_string($https) && $https !== '' && strtolower($https) !== 'off') {
            return true;
        }

        return (int) ($_SERVER['SERVER_PORT'] ?? 0) === 443;
    }

    private static function bodyTooLarge(): ApiException
    {
        return new ApiException(
            'payload_too_large',
            'İstek gövdesi 1 MB sınırını aşıyor.',
            413,
        );
    }
}
