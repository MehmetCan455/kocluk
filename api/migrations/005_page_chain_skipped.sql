-- Page-chain skip list (additive to 004).
--
-- `skipped_chunks` stores the JSON array of chunk indexes the user marked with
-- “Sil”. Ignoring a range changes only this list: the chain row, its slots and
-- the scheduled tasks stay untouched. The default keeps rows written by the
-- first page-chain build readable without a data backfill.

ALTER TABLE `schedule_page_chains`
    ADD COLUMN IF NOT EXISTS `skipped_chunks` TEXT NOT NULL DEFAULT '[]';
