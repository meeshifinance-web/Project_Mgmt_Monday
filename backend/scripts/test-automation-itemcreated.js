/**
 * test-automation-itemcreated.js — verifies the item_created trigger runs
 * multiple actions through the real POST /api/items route.
 *   node scripts/test-automation-itemcreated.js
 */
require('dotenv').config();
const jwt = require('jsonwebtoken');
const pool = require('../db');

const BASE = 'http://localhost:3001/api';
const token = jwt.sign({ id: 1, name: 'Admin', email: 'admin@simplixart.com' }, process.env.JWT_SECRET, { expiresIn: '1h' });
const H = { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` };
const api = (m, p, body) => fetch(BASE + p, { method: m, headers: H, body: body ? JSON.stringify(body) : undefined }).then(async r => ({ status: r.status, data: await r.json().catch(() => null) }));

let pass = 0, fail = 0;
function ok(c, m) { if (c) { pass++; console.log('  ✅', m); } else { fail++; console.log('  ❌', m); } }

(async () => {
  const board_id = 1;
  const cols = (await pool.query('SELECT id,title,type,settings FROM columns WHERE board_id=$1', [board_id])).rows;
  const statusCol = cols.find(c => c.type === 'status');
  const dateCol = cols.find(c => c.type === 'date');
  const grp = (await pool.query('SELECT id FROM groups WHERE board_id=$1 ORDER BY id LIMIT 1', [board_id])).rows[0];
  const opts = (typeof statusCol.settings === 'string' ? JSON.parse(statusCol.settings) : statusCol.settings)?.options || [];
  const statusVal = opts[0]?.label || 'Not Started';

  let autoId, itemId;
  try {
    const created = await api('POST', '/automations', {
      board_id, name: 'On create: set status + due date + notify',
      trigger_type: 'item_created',
      trigger_config: {},
      conditions: [],
      actions: [
        { type: 'set_status', config: { column_id: statusCol.id, value: statusVal } },
        { type: 'notify', config: { message: 'New item created!' } },
        ...(dateCol ? [{ type: 'set_due_date', config: { column_id: dateCol.id, weekday: '3', weeks_ahead: 2 } }] : []),
      ],
    });
    ok(created.status === 201, `create automation → 201 (got ${created.status})`);
    autoId = created.data?.id;

    const item = await api('POST', '/items', { group_id: grp.id, name: 'IC-AUTO-' + Date.now() });
    ok(item.status === 201, `create item → 201 (got ${item.status})`);
    itemId = item.data?.id;
    const values = item.data?.values || {};
    ok(String(values[statusCol.id]) === statusVal, `item_created set_status applied (${values[statusCol.id]})`);
    if (dateCol) ok(!!values[dateCol.id], `item_created set_due_date applied (${values[dateCol.id]})`);
    ok((item.data?.triggeredAutomations || []).some(a => a.action_type === 'notify' && a.action_config?.message === 'New item created!'), 'notify surfaced on creation');

    console.log(`\n${fail === 0 ? '✅ ALL PASS' : '❌ FAILURES'} — ${pass} passed, ${fail} failed`);
  } catch (e) {
    console.error('TEST ERROR:', e); fail++;
  } finally {
    if (autoId) await api('DELETE', `/automations/${autoId}`).catch(() => {});
    if (itemId) {
      await pool.query('DELETE FROM notifications WHERE item_id=$1', [itemId]).catch(() => {});
      await pool.query('DELETE FROM activity_logs WHERE item_id=$1', [itemId]).catch(() => {});
      await pool.query('DELETE FROM column_values WHERE item_id=$1', [itemId]).catch(() => {});
      await pool.query('DELETE FROM items WHERE id=$1', [itemId]).catch(() => {});
    }
    await pool.end();
    process.exit(fail === 0 ? 0 : 1);
  }
})();
