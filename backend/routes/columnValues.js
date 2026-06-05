const express = require('express');
const router = express.Router();
const pool = require('../db');
const { requireAuth, canAccessBoard } = require('../middleware/auth');
const { sendAutomationEmail } = require('../services/automationEmail');
const { notifyNewAssignees } = require('../services/assignmentEmail');
const { runDateCascade } = require('../services/dateCascadeEngine');
const { computeRelativeDate } = require('../services/relativeDate');
const { validateColumnValue } = require('../services/columnValidate');
const { getConditions, getActions, evaluateConditions, executeActions, runDeferred } = require('../services/automationEngine');

// Parse a person-column value (JSON array of names or legacy single string)
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

// ── Two-way connect sync helpers ──────────────────────────────────────────────
function parseLinkIds(raw) {
  try { const a = JSON.parse(raw || '[]'); return Array.isArray(a) ? a.filter(Number.isInteger) : []; }
  catch { return []; }
}
async function writeLinks(client, itemId, columnId, ids) {
  await client.query(
    `INSERT INTO column_values (item_id, column_id, value) VALUES ($1,$2,$3)
     ON CONFLICT (item_id, column_id) DO UPDATE SET value=EXCLUDED.value`,
    [itemId, columnId, ids.length ? JSON.stringify(ids) : '']
  );
}
async function addReciprocalLink(client, itemId, columnId, addId) {
  // Skip dangling targets (e.g. a since-deleted item) so a bad link can never
  // break the primary save with a foreign-key error.
  const exists = await client.query('SELECT 1 FROM items WHERE id=$1', [itemId]);
  if (!exists.rows.length) return;
  const r = await client.query('SELECT value FROM column_values WHERE item_id=$1 AND column_id=$2', [itemId, columnId]);
  const ids = parseLinkIds(r.rows[0]?.value);
  if (!ids.includes(addId)) { ids.push(addId); await writeLinks(client, itemId, columnId, ids); }
}
async function removeReciprocalLink(client, itemId, columnId, removeId) {
  const r = await client.query('SELECT value FROM column_values WHERE item_id=$1 AND column_id=$2', [itemId, columnId]);
  const ids = parseLinkIds(r.rows[0]?.value);
  if (ids.includes(removeId)) await writeLinks(client, itemId, columnId, ids.filter(x => x !== removeId));
}

async function columnTitle(client, columnId) {
  if (!columnId) return null;
  const r = await client.query('SELECT title FROM columns WHERE id=$1', [columnId]);
  return r.rows[0]?.title || null;
}

async function logActivity(client, data) {
  try {
    await client.query(
      `INSERT INTO activity_logs (board_id,user_id,user_name,item_id,item_name,action,field,old_value,new_value)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
      [data.board_id, data.user_id||null, data.user_name||null, data.item_id||null,
       data.item_name||null, data.action, data.field||null, data.old_value||null, data.new_value||null]
    );
  } catch(_) {}
}

router.post('/upsert', requireAuth, async (req, res) => {
  // Read-only users normally can't edit, but they MAY self-assign — add/remove
  // only themselves on a person column. Enforced precisely below once we know
  // the column type and the before/after owner ids.
  const isReadOnlyUser = req.user.role === 'user';

  let { item_id, column_id, value } = req.body;

  // Resolve board from item and verify membership BEFORE opening a transaction
  try {
    const boardRes = await pool.query(
      `SELECT g.board_id FROM items i JOIN groups g ON g.id = i.group_id WHERE i.id = $1`,
      [item_id]
    );
    if (!boardRes.rows.length) return res.status(404).json({ error: 'Item not found' });
    if (!(await canAccessBoard(boardRes.rows[0].board_id, req.user, pool)))
      return res.status(403).json({ error: 'Access denied' });

    // Validate + normalise against the column type (clamps progress/rating,
    // rejects bad numbers/dates/emails, sanitises links, de-dupes tags).
    const colMetaRes = await pool.query('SELECT type, settings FROM columns WHERE id=$1', [column_id]);
    if (!colMetaRes.rows.length) return res.status(404).json({ error: 'Column not found' });
    const v = validateColumnValue(colMetaRes.rows[0].type, value, colMetaRes.rows[0].settings || {});
    if (!v.ok) return res.status(400).json({ error: v.error });
    value = v.value;

    // ── Self-assign permission for read-only users ──────────────────────────
    if (isReadOnlyUser) {
      if (colMetaRes.rows[0].type !== 'person')
        return res.status(403).json({ error: 'Read-only access — you cannot edit values' });
      const curRes = await pool.query('SELECT value FROM column_values WHERE item_id=$1 AND column_id=$2', [item_id, column_id]);
      const before = new Set(ownerIds(curRes.rows[0]?.value));
      const after = new Set(ownerIds(value));
      const changed = [...new Set([...before, ...after])].filter(id => before.has(id) !== after.has(id));
      const onlySelf = changed.length >= 1 && changed.every(id => id === req.user.id);
      const addsNamelessOwner = parseOwnerEntries(value).some(e => e.id == null); // can't inject legacy/foreign names
      if (!onlySelf || addsNamelessOwner)
        return res.status(403).json({ error: 'You can only assign or unassign yourself' });
    }
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: 'Internal server error' });
  }

  const client = await pool.connect();
  // Variables captured for post-transaction cascade check
  let savedRow, triggeredAutomations, movedItem, setValues;
  let board_id, colType, old_value;
  let deferredEffects = []; // automation side-effects (emails) to run after commit

  try {
    await client.query('BEGIN');

    // Fetch old value for logging + cascade from-value comparison
    const oldRes = await client.query(
      'SELECT value FROM column_values WHERE item_id=$1 AND column_id=$2',
      [item_id, column_id]
    );
    old_value = oldRes.rows[0]?.value || '';

    // 1. Upsert the column value
    const { rows } = await client.query(
      `INSERT INTO column_values (item_id, column_id, value)
       VALUES ($1,$2,$3)
       ON CONFLICT (item_id, column_id) DO UPDATE SET value=EXCLUDED.value
       RETURNING *`,
      [item_id, column_id, value]
    );
    savedRow = rows[0];

    // Mark this cell as manually edited so cascade won't overwrite it
    try {
      await client.query(
        `INSERT INTO column_value_meta (item_id, column_id, is_auto_cascaded)
         VALUES ($1,$2,false)
         ON CONFLICT (item_id, column_id) DO UPDATE SET is_auto_cascaded=false`,
        [item_id, column_id]
      );
    } catch (_) { /* table may not exist during first migration — safe to ignore */ }

    // 2. Get column info + item info
    const colRes = await client.query(
      'SELECT board_id, title, type FROM columns WHERE id=$1',
      [column_id]
    );
    if (!colRes.rows.length) {
      await client.query('COMMIT');
      // Release before returning so cascade check path is consistent
      triggeredAutomations = [];
      movedItem = null;
      setValues = [];
      client.release();
      return res.json({ value: savedRow, triggeredAutomations, cascadeResult: null });
    }

    const { board_id: bId, title } = colRes.rows[0];
    board_id = bId;
    colType  = colRes.rows[0].type;

    // ── Two-way connect sync ─────────────────────────────────────────────────
    // When a connect cell with a reciprocal column changes, mirror the link on
    // the items at the other end (add the source item to newly-linked targets,
    // remove it from unlinked ones). Done directly (not via this route) so it
    // never recurses.
    if (colType === 'connect_boards') {
      const stRow = await client.query('SELECT settings FROM columns WHERE id=$1', [column_id]);
      const st = typeof stRow.rows[0]?.settings === 'string' ? JSON.parse(stRow.rows[0].settings || '{}') : (stRow.rows[0]?.settings || {});
      if (st.reciprocalColumnId) {
        const oldIds = parseLinkIds(old_value);
        const newIds = parseLinkIds(value);
        const srcId = parseInt(item_id, 10);
        for (const tid of newIds.filter(x => !oldIds.includes(x))) await addReciprocalLink(client, tid, st.reciprocalColumnId, srcId);
        for (const tid of oldIds.filter(x => !newIds.includes(x))) await removeReciprocalLink(client, tid, st.reciprocalColumnId, srcId);
      }
    }

    // Fetch item name for log
    const itemRes2 = await client.query('SELECT name FROM items WHERE id=$1', [item_id]);
    const item_name = itemRes2.rows[0]?.name || '';

    // 3. Find enabled status_change automations (existing Monday-style automations)
    const autoRes = await client.query(
      "SELECT * FROM automations WHERE board_id=$1 AND trigger_type='status_change' AND enabled=true",
      [board_id]
    );
    const matching = autoRes.rows.filter(a => {
      const cfg = typeof a.trigger_config === 'string' ? JSON.parse(a.trigger_config) : a.trigger_config;
      const colMatch = cfg.column_id ? String(cfg.column_id) === String(column_id) : cfg.column_title === title;
      return colMatch && cfg.to_value === value;
    });

    // 4. Execute each matching automation — evaluate "only if" CONDITIONS
    //    (all must pass), then run the full ordered ACTION list via the shared
    //    engine. Legacy single-action rules fall back transparently.
    triggeredAutomations = [];
    movedItem = null;
    setValues = [];

    for (const auto of matching) {
      if (!(await evaluateConditions(client, item_id, getConditions(auto)))) continue;
      const r = await executeActions(client, {
        actions: getActions(auto), auto,
        itemId: item_id, boardId: board_id, itemName: item_name,
        actor: { id: req.user.id, name: req.user.name },
      });
      if (r.setValues.length) setValues.push(...r.setValues);
      if (r.movedItem) movedItem = r.movedItem;
      deferredEffects.push(...r.deferred);
      // Surface notify / passthrough actions to the client toast in the legacy
      // shape fireAutomations() expects (action_type + action_config.message).
      for (const n of r.notifies) {
        triggeredAutomations.push({ id: auto.id, name: auto.name, action_type: 'notify', action_config: { message: n.message } });
      }
    }

    // 5. Log the value change
    if (old_value !== value) {
      await logActivity(client, {
        board_id,
        user_id: req.user.id,
        user_name: req.user.name,
        item_id: parseInt(item_id),
        item_name,
        action: 'value_changed',
        field: title,
        old_value,
        new_value: value,
      });
    }

    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK');
    client.release();
    console.error(err);
    return res.status(500).json({ error: 'Internal server error' });
  }
  // Release BEFORE cascade so cascade gets a fresh pool connection
  client.release();

  // Run automation side-effects (emails, assignment notifications) now that the
  // transaction is committed and the rows are durable.
  runDeferred(deferredEffects);

  // ── Person-assignment Email Hook ─────────────────────────────────────────────
  // Fire-and-forget — never blocks the response. Only fires for person columns
  // when newly-added assignees are detected (diff of oldValue vs newValue).
  if (colType === 'person' && old_value !== value) {
    notifyNewAssignees({
      oldValue: old_value,
      newValue: value,
      itemId:   parseInt(item_id),
      boardId:  parseInt(board_id),
      actor:    { id: req.user?.id, name: req.user?.name },
    }).catch(err => console.error('[AssignEmail] async error:', err.message));
  }

  // ── Date Cascade Hook ────────────────────────────────────────────────────────
  // Runs in the same request cycle (synchronous to include result in response).
  // Uses its own pool connection — no shared transaction with the above.
  let cascadeResult = null;
  try {
    if (board_id) {
      const rulesRes = await pool.query(
        'SELECT * FROM board_automation_rules WHERE board_id=$1 AND is_active=true',
        [board_id]
      );
      for (const rule of rulesRes.rows) {
        let anchorColId = rule.anchor_column_id;
        let anchorDate  = null;

        if (rule.trigger_type === 'date_entry' && colType === 'date') {
          if (parseInt(rule.trigger_column_id) === parseInt(column_id)) {
            anchorDate = value; // the date the user just saved
          }
        } else if (rule.trigger_type === 'status_change' &&
                   (colType === 'status' || colType === 'dropdown')) {
          const colMatches = !rule.trigger_column_id ||
                             parseInt(rule.trigger_column_id) === parseInt(column_id);
          const fromMatches = !rule.trigger_status_from ||
                              rule.trigger_status_from === old_value;
          const toMatches   = rule.trigger_status_to === value;
          if (colMatches && fromMatches && toMatches) {
            // Use the existing anchor column value, or today as fallback
            const anchorRes = await pool.query(
              'SELECT value FROM column_values WHERE item_id=$1 AND column_id=$2',
              [item_id, anchorColId]
            );
            anchorDate = anchorRes.rows[0]?.value ||
                         new Date().toISOString().slice(0, 10);
          }
        }

        if (anchorDate) {
          cascadeResult = await runDateCascade({
            boardId:        parseInt(board_id),
            itemId:         parseInt(item_id),
            anchorColumnId: parseInt(anchorColId),
            anchorDate,
            direction:      rule.direction,
            userId:         req.user?.id,
            ruleId:         rule.id,
          });
          break; // first matching rule wins
        }
      }
    }
  } catch (cascadeErr) {
    console.error('[DateCascade] hook error:', cascadeErr.message);
    // do not fail the main request
  }

  // ── Dependency auto-shift ────────────────────────────────────────────────────
  // When a task's timeline (schedule) column changes, push any dependent tasks
  // forward so they still start after their predecessors finish.
  let dependencyShifts = [];
  if (colType === 'timeline' && board_id) {
    try {
      dependencyShifts = await require('../services/dependencyEngine').runAutoShift(pool, parseInt(board_id), parseInt(column_id));
    } catch (depErr) {
      console.error('[dependencies] auto-shift hook error:', depErr.message);
    }
  }

  res.json({ value: savedRow, triggeredAutomations, movedItem, setValues, cascadeResult, dependencyShifts });
});

// ── POST /bulk-upsert ─────────────────────────────────────────────────────────
// Sets the SAME column value on many items at once. Capped at 100 items per
// call. Fires assignment emails for person-column changes, writes activity
// logs, but SKIPS automations + date cascade (those are designed to fire on
// single edits — running them N times here could create a stampede).
const BULK_LIMIT = 100;

router.post('/bulk-upsert', requireAuth, async (req, res) => {
  if (req.user.role === 'user')
    return res.status(403).json({ error: 'Read-only access — you cannot edit values' });

  let { item_ids, column_id, value } = req.body;
  if (!Array.isArray(item_ids) || item_ids.length === 0 || !column_id)
    return res.status(400).json({ error: 'item_ids (array) and column_id are required' });
  if (item_ids.length > BULK_LIMIT)
    return res.status(400).json({ error: `Too many items — limit is ${BULK_LIMIT} per bulk update` });

  // Resolve column + board
  const colRes = await pool.query('SELECT board_id, title, type, settings FROM columns WHERE id=$1', [column_id]);
  if (!colRes.rows.length) return res.status(404).json({ error: 'Column not found' });
  const { board_id, title, type: colType } = colRes.rows[0];

  if (!(await canAccessBoard(board_id, req.user, pool)))
    return res.status(403).json({ error: 'Access denied' });

  // Validate + normalise the shared value against the column type
  {
    const v = validateColumnValue(colType, value, colRes.rows[0].settings || {});
    if (!v.ok) return res.status(400).json({ error: v.error });
    value = v.value;
  }

  // Verify every item belongs to this board — reject silently if any don't.
  // (Protects against a crafted payload spanning boards the user can't see.)
  const checkRes = await pool.query(
    `SELECT i.id FROM items i
       JOIN groups g ON g.id = i.group_id
      WHERE g.board_id = $1 AND i.id = ANY($2)`,
    [board_id, item_ids.map(Number)]
  );
  const validIds = checkRes.rows.map(r => r.id);
  if (!validIds.length) return res.status(400).json({ error: 'No valid items for this board' });

  // Optional service — loaded lazily so tests without it won't crash
  let notifyNewAssignees = null;
  try { ({ notifyNewAssignees } = require('../services/assignmentEmail')); } catch (_) {}

  const client = await pool.connect();
  const updated = [];
  try {
    await client.query('BEGIN');

    for (const itemId of validIds) {
      const oldRes = await client.query(
        'SELECT value FROM column_values WHERE item_id=$1 AND column_id=$2',
        [itemId, column_id]
      );
      const oldValue = oldRes.rows[0]?.value || '';
      if (oldValue === value) { updated.push({ item_id: itemId, changed: false }); continue; }

      await client.query(
        `INSERT INTO column_values (item_id, column_id, value)
         VALUES ($1,$2,$3)
         ON CONFLICT (item_id, column_id) DO UPDATE SET value=EXCLUDED.value`,
        [itemId, column_id, value]
      );

      // Mark manually-edited so date cascade won't overwrite
      try {
        await client.query(
          `INSERT INTO column_value_meta (item_id, column_id, is_auto_cascaded)
           VALUES ($1,$2,false)
           ON CONFLICT (item_id, column_id) DO UPDATE SET is_auto_cascaded=false`,
          [itemId, column_id]
        );
      } catch (_) {}

      // Activity log
      const itemRes = await client.query('SELECT name FROM items WHERE id=$1', [itemId]);
      const itemName = itemRes.rows[0]?.name || '';
      await logActivity(client, {
        board_id,
        user_id:   req.user.id,
        user_name: req.user.name,
        item_id:   itemId,
        item_name: itemName,
        action:    'value_changed',
        field:     title,
        old_value: oldValue,
        new_value: value,
      });

      updated.push({ item_id: itemId, changed: true, old_value: oldValue });
    }

    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK');
    client.release();
    console.error('[bulk-upsert]', err);
    return res.status(500).json({ error: 'Bulk update failed' });
  }
  client.release();

  // Fire assignment emails for person-column changes, outside the transaction.
  if (colType === 'person' && notifyNewAssignees) {
    for (const u of updated) {
      if (!u.changed) continue;
      notifyNewAssignees({
        oldValue: u.old_value,
        newValue: value,
        itemId:   u.item_id,
        boardId:  board_id,
        actor:    { id: req.user?.id, name: req.user?.name },
      }).catch(err => console.error('[AssignEmail] bulk async error:', err.message));
    }
  }

  res.json({
    updated: updated.filter(u => u.changed).length,
    skipped: updated.length - updated.filter(u => u.changed).length,
    total:   updated.length,
  });
});

module.exports = router;
