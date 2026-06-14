require('dotenv').config();
const pool = require('./index');
const bcrypt = require('bcryptjs');

// ─────────────────────────────────────────────────────────────────────────────
// Seed for local testing. Idempotent — safe to run repeatedly.
//
// Creates four accounts and a board matrix that exercises the super-admin
// hierarchy so you can verify who sees what:
//
//   Board                            visibility  creator   members        admin? super?
//   TEST · Public (org-wide)         org_wide    manager   manager         ✅     ✅
//   TEST · Admin-owned (private)     private     admin     admin           ✅     ✅
//   TEST · Manager-only (private)    private     manager   manager         ❌     ✅
//   TEST · Shared with Admin         private     manager   manager+admin   ✅     ✅
//
// Log in as admin@simplixart.com to confirm the ❌ board is hidden; log in as
// the superadmin to confirm it sees all four AND never appears in User Mgmt.
// ─────────────────────────────────────────────────────────────────────────────

// Make the script self-sufficient: apply the superadmin/visibility schema bits
// if the migrations haven't been run yet (all idempotent).
async function ensureSchema(client) {
  await client.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS is_hidden BOOLEAN DEFAULT false`);
  await client.query(`ALTER TABLE users DROP CONSTRAINT IF EXISTS users_role_check`);
  await client.query(`ALTER TABLE users ADD CONSTRAINT users_role_check
                      CHECK (role IN ('superadmin','admin','manager','member','user'))`);
  await client.query(`ALTER TABLE boards ADD COLUMN IF NOT EXISTS
                      visibility VARCHAR(20) DEFAULT 'org_wide'`);
  await client.query(`ALTER TABLE boards ADD COLUMN IF NOT EXISTS
                      created_by INTEGER REFERENCES users(id) ON DELETE SET NULL`);
  await client.query(`CREATE TABLE IF NOT EXISTS board_members (
                        id SERIAL PRIMARY KEY,
                        board_id INTEGER REFERENCES boards(id) ON DELETE CASCADE,
                        user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
                        added_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
                        added_at TIMESTAMP DEFAULT NOW(),
                        UNIQUE(board_id, user_id))`);
}

// Upsert a user and return its id.
async function upsertUser(client, { email, password, name, role, hidden = false, updateOnConflict = false }) {
  const hash = await bcrypt.hash(password, 12);
  const onConflict = updateOnConflict
    ? `DO UPDATE SET password_hash = EXCLUDED.password_hash, name = EXCLUDED.name,
                     role = EXCLUDED.role, is_hidden = EXCLUDED.is_hidden, is_active = true`
    : `DO NOTHING`;
  await client.query(
    `INSERT INTO users (email, password_hash, name, role, is_hidden, is_active)
       VALUES ($1,$2,$3,$4,$5,true)
     ON CONFLICT (email) ${onConflict}`,
    [email.toLowerCase(), hash, name, role, hidden]
  );
  const { rows } = await client.query('SELECT id FROM users WHERE email=$1', [email.toLowerCase()]);
  return rows[0].id;
}

// Create a board (with one group + a couple items) only if it doesn't exist yet.
// Returns the board id either way.
async function ensureBoard(client, { name, visibility, createdBy, memberIds = [] }) {
  const existing = await client.query('SELECT id FROM boards WHERE name=$1 LIMIT 1', [name]);
  if (existing.rows.length) return existing.rows[0].id;

  const bRes = await client.query(
    `INSERT INTO boards (name, description, visibility, created_by)
       VALUES ($1,$2,$3,$4) RETURNING id`,
    [name, 'Super-admin hierarchy test board', visibility, createdBy]
  );
  const boardId = bRes.rows[0].id;

  for (const uid of memberIds) {
    await client.query(
      `INSERT INTO board_members (board_id, user_id, added_by)
         VALUES ($1,$2,$3) ON CONFLICT (board_id, user_id) DO NOTHING`,
      [boardId, uid, createdBy]
    );
  }

  const gRes = await client.query(
    'INSERT INTO groups (board_id, name, color, position) VALUES ($1,$2,$3,0) RETURNING id',
    [boardId, 'Tasks', '#0073ea']
  );
  const groupId = gRes.rows[0].id;
  for (let i = 0; i < 2; i++) {
    await client.query(
      'INSERT INTO items (group_id, name, position) VALUES ($1,$2,$3)',
      [groupId, `${name} — item ${i + 1}`, i]
    );
  }
  return boardId;
}

async function seedDemoBoard(client, adminId) {
  const { rows } = await client.query('SELECT COUNT(*) FROM boards');
  if (parseInt(rows[0].count) > 0) {
    console.log('• Demo board(s) already present — skipping the main demo board.');
    return;
  }

  const boardRes = await client.query(
    `INSERT INTO boards (name, description, visibility, created_by)
       VALUES ('Simplix Project Board', 'Main project tracking board', 'org_wide', $1) RETURNING id`,
    [adminId]
  );
  const boardId = boardRes.rows[0].id;

  const columns = [
    { title: 'Status', type: 'status', settings: { options: [{ label: 'Not Started', color: '#c4c4c4' }, { label: 'In Progress', color: '#fdab3d' }, { label: 'Done', color: '#00c875' }, { label: 'Stuck', color: '#e2445c' }, { label: 'Review', color: '#a25ddc' }] }, position: 0 },
    { title: 'Owner', type: 'person', settings: {}, position: 1 },
    { title: 'Due Date', type: 'date', settings: {}, position: 2 },
    { title: 'Priority', type: 'dropdown', settings: { options: ['Low', 'Medium', 'High', 'Critical'] }, position: 3 },
    { title: 'Progress', type: 'progress', settings: {}, position: 4 },
    { title: 'Notes', type: 'long_text', settings: {}, position: 5 },
  ];
  const colIds = [];
  for (const col of columns) {
    const r = await client.query(
      'INSERT INTO columns (board_id, title, type, settings, position) VALUES ($1,$2,$3,$4,$5) RETURNING id',
      [boardId, col.title, col.type, JSON.stringify(col.settings), col.position]
    );
    colIds.push(r.rows[0].id);
  }

  const groups = [
    { name: 'Design Phase', color: '#0073ea', position: 0 },
    { name: 'Production', color: '#00c875', position: 1 },
    { name: 'Dispatch', color: '#fdab3d', position: 2 },
  ];
  for (const grp of groups) {
    const gRes = await client.query(
      'INSERT INTO groups (board_id, name, color, position) VALUES ($1,$2,$3,$4) RETURNING id',
      [boardId, grp.name, grp.color, grp.position]
    );
    const groupId = gRes.rows[0].id;
    const itemNames = grp.name === 'Design Phase'
      ? ['Sofa Collection Designs', 'Curtain Patterns Q2', 'Color Palette Review']
      : grp.name === 'Production'
      ? ['Upholstery Fabric Weaving', 'Quality Check Batch 1', 'Dye Testing']
      : ['Shipment to Delhi Warehouse', 'Export Order #4521', 'Local Delivery Run'];
    for (let i = 0; i < itemNames.length; i++) {
      const iRes = await client.query(
        'INSERT INTO items (group_id, name, position) VALUES ($1,$2,$3) RETURNING id',
        [groupId, itemNames[i], i]
      );
      const itemId = iRes.rows[0].id;
      const values = ['In Progress', 'Anupam Kumar', '2026-04-15', 'High', '45', 'Working on it'];
      for (let j = 0; j < colIds.length; j++) {
        await client.query(
          'INSERT INTO column_values (item_id, column_id, value) VALUES ($1,$2,$3)',
          [itemId, colIds[j], values[j] || '']
        );
      }
    }
  }

  await client.query(
    `INSERT INTO automations (board_id, name, trigger_type, trigger_config, action_type, action_config, enabled)
       VALUES ($1,$2,$3,$4,$5,$6,$7)`,
    [
      boardId, 'Notify on Status Done', 'status_change',
      JSON.stringify({ column_title: 'Status', to_value: 'Done' }),
      'send_email',
      JSON.stringify({ to: 'manager@simplixart.com', subject: 'Item marked Done', body: 'An item has been marked as Done on the board.' }),
      true,
    ]
  );
  console.log('• Demo board "Simplix Project Board" created (public, owned by admin).');
}

async function seed() {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await ensureSchema(client);

    // ── Accounts ──────────────────────────────────────────────────────────────
    const adminId = await upsertUser(client, { email: 'admin@simplixart.com', password: 'Admin@1234', name: 'Admin', role: 'admin' });
    const managerId = await upsertUser(client, { email: 'manager@simplixart.com', password: 'Manager@1234', name: 'Manager', role: 'manager' });
    await upsertUser(client, { email: 'member@simplixart.com', password: 'Member@1234', name: 'Member', role: 'member' });

    // Hidden superadmin — credentials come from env (falls back to the test default).
    const superEmail = (process.env.SUPERADMIN_EMAIL || 'superadmin@simplixart.com').toLowerCase();
    const superPass = process.env.SUPERADMIN_PASSWORD || 'superadmin@123';
    const superName = process.env.SUPERADMIN_NAME || 'System';
    await upsertUser(client, { email: superEmail, password: superPass, name: superName, role: 'superadmin', hidden: true, updateOnConflict: true });

    // ── Boards: the main demo + the hierarchy test matrix ──────────────────────
    await seedDemoBoard(client, adminId);
    await ensureBoard(client, { name: 'TEST · Public (org-wide)',       visibility: 'org_wide', createdBy: managerId, memberIds: [managerId] });
    await ensureBoard(client, { name: 'TEST · Admin-owned (private)',   visibility: 'private',  createdBy: adminId,   memberIds: [adminId] });
    await ensureBoard(client, { name: 'TEST · Manager-only (private)',  visibility: 'private',  createdBy: managerId, memberIds: [managerId] });
    await ensureBoard(client, { name: 'TEST · Shared with Admin',       visibility: 'private',  createdBy: managerId, memberIds: [managerId, adminId] });

    await client.query('COMMIT');

    console.log('\n✅ Seed complete. Test accounts:');
    console.log('   admin@simplixart.com      / Admin@1234     (admin — scoped board access)');
    console.log('   manager@simplixart.com    / Manager@1234   (manager)');
    console.log('   member@simplixart.com     / Member@1234    (member, read-only-ish)');
    console.log(`   ${superEmail}  / ${superPass}   (SUPERADMIN — hidden, sees everything)`);
    console.log('\n   Expected: admin sees all TEST boards EXCEPT "Manager-only (private)".');
    console.log('   The superadmin sees all four and never appears in User Management.\n');
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('Seed failed:', err);
    process.exitCode = 1;
  } finally {
    client.release();
    await pool.end();
  }
}

seed();
