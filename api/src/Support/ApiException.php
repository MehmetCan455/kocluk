<?php

declare(strict_types=1);

namespace Kocluk\Api\Support;

use InvalidArgumentException;
use RuntimeException;
use Throwable;

/**
 * Expected HTTP failure.
 *
 * Carries the machine-readable code and HTTP status that the front controller
 * turns into { "error": { "code", "message" } }. Messages are user-facing:
 * never put secrets, tokens or stack details here. Unexpected failures are
 * logged by the front controller and reported as a generic internal_error.
 */
final class ApiException extends RuntimeException
{
    /**
     * @param array<string, string> $headers extra response headers (Retry-After, Allow, ...)
     */
    public function __construct(
        public readonly string $errorCode,
        string $message,
        public readonly int $status = 400,
        public readonly array $headers = [],
        ?Throwable $previous = null,
    ) {
        if ($status < 400 || $status > 599) {
            throw new InvalidArgumentException(
                'ApiException durum kodu 400 ile 599 arasında olmalı: ' . $status,
            );
        }

        parent::__construct($message, 0, $previous);
    }
}
