-- ═══════════════════════════════════════════════════════════════════════════
-- Email Routing Schema — idempotent, safe to run multiple times
-- ═══════════════════════════════════════════════════════════════════════════
-- Purpose: support inbound email → auto-create task via the automations
-- engine. Extends existing tables with threading fields and adds a small
-- dedup table so the poller never processes the same message twice.
--
-- Run:
--   psql -U postgres -d workboard_db -f db/email_routing_schema.sql
--
-- All statements use IF NOT EXISTS / ADD COLUMN IF NOT EXISTS — nothing
-- here collides with existing data or breaks existing features.
-- ═══════════════════════════════════════════════════════════════════════════

-- 1. Extend item_emails with RFC 5322 threading headers so replies can be
--    matched back to their originating item.
ALTER TABLE item_emails ADD COLUMN IF NOT EXISTS message_id   VARCHAR(512);
ALTER TABLE item_emails ADD COLUMN IF NOT EXISTS in_reply_to  VARCHAR(512);
ALTER TABLE item_emails ADD COLUMN IF NOT EXISTS "references" TEXT;
ALTER TABLE item_emails ADD COLUMN IF NOT EXISTS body_html    TEXT;
ALTER TABLE item_emails ADD COLUMN IF NOT EXISTS received_at  TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS idx_item_emails_message_id  ON item_emails(message_id);
CREATE INDEX IF NOT EXISTS idx_item_emails_in_reply_to ON item_emails(in_reply_to);

-- 2. Tag items with the email Message-ID that originally created them.
--    Lets us look up "the item for this thread" in O(1) on replies.
ALTER TABLE items ADD COLUMN IF NOT EXISTS source_message_id VARCHAR(512);
CREATE INDEX IF NOT EXISTS idx_items_source_message_id ON items(source_message_id);

-- 3. Dedup table — primary key is the email Message-ID. If a message_id
--    already exists here, the poller skips it. Survives restarts.
CREATE TABLE IF NOT EXISTS email_seen_messages (
  message_id  VARCHAR(512) PRIMARY KEY,
  mailbox     VARCHAR(255),
  processed_at TIMESTAMPTZ DEFAULT NOW(),
  result      VARCHAR(32)             -- 'created' | 'appended' | 'skipped' | 'error'
);

-- 4. Seed a system user for email-created items. Using a well-known email
--    lets us find/create idempotently. `created_by_user_id` on items is
--    nullable, but having a real row keeps joins and UIs happy.
INSERT INTO users (name, email, role, is_active)
SELECT 'Email Bot', 'noreply+bot@ddecor.com', 'user', true
WHERE NOT EXISTS (SELECT 1 FROM users WHERE email = 'noreply+bot@ddecor.com');

-- 5. Add a field to automations config to remember the last-seen Graph
--    delta token per-rule. Graph supports incremental sync which is much
--    cheaper than full poll; we'll use it in Phase 2. For now unused.
-- (no-op — stored inside trigger_config JSONB; no column change needed)

-- ═══════════════════════════════════════════════════════════════════════════
-- Done. Verify with:
--   \d item_emails
--   \d items
--   \d email_seen_messages
--   SELECT id, name, email FROM users WHERE email = 'noreply+bot@ddecor.com';
-- ═══════════════════════════════════════════════════════════════════════════
