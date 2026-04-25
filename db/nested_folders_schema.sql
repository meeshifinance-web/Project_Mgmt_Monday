-- ═══════════════════════════════════════════════════════════════════════════
-- Nested Folders Schema — idempotent, safe to run multiple times
-- ═══════════════════════════════════════════════════════════════════════════
-- Adds one column so a folder can optionally sit inside another folder.
-- Depth is intentionally limited to 2 levels (top folder → subfolder) by
-- application logic, not a CHECK constraint, so the rule can be relaxed in
-- the future without a migration.
--
-- Run:
--   psql -U postgres -d <db_name> -f db/nested_folders_schema.sql
-- ═══════════════════════════════════════════════════════════════════════════

ALTER TABLE board_folders
  ADD COLUMN IF NOT EXISTS parent_folder_id INTEGER
  REFERENCES board_folders(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_board_folders_parent
  ON board_folders(parent_folder_id);

-- ═══════════════════════════════════════════════════════════════════════════
-- Verify with:
--   \d board_folders
--   SELECT id, name, parent_folder_id FROM board_folders ORDER BY id;
-- ═══════════════════════════════════════════════════════════════════════════
