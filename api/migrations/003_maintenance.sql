-- Retention support (design §6.4).
--
-- The maintenance cron purges sync_changes by changed_at. Without this index
-- the DELETE would scan the whole, ever-growing change log. IF NOT EXISTS
-- keeps the migration re-runnable after a partial DDL failure.

ALTER TABLE `sync_changes`
    ADD INDEX IF NOT EXISTS `idx_sync_changes_changed_at` (`changed_at`);
