-- Authentication, session and anti-abuse tables.
-- Applied by api/bin/migrate.php inside a transaction. Every statement is
-- re-runnable, so a partially applied migration can be retried safely.

CREATE TABLE IF NOT EXISTS `users` (
    `id` CHAR(36) NOT NULL,
    `email` VARCHAR(255) NOT NULL,
    `password_hash` VARCHAR(255) NOT NULL,
    `display_name` VARCHAR(80) NOT NULL,
    `email_verified_at` DATETIME(6) NULL,
    `privacy_version` VARCHAR(32) NOT NULL,
    `consented_at` DATETIME(6) NOT NULL,
    `created_at` DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
    `updated_at` DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
    `deleted_at` DATETIME(6) NULL,
    PRIMARY KEY (`id`),
    UNIQUE KEY `uq_users_email` (`email`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `sessions` (
    `id` CHAR(64) NOT NULL,
    `user_id` CHAR(36) NOT NULL,
    `csrf_token` VARCHAR(128) NOT NULL,
    `expires_at` DATETIME(6) NOT NULL,
    `created_at` DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
    `last_seen_at` DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
    `revoked_at` DATETIME(6) NULL,
    `ip` VARCHAR(45) NULL,
    `user_agent` VARCHAR(255) NULL,
    PRIMARY KEY (`id`),
    KEY `idx_sessions_user_expires` (`user_id`, `expires_at`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `password_resets` (
    `id` CHAR(64) NOT NULL,
    `user_id` CHAR(36) NOT NULL,
    `expires_at` DATETIME(6) NOT NULL,
    `used_at` DATETIME(6) NULL,
    `created_at` DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
    PRIMARY KEY (`id`),
    KEY `idx_password_resets_user` (`user_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `email_verifications` (
    `id` CHAR(64) NOT NULL,
    `user_id` CHAR(36) NOT NULL,
    `expires_at` DATETIME(6) NOT NULL,
    `used_at` DATETIME(6) NULL,
    `created_at` DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
    PRIMARY KEY (`id`),
    KEY `idx_email_verifications_user` (`user_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `rate_limits` (
    `id` BIGINT NOT NULL AUTO_INCREMENT,
    `user_id` CHAR(36) NULL,
    `bucket` VARCHAR(128) NOT NULL,
    `ip` VARCHAR(45) NULL,
    `created_at` DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
    PRIMARY KEY (`id`),
    KEY `idx_rate_limits_bucket_created` (`bucket`, `created_at`),
    KEY `idx_rate_limits_ip_created` (`ip`, `created_at`),
    KEY `idx_rate_limits_user_created` (`user_id`, `created_at`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
