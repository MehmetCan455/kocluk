<?php

declare(strict_types=1);

namespace Kocluk\Api\Sync;

use Kocluk\Api\Db\Database;

/**
 * Append-only server change log (spec §6.4).
 *
 * Every write in SyncService appends one row inside the same transaction, so a
 * pull cursor can never miss a committed change. The table never leaves the
 * server; it only feeds the pull endpoint and the status cursor.
 */
final class ChangeLog
{
    public function __construct(private readonly Database $database)
    {
    }

    public function append(string $userId, string $table, string $rowId, string $op): void
    {
        $this->database->execute(
            'INSERT INTO `sync_changes` (`user_id`, `table_name`, `row_id`, `op`)'
            . ' VALUES (?, ?, ?, ?)',
            [$userId, $table, $rowId, $op],
        );
    }

    /**
     * Highest change id for the account, or 0 when the log is empty.
     */
    public function maxId(string $userId): int
    {
        $row = $this->database->fetchOne(
            'SELECT MAX(`id`) AS `cursor` FROM `sync_changes` WHERE `user_id` = ?',
            [$userId],
        );

        return (int) ($row['cursor'] ?? 0);
    }

    /**
     * Oldest change id still retained for the account, or 0 when empty.
     */
    public function minId(string $userId): int
    {
        $row = $this->database->fetchOne(
            'SELECT MIN(`id`) AS `cursor` FROM `sync_changes` WHERE `user_id` = ?',
            [$userId],
        );

        return (int) ($row['cursor'] ?? 0);
    }

    /**
     * Changes after a cursor, oldest first (spec §8.3).
     *
     * The caller asks for one row more than the page so it can tell whether
     * another page exists without a second query. Table names are returned as
     * stored; mapping them to API shapes stays in SyncService/TableMap.
     *
     * @return list<array{id: int, table: string, rowId: string, op: string}>
     */
    public function since(string $userId, int $since, int $limit): array
    {
        $rows = $this->database->fetchAll(
            sprintf(
                'SELECT `id`, `table_name`, `row_id`, `op` FROM `sync_changes`'
                . ' WHERE `user_id` = ? AND `id` > ? ORDER BY `id` LIMIT %d',
                max(1, $limit),
            ),
            [$userId, $since],
        );

        return array_map(
            static fn (array $row): array => [
                'id' => (int) $row['id'],
                'table' => (string) $row['table_name'],
                'rowId' => (string) $row['row_id'],
                'op' => (string) $row['op'],
            ],
            $rows,
        );
    }
}
