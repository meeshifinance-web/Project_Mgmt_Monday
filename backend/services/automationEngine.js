/**
 * automationEngine.js
 *
 * Single source of truth for evaluating an automation's "only if" CONDITIONS
 * and executing its list of ACTIONS. Both the status-change engine
 * (routes/columnValues.js), the item-created engine (routes/items.js) and the
 * date-arrives engine (services/dateArrivesEngine.js) call into here, so a rule
 * behaves identically no matter which trigger fired it.
 *
 * Data shapes (stored on the automations row):
 *   conditions: [{ column_id, operator, value }]        // ALL must pass (AND)
 *   actions:    [{ type, config }]                       // run in order
 *
 * Backward compatibility:
 *   - Empty/absent conditions  → always pass.
 *   - Empty/absent actions     → fall back to the legacy single
 *                                action_type / action_config columns.
 *   So pre-existing single-action automations keep working untouched.
 *
 * Side effects that must outlive the DB transaction (emails, assignment
 * notifications) are NOT run inline. executeActions() collects them as a
 * `deferred` array of zero-arg async functions; the caller runs them with
 * setImmediate AFTER commit so the rows are durable first.
 */

const { sendAutomationEmail } = require('./automationEmail');
const { notifyNewAssignees } = require('./assignmentEmail');
const { computeRelativeDate } = require('./relativeDate');

function parseJSON(v, fallback) {
  if (v == null) return fallback;
  if (typeof v === 'object') return v;
  try { return JSON.parse(v); } catch { return fallback; }
}

// Person-column value → array of names (JSON array, or legacy single string).
function parseOwnerEntries(val) {
  if (!val) return [];
  let arr;
  try { arr = JSON.parse(val); } catch { return String(val).trim() ? [{ id: null, name: String(val).trim() }] : []; }
  if (!Array.isArray(arr)) arr = arr ? [arr] : [];
  return arr.map(e => (e && typeof e === 'object') ? { id: e.id ?? null, name: e.name || '' } : { id: null, name: String(e) })
            .filter(e => e.name || e.id != null);
}
function parseOwners(val) { return parseOwnerEntries(val).map(e => e.name).filter(Boolean); }
function ownerIds(val) { return parseOwnerEntries(val).map(e => e.id).filter(id => id != null); }

// ── Normalise the stored rule into condition + action arrays ──────────────────
function getConditions(auto) {
  const arr = parseJSON(auto.conditions, []);
  return Array.isArray(arr) ? arr.filter(c => c && c.column_id && c.operator) : [];
}

function getActions(auto) {
  const arr = parseJSON(auto.actions, []);
  if (Array.isArray(arr) && arr.length) {
    return arr.filter(a => a && a.type).map(a => ({ type: a.type, config: a.config || {} }));
  }
  // Legacy fallback: single action_type / action_config.
  if (auto.action_type) {
    return [{ type: auto.action_type, config: parseJSON(auto.action_config, {}) }];
  }
  return [];
}

// ── Condition evaluation ──────────────────────────────────────────────────────
// `valueGetter(columnId)` returns the item's current stored value for a column
// (string or null). We pass a getter so callers can use either a cached values
// map (item_created) or a live DB lookup (status_change).
function matchOne(condition, rawValue) {
  const op = condition.operator;
  const expected = condition.value;
  const actual = rawValue == null ? '' : String(rawValue);

  // For person columns the stored value is a JSON array of names — flatten it
  // so equality / contains behave intuitively against a chosen name.
  const owners = parseOwners(rawValue);
  const haystack = owners.length ? owners.join(', ') : actual;

  const norm = s => String(s == null ? '' : s).trim().toLowerCase();

  switch (op) {
    case 'is':
    case 'equals':
      if (owners.length) return owners.some(o => norm(o) === norm(expected));
      return norm(actual) === norm(expected);
    case 'is_not':
    case 'not_equals':
      if (owners.length) return !owners.some(o => norm(o) === norm(expected));
      return norm(actual) !== norm(expected);
    case 'is_empty':
      return owners.length ? owners.length === 0 : actual.trim() === '';
    case 'is_not_empty':
      return owners.length ? owners.length > 0 : actual.trim() !== '';
    case 'contains':
      return norm(haystack).includes(norm(expected));
    case 'not_contains':
      return !norm(haystack).includes(norm(expected));
    case 'gt':
    case 'greater_than': {
      const a = parseFloat(actual), b = parseFloat(expected);
      return Number.isFinite(a) && Number.isFinite(b) && a > b;
    }
    case 'lt':
    case 'less_than': {
      const a = parseFloat(actual), b = parseFloat(expected);
      return Number.isFinite(a) && Number.isFinite(b) && a < b;
    }
    default:
      return true; // unknown operator → don't block the rule
  }
}

/**
 * Evaluate all conditions (AND). `db` is a pg client or pool.
 * Returns true when every condition passes (or there are none).
 */
async function evaluateConditions(db, itemId, conditions) {
  if (!conditions || !conditions.length) return true;
  // Batch-load the values for the referenced columns in one query.
  const colIds = [...new Set(conditions.map(c => parseInt(c.column_id)).filter(Number.isInteger))];
  const valueByCol = {};
  if (colIds.length) {
    const r = await db.query(
      'SELECT column_id, value FROM column_values WHERE item_id=$1 AND column_id = ANY($2)',
      [itemId, colIds]
    );
    for (const row of r.rows) valueByCol[String(row.column_id)] = row.value;
  }
  for (const c of conditions) {
    if (!matchOne(c, valueByCol[String(c.column_id)])) return false;
  }
  return true;
}

// ── Action execution ──────────────────────────────────────────────────────────
async function columnTitle(db, columnId) {
  if (!columnId) return null;
  const r = await db.query('SELECT title FROM columns WHERE id=$1', [columnId]);
  return r.rows[0]?.title || null;
}

async function logActivity(db, data) {
  try {
    await db.query(
      `INSERT INTO activity_logs (board_id,user_id,user_name,item_id,item_name,action,field,old_value,new_value)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
      [data.board_id, data.user_id || null, data.user_name || null, data.item_id || null,
       data.item_name || null, data.action, data.field || null, data.old_value || null, data.new_value || null]
    );
  } catch (_) { /* logging is best-effort */ }
}

/**
 * Execute a rule's actions against one item, inside the caller's transaction.
 *
 * @param {object} db     pg client (inside a transaction) or pool
 * @param {object} opts
 *   actions    [{type, config}]
 *   auto       the automation row (for name/id in logs + toasts)
 *   itemId, boardId, itemName
 *   actor      { id, name }
 *
 * @returns {object} {
 *   setValues:  [{column_id, value}]      column writes for the client to apply
 *   movedItem:  {id, old_group_id, group_id} | null
 *   notifies:   [{ message }]             notify actions (client toast hint)
 *   deferred:   [async () => {}]          side effects to run AFTER commit
 * }
 */
async function executeActions(db, { actions, auto, itemId, boardId, itemName, actor }) {
  const result = { setValues: [], movedItem: null, notifies: [], deferred: [] };
  const actorName = `Automation: ${auto?.name || 'rule'}`;
  itemId = parseInt(itemId);
  boardId = parseInt(boardId);

  for (const action of actions) {
    const type = action.type;
    const cfg = action.config || {};

    if (type === 'move_to_group') {
      const targetGroupId = cfg.target_group_id;
      if (!targetGroupId) continue;
      // Target group MUST be on the same board, or the item vanishes.
      const grpRes = await db.query('SELECT board_id, name FROM groups WHERE id=$1', [targetGroupId]);
      const targetBoardId = grpRes.rows[0]?.board_id;
      if (targetBoardId == null || String(targetBoardId) !== String(boardId)) {
        console.warn(`[automationEngine] move_to_group skipped: group ${targetGroupId} not on board ${boardId}`);
        continue;
      }
      const itemRes = await db.query('SELECT group_id FROM items WHERE id=$1', [itemId]);
      const oldGroupId = itemRes.rows[0]?.group_id;
      await db.query('UPDATE items SET group_id=$1 WHERE id=$2', [targetGroupId, itemId]);
      result.movedItem = { id: itemId, old_group_id: oldGroupId, group_id: parseInt(targetGroupId) };
      await logActivity(db, {
        board_id: boardId, user_id: actor?.id, user_name: actorName,
        item_id: itemId, item_name: itemName, action: 'item_moved',
        field: 'Group', old_value: '', new_value: grpRes.rows[0]?.name || String(targetGroupId),
      });

    } else if (type === 'set_status') {
      const { column_id: targetColId, value: targetVal } = cfg;
      if (!targetColId || !targetVal) continue;
      const prevRes = await db.query(
        'SELECT value FROM column_values WHERE item_id=$1 AND column_id=$2', [itemId, targetColId]);
      const prevVal = prevRes.rows[0]?.value || '';
      await db.query(
        `INSERT INTO column_values (item_id, column_id, value) VALUES ($1,$2,$3)
         ON CONFLICT (item_id, column_id) DO UPDATE SET value=EXCLUDED.value`,
        [itemId, targetColId, targetVal]);
      result.setValues.push({ column_id: parseInt(targetColId), value: targetVal });
      if (prevVal !== targetVal) {
        await logActivity(db, {
          board_id: boardId, user_id: actor?.id, user_name: actorName,
          item_id: itemId, item_name: itemName, action: 'value_changed',
          field: await columnTitle(db, targetColId), old_value: prevVal, new_value: targetVal,
        });
      }

    } else if (type === 'assign_person') {
      const { column_id: targetColId } = cfg;
      if (!targetColId) continue;
      // Resolve the configured member to a stable {id,name}. Prefer an explicit
      // user_id; fall back to the legacy user_name (first active match).
      let entry = null;
      if (cfg.user_id != null) {
        const r = await db.query('SELECT id, name FROM users WHERE id=$1 AND is_active=true', [cfg.user_id]);
        if (r.rows[0]) entry = { id: r.rows[0].id, name: r.rows[0].name };
      } else if (cfg.user_name) {
        const r = await db.query('SELECT id, name FROM users WHERE name=$1 AND is_active=true ORDER BY id LIMIT 1', [cfg.user_name]);
        entry = r.rows[0] ? { id: r.rows[0].id, name: r.rows[0].name } : { id: null, name: cfg.user_name };
      }
      if (!entry) continue;
      const oldRes = await db.query(
        'SELECT value FROM column_values WHERE item_id=$1 AND column_id=$2', [itemId, targetColId]);
      const oldAssignees = oldRes.rows[0]?.value || null;
      const newValue = JSON.stringify([entry]);
      await db.query(
        `INSERT INTO column_values (item_id, column_id, value) VALUES ($1,$2,$3)
         ON CONFLICT (item_id, column_id) DO UPDATE SET value=EXCLUDED.value`,
        [itemId, targetColId, newValue]);
      result.setValues.push({ column_id: parseInt(targetColId), value: newValue });
      if ((oldAssignees || '') !== newValue) {
        await logActivity(db, {
          board_id: boardId, user_id: actor?.id, user_name: actorName,
          item_id: itemId, item_name: itemName, action: 'value_changed',
          field: await columnTitle(db, targetColId), old_value: parseOwners(oldAssignees).join(', '), new_value: entry.name,
        });
        result.deferred.push(() => notifyNewAssignees({
          oldValue: oldAssignees, newValue,
          itemId, boardId, actor: { id: actor?.id, name: actor?.name },
        }));
      }

    } else if (type === 'set_due_date') {
      const { column_id: targetColId, weekday, weeks_ahead, days_ahead } = cfg;
      const hasDaysAhead = days_ahead !== undefined && days_ahead !== '' && days_ahead !== null;
      const hasWeekday = weekday !== undefined && weekday !== '' && weekday !== null;
      if (!targetColId || (!hasDaysAhead && !hasWeekday)) continue;
      try {
        const dateStr = computeRelativeDate({ weekday, weeks_ahead, days_ahead });
        await db.query(
          `INSERT INTO column_values (item_id, column_id, value) VALUES ($1,$2,$3)
           ON CONFLICT (item_id, column_id) DO UPDATE SET value=EXCLUDED.value`,
          [itemId, targetColId, dateStr]);
        result.setValues.push({ column_id: parseInt(targetColId), value: dateStr });
        await logActivity(db, {
          board_id: boardId, user_id: actor?.id, user_name: actorName,
          item_id: itemId, item_name: itemName, action: 'value_changed',
          field: await columnTitle(db, targetColId), old_value: '', new_value: dateStr,
        });
      } catch (e) {
        console.error('[automationEngine] set_due_date failed:', e.message);
      }

    } else if (type === 'notify') {
      const message = (cfg.message && String(cfg.message).trim()) || `Update on "${itemName}"`;
      // Recipients = owners from any person column; else all board members.
      // The triggering user is never notified of their own action.
      let recipientIds = [];
      const personColsRes = await db.query(
        `SELECT id FROM columns WHERE board_id=$1 AND type='person'`, [boardId]);
      if (personColsRes.rows.length) {
        const pcIds = personColsRes.rows.map(r => r.id);
        const ownerValsRes = await db.query(
          `SELECT value FROM column_values WHERE item_id=$1 AND column_id = ANY($2)`, [itemId, pcIds]);
        const names = new Set();
        for (const r of ownerValsRes.rows) for (const n of parseOwners(r.value)) names.add(n);
        if (names.size) {
          const uRes = await db.query(
            `SELECT id FROM users WHERE name = ANY($1) AND is_active=true`, [[...names]]);
          recipientIds = uRes.rows.map(r => r.id);
        }
      }
      if (!recipientIds.length) {
        const memRes = await db.query(`SELECT user_id FROM board_members WHERE board_id=$1`, [boardId]);
        recipientIds = memRes.rows.map(r => r.user_id);
      }
      recipientIds = [...new Set(recipientIds)].filter(uid => uid !== actor?.id);
      if (recipientIds.length) {
        const bnRes = await db.query('SELECT name FROM boards WHERE id=$1', [boardId]);
        const boardName = bnRes.rows[0]?.name || '';
        for (const uid of recipientIds) {
          await db.query(
            `INSERT INTO notifications (user_id, from_user_id, from_user_name, item_id, item_name, board_id, board_name, message)
             VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
            [uid, actor?.id || null, actor?.name || null, itemId, itemName, boardId, boardName, message]);
        }
      }
      result.notifies.push({ message });

    } else if (type === 'send_email') {
      result.deferred.push(() => sendAutomationEmail({
        boardId, itemId,
        to:         cfg.to || '',
        toType:     cfg.to_type || 'specific',
        toColumnId: cfg.to_column_id || null,
        subject:    cfg.subject || '',
        body:       cfg.body || '',
      }));

    } else {
      // Unknown / passthrough action — surface to the client toast only.
      result.notifies.push({ message: `Automation: ${auto?.name || 'rule'}` });
    }
  }

  return result;
}

// Run deferred side-effects after the caller commits. Errors are logged, never thrown.
function runDeferred(deferred) {
  for (const fn of deferred || []) {
    setImmediate(() => {
      try {
        const p = fn();
        if (p && typeof p.catch === 'function') p.catch(err => console.error('[automationEngine] deferred error:', err.message));
      } catch (err) {
        console.error('[automationEngine] deferred sync error:', err.message);
      }
    });
  }
}

module.exports = {
  parseJSON,
  getConditions,
  getActions,
  evaluateConditions,
  executeActions,
  runDeferred,
};
