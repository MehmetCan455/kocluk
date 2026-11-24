<?php

declare(strict_types=1);

namespace Kocluk\Api\Sync;

use DateTimeImmutable;
use DateTimeZone;
use JsonException;
use Throwable;

/**
 * The only production table map for synced data (spec §8.1).
 *
 * Public API field names are camelCase, MariaDB columns are snake_case. Every
 * definition declares:
 *   * `table`     physical table
 *   * `owner`     scoping column; never read from the request body
 *   * `ownerKey`  client-side ownership field used only as an assertion
 *   * `pk`        API field that identifies a row
 *   * `columns`   API field => DB column
 *   * `required`  API fields that an upsert must carry
 *   * `immutable` API fields that cannot change after the first insert
 *   * `natural`   DB columns of the active natural key (unique index)
 *
 * The map also drives account export/deletion, so a new synced table cannot be
 * silently missing there. Only public API fields are produced by toApi();
 * `user_id`/`owner_id`, `server_updated_at` and the generated `active_*`
 * columns never leave the server.
 */
final class TableMap
{
    /** Account-level settings only; accent and scheduleMode stay on the device. */
    private const ACCOUNT_SETTINGS = [
        'profileName',
        'examDate',
        'examName',
        'onboardingDone',
        'lastBackupAt',
        'schemaVersion',
        'seedVersion',
        'aytAlan',
        'hiddenSubjects',
        'geometryMode',
    ];

    /** @var array<string, array<string, mixed>> */
    private const TABLES = [
        'subjects' => [
            'table' => 'subjects',
            'owner' => 'user_id',
            'ownerKey' => 'userId',
            'pk' => 'id',
            'columns' => [
                'id' => 'id',
                'seedKey' => 'seed_key',
                'exam' => 'exam',
                'name' => 'name',
                'slug' => 'slug',
                'icon' => 'icon',
                'order' => 'sort_order',
                'updatedAt' => 'updated_at',
                'deletedAt' => 'deleted_at',
            ],
            'required' => ['id', 'seedKey', 'exam', 'name', 'slug', 'icon', 'order', 'updatedAt'],
            'immutable' => ['id', 'seedKey'],
            'natural' => ['seed_key'],
            'timestamps' => ['updatedAt', 'deletedAt'],
            'dates' => [],
            'booleans' => [],
            'integers' => ['order'],
            'decimals' => [],
        ],
        'topics' => [
            'table' => 'topics',
            'owner' => 'user_id',
            'ownerKey' => 'userId',
            'pk' => 'id',
            'columns' => [
                'id' => 'id',
                'seedKey' => 'seed_key',
                'subjectId' => 'subject_id',
                'name' => 'name',
                'order' => 'sort_order',
                'isCustom' => 'is_custom',
                'createdAt' => 'created_at',
                'updatedAt' => 'updated_at',
                'deletedAt' => 'deleted_at',
            ],
            'required' => ['id', 'subjectId', 'name', 'order', 'isCustom', 'createdAt', 'updatedAt'],
            'immutable' => ['id', 'seedKey'],
            'natural' => ['seed_key'],
            'timestamps' => ['createdAt', 'updatedAt', 'deletedAt'],
            'dates' => [],
            'booleans' => ['isCustom'],
            'integers' => ['order'],
            'decimals' => [],
        ],
        'exams' => [
            'table' => 'exams',
            'owner' => 'user_id',
            'ownerKey' => 'userId',
            'pk' => 'id',
            'columns' => [
                'id' => 'id',
                'type' => 'type',
                'name' => 'name',
                'date' => 'date',
                'alan' => 'alan',
                'kind' => 'kind',
                'branch' => 'branch',
                'note' => 'note',
                'createdAt' => 'created_at',
                'updatedAt' => 'updated_at',
                'deletedAt' => 'deleted_at',
            ],
            'required' => ['id', 'type', 'name', 'date', 'note', 'createdAt', 'updatedAt'],
            'immutable' => ['id'],
            'natural' => [],
            'timestamps' => ['createdAt', 'updatedAt', 'deletedAt'],
            'dates' => ['date'],
            'booleans' => [],
            'integers' => [],
            'decimals' => [],
        ],
        'examResults' => [
            'table' => 'exam_results',
            'owner' => 'user_id',
            'ownerKey' => 'userId',
            'pk' => 'id',
            'columns' => [
                'id' => 'id',
                'examId' => 'exam_id',
                'subjectId' => 'subject_id',
                'correct' => 'correct',
                'wrong' => 'wrong',
                'blank' => 'blank',
                'net' => 'net',
                'updatedAt' => 'updated_at',
                'deletedAt' => 'deleted_at',
            ],
            'required' => ['id', 'examId', 'subjectId', 'correct', 'wrong', 'blank', 'net', 'updatedAt'],
            'immutable' => ['id', 'examId', 'subjectId'],
            'natural' => ['exam_id', 'subject_id'],
            'timestamps' => ['updatedAt', 'deletedAt'],
            'dates' => [],
            'booleans' => [],
            'integers' => ['correct', 'wrong', 'blank'],
            'decimals' => ['net'],
        ],
        'notes' => [
            'table' => 'notes',
            'owner' => 'user_id',
            'ownerKey' => 'userId',
            'pk' => 'topicId',
            'columns' => [
                'topicId' => 'topic_id',
                'contentHtml' => 'content_html',
                'plainText' => 'plain_text',
                'updatedAt' => 'updated_at',
                'deletedAt' => 'deleted_at',
            ],
            'required' => ['topicId', 'contentHtml', 'plainText', 'updatedAt'],
            'immutable' => ['topicId'],
            'natural' => [],
            'timestamps' => ['updatedAt', 'deletedAt'],
            'dates' => [],
            'booleans' => [],
            'integers' => [],
            'decimals' => [],
        ],
        'catalogBooks' => [
            'table' => 'catalog_books',
            'owner' => 'owner_id',
            'ownerKey' => 'ownerId',
            'pk' => 'id',
            'columns' => [
                'id' => 'id',
                'title' => 'title',
                'publisher' => 'publisher',
                'exam' => 'exam',
                'subjectSlug' => 'subject_slug',
                'totalPages' => 'total_pages',
                'edition' => 'edition',
                'createdAt' => 'created_at',
                'updatedAt' => 'updated_at',
                'deletedAt' => 'deleted_at',
            ],
            'required' => ['id', 'title', 'totalPages', 'createdAt', 'updatedAt'],
            'immutable' => ['id'],
            'natural' => [],
            'timestamps' => ['createdAt', 'updatedAt', 'deletedAt'],
            'dates' => [],
            'booleans' => [],
            'integers' => ['totalPages'],
            'decimals' => [],
        ],
        'userBooks' => [
            'table' => 'user_books',
            'owner' => 'user_id',
            'ownerKey' => 'userId',
            'pk' => 'id',
            'columns' => [
                'id' => 'id',
                'bookId' => 'book_id',
                'totalPagesOverride' => 'total_pages_override',
                'note' => 'note',
                'status' => 'status',
                'startedAt' => 'started_at',
                'createdAt' => 'created_at',
                'updatedAt' => 'updated_at',
                'deletedAt' => 'deleted_at',
            ],
            'required' => ['id', 'bookId', 'status', 'createdAt', 'updatedAt'],
            'immutable' => ['id', 'bookId'],
            'natural' => ['book_id'],
            'timestamps' => ['startedAt', 'createdAt', 'updatedAt', 'deletedAt'],
            'dates' => [],
            'booleans' => [],
            'integers' => ['totalPagesOverride'],
            'decimals' => [],
        ],
        'activityLogs' => [
            'table' => 'activity_logs',
            'owner' => 'user_id',
            'ownerKey' => 'userId',
            'pk' => 'id',
            'columns' => [
                'id' => 'id',
                'type' => 'type',
                'userBookId' => 'user_book_id',
                'topicId' => 'topic_id',
                'fromPage' => 'from_page',
                'toPage' => 'to_page',
                'taskId' => 'task_id',
                'source' => 'source',
                'createdAt' => 'created_at',
                'deletedAt' => 'deleted_at',
            ],
            'required' => ['id', 'type', 'source', 'createdAt'],
            'immutable' => ['id'],
            'natural' => ['task_id'],
            'timestamps' => ['createdAt', 'deletedAt'],
            'dates' => [],
            'booleans' => [],
            'integers' => ['fromPage', 'toPage'],
            'decimals' => [],
            'insertOnly' => true,
        ],
        'scheduleWeeks' => [
            'table' => 'schedule_weeks',
            'owner' => 'user_id',
            'ownerKey' => 'userId',
            'pk' => 'id',
            'columns' => [
                'id' => 'id',
                'weekStart' => 'week_start',
                'note' => 'note',
                'createdAt' => 'created_at',
                'updatedAt' => 'updated_at',
                'deletedAt' => 'deleted_at',
            ],
            'required' => ['id', 'weekStart', 'note', 'createdAt', 'updatedAt'],
            'immutable' => ['id', 'weekStart'],
            'natural' => ['week_start'],
            'timestamps' => ['createdAt', 'updatedAt', 'deletedAt'],
            'dates' => ['weekStart'],
            'booleans' => [],
            'integers' => [],
            'decimals' => [],
        ],
        'scheduleRows' => [
            'table' => 'schedule_rows',
            'owner' => 'user_id',
            'ownerKey' => 'userId',
            'pk' => 'id',
            'columns' => [
                'id' => 'id',
                'weekId' => 'week_id',
                'subjectId' => 'subject_id',
                'label' => 'label',
                'order' => 'sort_order',
                'createdAt' => 'created_at',
                'updatedAt' => 'updated_at',
                'deletedAt' => 'deleted_at',
            ],
            'required' => ['id', 'weekId', 'label', 'order', 'createdAt', 'updatedAt'],
            'immutable' => ['id'],
            'natural' => [],
            'timestamps' => ['createdAt', 'updatedAt', 'deletedAt'],
            'dates' => [],
            'booleans' => [],
            'integers' => ['order'],
            'decimals' => [],
        ],
        'scheduleTasks' => [
            'table' => 'schedule_tasks',
            'owner' => 'user_id',
            'ownerKey' => 'userId',
            'pk' => 'id',
            'columns' => [
                'id' => 'id',
                'weekId' => 'week_id',
                'rowId' => 'row_id',
                'dayIndex' => 'day_index',
                'type' => 'type',
                'userBookId' => 'user_book_id',
                'fromPage' => 'from_page',
                'toPage' => 'to_page',
                'topicId' => 'topic_id',
                'title' => 'title',
                'completedAt' => 'completed_at',
                'missedAt' => 'missed_at',
                'createdAt' => 'created_at',
                'updatedAt' => 'updated_at',
                'deletedAt' => 'deleted_at',
            ],
            'required' => ['id', 'weekId', 'rowId', 'dayIndex', 'type', 'createdAt', 'updatedAt'],
            'immutable' => ['id'],
            'natural' => [],
            'timestamps' => ['completedAt', 'missedAt', 'createdAt', 'updatedAt', 'deletedAt'],
            'dates' => [],
            'booleans' => [],
            'integers' => ['dayIndex', 'fromPage', 'toPage'],
            'decimals' => [],
        ],
        'topicProgress' => [
            'table' => 'topic_progress',
            'owner' => 'user_id',
            'ownerKey' => 'userId',
            'pk' => 'id',
            'columns' => [
                'id' => 'id',
                'topicId' => 'topic_id',
                'done' => 'done',
                'doneAt' => 'done_at',
                'updatedAt' => 'updated_at',
                'deletedAt' => 'deleted_at',
            ],
            'required' => ['id', 'topicId', 'done', 'updatedAt'],
            'immutable' => ['id', 'topicId'],
            'natural' => ['topic_id'],
            'timestamps' => ['doneAt', 'updatedAt', 'deletedAt'],
            'dates' => [],
            'booleans' => ['done'],
            'integers' => [],
            'decimals' => [],
        ],
        'settings' => [
            'table' => 'user_settings',
            'owner' => 'user_id',
            'ownerKey' => 'userId',
            'pk' => 'userId',
            'columns' => [
                'updatedAt' => 'updated_at',
            ],
            'required' => ['userId', 'updatedAt'],
            'immutable' => ['userId'],
            'natural' => [],
            'timestamps' => ['updatedAt'],
            'dates' => [],
            'booleans' => [],
            'integers' => [],
            'decimals' => [],
            'json' => 'data',
            'settings' => self::ACCOUNT_SETTINGS,
        ],
    ];

    /**
     * @return list<string>
     */
    public static function keys(): array
    {
        return array_keys(self::TABLES);
    }

    public static function has(string $apiKey): bool
    {
        return isset(self::TABLES[$apiKey]);
    }

    /**
     * @return array<string, mixed>
     */
    public static function definition(string $apiKey): array
    {
        if (!isset(self::TABLES[$apiKey])) {
            throw new InvalidRowValue('unknown_table', 'Bilinmeyen tablo: ' . $apiKey);
        }

        return self::TABLES[$apiKey];
    }

    public static function ownerKey(string $apiKey): string
    {
        return (string) self::definition($apiKey)['ownerKey'];
    }

    /**
     * API field that carries the row identity (id, topicId or userId).
     */
    public static function rowId(string $apiKey, array $row): string
    {
        $pk = (string) self::definition($apiKey)['pk'];

        return self::assertRowId($row[$pk] ?? null, $pk);
    }

    public static function assertRowId(mixed $value, string $field = 'id'): string
    {
        if (
            !is_string($value)
            || trim($value) === ''
            || strlen($value) > 36
            || preg_match('/^[A-Za-z0-9_-]+$/', $value) !== 1
        ) {
            throw new InvalidRowValue('validation_failed', 'Geçersiz satır kimliği: ' . $field);
        }

        return $value;
    }

    /**
     * Rejects fields that are not part of the public API row. Called before
     * any row of a push batch is written so a typo cannot partially apply.
     *
     * @param array<string, mixed> $row
     */
    public static function assertFields(string $apiKey, array $row): void
    {
        $allowed = self::allowedFields(self::definition($apiKey));

        foreach (array_keys($row) as $field) {
            $field = (string) $field;

            if (!in_array($field, $allowed, true)) {
                throw new InvalidRowValue('validation_failed', 'Bilinmeyen alan: ' . $field);
            }
        }
    }

    /**
     * API row => DB column values. Optional fields absent from the row are
     * written as NULL because a client row is a full replacement, not a patch.
     *
     * @param array<string, mixed> $row
     * @return array<string, mixed>
     */
    public static function toDb(string $apiKey, array $row): array
    {
        $definition = self::definition($apiKey);

        self::assertFields($apiKey, $row);

        foreach ($definition['required'] as $field) {
            if (!array_key_exists($field, $row)) {
                throw new InvalidRowValue('validation_failed', 'Zorunlu alan eksik: ' . $field);
            }
        }

        $db = [];

        foreach ($definition['columns'] as $field => $column) {
            $field = (string) $field;
            $hasValue = array_key_exists($field, $row);

            $db[$column] = $hasValue
                ? self::toDbValue($column, $row[$field], $definition, $field)
                : null;
        }

        if (isset($definition['json'])) {
            $data = [];

            foreach ($definition['settings'] as $field) {
                if (array_key_exists($field, $row)) {
                    $data[$field] = $row[$field];
                }
            }

            try {
                $db[(string) $definition['json']] = json_encode(
                    $data,
                    JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES | JSON_THROW_ON_ERROR,
                );
            } catch (JsonException) {
                throw new InvalidRowValue('validation_failed', 'Ayarlar JSON olarak yazılamadı.');
            }
        }

        return $db;
    }

    /**
     * DB row => public API fields. Unknown DB columns (server_updated_at,
     * active_* and the ownership column) are not copied.
     *
     * @param array<string, mixed> $row
     * @return array<string, mixed>
     */
    public static function toApi(string $apiKey, array $row): array
    {
        $definition = self::definition($apiKey);

        if (isset($definition['json'])) {
            $api = [];

            $data = [];

            if (isset($row[$definition['json']]) && is_string($row[$definition['json']])) {
                try {
                    $decoded = json_decode(
                        (string) $row[$definition['json']],
                        true,
                        64,
                        JSON_THROW_ON_ERROR,
                    );

                    if (is_array($decoded)) {
                        $data = $decoded;
                    }
                } catch (JsonException) {
                    $data = [];
                }
            }

            foreach ($data as $field => $value) {
                $api[(string) $field] = $value;
            }

            // Identity and LWW fields are server-owned; stored JSON cannot
            // spoof the owner or overwrite the timestamp the client compares.
            $api[(string) $definition['ownerKey']] = (string) ($row[$definition['owner']] ?? '');
            $api['updatedAt'] = self::apiTimestamp($row['updated_at'] ?? null);

            return $api;
        }

        $api = [];

        foreach ($definition['columns'] as $field => $column) {
            $field = (string) $field;
            $column = (string) $column;

            if (!array_key_exists($column, $row)) {
                continue;
            }

            $api[$field] = self::toApiValue($field, $column, $row[$column], $definition);
        }

        return $api;
    }

    /**
     * Explicit DB columns for SELECT lists; the caller adds the owner column
     * and, for export ordering, server_updated_at.
     *
     * @return list<string>
     */
    public static function columns(string $apiKey): array
    {
        $definition = self::definition($apiKey);
        $columns = array_values(array_map(
            static fn (mixed $column): string => (string) $column,
            $definition['columns'],
        ));

        if (isset($definition['json'])) {
            $columns[] = (string) $definition['json'];
        }

        return array_values(array_unique($columns));
    }

    /**
     * DB column that stores the row identity.
     */
    public static function idColumn(string $apiKey): string
    {
        $definition = self::definition($apiKey);
        $pk = (string) $definition['pk'];

        if (isset($definition['columns'][$pk])) {
            return (string) $definition['columns'][$pk];
        }

        return $pk === 'userId' ? (string) $definition['owner'] : $pk;
    }

    /**
     * ISO-8601 timestamp => DATETIME(6) literal. Public so push can normalise
     * a delete request that carries only `updatedAt`.
     */
    public static function timestampSql(mixed $value, string $field = 'updatedAt'): string
    {
        if (
            !is_string($value)
            || preg_match(
                '/^\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}:\d{2}(?:\.\d{1,6})?(?:Z|[+-]\d{2}:?\d{2})$/',
                trim($value),
            ) !== 1
        ) {
            throw new InvalidRowValue('invalid_timestamp', 'Geçersiz zaman damgası: ' . $field);
        }

        try {
            $at = new DateTimeImmutable(trim($value));
        } catch (Throwable) {
            throw new InvalidRowValue('invalid_timestamp', 'Geçersiz zaman damgası: ' . $field);
        }

        return $at
            ->setTimezone(new DateTimeZone('UTC'))
            ->format('Y-m-d H:i:s.u');
    }

    /**
     * @param array<string, mixed> $definition
     * @return list<string>
     */
    private static function allowedFields(array $definition): array
    {
        $allowed = array_map(
            static fn (mixed $field): string => (string) $field,
            array_keys($definition['columns']),
        );
        $allowed[] = (string) $definition['ownerKey'];

        foreach ($definition['settings'] ?? [] as $field) {
            $allowed[] = (string) $field;
        }

        return array_values(array_unique($allowed));
    }

    /**
     * @param array<string, mixed> $definition
     */
    private static function toDbValue(
        string $column,
        mixed $value,
        array $definition,
        string $field,
    ): mixed {
        if ($value === null) {
            return null;
        }

        if (in_array($field, $definition['timestamps'], true)) {
            return self::timestampSql($value, $field);
        }

        if (in_array($field, $definition['dates'], true)) {
            return self::dateSql($value, $field);
        }

        if (in_array($field, $definition['booleans'], true)) {
            if (is_bool($value)) {
                return $value ? 1 : 0;
            }

            if ($value === 0 || $value === 1) {
                return $value;
            }

            throw new InvalidRowValue('validation_failed', 'Geçersiz mantıksal değer: ' . $field);
        }

        if (in_array($field, $definition['integers'], true)) {
            if (is_int($value)) {
                return $value;
            }

            if (is_string($value) && preg_match('/^-?\d+$/', $value) === 1) {
                return (int) $value;
            }

            throw new InvalidRowValue('validation_failed', 'Geçersiz sayı: ' . $field);
        }

        if (in_array($field, $definition['decimals'], true)) {
            if (is_int($value) || is_float($value)) {
                return (string) $value;
            }

            if (is_string($value) && is_numeric($value)) {
                return $value;
            }

            throw new InvalidRowValue('validation_failed', 'Geçersiz sayı: ' . $field);
        }

        if (!is_string($value)) {
            throw new InvalidRowValue('validation_failed', 'Metin bekleniyordu: ' . $field);
        }

        if ($column === 'id' || str_ends_with($column, '_id')) {
            return self::assertRowId($value, $field);
        }

        return $value;
    }

    private static function dateSql(mixed $value, string $field): string
    {
        if (!is_string($value) || preg_match('/^\d{4}-\d{2}-\d{2}$/', $value) !== 1) {
            throw new InvalidRowValue('validation_failed', 'Geçersiz tarih: ' . $field);
        }

        $date = DateTimeImmutable::createFromFormat('!Y-m-d', $value);
        $errors = DateTimeImmutable::getLastErrors();

        if (
            $date === false
            || ($errors !== false && ($errors['warning_count'] > 0 || $errors['error_count'] > 0))
            || $date->format('Y-m-d') !== $value
        ) {
            throw new InvalidRowValue('validation_failed', 'Geçersiz tarih: ' . $field);
        }

        return $value;
    }

    /**
     * @param array<string, mixed> $definition
     */
    private static function toApiValue(
        string $field,
        string $column,
        mixed $value,
        array $definition,
    ): mixed {
        if ($value === null) {
            return null;
        }

        if (in_array($field, $definition['timestamps'], true)) {
            return self::apiTimestamp($value);
        }

        if (in_array($field, $definition['booleans'], true)) {
            return (bool) (int) $value;
        }

        if (in_array($field, $definition['integers'], true)) {
            return (int) $value;
        }

        return $value;
    }

    private static function apiTimestamp(mixed $value): ?string
    {
        if (!is_string($value) || $value === '') {
            return null;
        }

        return (new DateTimeImmutable($value, new DateTimeZone('UTC')))
            ->format('Y-m-d\TH:i:s.u\Z');
    }
}
