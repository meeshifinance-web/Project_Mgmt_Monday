/**
 * test-automation-http.js — end-to-end test of the automation feature through
 * the real HTTP routes: CRUD via /api/automations, plus a live status_change
 * firing through /api/column-values/upsert with conditions + multiple actions.
 *
 * Requires the backend running on :3001. Authenticates by signing a JWT with
 * the dev JWT_SECRET (admin user id 1).
 *
 *   node scripts/test-automation-http.js
 */
require('dotenv').config();
const jwt = require('jsonwebtoken');
const pool = require('../db');

const BASE = 'http://localhost:3001/api';
const token = jwt.sign({ id: 1, name: 'Admin', email: 'admin@simplixart.com' }, process.env.JWT_SECRET, { expiresIn: '1h' });
const H = { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` };

let pass = 0, fail = 0;
function ok(c, m) { if (c) { pass++; console.log('  ✅', m); } else { fail++; console.log('  ❌', m); } }
const api = (m, p, body) => fetch(BASE + p, { method: m, headers: H, body: body ? JSON.stringify(body) : undefined }).then(async r => ({ status: r.status, data: await r.json().catch(() => null) }));

(async () => {
  const board_id = 1;
  const cols = (await pool.query('SELECT id,title,type,settings FROM columns WHERE board_id=$1', [board_id])).rows;
  const statusCol = cols.find(c => c.type === 'status');
  const personCol = cols.find(c => c.type === 'person');
  const dropCol   = cols.find(c => c.type === 'dropdown') || cols.find(c => c.type === 'status');
  const dateCol   = cols.find(c => c.type === 'date');
  const grp = (await pool.query('SELECT id FROM groups WHERE board_id=$1 ORDER BY id LIMIT 1', [board_id])).rows[0];
  const opts = (typeof statusCol.settings === 'string' ? JSON.parse(statusCol.settings) : statusCol.settings)?.options || [];
  const triggerVal = opts[1]?.label || opts[0]?.label || 'Stuck';

  const createItem = async (name) => (await pool.query(
    'INSERT INTO items (group_id,name) VALUES ($1,$2) RETURNING id', [grp.id, name])).rows[0].id;
  const setVal = (itemId, colId, value) => pool.query(
    `INSERT INTO column_values (item_id,column_id,value) VALUES ($1,$2,$3)
     ON CONFLICT (item_id,column_id) DO UPDATE SET value=EXCLUDED.value`, [itemId, colId, value]);
  const getVal = async (itemId, colId) => (await pool.query(
    'SELECT value FROM column_values WHERE item_id=$1 AND column_id=$2', [itemId, colId])).rows[0]?.value ?? null;

  let autoId, itemPass, itemBlock;
  try {
    console.log('\n── CRUD: create automation with conditions + multiple actions ──');
    const created = await api('POST', '/automations', {
      board_id, name: 'HTTP multi-action rule',
      trigger_type: 'status_change',
      trigger_config: { column_id: statusCol.id, to_value: triggerVal },
      conditions: [{ column_id: dropCol.id, operator: 'is', value: 'High' }],
      actions: [
        { type: 'assign_person', config: { column_id: personCol.id, user_name: 'Rajesh Menon' } },
        { type: 'notify', config: { message: 'HTTP test fired' } },
        ...(dateCol ? [{ type: 'set_due_date', config: { column_id: dateCol.id, weekday: '1', weeks_ahead: 1 } }] : []),
      ],
    });
    ok(created.status === 201, `POST /automations → 201 (got ${created.status})`);
    autoId = created.data?.id;
    ok(Array.isArray(created.data?.conditions) && created.data.conditions.length === 1, 'conditions persisted as array');
    ok(Array.isArray(created.data?.actions) && created.data.actions.length >= 2, 'actions persisted as array');
    ok(created.data?.action_type === 'assign_person', 'legacy action_type mirrored from first action');

    console.log('\n── Fire with condition SATISFIED → all actions run ──');
    itemPass = await createItem('HTTP-AUTO-PASS-' + Date.now());
    await setVal(itemPass, dropCol.id, 'High'); // satisfies condition
    const fire = await api('POST', '/column-values/upsert', { item_id: itemPass, column_id: statusCol.id, value: triggerVal });
    ok(fire.status === 200, `upsert → 200 (got ${fire.status})`);
    const sv = fire.data?.setValues || [];
    ok(sv.some(x => String(x.column_id) === String(personCol.id) && String(x.value).includes('Rajesh Menon')), 'assign_person applied (setValues)');
    if (dateCol) ok(sv.some(x => String(x.column_id) === String(dateCol.id)), 'set_due_date applied (setValues)');
    ok((fire.data?.triggeredAutomations || []).some(a => a.action_type === 'notify' && a.action_config?.message === 'HTTP test fired'), 'notify surfaced to client toast');
    ok((await getVal(itemPass, personCol.id) || '').includes('Rajesh Menon'), 'DB: person column written');
    const notif = await pool.query('SELECT 1 FROM notifications WHERE item_id=$1 AND message=$2', [itemPass, 'HTTP test fired']);
    ok(notif.rows.length > 0, 'DB: notification row created');

    console.log('\n── Fire with condition NOT satisfied → actions skipped ──');
    itemBlock = await createItem('HTTP-AUTO-BLOCK-' + Date.now());
    await setVal(itemBlock, dropCol.id, 'Low'); // condition fails
    const fire2 = await api('POST', '/column-values/upsert', { item_id: itemBlock, column_id: statusCol.id, value: triggerVal });
    ok(fire2.status === 200, `upsert (blocked) → 200 (got ${fire2.status})`);
    ok((fire2.data?.setValues || []).length === 0, 'no setValues when condition fails');
    ok(await getVal(itemBlock, personCol.id) === null, 'DB: person column NOT written when condition fails');

    console.log('\n── Update automation (PUT) preserves arrays ──');
    const upd = await api('PUT', `/automations/${autoId}`, {
      name: 'HTTP multi-action rule (edited)',
      trigger_type: 'status_change',
      trigger_config: { column_id: statusCol.id, to_value: triggerVal },
      conditions: [{ column_id: dropCol.id, operator: 'is', value: 'High' }, { column_id: dropCol.id, operator: 'is_not', value: 'Low' }],
      actions: [{ type: 'notify', config: { message: 'edited' } }],
    });
    ok(upd.status === 200 && upd.data?.conditions?.length === 2, 'PUT updates conditions to 2');
    ok(upd.data?.actions?.length === 1 && upd.data.action_type === 'notify', 'PUT updates actions + mirror');

    console.log(`\n${fail === 0 ? '✅ ALL PASS' : '❌ FAILURES'} — ${pass} passed, ${fail} failed`);
  } catch (e) {
    console.error('TEST ERROR:', e); fail++;
  } finally {
    if (autoId) await api('DELETE', `/automations/${autoId}`).catch(() => {});
    for (const id of [itemPass, itemBlock].filter(Boolean)) {
      await pool.query('DELETE FROM notifications WHERE item_id=$1', [id]).catch(() => {});
      await pool.query('DELETE FROM activity_logs WHERE item_id=$1', [id]).catch(() => {});
      await pool.query('DELETE FROM column_values WHERE item_id=$1', [id]).catch(() => {});
      await pool.query('DELETE FROM items WHERE id=$1', [id]).catch(() => {});
    }
    await pool.end();
    process.exit(fail === 0 ? 0 : 1);
  }
})();
