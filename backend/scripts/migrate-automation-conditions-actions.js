/**
 * migrate-automation-conditions-actions.js
 *
 * Idempotent migration that upgrades the `automations` table to support
 * Monday-style recipes with MULTIPLE "only if" conditions and MULTIPLE
 * actions per rule.
 *
 *   conditions JSONB DEFAULT '[]'   — array of { column_id, operator, value }
 *   actions    JSONB DEFAULT '[]'   — array of { type, config }
 *
 * The legacy single-trigger/single-action columns (trigger_type,
 * trigger_config, action_type, action_config) are kept untouched so old
 * rows and any not-yet-migrated reader keep working. The engine treats an
 * empty `conditions` as "always pass" and an empty `actions` as "fall back
 * to the legacy action_type/action_config", so existing automations behave
 * exactly as before until edited.
 *
 * Run:  node scripts/migrate-automation-conditions-actions.js
 */

require('dotenv').config();
const pool = require('../db');

async function migrate() {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query(`ALTER TABLE automations ADD COLUMN IF NOT EXISTS conditions JSONB DEFAULT '[]'::jsonb`);
    await client.query(`ALTER TABLE automations ADD COLUMN IF NOT EXISTS actions    JSONB DEFAULT '[]'::jsonb`);
    // Backfill any NULLs (older rows created before the default existed).
    await client.query(`UPDATE automations SET conditions='[]'::jsonb WHERE conditions IS NULL`);
    await client.query(`UPDATE automations SET actions='[]'::jsonb    WHERE actions    IS NULL`);
    await client.query('COMMIT');
    console.log('✅ automations.conditions and automations.actions are present.');
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('❌ migration failed:', err.message);
    process.exitCode = 1;
  } finally {
    client.release();
    await pool.end();
  }
}

migrate();
