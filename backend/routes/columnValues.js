const express = require('express');
const router = express.Router();
const pool = require('../db');
const { requireAuth, canAccessBoard } = require('../middleware/auth');
const { sendAutomationEmail } = require('../services/automationEmail');
const { runDateCascade } = require('../services/dateCascadeEngine');

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
  if (req.user.role === 'user')
    return res.status(403).json({ error: 'Read-only access — you cannot edit values' });

  const { item_id, column_id, value } = req.body;

  // Resolve board from item and verify membership BEFORE opening a transaction
  try {
    const boardRes = await pool.query(
      `SELECT g.board_id FROM items i JOIN groups g ON g.id = i.group_id WHERE i.id = $1`,
      [item_id]
    );
    if (!boardRes.rows.length) return res.status(404).json({ error: 'Item not found' });
    if (!(await canAccessBoard(boardRes.rows[0].board_id, req.user, pool)))
      return res.status(403).json({ error: 'Access denied' });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: 'Internal server error' });
  }

  const client = await pool.connect();
  // Variables captured for post-transaction cascade check
  let savedRow, triggeredAutomations, movedItem, setValues;
  let board_id, colType, old_value;

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

    // 4. Execute each matching automation
    triggeredAutomations = [];
    movedItem = null;
    setValues = [];

    for (const auto of matching) {
      const acfg = typeof auto.action_config === 'string' ? JSON.parse(auto.action_config) : auto.action_config;
      if (auto.action_type === 'move_to_group') {
        const targetGroupId = acfg.target_group_id;
        if (targetGroupId) {
          const itemRes = await client.query('SELECT group_id FROM items WHERE id=$1', [item_id]);
          const oldGroupId = itemRes.rows[0]?.group_id;
          await client.query('UPDATE items SET group_id=$1 WHERE id=$2', [targetGroupId, item_id]);
          movedItem = { id: parseInt(item_id), old_group_id: oldGroupId, group_id: parseInt(targetGroupId) };
        }
      } else if (auto.action_type === 'set_status') {
        const { column_id: targetColId, value: targetVal } = acfg;
        if (targetColId && targetVal) {
          await client.query(
            `INSERT INTO column_values (item_id, column_id, value)
             VALUES ($1,$2,$3)
             ON CONFLICT (item_id, column_id) DO UPDATE SET value=EXCLUDED.value`,
            [item_id, targetColId, targetVal]
          );
          setValues.push({ column_id: parseInt(targetColId), value: targetVal });
        }
      } else if (auto.action_type === 'send_email') {
        sendAutomationEmail({
          boardId:    board_id,
          itemId:     parseInt(item_id),
          to:         acfg.to || '',
          toType:     acfg.to_type || 'specific',
          toColumnId: acfg.to_column_id || null,
          subject:    acfg.subject || '',
          body:       acfg.body || '',
        }).catch(err => console.error('[AutomationEmail] async error:', err.message));
      } else {
        triggeredAutomations.push(auto);
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

  res.json({ value: savedRow, triggeredAutomations, movedItem, setValues, cascadeResult });
});

module.exports = router;
