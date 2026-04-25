-- ═══════════════════════════════════════════════════════════════════════════
-- Board-Owner Visibility Schema — idempotent, safe to run multiple times
-- ═══════════════════════════════════════════════════════════════════════════
-- Purpose:
--   Allow boards to enforce strict per-item visibility based on the owner
--   column, where ONLY designated "Board Owners" (and system admins) see
--   every item — every other member, regardless of system role
--   (manager / VP / AVP / regular), only sees items where they are listed
--   in an owner column.
--
--   This is the access model needed for confidential boards (e.g. a
--   director's task board where reportees must not see each other's tasks
--   even though they all have manager-level system roles).
--
-- Run:
--   psql -U postgres -d <db_name> -f db/board_owner_visibility_schema.sql
--
-- All statements are idempotent — safe to re-run.
-- ═══════════════════════════════════════════════════════════════════════════

-- 1. Per-board "is_owner" flag on board_members.
--    A member with is_owner=true sees ALL items on that board, regardless
--    of owner-column assignment. Multiple owners per board are allowed.
ALTER TABLE board_members
  ADD COLUMN IF NOT EXISTS is_owner BOOLEAN DEFAULT false;

CREATE INDEX IF NOT EXISTS idx_board_members_is_owner
  ON board_members(board_id, is_owner) WHERE is_owner = true;

-- 2. Per-board toggle to enforce the strict visibility rule.
--    When false (default), behaviour matches today: admins + managers see
--    everything; only regular members are filtered by owner column.
--    When true, the rule becomes role-agnostic — only board owners and
--    system admins see everything; everyone else (including managers /
--    VPs / AVPs) is filtered by owner column just like regular members.
ALTER TABLE boards
  ADD COLUMN IF NOT EXISTS enforce_owner_visibility BOOLEAN DEFAULT false;

-- 3. Backfill: ensure every existing board's creator is marked as a
--    board owner. Without this, turning on the strict toggle on an
--    existing board would lock the creator out of seeing their own
--    unassigned items.
UPDATE board_members bm
   SET is_owner = true
  FROM boards b
 WHERE bm.board_id = b.id
   AND bm.user_id  = b.created_by
   AND (bm.is_owner IS NULL OR bm.is_owner = false);

-- ═══════════════════════════════════════════════════════════════════════════
-- Verify with:
--   \d board_members
--   \d boards
--   SELECT b.id, b.name, b.enforce_owner_visibility,
--          COUNT(*) FILTER (WHERE bm.is_owner) AS owner_count
--     FROM boards b LEFT JOIN board_members bm ON bm.board_id = b.id
--    GROUP BY b.id ORDER BY b.id;
-- ═══════════════════════════════════════════════════════════════════════════
