<?php

declare(strict_types=1);

namespace Kocluk\Api\Http;

use InvalidArgumentException;
use Kocluk\Api\Support\Json;

/**
 * Immutable JSON response.
 *
 * Every response carries the API security headers; callers can add or override
 * headers (Allow, Retry-After, Set-Cookie, ...) case-insensitively.
 */
final class Response
{
    /** @var array<string, string> */
    private const DEFAULT_HEADERS = [
        'Content-Type' => 'application/json; charset=utf-8',
        'X-Content-Type-Options' => 'nosniff',
        'Referrer-Policy' => 'strict-origin-when-cross-origin',
        'X-Frame-Options' => 'DENY',
        'Cache-Control' => 'no-store',
    ];

    /**
     * @param array<string, string> $headers
     */
    private function __construct(
        private readonly string $body,
        private readonly int $status,
        private readonly array $headers,
    ) {
    }

    /**
     * @param array<string, mixed> $data
     * @param array<string, string> $headers
     */
    public static function json(array $data, int $status = 200, array $headers = []): self
    {
        if ($status < 100 || $status > 599) {
            throw new InvalidArgumentException(
                'HTTP durum kodu 100 ile 599 arasında olmalı: ' . $status,
            );
        }

        $merged = self::DEFAULT_HEADERS;

        foreach ($headers as $name => $value) {
            foreach (array_keys($merged) as $existing) {
                if (strcasecmp($existing, $name) === 0) {
                    unset($merged[$existing]);
                }
            }

            $merged[$name] = $value;
        }

        return new self(Json::encode($data), $status, $merged);
    }

    public function status(): int
    {
        return $this->status;
    }

    public function body(): string
    {
        return $this->body;
    }

    /**
     * @return array<string, string>
     */
    public function headers(): array
    {
        return $this->headers;
    }

    public function header(string $name): ?string
    {
        foreach ($this->headers as $header => $value) {
            if (strcasecmp($header, $name) === 0) {
                return $value;
            }
        }

        return null;
    }

    public function send(): void
    {
        if (!headers_sent()) {
            http_response_code($this->status);

            foreach ($this->headers as $name => $value) {
                header($name . ': ' . $value, true);
            }
        }

        echo $this->body;
    }
}
