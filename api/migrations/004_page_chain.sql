-- Page chains (design §10.2).
--
-- A chain is a separate synced table so old clients never rewrite it as a
-- schedule task: the sync API treats a row as a full replacement. Linked
-- tasks are referenced from `slots`, a JSON array of at most seven entries
-- ({taskId, slotIndex, chunkIndex, dayIndex}); the server only bounds the
-- text length, the scheduling rules live on the client.
--
-- `schedule_tasks` is not touched: a task row stays exactly what an old
-- client already knows.

CREATE TABLE IF NOT EXISTS `schedule_page_chains` (
    `id` CHAR(36) NOT NULL,
    `user_id` CHAR(36) NOT NULL,
    `week_id` CHAR(36) NOT NULL,
    `row_id` CHAR(36) NOT NULL,
    `user_book_id` CHAR(36) NOT NULL,
    `start_page` INT UNSIGNED NOT NULL,
    `end_page` INT UNSIGNED NOT NULL,
    `chunk_size` SMALLINT UNSIGNED NOT NULL,
    `chunk_count` TINYINT UNSIGNED NOT NULL,
    `slots` TEXT NOT NULL,
    `created_at` DATETIME(6) NOT NULL,
    `updated_at` DATETIME(6) NOT NULL,
    `deleted_at` DATETIME(6) NULL,
    `server_updated_at` DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
    PRIMARY KEY (`user_id`, `id`),
    KEY `idx_schedule_page_chains_user_week` (`user_id`, `week_id`),
    KEY `idx_schedule_page_chains_user_server_updated` (`user_id`, `server_updated_at`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
