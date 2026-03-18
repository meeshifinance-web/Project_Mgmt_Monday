-- Board visibility and membership

ALTER TABLE boards ADD COLUMN IF NOT EXISTS
  visibility VARCHAR(20) DEFAULT 'org_wide'
  CHECK (visibility IN ('private', 'org_wide'));

ALTER TABLE boards ADD COLUMN IF NOT EXISTS
  created_by INTEGER REFERENCES users(id) ON DELETE SET NULL;

CREATE TABLE IF NOT EXISTS board_members (
  id SERIAL PRIMARY KEY,
  board_id INTEGER REFERENCES boards(id) ON DELETE CASCADE,
  user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
  added_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  added_at TIMESTAMP DEFAULT NOW(),
  UNIQUE(board_id, user_id)
);

CREATE INDEX IF NOT EXISTS idx_board_members_board ON board_members(board_id);
CREATE INDEX IF NOT EXISTS idx_board_members_user  ON board_members(user_id);
