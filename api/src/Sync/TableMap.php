<?php

declare(strict_types=1);

namespace Kocluk\Api\Sync;

use DateTimeImmutable;
use DateTimeZone;
use JsonException;
use LogicException;
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
 *   * `required`  API fields that an upsert must carry and may not be null
 *   * `immutable` API fields that cannot change after the first insert
 *   * `natural`   DB columns of the active natural key (unique index)
 *   * `rules`     per-field type, maximum width/bytes, numeric range and enum
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

    private const EXAM_TYPE_VALUES = ['TYT', 'AYT'];

    private const AYT_ALAN_VALUES = ['sayisal', 'ea', 'sozel', 'tumu'];

    private const EXAM_KIND_VALUES = ['full', 'branch'];

    private const BRANCH_VALUES = [
        'tyt-turkce',
        'tyt-sosyal',
        'tyt-matematik',
        'tyt-fen',
        'ayt-sayisal-matematik',
        'ayt-sayisal-fen',
        'ayt-ea-matematik',
        'ayt-ea-edebiyat-sosyal-1',
        'ayt-sozel-edebiyat-sosyal-1',
        'ayt-sozel-sosyal-2',
    ];

    private const USER_BOOK_STATUS_VALUES = ['active', 'completed', 'archived'];

    private const ACTIVITY_TYPE_VALUES = ['book_pages', 'page_set', 'topic_review'];

    private const ACTIVITY_SOURCE_VALUES = ['task', 'manual'];

    private const SCHEDULE_TASK_TYPE_VALUES = ['book', 'topic', 'free'];

    private const RULE_ID = ['type' => 'id'];

    private const RULE_TIMESTAMP = ['type' => 'timestamp'];

    private const RULE_DATE = ['type' => 'date'];

    private const RULE_BOOL = ['type' => 'bool'];

    private const RULE_TEXT = ['type' => 'string', 'maxBytes' => 65535];

    private const RULE_MEDIUM_TEXT = ['type' => 'string', 'maxBytes' => 16777215];

    private const RULE_ORDER = ['type' => 'int', 'min' => 0, 'max' => 2147483647];

    private const RULE_UNSIGNED = ['type' => 'int', 'min' => 0, 'max' => 4294967295];

    private const RULE_SMALL_UNSIGNED = ['type' => 'int', 'min' => 0, 'max' => 65535];

    /** Monday = 1 … Sunday = 7, matching the client schedule domain. */
    private const RULE_DAY_INDEX = ['type' => 'int', 'min' => 1, 'max' => 7];

    /** Day count selected when a page chain is created (client range). */
    private const RULE_CHUNK_COUNT = ['type' => 'int', 'min' => 2, 'max' => 7];

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
            'rules' => [
                'id' => self::RULE_ID,
                'seedKey' => ['type' => 'string', 'max' => 64],
                'exam' => ['type' => 'string', 'max' => 8, 'enum' => self::EXAM_TYPE_VALUES],
                'name' => ['type' => 'string', 'max' => 255],
                'slug' => ['type' => 'string', 'max' => 64],
                'icon' => ['type' => 'string', 'max' => 64],
                'order' => self::RULE_ORDER,
                'updatedAt' => self::RULE_TIMESTAMP,
                'deletedAt' => self::RULE_TIMESTAMP,
            ],
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
            'rules' => [
                'id' => self::RULE_ID,
                'seedKey' => ['type' => 'string', 'max' => 64],
                'subjectId' => self::RULE_ID,
                'name' => ['type' => 'string', 'max' => 255],
                'order' => self::RULE_ORDER,
                'isCustom' => self::RULE_BOOL,
                'createdAt' => self::RULE_TIMESTAMP,
                'updatedAt' => self::RULE_TIMESTAMP,
                'deletedAt' => self::RULE_TIMESTAMP,
            ],
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
            'rules' => [
                'id' => self::RULE_ID,
                'type' => ['type' => 'string', 'max' => 8, 'enum' => self::EXAM_TYPE_VALUES],
                'name' => ['type' => 'string', 'max' => 255],
                'date' => self::RULE_DATE,
                'alan' => ['type' => 'string', 'max' => 16, 'enum' => self::AYT_ALAN_VALUES],
                'kind' => ['type' => 'string', 'max' => 16, 'enum' => self::EXAM_KIND_VALUES],
                'branch' => ['type' => 'string', 'max' => 64, 'enum' => self::BRANCH_VALUES],
                'note' => self::RULE_TEXT,
                'createdAt' => self::RULE_TIMESTAMP,
                'updatedAt' => self::RULE_TIMESTAMP,
                'deletedAt' => self::RULE_TIMESTAMP,
            ],
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
            'rules' => [
                'id' => self::RULE_ID,
                'examId' => self::RULE_ID,
                'subjectId' => self::RULE_ID,
                'correct' => self::RULE_SMALL_UNSIGNED,
                'wrong' => self::RULE_SMALL_UNSIGNED,
                'blank' => self::RULE_SMALL_UNSIGNED,
                'net' => ['type' => 'decimal', 'min' => -9999.99, 'max' => 9999.99],
                'updatedAt' => self::RULE_TIMESTAMP,
                'deletedAt' => self::RULE_TIMESTAMP,
            ],
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
            'rules' => [
                'topicId' => self::RULE_ID,
                'contentHtml' => self::RULE_MEDIUM_TEXT,
                'plainText' => self::RULE_MEDIUM_TEXT,
                'updatedAt' => self::RULE_TIMESTAMP,
                'deletedAt' => self::RULE_TIMESTAMP,
            ],
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
            'rules' => [
                'id' => self::RULE_ID,
                'title' => ['type' => 'string', 'max' => 255],
                'publisher' => ['type' => 'string', 'max' => 255],
                'exam' => ['type' => 'string', 'max' => 8, 'enum' => self::EXAM_TYPE_VALUES],
                'subjectSlug' => ['type' => 'string', 'max' => 64],
                'totalPages' => self::RULE_UNSIGNED,
                'edition' => ['type' => 'string', 'max' => 64],
                'createdAt' => self::RULE_TIMESTAMP,
                'updatedAt' => self::RULE_TIMESTAMP,
                'deletedAt' => self::RULE_TIMESTAMP,
            ],
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
            'rules' => [
                'id' => self::RULE_ID,
                'bookId' => self::RULE_ID,
                'totalPagesOverride' => self::RULE_UNSIGNED,
                'note' => self::RULE_TEXT,
                'status' => ['type' => 'string', 'max' => 16, 'enum' => self::USER_BOOK_STATUS_VALUES],
                'startedAt' => self::RULE_TIMESTAMP,
                'createdAt' => self::RULE_TIMESTAMP,
                'updatedAt' => self::RULE_TIMESTAMP,
                'deletedAt' => self::RULE_TIMESTAMP,
            ],
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
            'rules' => [
                'id' => self::RULE_ID,
                'type' => ['type' => 'string', 'max' => 32, 'enum' => self::ACTIVITY_TYPE_VALUES],
                'userBookId' => self::RULE_ID,
                'topicId' => self::RULE_ID,
                'fromPage' => self::RULE_UNSIGNED,
                'toPage' => self::RULE_UNSIGNED,
                'taskId' => self::RULE_ID,
                'source' => ['type' => 'string', 'max' => 16, 'enum' => self::ACTIVITY_SOURCE_VALUES],
                'createdAt' => self::RULE_TIMESTAMP,
                'deletedAt' => self::RULE_TIMESTAMP,
            ],
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
            'rules' => [
                'id' => self::RULE_ID,
                'weekStart' => self::RULE_DATE,
                'note' => self::RULE_TEXT,
                'createdAt' => self::RULE_TIMESTAMP,
                'updatedAt' => self::RULE_TIMESTAMP,
                'deletedAt' => self::RULE_TIMESTAMP,
            ],
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
            'rules' => [
                'id' => self::RULE_ID,
                'weekId' => self::RULE_ID,
                'subjectId' => self::RULE_ID,
                'label' => ['type' => 'string', 'max' => 255],
                'order' => self::RULE_ORDER,
                'createdAt' => self::RULE_TIMESTAMP,
                'updatedAt' => self::RULE_TIMESTAMP,
                'deletedAt' => self::RULE_TIMESTAMP,
            ],
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
            'rules' => [
                'id' => self::RULE_ID,
                'weekId' => self::RULE_ID,
                'rowId' => self::RULE_ID,
                'dayIndex' => self::RULE_DAY_INDEX,
                'type' => ['type' => 'string', 'max' => 16, 'enum' => self::SCHEDULE_TASK_TYPE_VALUES],
                'userBookId' => self::RULE_ID,
                'fromPage' => self::RULE_UNSIGNED,
                'toPage' => self::RULE_UNSIGNED,
                'topicId' => self::RULE_ID,
                'title' => ['type' => 'string', 'max' => 255],
                'completedAt' => self::RULE_TIMESTAMP,
                'missedAt' => self::RULE_TIMESTAMP,
                'createdAt' => self::RULE_TIMESTAMP,
                'updatedAt' => self::RULE_TIMESTAMP,
                'deletedAt' => self::RULE_TIMESTAMP,
            ],
        ],
        'schedulePageChains' => [
            'table' => 'schedule_page_chains',
            'owner' => 'user_id',
            'ownerKey' => 'userId',
            'pk' => 'id',
            'columns' => [
                'id' => 'id',
                'weekId' => 'week_id',
                'rowId' => 'row_id',
                'userBookId' => 'user_book_id',
                'startPage' => 'start_page',
                'endPage' => 'end_page',
                'chunkSize' => 'chunk_size',
                'chunkCount' => 'chunk_count',
                'slots' => 'slots',
                'createdAt' => 'created_at',
                'updatedAt' => 'updated_at',
                'deletedAt' => 'deleted_at',
            ],
            'required' => [
                'id',
                'weekId',
                'rowId',
                'userBookId',
                'startPage',
                'endPage',
                'chunkSize',
                'chunkCount',
                'slots',
                'createdAt',
                'updatedAt',
            ],
            'immutable' => ['id'],
            'natural' => [],
            'rules' => [
                'id' => self::RULE_ID,
                'weekId' => self::RULE_ID,
                'rowId' => self::RULE_ID,
                'userBookId' => self::RULE_ID,
                'startPage' => self::RULE_UNSIGNED,
                'endPage' => self::RULE_UNSIGNED,
                'chunkSize' => self::RULE_SMALL_UNSIGNED,
                'chunkCount' => self::RULE_CHUNK_COUNT,
                'slots' => ['type' => 'string', 'maxBytes' => 65535],
                'createdAt' => self::RULE_TIMESTAMP,
                'updatedAt' => self::RULE_TIMESTAMP,
                'deletedAt' => self::RULE_TIMESTAMP,
            ],
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
            'rules' => [
                'id' => self::RULE_ID,
                'topicId' => self::RULE_ID,
                'done' => self::RULE_BOOL,
                'doneAt' => self::RULE_TIMESTAMP,
                'updatedAt' => self::RULE_TIMESTAMP,
                'deletedAt' => self::RULE_TIMESTAMP,
            ],
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
            'rules' => [
                'userId' => self::RULE_ID,
                'updatedAt' => self::RULE_TIMESTAMP,
            ],
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
     * Account-level setting names accepted and returned by the sync API.
     *
     * @return list<string>
     */
    public static function settingsFields(): array
    {
        return self::ACCOUNT_SETTINGS;
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
     * Rejects fields that are not part of the public API row.
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
     * Required fields must be present and non-null; every value is checked
     * against its type, maximum width/bytes, numeric range and enum before it
     * reaches MariaDB, so malformed rows stay row-level validation errors.
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

            if ($row[$field] === null) {
                throw new InvalidRowValue('validation_failed', 'Zorunlu alan null olamaz: ' . $field);
            }
        }

        // Settings have no userId column; validate the identity field that is
        // only carried by the wire row.
        $pk = (string) $definition['pk'];

        if (!isset($definition['columns'][$pk]) && array_key_exists($pk, $row)) {
            self::toDbValue($row[$pk], $definition, $pk);
        }

        $db = [];

        foreach ($definition['columns'] as $field => $column) {
            $field = (string) $field;
            $hasValue = array_key_exists($field, $row) && $row[$field] !== null;

            $db[$column] = $hasValue
                ? self::toDbValue($row[$field], $definition, $field)
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
     * active_* and the ownership column) are not copied. The settings read
     * path filters the stored JSON through the account-level allowlist so a
     * legacy device key never leaks back to a client.
     *
     * @param array<string, mixed> $row
     * @return array<string, mixed>
     */
    public static function toApi(string $apiKey, array $row): array
    {
        $definition = self::definition($apiKey);

        if (isset($definition['json'])) {
            $data = self::settingsData($row[$definition['json']] ?? null);
            $api = [];

            foreach (self::ACCOUNT_SETTINGS as $field) {
                if (array_key_exists($field, $data)) {
                    $api[$field] = $data[$field];
                }
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

            $api[$field] = self::toApiValue($field, $row[$column], $definition);
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
    private static function toDbValue(mixed $value, array $definition, string $field): mixed
    {
        $rule = $definition['rules'][$field] ?? null;

        if (!is_array($rule)) {
            throw new LogicException('Eksik alan kuralı: ' . $field);
        }

        return match ((string) ($rule['type'] ?? 'string')) {
            'id' => self::assertRowId($value, $field),
            'timestamp' => self::timestampSql($value, $field),
            'date' => self::dateSql($value, $field),
            'bool' => self::boolSql($value, $field),
            'int' => self::intSql($value, $rule, $field),
            'decimal' => self::decimalSql($value, $rule, $field),
            'string' => self::textSql($value, $rule, $field),
            default => throw new InvalidRowValue('validation_failed', 'Geçersiz alan tipi: ' . $field),
        };
    }

    /**
     * @param array<string, mixed> $rule
     */
    private static function textSql(mixed $value, array $rule, string $field): string
    {
        if (!is_string($value)) {
            throw new InvalidRowValue('validation_failed', 'Metin bekleniyordu: ' . $field);
        }

        if (isset($rule['max']) && mb_strlen($value) > (int) $rule['max']) {
            throw new InvalidRowValue('validation_failed', 'Metin çok uzun: ' . $field);
        }

        if (isset($rule['maxBytes']) && strlen($value) > (int) $rule['maxBytes']) {
            throw new InvalidRowValue('validation_failed', 'Metin çok uzun: ' . $field);
        }

        if (isset($rule['enum']) && !in_array($value, $rule['enum'], true)) {
            throw new InvalidRowValue('validation_failed', 'Geçersiz değer: ' . $field);
        }

        return $value;
    }

    /**
     * @param array<string, mixed> $rule
     */
    private static function intSql(mixed $value, array $rule, string $field): int
    {
        if (is_int($value)) {
            $number = $value;
        } elseif (is_string($value) && preg_match('/^-?\d+$/', $value) === 1) {
            $number = (int) $value;
        } else {
            throw new InvalidRowValue('validation_failed', 'Geçersiz sayı: ' . $field);
        }

        $min = isset($rule['min']) ? (int) $rule['min'] : PHP_INT_MIN;
        $max = isset($rule['max']) ? (int) $rule['max'] : PHP_INT_MAX;

        if ($number < $min || $number > $max) {
            throw new InvalidRowValue('validation_failed', 'Sayı aralık dışında: ' . $field);
        }

        return $number;
    }

    /**
     * @param array<string, mixed> $rule
     */
    private static function decimalSql(mixed $value, array $rule, string $field): string
    {
        if (is_int($value) || is_float($value)) {
            $number = (float) $value;
        } elseif (is_string($value) && is_numeric($value)) {
            $number = (float) $value;
        } else {
            throw new InvalidRowValue('validation_failed', 'Geçersiz sayı: ' . $field);
        }

        $min = isset($rule['min']) ? (float) $rule['min'] : -PHP_FLOAT_MAX;
        $max = isset($rule['max']) ? (float) $rule['max'] : PHP_FLOAT_MAX;

        if ($number < $min || $number > $max) {
            throw new InvalidRowValue('validation_failed', 'Sayı aralık dışında: ' . $field);
        }

        return is_string($value) ? $value : (string) $value;
    }

    private static function boolSql(mixed $value, string $field): int
    {
        if (is_bool($value)) {
            return $value ? 1 : 0;
        }

        if ($value === 0 || $value === 1) {
            return $value;
        }

        throw new InvalidRowValue('validation_failed', 'Geçersiz mantıksal değer: ' . $field);
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
    private static function toApiValue(string $field, mixed $value, array $definition): mixed
    {
        if ($value === null) {
            return null;
        }

        $rule = $definition['rules'][$field] ?? null;
        $type = is_array($rule) ? (string) ($rule['type'] ?? 'string') : 'string';

        return match ($type) {
            'timestamp' => self::apiTimestamp($value),
            'bool' => (bool) (int) $value,
            'int' => (int) $value,
            // MariaDB returns DECIMAL/NUMERIC as a string. The wire contract is
            // still a JSON number: a string `net` would turn exam totals into
            // "20" + "18.75" concatenation and NaN on the client (design §8.1).
            'decimal' => (float) $value,
            default => $value,
        };
    }

    /**
     * @return array<string, mixed>
     */
    private static function settingsData(mixed $value): array
    {
        if (!is_string($value)) {
            return [];
        }

        try {
            $decoded = json_decode($value, true, 64, JSON_THROW_ON_ERROR);
        } catch (JsonException) {
            return [];
        }

        return is_array($decoded) ? $decoded : [];
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
