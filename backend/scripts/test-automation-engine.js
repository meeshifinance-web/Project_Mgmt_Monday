/**
 * test-automation-engine.js  —  rigorous integration test for the shared
 * automation engine (conditions + multi-action). Runs against the live DB on a
 * throwaway item, asserts outcomes, then cleans everything up.
 *
 *   node scripts/test-automation-engine.js
 */
require('dotenv').config();
const pool = require('../db');
const {
  getConditions, getActions, evaluateConditions, executeActions,
} = require('../services/automationEngine');

let pass = 0, fail = 0;
function ok(cond, msg) { if (cond) { pass++; console.log('  ✅', msg); } else { fail++; console.log('  ❌', msg); } }

async function val(itemId, colId) {
  const r = await pool.query('SELECT value FROM column_values WHERE item_id=$1 AND column_id=$2', [itemId, colId]);
  return r.rows[0]?.value ?? null;
}
async function setVal(itemId, colId, value) {
  await pool.query(
    `INSERT INTO column_values (item_id,column_id,value) VALUES ($1,$2,$3)
     ON CONFLICT (item_id,column_id) DO UPDATE SET value=EXCLUDED.value`, [itemId, colId, value]);
}

(async () => {
  const board_id = 1;
  const cols = (await pool.query('SELECT id,title,type FROM columns WHERE board_id=$1', [board_id])).rows;
  const statusCol = cols.find(c => c.type === 'status');
  const personCol = cols.find(c => c.type === 'person');
  const dropCol   = cols.find(c => c.type === 'dropdown') || cols.find(c => c.type === 'status');
  const numCol    = cols.find(c => c.type === 'progress') || cols.find(c => c.type === 'number');
  const textCol   = cols.find(c => c.type === 'long_text') || cols.find(c => c.type === 'text');
  const grp = (await pool.query('SELECT id FROM groups WHERE board_id=$1 ORDER BY id LIMIT 1', [board_id])).rows[0];
  if (!statusCol || !personCol || !dropCol || !numCol || !grp) {
    console.error('Board 1 lacks the column types this test needs.'); process.exit(1);
  }

  const itemId = (await pool.query(
    'INSERT INTO items (group_id,name) VALUES ($1,$2) RETURNING id', [grp.id, 'AUTO-TEST-' + Date.now()])).rows[0].id;
  const actor = { id: 999999, name: 'Tester' }; // non-member id so notify won't exclude our owner

  const cleanup = async () => {
    await pool.query('DELETE FROM notifications WHERE item_id=$1', [itemId]).catch(() => {});
    await pool.query('DELETE FROM activity_logs WHERE item_id=$1', [itemId]).catch(() => {});
    await pool.query('DELETE FROM column_values WHERE item_id=$1', [itemId]).catch(() => {});
    await pool.query('DELETE FROM items WHERE id=$1', [itemId]).catch(() => {});
  };

  try {
    // Seed condition inputs: dropdown=High, progress=80, owner=Admin, notes empty
    await setVal(itemId, dropCol.id, 'High');
    await setVal(itemId, numCol.id, '80');
    await setVal(itemId, personCol.id, JSON.stringify(['Admin']));

    console.log('\n── Condition operators ──');
    ok(await evaluateConditions(pool, itemId, [{ column_id: dropCol.id, operator: 'is', value: 'High' }]), 'is High → pass');
    ok(!await evaluateConditions(pool, itemId, [{ column_id: dropCol.id, operator: 'is', value: 'Low' }]), 'is Low → fail');
    ok(await evaluateConditions(pool, itemId, [{ column_id: dropCol.id, operator: 'is_not', value: 'Low' }]), 'is_not Low → pass');
    ok(await evaluateConditions(pool, itemId, [{ column_id: numCol.id, operator: 'gt', value: '50' }]), 'progress gt 50 → pass');
    ok(!await evaluateConditions(pool, itemId, [{ column_id: numCol.id, operator: 'lt', value: '50' }]), 'progress lt 50 → fail');
    ok(await evaluateConditions(pool, itemId, [{ column_id: personCol.id, operator: 'contains', value: 'admin' }]), 'owner contains admin (ci) → pass');
    ok(await evaluateConditions(pool, itemId, [{ column_id: personCol.id, operator: 'is', value: 'Admin' }]), 'owner is Admin → pass');
    if (textCol) ok(await evaluateConditions(pool, itemId, [{ column_id: textCol.id, operator: 'is_empty', value: '' }]), 'empty notes is_empty → pass');
    ok(await evaluateConditions(pool, itemId, [
      { column_id: dropCol.id, operator: 'is', value: 'High' },
      { column_id: numCol.id, operator: 'gt', value: '50' },
    ]), 'AND of two passing conditions → pass');
    ok(!await evaluateConditions(pool, itemId, [
      { column_id: dropCol.id, operator: 'is', value: 'High' },
      { column_id: numCol.id, operator: 'lt', value: '50' },
    ]), 'AND with one failing condition → fail');

    console.log('\n── Multiple actions in one rule ──');
    const auto = { id: 1, name: 'Test rule' };
    const statusVal = (statusCol.settings?.options?.[0]?.label) || 'Done';
    const r = await executeActions(pool, {
      actions: [
        { type: 'set_status', config: { column_id: statusCol.id, value: statusVal } },
        { type: 'set_status', config: { column_id: numCol.id, value: '100' } },
        { type: 'notify',     config: { message: 'Two actions fired' } },
      ],
      auto, itemId, boardId: board_id, itemName: 'AUTO-TEST', actor,
    });
    ok(await val(itemId, statusCol.id) === statusVal, `action 1 set status → "${statusVal}"`);
    ok(await val(itemId, numCol.id) === '100', 'action 2 set progress → 100');
    ok(r.setValues.length === 2, 'two setValues returned to client');
    ok(r.notifies.length === 1, 'one notify surfaced for client toast');
    const notif = await pool.query('SELECT user_id,message FROM notifications WHERE item_id=$1', [itemId]);
    ok(notif.rows.some(n => n.message === 'Two actions fired'), 'notify persisted a notification row');

    console.log('\n── assign_person defers an email side-effect ──');
    const r2 = await executeActions(pool, {
      actions: [{ type: 'assign_person', config: { column_id: personCol.id, user_name: 'Rajesh Menon' } }],
      auto, itemId, boardId: board_id, itemName: 'AUTO-TEST', actor,
    });
    ok((await val(itemId, personCol.id) || '').includes('Rajesh Menon'), 'assign_person wrote the person column');
    ok(r2.deferred.length === 1, 'assign_person queued one deferred (assignment email)');

    console.log('\n── Legacy single-action fallback ──');
    const legacy = { action_type: 'set_status', action_config: JSON.stringify({ column_id: numCol.id, value: '42' }), actions: '[]' };
    const acts = getActions(legacy);
    ok(acts.length === 1 && acts[0].type === 'set_status' && acts[0].config.value === '42', 'getActions falls back to action_type/action_config');
    ok(getConditions({ conditions: '[]' }).length === 0, 'getConditions empty when none set');

    console.log('\n── move_to_group cross-board guard ──');
    const otherGrp = (await pool.query('SELECT id FROM groups WHERE board_id<>$1 ORDER BY id LIMIT 1', [board_id])).rows[0];
    if (otherGrp) {
      const before = (await pool.query('SELECT group_id FROM items WHERE id=$1', [itemId])).rows[0].group_id;
      const r3 = await executeActions(pool, {
        actions: [{ type: 'move_to_group', config: { target_group_id: otherGrp.id } }],
        auto, itemId, boardId: board_id, itemName: 'AUTO-TEST', actor,
      });
      const after = (await pool.query('SELECT group_id FROM items WHERE id=$1', [itemId])).rows[0].group_id;
      ok(r3.movedItem === null && before === after, 'move to another board\'s group is refused');
    } else {
      console.log('  (skipped — no second board/group available)');
    }

    console.log(`\n${fail === 0 ? '✅ ALL PASS' : '❌ FAILURES'} — ${pass} passed, ${fail} failed`);
  } catch (e) {
    console.error('TEST ERROR:', e);
    fail++;
  } finally {
    await cleanup();
    await pool.end();
    process.exit(fail === 0 ? 0 : 1);
  }
})();
