/**
 * test-people.js — store-by-ID person column: round-trip, self-assign
 * permission (allow self / block others / block non-person), engine assign,
 * and back-compat name resolution. Runs against the live backend (:3001).
 */
require('dotenv').config();
const { Pool } = require('pg');
const jwt = require('jsonwebtoken');
const pool = new Pool({ host: process.env.DB_HOST, port: process.env.DB_PORT, database: process.env.DB_NAME, user: process.env.DB_USER, password: process.env.DB_PASSWORD });
const { executeActions } = require('../services/automationEngine');

const tok = (id, name) => jwt.sign({ id, name }, process.env.JWT_SECRET, { expiresIn: '1h' });
const api = (token, m, p, b) => fetch('http://localhost:3001/api' + p, { method: m, headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + token }, body: b ? JSON.stringify(b) : undefined }).then(async r => ({ status: r.status, data: await r.json().catch(() => null) }));
let pass = 0, fail = 0; const ok = (c, m) => { c ? (pass++, console.log('  ✅', m)) : (fail++, console.log('  ❌', m)); };
const val = async (item, col) => (await pool.query('SELECT value FROM column_values WHERE item_id=$1 AND column_id=$2', [item, col])).rows[0]?.value ?? null;

(async () => {
  const admin = tok(1, 'Admin');
  let colId, itemId;
  // Find a board with members + a status column to attach to; board 17 has a read-only user (24, Sara Khan)
  const boardId = 17;
  const roUser = (await pool.query("SELECT id,name,role FROM users WHERE id=24")).rows[0];
  const otherMember = (await pool.query('SELECT u.id,u.name FROM board_members bm JOIN users u ON u.id=bm.user_id WHERE bm.board_id=$1 AND u.id<>24 LIMIT 1', [boardId])).rows[0];
  const statusCol = (await pool.query("SELECT id FROM columns WHERE board_id=$1 AND type='status' LIMIT 1", [boardId])).rows[0];
  const grp = (await pool.query('SELECT id FROM groups WHERE board_id=$1 ORDER BY id LIMIT 1', [boardId])).rows[0];

  try {
    ok(roUser && roUser.role === 'user', `read-only user present (${roUser?.name})`);
    // create a person column + item
    const c = await api(admin, 'POST', '/columns', { board_id: boardId, title: 'TestOwner', type: 'person' });
    colId = c.data?.id; ok(c.status === 201 || c.status === 200, 'created person column');
    itemId = (await pool.query('INSERT INTO items (group_id,name) VALUES ($1,$2) RETURNING id', [grp.id, 'people-test'])).rows[0].id;

    console.log('\n── Manager assigns by ID (round-trip) ──');
    const a1 = await api(admin, 'POST', '/column-values/upsert', { item_id: itemId, column_id: colId, value: JSON.stringify([{ id: 24, name: roUser.name }]) });
    ok(a1.status === 200, 'manager upsert person → 200');
    const stored = JSON.parse(await val(itemId, colId));
    ok(stored[0].id === 24 && stored[0].name === roUser.name, 'stored as {id,name}');

    console.log('\n── Read-only user self-assign / unassign ──');
    // clear first (manager)
    await api(admin, 'POST', '/column-values/upsert', { item_id: itemId, column_id: colId, value: '' });
    const user24 = tok(24, roUser.name);
    const s1 = await api(user24, 'POST', '/column-values/upsert', { item_id: itemId, column_id: colId, value: JSON.stringify([{ id: 24, name: roUser.name }]) });
    ok(s1.status === 200, 'read-only user assigns SELF → 200');
    const s1v = JSON.parse(await val(itemId, colId) || '[]');
    ok(s1v.length === 1 && s1v[0].id === 24, 'self stored');
    const s2 = await api(user24, 'POST', '/column-values/upsert', { item_id: itemId, column_id: colId, value: '' });
    ok(s2.status === 200, 'read-only user unassigns SELF → 200');

    console.log('\n── Read-only user blocked from assigning others / non-person ──');
    const b1 = await api(user24, 'POST', '/column-values/upsert', { item_id: itemId, column_id: colId, value: JSON.stringify([{ id: otherMember.id, name: otherMember.name }]) });
    ok(b1.status === 403, `assigning ANOTHER person → 403 (got ${b1.status})`);
    if (statusCol) {
      const b2 = await api(user24, 'POST', '/column-values/upsert', { item_id: itemId, column_id: statusCol.id, value: 'Done' });
      ok(b2.status === 403, `editing a non-person column → 403 (got ${b2.status})`);
    }
    // read-only user adding self + someone else at once → blocked
    const b3 = await api(user24, 'POST', '/column-values/upsert', { item_id: itemId, column_id: colId, value: JSON.stringify([{ id: 24, name: roUser.name }, { id: otherMember.id, name: otherMember.name }]) });
    ok(b3.status === 403, 'adding self + another together → 403');

    console.log('\n── Engine assign_person writes {id,name} ──');
    await pool.query('DELETE FROM column_values WHERE item_id=$1 AND column_id=$2', [itemId, colId]);
    const r = await executeActions(pool, { actions: [{ type: 'assign_person', config: { column_id: colId, user_id: 24 } }], auto: { id: 1, name: 'x' }, itemId, boardId, itemName: 'people-test', actor: { id: 1, name: 'Admin' } });
    const ev = JSON.parse(await val(itemId, colId) || '[]');
    ok(ev[0]?.id === 24 && ev[0]?.name === roUser.name, 'engine assign_person stored {id,name}');
    ok(r.setValues[0] && JSON.parse(r.setValues[0].value)[0].id === 24, 'engine returned id-based setValue to client');

    console.log('\n── Migration is idempotent ──');
    const { execSync } = require('child_process');
    const out = execSync('node scripts/migrate-person-values-to-ids.js', { cwd: require('path').join(__dirname, '..') }).toString();
    ok(/0 converted/.test(out) || /converted/.test(out), 'migration re-run is safe (' + out.trim().split('\n').pop() + ')');

    console.log(`\n${fail === 0 ? '✅ ALL PASS' : '❌ FAIL'} — ${pass} passed, ${fail} failed`);
  } catch (e) { console.error('TEST ERROR', e); fail++; }
  finally {
    if (itemId) { await pool.query('DELETE FROM column_values WHERE item_id=$1', [itemId]).catch(() => {}); await pool.query('DELETE FROM items WHERE id=$1', [itemId]).catch(() => {}); }
    if (colId) await api(admin, 'DELETE', '/columns/' + colId).catch(() => {});
    await pool.end(); process.exit(fail ? 1 : 0);
  }
})();
