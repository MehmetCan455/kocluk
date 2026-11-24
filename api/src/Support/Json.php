<?php

declare(strict_types=1);

namespace Kocluk\Api\Support;

use JsonException;

/**
 * JSON encoding/decoding and the API error envelope.
 *
 * All responses are UTF-8 JSON with unescaped slashes; Turkish characters are
 * written as-is. A request body that is not a JSON object/array is rejected as
 * invalid_json (400) so callers always receive an array.
 */
final class Json
{
    public static function encode(mixed $data): string
    {
        return json_encode(
            $data,
            JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES | JSON_THROW_ON_ERROR,
        );
    }

    /**
     * @return array<string, mixed>
     */
    public static function decode(string $json): array
    {
        try {
            $decoded = json_decode($json, true, 64, JSON_THROW_ON_ERROR);
        } catch (JsonException) {
            throw new ApiException('invalid_json', 'İstek gövdesi geçerli JSON değil.', 400);
        }

        if (!is_array($decoded)) {
            throw new ApiException('invalid_json', 'İstek gövdesi bir JSON nesnesi olmalı.', 400);
        }

        /** @var array<string, mixed> $decoded */
        return $decoded;
    }

    /**
     * @return array{error: array{code: string, message: string}}
     */
    public static function error(string $code, string $message): array
    {
        return ['error' => ['code' => $code, 'message' => $message]];
    }
}
