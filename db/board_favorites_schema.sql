-- ═══════════════════════════════════════════════════════════════════════════
-- Board Favourites Schema — idempotent, safe to run multiple times
-- ═══════════════════════════════════════════════════════════════════════════
-- Purpose:
--   Per-user "star" toggle on boards (monday-style). Each row marks one user
--   favouriting one board. Used by the sidebar to surface starred boards and
--   by GET /api/boards to populate the `is_favorite` flag.
--
-- Note:
--   This table is also created on backend startup via CREATE TABLE IF NOT
--   EXISTS in backend/index.js, so existing deployments already have it.
--   This file exists so a fresh instance can be provisioned from db/ alone,
--   matching the pattern of the other *_schema.sql migrations.
--
-- Run:
--   psql -U postgres -d <db_name> -f db/board_favorites_schema.sql
--
-- All statements are idempotent — safe to re-run.
-- ═══════════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS board_favorites (
  board_id   INTEGER NOT NULL REFERENCES boards(id) ON DELETE CASCADE,
  user_id    INTEGER NOT NULL REFERENCES users(id)  ON DELETE CASCADE,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  PRIMARY KEY (board_id, user_id)
);

CREATE INDEX IF NOT EXISTS idx_board_favorites_user
  ON board_favorites(user_id);

-- ═══════════════════════════════════════════════════════════════════════════
-- Verify with:
--   \d board_favorites
--   SELECT b.id, b.name, COUNT(bf.user_id) AS star_count
--     FROM boards b LEFT JOIN board_favorites bf ON bf.board_id = b.id
--    GROUP BY b.id ORDER BY b.id;
-- ═══════════════════════════════════════════════════════════════════════════
