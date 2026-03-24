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

const READ_ONLY_ROLES = ['user'];

router.post('/', requireAuth, async (req, res) => {
  if (READ_ONLY_ROLES.includes(req.user.role))
    return res.status(403).json({ error: 'Read-only access — you cannot create items' });
  const { group_id, name } = req.body;
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const posRes = await client.query(
      'SELECT COALESCE(MAX(position),0)+1 AS pos FROM items WHERE group_id=$1',
      [group_id]
    );
    const { rows } = await client.query(
      'INSERT INTO items (group_id, name, position, created_by_user_id, created_by_user_name) VALUES ($1,$2,$3,$4,$5) RETURNING *',
      [group_id, name, posRes.rows[0].pos, req.user.id, req.user.name]
    );
    const item = rows[0];
    item.values = {};

    const groupRes = await client.query('SELECT board_id FROM groups WHERE id=$1', [group_id]);
    const board_id = groupRes.rows[0]?.board_id;

    const triggeredAutomations = [];

    if (board_id) {
      const autoRes = await client.query(
        "SELECT * FROM automations WHERE board_id=$1 AND trigger_type='item_created' AND enabled=true",
        [board_id]
      );

      for (const auto of autoRes.rows) {
        const acfg = typeof auto.action_config === 'string' ? JSON.parse(auto.action_config) : auto.action_config;
        if (auto.action_type === 'set_status') {
          const { column_id: colId, value: val } = acfg;
          if (colId && val) {
            await client.query(
              `INSERT INTO column_values (item_id, column_id, value)
               VALUES ($1,$2,$3)
               ON CONFLICT (item_id, column_id) DO UPDATE SET value=EXCLUDED.value`,
              [item.id, colId, val]
            );
            item.values[parseInt(colId)] = val;
          }
        } else if (auto.action_type === 'send_email') {
          // Fire after commit so item exists in DB for placeholder resolution
          setImmediate(() => sendAutomationEmail({
            boardId: board_id,
            itemId:  item.id,
            to:      acfg.to || '',
            subject: acfg.subject || '',
            body:    acfg.body || '',
          }).catch(err => console.error('[AutomationEmail] async error:', err.message)));
        } else {
          triggeredAutomations.push(auto);
        }
      }

      // Apply column default values for columns not already set by an automation
      const colsRes = await client.query(
        'SELECT id, settings FROM columns WHERE board_id=$1',
        [board_id]
      );
      for (const col of colsRes.rows) {
        const s = typeof col.settings === 'string' ? JSON.parse(col.settings) : (col.settings || {});
        const dv = s?.defaultValue;
        if (dv !== undefined && dv !== null && String(dv) !== '' && item.values[col.id] === undefined) {
          await client.query(
            `INSERT INTO column_values (item_id, column_id, value)
             VALUES ($1,$2,$3)
             ON CONFLICT (item_id, column_id) DO NOTHING`,
            [item.id, col.id, String(dv)]
          );
          item.values[col.id] = String(dv);
        }
      }

      await logActivity(client, {
        board_id,
        user_id: req.user.id,
        user_name: req.user.name,
        item_id: item.id,
        item_name: name,
        action: 'item_created',
      });
    }

    await client.query('COMMIT');
    item.triggeredAutomations = triggeredAutomations;
    res.status(201).json(item);
  } catch (err) {
    await client.query('ROLLBACK');
    res.status(500).json({ error: err.message });
  } finally {
    client.release();
  }
});

router.put('/:id', requireAuth, async (req, res) => {
  if (READ_ONLY_ROLES.includes(req.user.role))
    return res.status(403).json({ error: 'Read-only access — you cannot edit items' });
  const { name } = req.body;
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    // Fetch old name + board_id
    const oldRes = await client.query(
      `SELECT i.name, g.board_id FROM items i JOIN groups g ON g.id=i.group_id WHERE i.id=$1`,
      [req.params.id]
    );
    const old = oldRes.rows[0];
    const { rows } = await client.query(
      'UPDATE items SET name=$1 WHERE id=$2 RETURNING *',
      [name, req.params.id]
    );
    if (old) {
      await logActivity(client, {
        board_id: old.board_id,
        user_id: req.user.id,
        user_name: req.user.name,
        item_id: parseInt(req.params.id),
        item_name: name,
        action: 'item_renamed',
        old_value: old.name,
        new_value: name,
      });
    }
    await client.query('COMMIT');
    res.json(rows[0]);
  } catch (err) {
    await client.query('ROLLBACK');
    res.status(500).json({ error: err.message });
  } finally {
    client.release();
  }
});

router.delete('/:id', requireAuth, async (req, res) => {
  if (READ_ONLY_ROLES.includes(req.user.role))
    return res.status(403).json({ error: 'Read-only access — you cannot delete items' });
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // Fetch item + group info
    const infoRes = await client.query(
      `SELECT i.name, i.group_id, g.board_id, g.name AS group_name
       FROM items i JOIN groups g ON g.id=i.group_id WHERE i.id=$1`,
      [req.params.id]
    );
    const info = infoRes.rows[0];
    if (!info) { await client.query('ROLLBACK'); return res.status(404).json({ error: 'Item not found' }); }

    // Snapshot all column values
    const cvRes = await client.query(
      'SELECT column_id, value FROM column_values WHERE item_id=$1',
      [req.params.id]
    );
    const values = {};
    cvRes.rows.forEach(r => { values[r.column_id] = r.value; });

    // Save to trash
    await client.query(
      `INSERT INTO trash_items
         (board_id, group_id, group_name, item_id, name, values, deleted_by_user_id, deleted_by_user_name)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
      [info.board_id, info.group_id, info.group_name, parseInt(req.params.id),
       info.name, JSON.stringify(values), req.user.id, req.user.name]
    );

    // Hard-delete item (column_values cascade)
    await client.query('DELETE FROM items WHERE id=$1', [req.params.id]);

    await logActivity(client, {
      board_id: info.board_id,
      user_id: req.user.id,
      user_name: req.user.name,
      item_id: parseInt(req.params.id),
      item_name: info.name,
      action: 'item_deleted',
    });

    await client.query('COMMIT');
    res.json({ success: true });
  } catch (err) {
    await client.query('ROLLBACK');
    res.status(500).json({ error: err.message });
  } finally {
    client.release();
  }
});

// ── PATCH /:id/move — drag between groups / reorder ──────────────────────────
router.patch('/:id/move', requireAuth, async (req, res) => {
  if (READ_ONLY_ROLES.includes(req.user.role))
    return res.status(403).json({ error: 'Read-only access — you cannot move items' });
  const { group_id, position } = req.body;
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const itemRes = await client.query(
      `SELECT i.*, g.board_id FROM items i JOIN groups g ON g.id=i.group_id WHERE i.id=$1`,
      [req.params.id]
    );
    if (!itemRes.rows.length) return res.status(404).json({ error: 'Item not found' });

    const item = itemRes.rows[0];
    const oldGroupId = item.group_id;
    const newGroupId = parseInt(group_id);
    const newPos    = Math.max(0, parseInt(position));

    if (oldGroupId === newGroupId) {
      // ── Reorder within same group ──────────────────────────────────────────
      const { rows } = await client.query(
        'SELECT id FROM items WHERE group_id=$1 ORDER BY position', [newGroupId]
      );
      const ids = rows.map(r => r.id).filter(id => id !== parseInt(req.params.id));
      ids.splice(Math.min(newPos, ids.length), 0, parseInt(req.params.id));
      for (let i = 0; i < ids.length; i++) {
        await client.query('UPDATE items SET position=$1 WHERE id=$2', [i, ids[i]]);
      }
    } else {
      // ── Move to different group ────────────────────────────────────────────
      const { rows: src } = await client.query(
        'SELECT id FROM items WHERE group_id=$1 AND id!=$2 ORDER BY position',
        [oldGroupId, req.params.id]
      );
      for (let i = 0; i < src.length; i++) {
        await client.query('UPDATE items SET position=$1 WHERE id=$2', [i, src[i].id]);
      }
      const { rows: tgt } = await client.query(
        'SELECT id FROM items WHERE group_id=$1 ORDER BY position', [newGroupId]
      );
      const ids = tgt.map(r => r.id);
      ids.splice(Math.min(newPos, ids.length), 0, parseInt(req.params.id));
      for (let i = 0; i < ids.length; i++) {
        await client.query('UPDATE items SET group_id=$1, position=$2 WHERE id=$3',
          [newGroupId, i, ids[i]]);
      }
      await logActivity(client, {
        board_id: item.board_id,
        user_id: req.user.id,
        user_name: req.user.name,
        item_id: parseInt(req.params.id),
        item_name: item.name,
        action: 'item_moved',
        old_value: String(oldGroupId),
        new_value: String(newGroupId),
      });
    }

    await client.query('COMMIT');
    res.json({ success: true });
  } catch (err) {
    await client.query('ROLLBACK');
    res.status(500).json({ error: err.message });
  } finally {
    client.release();
  }
});

module.exports = router;
