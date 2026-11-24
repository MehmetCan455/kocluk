-- Synced per-user tables and the server-side change log.
--
-- Conventions (design spec section 6):
--   * ids are client-generated UUIDs, so the primary key is (user_id, id) and
--     an id alone is not globally unique
--   * deletes are soft; deleted_at is set and the row stays for tombstones
--   * unique keys use a PERSISTENT generated active_* column so a soft-deleted
--     row does not block a new active row (MariaDB has no partial indexes)
--   * server_updated_at is the server receive time, not the LWW timestamp
--
-- Every statement is re-runnable, so a partially applied migration can be
-- retried safely.

CREATE TABLE IF NOT EXISTS `subjects` (
    `id` CHAR(36) NOT NULL,
    `user_id` CHAR(36) NOT NULL,
    `seed_key` VARCHAR(64) NOT NULL,
    `exam` VARCHAR(8) NOT NULL,
    `name` VARCHAR(255) NOT NULL,
    `slug` VARCHAR(64) NOT NULL,
    `icon` VARCHAR(64) NOT NULL,
    `sort_order` INT NOT NULL DEFAULT 0,
    `updated_at` DATETIME(6) NOT NULL,
    `deleted_at` DATETIME(6) NULL,
    `server_updated_at` DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
    `active_seed_key` VARCHAR(64) AS (IF(`deleted_at` IS NULL, `seed_key`, NULL)) PERSISTENT,
    PRIMARY KEY (`user_id`, `id`),
    UNIQUE KEY `uq_subjects_active_seed` (`user_id`, `active_seed_key`),
    KEY `idx_subjects_user_server_updated` (`user_id`, `server_updated_at`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `topics` (
    `id` CHAR(36) NOT NULL,
    `user_id` CHAR(36) NOT NULL,
    `seed_key` VARCHAR(64) NULL,
    `subject_id` CHAR(36) NOT NULL,
    `name` VARCHAR(255) NOT NULL,
    `sort_order` INT NOT NULL DEFAULT 0,
    `is_custom` TINYINT(1) NOT NULL DEFAULT 0,
    `created_at` DATETIME(6) NOT NULL,
    `updated_at` DATETIME(6) NOT NULL,
    `deleted_at` DATETIME(6) NULL,
    `server_updated_at` DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
    `active_seed_key` VARCHAR(64) AS (IF(`deleted_at` IS NULL, `seed_key`, NULL)) PERSISTENT,
    PRIMARY KEY (`user_id`, `id`),
    UNIQUE KEY `uq_topics_active_seed` (`user_id`, `active_seed_key`),
    KEY `idx_topics_user_server_updated` (`user_id`, `server_updated_at`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `exams` (
    `id` CHAR(36) NOT NULL,
    `user_id` CHAR(36) NOT NULL,
    `type` VARCHAR(8) NOT NULL,
    `name` VARCHAR(255) NOT NULL,
    `date` DATE NOT NULL,
    `alan` VARCHAR(16) NULL,
    `kind` VARCHAR(16) NULL,
    `branch` VARCHAR(64) NULL,
    `note` TEXT NOT NULL,
    `created_at` DATETIME(6) NOT NULL,
    `updated_at` DATETIME(6) NOT NULL,
    `deleted_at` DATETIME(6) NULL,
    `server_updated_at` DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
    PRIMARY KEY (`user_id`, `id`),
    KEY `idx_exams_user_server_updated` (`user_id`, `server_updated_at`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `exam_results` (
    `id` CHAR(36) NOT NULL,
    `user_id` CHAR(36) NOT NULL,
    `exam_id` CHAR(36) NOT NULL,
    `subject_id` CHAR(36) NOT NULL,
    `correct` SMALLINT UNSIGNED NOT NULL DEFAULT 0,
    `wrong` SMALLINT UNSIGNED NOT NULL DEFAULT 0,
    `blank` SMALLINT UNSIGNED NOT NULL DEFAULT 0,
    `net` DECIMAL(6,2) NOT NULL DEFAULT 0.00,
    `updated_at` DATETIME(6) NOT NULL,
    `deleted_at` DATETIME(6) NULL,
    `server_updated_at` DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
    `active_result_key` VARCHAR(73) AS (IF(`deleted_at` IS NULL, CONCAT(RTRIM(`exam_id`), ':', RTRIM(`subject_id`)), NULL)) PERSISTENT,
    PRIMARY KEY (`user_id`, `id`),
    UNIQUE KEY `uq_exam_results_active_result` (`user_id`, `active_result_key`),
    KEY `idx_exam_results_user_server_updated` (`user_id`, `server_updated_at`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `notes` (
    `user_id` CHAR(36) NOT NULL,
    `topic_id` CHAR(36) NOT NULL,
    `content_html` MEDIUMTEXT NOT NULL,
    `plain_text` MEDIUMTEXT NOT NULL,
    `updated_at` DATETIME(6) NOT NULL,
    `deleted_at` DATETIME(6) NULL,
    `server_updated_at` DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
    PRIMARY KEY (`user_id`, `topic_id`),
    KEY `idx_notes_user_server_updated` (`user_id`, `server_updated_at`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `catalog_books` (
    `id` CHAR(36) NOT NULL,
    `owner_id` CHAR(36) NOT NULL,
    `title` VARCHAR(255) NOT NULL,
    `publisher` VARCHAR(255) NULL,
    `exam` VARCHAR(8) NULL,
    `subject_slug` VARCHAR(64) NULL,
    `total_pages` INT UNSIGNED NOT NULL DEFAULT 0,
    `edition` VARCHAR(64) NULL,
    `created_at` DATETIME(6) NOT NULL,
    `updated_at` DATETIME(6) NOT NULL,
    `deleted_at` DATETIME(6) NULL,
    `server_updated_at` DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
    PRIMARY KEY (`owner_id`, `id`),
    KEY `idx_catalog_books_owner_server_updated` (`owner_id`, `server_updated_at`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `user_books` (
    `id` CHAR(36) NOT NULL,
    `user_id` CHAR(36) NOT NULL,
    `book_id` CHAR(36) NOT NULL,
    `total_pages_override` INT UNSIGNED NULL,
    `note` TEXT NULL,
    `status` VARCHAR(16) NOT NULL DEFAULT 'active',
    `started_at` DATETIME(6) NULL,
    `created_at` DATETIME(6) NOT NULL,
    `updated_at` DATETIME(6) NOT NULL,
    `deleted_at` DATETIME(6) NULL,
    `server_updated_at` DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
    `active_book_id` VARCHAR(36) AS (IF(`deleted_at` IS NULL, RTRIM(`book_id`), NULL)) PERSISTENT,
    PRIMARY KEY (`user_id`, `id`),
    UNIQUE KEY `uq_user_books_active_book` (`user_id`, `active_book_id`),
    KEY `idx_user_books_user_server_updated` (`user_id`, `server_updated_at`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `activity_logs` (
    `id` CHAR(36) NOT NULL,
    `user_id` CHAR(36) NOT NULL,
    `type` VARCHAR(32) NOT NULL,
    `user_book_id` CHAR(36) NULL,
    `topic_id` CHAR(36) NULL,
    `from_page` INT UNSIGNED NULL,
    `to_page` INT UNSIGNED NULL,
    `task_id` CHAR(36) NULL,
    `source` VARCHAR(16) NOT NULL,
    `created_at` DATETIME(6) NOT NULL,
    `deleted_at` DATETIME(6) NULL,
    `server_updated_at` DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
    `active_task_id` VARCHAR(36) AS (IF(`deleted_at` IS NULL, RTRIM(`task_id`), NULL)) PERSISTENT,
    PRIMARY KEY (`user_id`, `id`),
    UNIQUE KEY `uq_activity_logs_active_task` (`user_id`, `active_task_id`),
    KEY `idx_activity_logs_user_server_updated` (`user_id`, `server_updated_at`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `schedule_weeks` (
    `id` CHAR(36) NOT NULL,
    `user_id` CHAR(36) NOT NULL,
    `week_start` DATE NOT NULL,
    `note` TEXT NOT NULL,
    `created_at` DATETIME(6) NOT NULL,
    `updated_at` DATETIME(6) NOT NULL,
    `deleted_at` DATETIME(6) NULL,
    `server_updated_at` DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
    `active_week_start` DATE AS (IF(`deleted_at` IS NULL, `week_start`, NULL)) PERSISTENT,
    PRIMARY KEY (`user_id`, `id`),
    UNIQUE KEY `uq_schedule_weeks_active_week` (`user_id`, `active_week_start`),
    KEY `idx_schedule_weeks_user_server_updated` (`user_id`, `server_updated_at`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `schedule_rows` (
    `id` CHAR(36) NOT NULL,
    `user_id` CHAR(36) NOT NULL,
    `week_id` CHAR(36) NOT NULL,
    `subject_id` CHAR(36) NULL,
    `label` VARCHAR(255) NOT NULL,
    `sort_order` INT NOT NULL DEFAULT 0,
    `created_at` DATETIME(6) NOT NULL,
    `updated_at` DATETIME(6) NOT NULL,
    `deleted_at` DATETIME(6) NULL,
    `server_updated_at` DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
    PRIMARY KEY (`user_id`, `id`),
    KEY `idx_schedule_rows_user_server_updated` (`user_id`, `server_updated_at`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `schedule_tasks` (
    `id` CHAR(36) NOT NULL,
    `user_id` CHAR(36) NOT NULL,
    `week_id` CHAR(36) NOT NULL,
    `row_id` CHAR(36) NOT NULL,
    `day_index` TINYINT UNSIGNED NOT NULL,
    `type` VARCHAR(16) NOT NULL,
    `user_book_id` CHAR(36) NULL,
    `from_page` INT UNSIGNED NULL,
    `to_page` INT UNSIGNED NULL,
    `topic_id` CHAR(36) NULL,
    `title` VARCHAR(255) NULL,
    `completed_at` DATETIME(6) NULL,
    `missed_at` DATETIME(6) NULL,
    `created_at` DATETIME(6) NOT NULL,
    `updated_at` DATETIME(6) NOT NULL,
    `deleted_at` DATETIME(6) NULL,
    `server_updated_at` DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
    PRIMARY KEY (`user_id`, `id`),
    KEY `idx_schedule_tasks_user_week_day` (`user_id`, `week_id`, `day_index`),
    KEY `idx_schedule_tasks_user_server_updated` (`user_id`, `server_updated_at`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `topic_progress` (
    `id` CHAR(36) NOT NULL,
    `user_id` CHAR(36) NOT NULL,
    `topic_id` CHAR(36) NOT NULL,
    `done` TINYINT(1) NOT NULL DEFAULT 0,
    `done_at` DATETIME(6) NULL,
    `updated_at` DATETIME(6) NOT NULL,
    `deleted_at` DATETIME(6) NULL,
    `server_updated_at` DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
    `active_topic_id` VARCHAR(36) AS (IF(`deleted_at` IS NULL, RTRIM(`topic_id`), NULL)) PERSISTENT,
    PRIMARY KEY (`user_id`, `id`),
    UNIQUE KEY `uq_topic_progress_active_topic` (`user_id`, `active_topic_id`),
    KEY `idx_topic_progress_user_server_updated` (`user_id`, `server_updated_at`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `user_settings` (
    `user_id` CHAR(36) NOT NULL,
    `data` JSON NOT NULL,
    `updated_at` DATETIME(6) NOT NULL,
    `server_updated_at` DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
    PRIMARY KEY (`user_id`),
    KEY `idx_user_settings_user_server_updated` (`user_id`, `server_updated_at`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `sync_changes` (
    `id` BIGINT NOT NULL AUTO_INCREMENT,
    `user_id` CHAR(36) NOT NULL,
    `table_name` VARCHAR(64) NOT NULL,
    `row_id` VARCHAR(36) NOT NULL,
    `op` VARCHAR(16) NOT NULL,
    `changed_at` DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
    PRIMARY KEY (`id`),
    KEY `idx_sync_changes_user_id` (`user_id`, `id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
