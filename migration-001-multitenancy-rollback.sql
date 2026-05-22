-- ============================================================
-- Rollback for Migration 001: Multi-tenant foundation
--
-- Removes everything `migration-001-multitenancy.sql` added:
--   • tenant_id column on every domain table (27 tables)
--   • tenant indexes (auto-dropped with the column, listed for clarity)
--   • tenants table itself
--
-- IDEMPOTENT — uses `IF EXISTS` everywhere, so running it twice is safe.
--
-- ⚠️  RUN THIS *ONLY* IF you have decided to abandon multi-tenancy at the DB
--    layer and split clients across separate Docker / DB instances instead.
--    Any data in `tenants` is permanently lost. Existing rows are untouched
--    (they just lose their tenant_id annotation).
--
-- Usage (psql):
--   psql -U postgres -d workboard_db -f migration-001-multitenancy-rollback.sql
-- ============================================================

BEGIN;

-- ---- 1. Drop tenant_id from every domain table ----
-- DROP COLUMN cascades to its FK constraint and the per-table tenant index,
-- so we don't have to drop those separately.

ALTER TABLE users                  DROP COLUMN IF EXISTS tenant_id;
ALTER TABLE boards                 DROP COLUMN IF EXISTS tenant_id;
ALTER TABLE board_folders          DROP COLUMN IF EXISTS tenant_id;
ALTER TABLE board_members          DROP COLUMN IF EXISTS tenant_id;
ALTER TABLE board_views            DROP COLUMN IF EXISTS tenant_id;
ALTER TABLE board_step_templates   DROP COLUMN IF EXISTS tenant_id;
ALTER TABLE board_automation_rules DROP COLUMN IF EXISTS tenant_id;
ALTER TABLE groups                 DROP COLUMN IF EXISTS tenant_id;
ALTER TABLE items                  DROP COLUMN IF EXISTS tenant_id;
ALTER TABLE columns                DROP COLUMN IF EXISTS tenant_id;
ALTER TABLE column_values          DROP COLUMN IF EXISTS tenant_id;
ALTER TABLE column_value_meta      DROP COLUMN IF EXISTS tenant_id;
ALTER TABLE comments               DROP COLUMN IF EXISTS tenant_id;
ALTER TABLE forms                  DROP COLUMN IF EXISTS tenant_id;
ALTER TABLE form_fields            DROP COLUMN IF EXISTS tenant_id;
ALTER TABLE automations            DROP COLUMN IF EXISTS tenant_id;
ALTER TABLE automation_logs        DROP COLUMN IF EXISTS tenant_id;
ALTER TABLE dashboards             DROP COLUMN IF EXISTS tenant_id;
ALTER TABLE dashboard_widgets      DROP COLUMN IF EXISTS tenant_id;
ALTER TABLE notifications          DROP COLUMN IF EXISTS tenant_id;
ALTER TABLE activity_logs          DROP COLUMN IF EXISTS tenant_id;
ALTER TABLE api_keys               DROP COLUMN IF EXISTS tenant_id;
ALTER TABLE trash_items            DROP COLUMN IF EXISTS tenant_id;
ALTER TABLE item_emails            DROP COLUMN IF EXISTS tenant_id;
ALTER TABLE password_reset_tokens  DROP COLUMN IF EXISTS tenant_id;
ALTER TABLE date_arrives_fired     DROP COLUMN IF EXISTS tenant_id;
ALTER TABLE email_seen_messages    DROP COLUMN IF EXISTS tenant_id;

-- ---- 2. Drop the tenants table itself ----
-- All FKs pointing at it were dropped along with the tenant_id columns above,
-- so this DROP is unconstrained. No CASCADE needed.

DROP INDEX  IF EXISTS idx_tenants_slug_active;
DROP TABLE  IF EXISTS tenants;

COMMIT;

-- ---- 3. Verification ----
-- Both queries should return 0 rows when the rollback succeeded.

SELECT table_name, column_name
  FROM information_schema.columns
 WHERE column_name = 'tenant_id'
   AND table_schema = 'public';

SELECT 1 FROM information_schema.tables
 WHERE table_name = 'tenants' AND table_schema = 'public';
