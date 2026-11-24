<?php

declare(strict_types=1);

namespace Kocluk\Api\Sync;

use InvalidArgumentException;

/**
 * A row that cannot be mapped or written.
 *
 * Carries the machine-readable code the push route reports (validation_failed,
 * invalid_timestamp or unknown_table) so the HTTP layer never has to guess
 * from an exception message. Messages only name fields, never values.
 */
final class InvalidRowValue extends InvalidArgumentException
{
    public function __construct(
        public readonly string $errorCode,
        string $message,
    ) {
        parent::__construct($message);
    }
}
