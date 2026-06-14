// ───────────────────────────────────────────────────────────────────────────
// Seed (or update) the hidden super admin account.
//
//   node backend/scripts/seed-superadmin.js
//
// Reads credentials from the environment so they never live in code:
//   SUPERADMIN_EMAIL      (required)
//   SUPERADMIN_PASSWORD   (required, min 12 chars)
//   SUPERADMIN_NAME       (optional, defaults to "System")
//
// Idempotent: re-running updates the password / re-asserts the role and the
// hidden+active flags for the same email. Run db/superadmin_schema.sql first.
// ───────────────────────────────────────────────────────────────────────────
require('dotenv').config();
const pool = require('../db');
const bcrypt = require('bcryptjs');

async function main() {
  const email = (process.env.SUPERADMIN_EMAIL || '').trim().toLowerCase();
  const password = process.env.SUPERADMIN_PASSWORD || '';
  const name = (process.env.SUPERADMIN_NAME || 'System').trim();

  if (!email || !password) {
    console.error('✖ SUPERADMIN_EMAIL and SUPERADMIN_PASSWORD must be set in the environment.');
    process.exit(1);
  }
  if (password.length < 12) {
    console.error('✖ SUPERADMIN_PASSWORD must be at least 12 characters.');
    process.exit(1);
  }

  // Make sure the migration that adds is_hidden / the role constraint has run.
  const col = await pool.query(
    `SELECT 1 FROM information_schema.columns WHERE table_name='users' AND column_name='is_hidden'`
  );
  if (!col.rows.length) {
    console.error('✖ users.is_hidden is missing. Run: psql -f db/superadmin_schema.sql first.');
    process.exit(1);
  }

  const hash = await bcrypt.hash(password, 12);
  const { rows } = await pool.query(
    `INSERT INTO users (email, password_hash, name, role, is_hidden, is_active)
       VALUES ($1, $2, $3, 'superadmin', true, true)
     ON CONFLICT (email) DO UPDATE
       SET password_hash = EXCLUDED.password_hash,
           name          = EXCLUDED.name,
           role          = 'superadmin',
           is_hidden     = true,
           is_active     = true
     RETURNING id, email, role, is_hidden`,
    [email, hash, name]
  );

  const u = rows[0];
  console.log(`✅ Super admin ready: ${u.email} (id=${u.id}, role=${u.role}, hidden=${u.is_hidden})`);
  console.log('   This account is invisible to all other users, including admins.');
}

main()
  .then(() => pool.end())
  .catch((err) => { console.error('✖ Seed failed:', err.message); pool.end(); process.exit(1); });
