-- ═══════════════════════════════════════════════════════════════════════════
-- Date-Arrives Schema — idempotent, safe to run multiple times
-- ═══════════════════════════════════════════════════════════════════════════
-- Stores a small dedup table so the date_arrives cron engine never fires
-- the same (automation, item) combination twice on the same calendar day.
-- Without this, restarting the backend after a fire would re-trigger every
-- rule that's matched today — duplicate emails, duplicate notifications.
--
-- Run:
--   psql -U postgres -d <db_name> -f db/date_arrives_schema.sql
-- ═══════════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS date_arrives_fired (
  automation_id  INTEGER NOT NULL REFERENCES automations(id) ON DELETE CASCADE,
  item_id        INTEGER NOT NULL REFERENCES items(id)       ON DELETE CASCADE,
  fire_date      DATE    NOT NULL,
  fired_at       TIMESTAMPTZ DEFAULT NOW(),
  PRIMARY KEY (automation_id, item_id, fire_date)
);

-- Cleanup index — used by the periodic vacuum that drops rows older than
-- 60 days (the engine runs this on each tick to keep the table tiny).
CREATE INDEX IF NOT EXISTS idx_date_arrives_fired_date
  ON date_arrives_fired(fire_date);

-- ═══════════════════════════════════════════════════════════════════════════
-- Verify with:
--   \d date_arrives_fired
--   SELECT count(*) FROM date_arrives_fired;
-- ═══════════════════════════════════════════════════════════════════════════
