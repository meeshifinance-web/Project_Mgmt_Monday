const express = require('express');
const router = express.Router();
const pool = require('../db');
const { requireAuth, canAccessBoard } = require('../middleware/auth');
const { requireScope } = require('../middleware/apiAuth');
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

// ── POST / — create item ──────────────────────────────────────────────────────
router.post('/', requireAuth, requireScope('write'), async (req, res) => {
  if (READ_ONLY_ROLES.includes(req.user.role))
    return res.status(403).json({ error: 'Read-only access — you cannot create items' });

  const { group_id, name, parent_item_id } = req.body;
  if (!group_id) return res.status(400).json({ error: 'group_id is required' });

  // Resolve board and verify access BEFORE opening a transaction
  let board_id;
  try {
    const groupRes = await pool.query('SELECT board_id FROM groups WHERE id=$1', [group_id]);
    if (!groupRes.rows.length) return res.status(404).json({ error: 'Group not found' });
    board_id = groupRes.rows[0].board_id;
    if (!(await canAccessBoard(board_id, req.user, pool)))
      return res.status(403).json({ error: 'Access denied' });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: 'Internal server error' });
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const posRes = await client.query(
      parent_item_id
        ? 'SELECT COALESCE(MAX(position),0)+1 AS pos FROM items WHERE parent_item_id=$1'
        : 'SELECT COALESCE(MAX(position),0)+1 AS pos FROM items WHERE group_id=$1 AND parent_item_id IS NULL',
      [parent_item_id || group_id]
    );
    const { rows } = await client.query(
      'INSERT INTO items (group_id, name, position, created_by_user_id, created_by_user_name, parent_item_id) VALUES ($1,$2,$3,$4,$5,$6) RETURNING *',
      [group_id, name, posRes.rows[0].pos, req.user.id, req.user.name, parent_item_id || null]
    );
    const item = rows[0];
    item.values = {};

    const triggeredAutomations = [];

    // Automations only fire for top-level items, not subitems
    if (!parent_item_id) {
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
        } else if (auto.action_type === 'assign_person') {
          const { column_id: colId, user_name: userName } = acfg;
          if (colId && userName) {
            await client.query(
              `INSERT INTO column_values (item_id, column_id, value)
               VALUES ($1,$2,$3)
               ON CONFLICT (item_id, column_id) DO UPDATE SET value=EXCLUDED.value`,
              [item.id, colId, userName]
            );
            item.values[parseInt(colId)] = userName;
          }
        } else if (auto.action_type === 'send_email') {
          // Fire after commit so item exists in DB for placeholder resolution
          setImmediate(() => sendAutomationEmail({
            boardId:    board_id,
            itemId:     item.id,
            to:         acfg.to || '',
            toType:     acfg.to_type || 'specific',
            toColumnId: acfg.to_column_id || null,
            subject:    acfg.subject || '',
            body:       acfg.body || '',
          }).catch(err => console.error('[AutomationEmail] async error:', err.message)));
        } else {
          triggeredAutomations.push(auto);
        }
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
      action: parent_item_id ? 'subitem_created' : 'item_created',
    });

    await client.query('COMMIT');
    item.triggeredAutomations = triggeredAutomations;
    res.status(201).json(item);
  } catch (err) {
    await client.query('ROLLBACK');
    console.error(err);
    res.status(500).json({ error: 'Internal server error' });
  } finally {
    client.release();
  }
});

// ── PUT /:id — rename item ────────────────────────────────────────────────────
router.put('/:id', requireAuth, requireScope('write'), async (req, res) => {
  if (READ_ONLY_ROLES.includes(req.user.role))
    return res.status(403).json({ error: 'Read-only access — you cannot edit items' });
  const { name } = req.body;
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // Fetch old name + board_id (used for access check and activity log)
    const oldRes = await client.query(
      `SELECT i.name, g.board_id FROM items i JOIN groups g ON g.id=i.group_id WHERE i.id=$1`,
      [req.params.id]
    );
    const old = oldRes.rows[0];
    if (!old) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'Item not found' });
    }

    if (!(await canAccessBoard(old.board_id, req.user, pool))) {
      await client.query('ROLLBACK');
      return res.status(403).json({ error: 'Access denied' });
    }

    const { rows } = await client.query(
      'UPDATE items SET name=$1 WHERE id=$2 RETURNING *',
      [name, req.params.id]
    );
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
    await client.query('COMMIT');
    res.json(rows[0]);
  } catch (err) {
    await client.query('ROLLBACK');
    console.error(err);
    res.status(500).json({ error: 'Internal server error' });
  } finally {
    client.release();
  }
});

// ── DELETE /:id — delete item (moves to trash) ────────────────────────────────
router.delete('/:id', requireAuth, requireScope('full'), async (req, res) => {
  if (READ_ONLY_ROLES.includes(req.user.role))
    return res.status(403).json({ error: 'Read-only access — you cannot delete items' });
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // Fetch item + group info (also used for access check)
    const infoRes = await client.query(
      `SELECT i.name, i.group_id, g.board_id, g.name AS group_name
       FROM items i JOIN groups g ON g.id=i.group_id WHERE i.id=$1`,
      [req.params.id]
    );
    const info = infoRes.rows[0];
    if (!info) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'Item not found' });
    }

    if (!(await canAccessBoard(info.board_id, req.user, pool))) {
      await client.query('ROLLBACK');
      return res.status(403).json({ error: 'Access denied' });
    }

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
    console.error(err);
    res.status(500).json({ error: 'Internal server error' });
  } finally {
    client.release();
  }
});

// ── POST /:id/copy — duplicate item with its column values ───────────────────
router.post('/:id/copy', requireAuth, requireScope('write'), async (req, res) => {
  if (READ_ONLY_ROLES.includes(req.user.role))
    return res.status(403).json({ error: 'Read-only access — you cannot copy items' });

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // Fetch source item + board
    const srcRes = await client.query(
      `SELECT i.*, g.board_id FROM items i JOIN groups g ON g.id = i.group_id WHERE i.id = $1`,
      [req.params.id]
    );
    if (!srcRes.rows.length) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'Item not found' });
    }
    const src = srcRes.rows[0];

    if (!(await canAccessBoard(src.board_id, req.user, pool))) {
      await client.query('ROLLBACK');
      return res.status(403).json({ error: 'Access denied' });
    }

    // Position: append at the end of the group (avoid fractional position on INT column)
    const posRes = await client.query(
      'SELECT COALESCE(MAX(position), 0) + 1 AS pos FROM items WHERE group_id = $1 AND parent_item_id IS NULL',
      [src.group_id]
    );
    const newPos = posRes.rows[0].pos;

    // Create copied item
    const newItemRes = await client.query(
      `INSERT INTO items (group_id, name, position, created_by_user_id, created_by_user_name, parent_item_id)
       VALUES ($1, $2, $3, $4, $5, $6) RETURNING *`,
      [src.group_id, `Copy of ${src.name}`, newPos,
       req.user.id, req.user.name, src.parent_item_id || null]
    );
    const newItem = newItemRes.rows[0];

    // Copy column values — skip creation_log type columns
    const cvRes = await client.query(
      `SELECT cv.column_id, cv.value
       FROM column_values cv
       JOIN columns c ON c.id = cv.column_id AND c.type <> 'creation_log'
       WHERE cv.item_id = $1`,
      [src.id]
    );
    newItem.values = {};
    for (const cv of cvRes.rows) {
      await client.query(
        `INSERT INTO column_values (item_id, column_id, value) VALUES ($1, $2, $3)`,
        [newItem.id, cv.column_id, cv.value]
      );
      newItem.values[cv.column_id] = cv.value;
    }

    await logActivity(client, {
      board_id: src.board_id,
      user_id: req.user.id,
      user_name: req.user.name,
      item_id: newItem.id,
      item_name: newItem.name,
      action: 'item_created',
    });

    await client.query('COMMIT');
    newItem.subitems = [];
    res.status(201).json(newItem);
  } catch (err) {
    await client.query('ROLLBACK');
    console.error(err);
    res.status(500).json({ error: 'Internal server error' });
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
    if (!itemRes.rows.length) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'Item not found' });
    }

    const item = itemRes.rows[0];

    if (!(await canAccessBoard(item.board_id, req.user, pool))) {
      await client.query('ROLLBACK');
      return res.status(403).json({ error: 'Access denied' });
    }

    const oldGroupId = item.group_id;
    const newGroupId = parseInt(group_id);
    const newPos     = Math.max(0, parseInt(position));

    // Guard: target group must belong to the same board (prevent cross-board moves)
    if (oldGroupId !== newGroupId) {
      const targetRes = await client.query(
        'SELECT board_id FROM groups WHERE id=$1',
        [newGroupId]
      );
      if (!targetRes.rows.length || targetRes.rows[0].board_id !== item.board_id) {
        await client.query('ROLLBACK');
        return res.status(400).json({ error: 'Target group does not belong to the same board' });
      }
    }

    if (oldGroupId === newGroupId) {
      // ── Reorder within same group ──────────────────────────────────────────
      const { rows } = await client.query(
        'SELECT id FROM items WHERE group_id=$1 ORDER BY position FOR UPDATE', [newGroupId]
      );
      const ids = rows.map(r => r.id).filter(id => id !== parseInt(req.params.id));
      ids.splice(Math.min(newPos, ids.length), 0, parseInt(req.params.id));
      // Build position map then update in ascending ID order to prevent deadlocks
      const posMap = new Map(ids.map((id, i) => [id, i]));
      for (const id of [...ids].sort((a, b) => a - b)) {
        await client.query('UPDATE items SET position=$1 WHERE id=$2', [posMap.get(id), id]);
      }
    } else {
      // ── Move to different group ────────────────────────────────────────────
      const { rows: src } = await client.query(
        'SELECT id FROM items WHERE group_id=$1 ORDER BY position FOR UPDATE',
        [oldGroupId]
      );
      const { rows: tgt } = await client.query(
        'SELECT id FROM items WHERE group_id=$1 ORDER BY position FOR UPDATE', [newGroupId]
      );
      // Build all updates
      const srcIds = src.map(r => r.id).filter(id => id !== parseInt(req.params.id));
      const tgtIds = tgt.map(r => r.id);
      tgtIds.splice(Math.min(newPos, tgtIds.length), 0, parseInt(req.params.id));

      // Collect all updates, then apply in ascending ID order to prevent deadlocks
      const updates = [
        ...srcIds.map((id, i) => ({ id, group_id: oldGroupId, position: i })),
        ...tgtIds.map((id, i) => ({ id, group_id: newGroupId, position: i })),
      ].sort((a, b) => a.id - b.id);

      for (const u of updates) {
        await client.query('UPDATE items SET group_id=$1, position=$2 WHERE id=$3',
          [u.group_id, u.position, u.id]);
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
    console.error(err);
    res.status(500).json({ error: 'Internal server error' });
  } finally {
    client.release();
  }
});

module.exports = router;
