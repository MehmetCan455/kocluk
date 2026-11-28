-- Nullable page-chain layout (additive to 004 and 005).
--
-- `chunk_sizes` stores the JSON array of pages per chunk for a chain whose
-- user edited the distribution (for example [3,3,3,3,3,3,2]). NULL marks a
-- legacy chain that keeps the even split derived from chunk_size, so the
-- column must be nullable: TableMap::toDb writes an absent optional field as
-- an explicit NULL and an old client row must still insert. An update skips
-- the column when the incoming value is NULL (TableMap preserveWhenNull), so
-- an old client push never erases a layout written by a newer client.

ALTER TABLE `schedule_page_chains`
    ADD COLUMN IF NOT EXISTS `chunk_sizes` TEXT NULL;
