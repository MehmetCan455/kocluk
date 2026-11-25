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
 *
 * Header values are kept as ordered lists so one response can carry several
 * Set-Cookie headers (for example a rotated session cookie plus a clearing
 * cookie). A string value is shorthand for a one-element list.
 */
final class Response
{
    /** @var array<string, string> */
    private const DEFAULT_HEADERS = [
        'Content-Type' => 'application/json; charset=utf-8',
        'X-Content-Type-Options' => 'nosniff',
        'Referrer-Policy' => 'strict-origin-when-cross-origin',
        'X-Frame-Options' => 'DENY',
        'Strict-Transport-Security' => 'max-age=31536000',
        'Cache-Control' => 'no-store',
    ];

    /**
     * @param array<string, list<string>> $headers
     */
    private function __construct(
        private readonly string $body,
        private readonly int $status,
        private readonly array $headers,
    ) {
    }

    /**
     * @param array<string, mixed> $data
     * @param array<string, string|list<string>> $headers
     */
    public static function json(array $data, int $status = 200, array $headers = []): self
    {
        if ($status < 100 || $status > 599) {
            throw new InvalidArgumentException(
                'HTTP durum kodu 100 ile 599 arasında olmalı: ' . $status,
            );
        }

        /** @var array<string, list<string>> $merged */
        $merged = [];

        foreach (self::DEFAULT_HEADERS as $name => $value) {
            $merged[$name] = [$value];
        }

        foreach ($headers as $name => $value) {
            foreach (array_keys($merged) as $existing) {
                if (strcasecmp($existing, $name) === 0) {
                    unset($merged[$existing]);
                }
            }

            $merged[$name] = is_array($value)
                ? array_values(array_map(static fn (mixed $item): string => (string) $item, $value))
                : [$value];
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
     * Header name => all of its values.
     *
     * @return array<string, list<string>>
     */
    public function headers(): array
    {
        return $this->headers;
    }

    /**
     * All values of a header, matched case-insensitively.
     *
     * @return list<string>
     */
    public function headerValues(string $name): array
    {
        foreach ($this->headers as $header => $values) {
            if (strcasecmp($header, $name) === 0) {
                return $values;
            }
        }

        return [];
    }

    /**
     * First value of a header, or null when it is absent.
     */
    public function header(string $name): ?string
    {
        return $this->headerValues($name)[0] ?? null;
    }

    /**
     * Every Set-Cookie header value, in the order it will be sent.
     *
     * @return list<string>
     */
    public function cookies(): array
    {
        return $this->headerValues('Set-Cookie');
    }

    public function send(): void
    {
        if (!headers_sent()) {
            http_response_code($this->status);

            foreach ($this->headers as $name => $values) {
                $replace = true;

                foreach ($values as $value) {
                    header($name . ': ' . $value, $replace);
                    $replace = false;
                }
            }
        }

        echo $this->body;
    }
}
