/**
 * test-automation-combos.js — broad combination coverage for the automation
 * engine: every action type (incl. move success + send_email), more operators,
 * many actions in one rule, and the date_arrives trigger with a condition gate.
 * Runs against the live DB (no HTTP). Cleans up after itself.
 *
 *   node scripts/test-automation-combos.js
 */
require('dotenv').config();
const pool = require('../db');
const { evaluateConditions, executeActions } = require('../services/automationEngine');
const { runDateArrivesEngine } = require('../services/dateArrivesEngine');

let pass = 0, fail = 0;
function ok(c, m) { if (c) { pass++; console.log('  ✅', m); } else { fail++; console.log('  ❌', m); } }
const todayISO = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`; };

async function val(itemId, colId) {
  const r = await pool.query('SELECT value FROM column_values WHERE item_id=$1 AND column_id=$2', [itemId, colId]);
  return r.rows[0]?.value ?? null;
}
const setVal = (itemId, colId, value) => pool.query(
  `INSERT INTO column_values (item_id,column_id,value) VALUES ($1,$2,$3)
   ON CONFLICT (item_id,column_id) DO UPDATE SET value=EXCLUDED.value`, [itemId, colId, value]);

(async () => {
  const board_id = 1;
  const cols = (await pool.query('SELECT id,title,type,settings FROM columns WHERE board_id=$1', [board_id])).rows;
  const statusCol = cols.find(c => c.type === 'status');
  const personCol = cols.find(c => c.type === 'person');
  const dropCol   = cols.find(c => c.type === 'dropdown') || cols.find(c => c.type === 'status');
  const numCol    = cols.find(c => c.type === 'progress') || cols.find(c => c.type === 'number');
  const dateCol   = cols.find(c => c.type === 'date');
  const groups = (await pool.query('SELECT id FROM groups WHERE board_id=$1 ORDER BY id', [board_id])).rows;
  const grpA = groups[0], grpB = groups[1] || groups[0];
  const statusVal = (typeof statusCol.settings === 'string' ? JSON.parse(statusCol.settings) : statusCol.settings)?.options?.[0]?.label || 'Not Started';
  const statusVal2 = (typeof statusCol.settings === 'string' ? JSON.parse(statusCol.settings) : statusCol.settings)?.options?.[1]?.label || statusVal;

  const items = [];
  const mkItem = async (name, gid = grpA.id) => { const id = (await pool.query('INSERT INTO items (group_id,name) VALUES ($1,$2) RETURNING id', [gid, name])).rows[0].id; items.push(id); return id; };
  const autos = [];

  try {
    const auto = { id: 1, name: 'combo' };
    const actor = { id: 999999, name: 'Tester' };

    console.log('\n── More operators ──');
    const it = await mkItem('combo-ops');
    await setVal(it, dropCol.id, 'High');
    await setVal(it, personCol.id, JSON.stringify(['Admin']));
    ok(await evaluateConditions(pool, it, [{ column_id: dropCol.id, operator: 'not_contains', value: 'Low' }]), 'not_contains Low → pass');
    ok(!await evaluateConditions(pool, it, [{ column_id: dropCol.id, operator: 'not_contains', value: 'High' }]), 'not_contains High → fail');
    ok(await evaluateConditions(pool, it, [{ column_id: personCol.id, operator: 'is_not_empty', value: '' }]), 'owner is_not_empty → pass');
    ok(!await evaluateConditions(pool, it, [{ column_id: numCol.id, operator: 'is_not_empty', value: '' }]), 'unset progress is_not_empty → fail');

    console.log('\n── move_to_group SUCCESS (same board) ──');
    const itMove = await mkItem('combo-move', grpA.id);
    const rMove = await executeActions(pool, {
      actions: [{ type: 'move_to_group', config: { target_group_id: grpB.id } }],
      auto, itemId: itMove, boardId: board_id, itemName: 'combo-move', actor,
    });
    const movedGid = (await pool.query('SELECT group_id FROM items WHERE id=$1', [itMove])).rows[0].group_id;
    ok(rMove.movedItem && String(movedGid) === String(grpB.id), `item moved to group ${grpB.id}`);

    console.log('\n── ALL action types in ONE rule (5 actions) ──');
    const itAll = await mkItem('combo-all', grpA.id);
    const rAll = await executeActions(pool, {
      actions: [
        { type: 'set_status',    config: { column_id: statusCol.id, value: statusVal2 } },
        { type: 'assign_person', config: { column_id: personCol.id, user_name: 'Priya Sharma' } },
        ...(dateCol ? [{ type: 'set_due_date', config: { column_id: dateCol.id, weekday: '2', weeks_ahead: 1 } }] : []),
        { type: 'notify',        config: { message: 'all actions' } },
        { type: 'send_email',    config: { to_type: 'specific', to: 'nobody@example.com', subject: 'x', body: 'y' } },
        { type: 'move_to_group', config: { target_group_id: grpB.id } },
      ],
      auto, itemId: itAll, boardId: board_id, itemName: 'combo-all', actor,
    });
    ok(await val(itAll, statusCol.id) === statusVal2, 'set_status applied');
    ok((await val(itAll, personCol.id) || '').includes('Priya Sharma'), 'assign_person applied');
    if (dateCol) ok(!!(await val(itAll, dateCol.id)), 'set_due_date applied');
    ok(rAll.notifies.length === 1, 'notify surfaced');
    ok(rAll.deferred.length === 2, 'two deferred side-effects (assignment email + send_email)');
    ok(rAll.movedItem && String(rAll.movedItem.group_id) === String(grpB.id), 'move_to_group applied');
    ok(rAll.setValues.length >= 2, 'setValues collected for client');

    console.log('\n── date_arrives trigger + condition gate ──');
    if (!dateCol) { console.log('  (skipped — no date column)'); }
    else {
      const mkAuto = async (conds) => {
        const r = await pool.query(
          `INSERT INTO automations (board_id,name,trigger_type,trigger_config,action_type,action_config,conditions,actions,enabled)
           VALUES ($1,$2,'date_arrives',$3,'set_status',$4,$5,$6,true) RETURNING id`,
          [board_id, 'combo date_arrives',
           JSON.stringify({ column_id: dateCol.id, mode: 'on', offset_days: 0 }),
           JSON.stringify({ column_id: statusCol.id, value: statusVal2 }),
           JSON.stringify(conds),
           JSON.stringify([{ type: 'set_status', config: { column_id: statusCol.id, value: statusVal2 } }, { type: 'notify', config: { message: 'date arrived' } }])]);
        autos.push(r.rows[0].id); return r.rows[0].id;
      };
      const aid = await mkAuto([{ column_id: dropCol.id, operator: 'is', value: 'High' }]);
      const itPass = await mkItem('combo-date-pass'); await setVal(itPass, dateCol.id, todayISO()); await setVal(itPass, dropCol.id, 'High');
      const itFail = await mkItem('combo-date-fail'); await setVal(itFail, dateCol.id, todayISO()); await setVal(itFail, dropCol.id, 'Low');
      await runDateArrivesEngine();
      ok(await val(itPass, statusCol.id) === statusVal2, 'date_arrives fired when condition met');
      ok(await val(itFail, statusCol.id) === null, 'date_arrives skipped when condition fails');
      const firedPass = await pool.query('SELECT 1 FROM date_arrives_fired WHERE automation_id=$1 AND item_id=$2', [aid, itPass]);
      const firedFail = await pool.query('SELECT 1 FROM date_arrives_fired WHERE automation_id=$1 AND item_id=$2', [aid, itFail]);
      ok(firedPass.rows.length === 1, 'dedup row recorded for fired item');
      ok(firedFail.rows.length === 0, 'no dedup row for condition-failed item (stays eligible)');
    }

    console.log(`\n${fail === 0 ? '✅ ALL PASS' : '❌ FAILURES'} — ${pass} passed, ${fail} failed`);
  } catch (e) {
    console.error('TEST ERROR:', e); fail++;
  } finally {
    for (const id of autos) {
      await pool.query('DELETE FROM date_arrives_fired WHERE automation_id=$1', [id]).catch(() => {});
      await pool.query('DELETE FROM automations WHERE id=$1', [id]).catch(() => {});
    }
    for (const id of items) {
      await pool.query('DELETE FROM notifications WHERE item_id=$1', [id]).catch(() => {});
      await pool.query('DELETE FROM activity_logs WHERE item_id=$1', [id]).catch(() => {});
      await pool.query('DELETE FROM column_values WHERE item_id=$1', [id]).catch(() => {});
      await pool.query('DELETE FROM items WHERE id=$1', [id]).catch(() => {});
    }
    await pool.end();
    process.exit(fail === 0 ? 0 : 1);
  }
})();
