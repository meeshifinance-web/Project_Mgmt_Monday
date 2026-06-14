-- ═══════════════════════════════════════════════════════════════════════════
-- Super Admin + Hidden User Schema — idempotent, safe to run multiple times
-- ═══════════════════════════════════════════════════════════════════════════
-- Purpose:
--   1. Introduce a "superadmin" role that sits above "admin". A superadmin has
--      unrestricted access to every board/item and all management surfaces.
--   2. Make accounts hide-able (users.is_hidden). The superadmin is hidden, so
--      it never appears in user management, people pickers, audit feeds, etc.
--
-- After running this migration, create the hidden superadmin with:
--   node backend/scripts/seed-superadmin.js
-- (reads SUPERADMIN_EMAIL / SUPERADMIN_PASSWORD / SUPERADMIN_NAME from env)
--
-- Run:
--   psql -U postgres -d <db_name> -f db/superadmin_schema.sql
-- ═══════════════════════════════════════════════════════════════════════════

-- 1. Hidden flag — when true the account is invisible to every other user.
ALTER TABLE users
  ADD COLUMN IF NOT EXISTS is_hidden BOOLEAN DEFAULT false;

-- 2. Allow the new role. The original inline CHECK only permitted
--    (admin, manager, user); the app also uses 'member'. Recreate the
--    constraint with the full, current set including 'superadmin'.
ALTER TABLE users DROP CONSTRAINT IF EXISTS users_role_check;
ALTER TABLE users
  ADD CONSTRAINT users_role_check
  CHECK (role IN ('superadmin', 'admin', 'manager', 'member', 'user'));

-- 3. Fast lookup of hidden accounts (used to exclude them from listings).
CREATE INDEX IF NOT EXISTS idx_users_is_hidden
  ON users(is_hidden) WHERE is_hidden = true;

-- ═══════════════════════════════════════════════════════════════════════════
-- Verify with:
--   SELECT id, email, role, is_hidden FROM users WHERE role = 'superadmin';
-- ═══════════════════════════════════════════════════════════════════════════
