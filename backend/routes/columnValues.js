const express = require('express');
const router = express.Router();
const pool = require('../db');
const { requireAuth } = require('../middleware/auth');
const { sendAutomationEmail } = require('../services/automationEmail');

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
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // Fetch old value for logging
    const oldRes = await client.query(
      'SELECT value FROM column_values WHERE item_id=$1 AND column_id=$2',
      [item_id, column_id]
    );
    const old_value = oldRes.rows[0]?.value || '';

    // 1. Upsert the column value
    const { rows } = await client.query(
      `INSERT INTO column_values (item_id, column_id, value)
       VALUES ($1,$2,$3)
       ON CONFLICT (item_id, column_id) DO UPDATE SET value=EXCLUDED.value
       RETURNING *`,
      [item_id, column_id, value]
    );

    // 2. Get column info + item info
    const colRes = await client.query(
      'SELECT board_id, title, type FROM columns WHERE id=$1',
      [column_id]
    );
    if (!colRes.rows.length) {
      await client.query('COMMIT');
      return res.json({ value: rows[0], triggeredAutomations: [] });
    }

    const { board_id, title } = colRes.rows[0];

    // Fetch item name for log
    const itemRes2 = await client.query('SELECT name FROM items WHERE id=$1', [item_id]);
    const item_name = itemRes2.rows[0]?.name || '';

    // 3. Find enabled status_change automations that match
    const autoRes = await client.query(
      "SELECT * FROM automations WHERE board_id=$1 AND trigger_type='status_change' AND enabled=true",
      [board_id]
    );
    const matching = autoRes.rows.filter(a => {
      const cfg = typeof a.trigger_config === 'string' ? JSON.parse(a.trigger_config) : a.trigger_config;
      const colMatch = cfg.column_id ? String(cfg.column_id) === String(column_id) : cfg.column_title === title;
      return colMatch && cfg.to_value === value;
    });

    // 4. Execute each automation
    const triggeredAutomations = [];
    let movedItem = null;
    const setValues = [];

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
        // Execute server-side — resolve item placeholders and send via SMTP
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
    res.json({ value: rows[0], triggeredAutomations, movedItem, setValues });
  } catch (err) {
    await client.query('ROLLBACK');
    res.status(500).json({ error: err.message });
  } finally {
    client.release();
  }
});

module.exports = router;
