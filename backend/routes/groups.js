const express = require('express');
const router = express.Router();
const pool = require('../db');
const { requireAuth, requireRole, canAccessBoard } = require('../middleware/auth');
const { requireScope } = require('../middleware/apiAuth');

const canWrite     = [requireAuth, requireScope('write'), requireRole('admin', 'manager')];
const canWriteFull = [requireAuth, requireScope('full'),  requireRole('admin', 'manager')];

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

// ── POST / — create group ────────────────────────────────────────────────────
router.post('/', ...canWrite, async (req, res) => {
  const { board_id, name, color } = req.body;
  if (!board_id) return res.status(400).json({ error: 'board_id is required' });

  try {
    if (!(await canAccessBoard(board_id, req.user, pool)))
      return res.status(403).json({ error: 'Access denied' });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: 'Internal server error' });
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const posRes = await client.query('SELECT COALESCE(MAX(position),0)+1 AS pos FROM groups WHERE board_id=$1', [board_id]);
    const { rows } = await client.query(
      'INSERT INTO groups (board_id, name, color, position) VALUES ($1,$2,$3,$4) RETURNING *',
      [board_id, name, color || '#0073ea', posRes.rows[0].pos]
    );
    rows[0].items = [];
    await logActivity(client, {
      board_id,
      user_id: req.user.id,
      user_name: req.user.name,
      action: 'group_created',
      field: name,
    });
    await client.query('COMMIT');
    res.status(201).json(rows[0]);
  } catch (err) {
    await client.query('ROLLBACK');
    console.error(err);
    res.status(500).json({ error: 'Internal server error' });
  } finally {
    client.release();
  }
});

// ── PUT /:id — rename / recolor group ────────────────────────────────────────
router.put('/:id', ...canWrite, async (req, res) => {
  const { name, color } = req.body;
  try {
    // Resolve board so we can verify membership
    const groupRes = await pool.query('SELECT board_id FROM groups WHERE id=$1', [req.params.id]);
    if (!groupRes.rows.length) return res.status(404).json({ error: 'Group not found' });

    if (!(await canAccessBoard(groupRes.rows[0].board_id, req.user, pool)))
      return res.status(403).json({ error: 'Access denied' });

    const { rows } = await pool.query(
      'UPDATE groups SET name=$1, color=$2 WHERE id=$3 RETURNING *',
      [name, color, req.params.id]
    );
    res.json(rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ── PATCH /reorder — bulk update group positions ─────────────────────────────
router.patch('/reorder', ...canWrite, async (req, res) => {
  const { board_id, ordered_ids } = req.body;
  if (!board_id || !Array.isArray(ordered_ids))
    return res.status(400).json({ error: 'board_id and ordered_ids required' });

  try {
    if (!(await canAccessBoard(board_id, req.user, pool)))
      return res.status(403).json({ error: 'Access denied' });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: 'Internal server error' });
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    for (let i = 0; i < ordered_ids.length; i++) {
      await client.query(
        'UPDATE groups SET position=$1 WHERE id=$2 AND board_id=$3',
        [i, ordered_ids[i], board_id]
      );
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

// ── POST /:id/duplicate — duplicate a group with its items + values ───────────
router.post('/:id/duplicate', ...canWrite, async (req, res) => {
  const client = await pool.connect();
  try {
    const srcRes = await client.query('SELECT * FROM groups WHERE id=$1', [req.params.id]);
    if (!srcRes.rows.length) return res.status(404).json({ error: 'Group not found' });
    const src = srcRes.rows[0];

    if (!(await canAccessBoard(src.board_id, req.user, pool)))
      return res.status(403).json({ error: 'Access denied' });

    await client.query('BEGIN');
    await client.query('UPDATE groups SET position=position+1 WHERE board_id=$1 AND position>$2', [src.board_id, src.position]);
    const newGroup = (await client.query(
      'INSERT INTO groups (board_id,name,color,position) VALUES ($1,$2,$3,$4) RETURNING *',
      [src.board_id, `${src.name} (copy)`, src.color, src.position + 1]
    )).rows[0];
    newGroup.items = [];

    const items = (await client.query(
      'SELECT * FROM items WHERE group_id=$1 AND parent_item_id IS NULL ORDER BY position', [src.id]
    )).rows;
    for (const it of items) {
      const ni = (await client.query(
        'INSERT INTO items (group_id,name,position,created_by_user_id,created_by_user_name) VALUES ($1,$2,$3,$4,$5) RETURNING *',
        [newGroup.id, it.name, it.position, req.user.id, req.user.name]
      )).rows[0];
      ni.values = {};
      const vals = (await client.query('SELECT column_id, value FROM column_values WHERE item_id=$1', [it.id])).rows;
      for (const v of vals) {
        await client.query('INSERT INTO column_values (item_id,column_id,value) VALUES ($1,$2,$3)', [ni.id, v.column_id, v.value]);
        ni.values[v.column_id] = v.value;
      }
      ni.subitems = [];
      newGroup.items.push(ni);
    }
    await logActivity(client, { board_id: src.board_id, user_id: req.user.id, user_name: req.user.name, action: 'group_created', field: newGroup.name });
    await client.query('COMMIT');
    res.status(201).json(newGroup);
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    console.error(err);
    res.status(500).json({ error: 'Internal server error' });
  } finally {
    client.release();
  }
});

// ── POST /:id/move-items — move all of a group's items to another group ───────
router.post('/:id/move-items', ...canWrite, async (req, res) => {
  const { target_group_id } = req.body;
  if (!target_group_id) return res.status(400).json({ error: 'target_group_id is required' });
  const client = await pool.connect();
  try {
    const g = (await client.query('SELECT board_id FROM groups WHERE id=$1', [req.params.id])).rows[0];
    const t = (await client.query('SELECT board_id FROM groups WHERE id=$1', [target_group_id])).rows[0];
    if (!g || !t) return res.status(404).json({ error: 'Group not found' });
    if (g.board_id !== t.board_id) return res.status(400).json({ error: 'Groups must be on the same board' });
    if (!(await canAccessBoard(g.board_id, req.user, pool))) return res.status(403).json({ error: 'Access denied' });

    await client.query('BEGIN');
    const base = (await client.query('SELECT COALESCE(MAX(position),-1)+1 AS pos FROM items WHERE group_id=$1 AND parent_item_id IS NULL', [target_group_id])).rows[0].pos;
    const moving = (await client.query('SELECT id FROM items WHERE group_id=$1 AND parent_item_id IS NULL ORDER BY position', [req.params.id])).rows;
    let p = base;
    for (const m of moving) {
      await client.query('UPDATE items SET group_id=$1, position=$2 WHERE id=$3', [target_group_id, p++, m.id]);
    }
    await client.query('COMMIT');
    res.json({ success: true, moved: moving.length });
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    console.error(err);
    res.status(500).json({ error: 'Internal server error' });
  } finally {
    client.release();
  }
});

// ── DELETE /:id — delete group ────────────────────────────────────────────────
router.delete('/:id', ...canWriteFull, async (req, res) => {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const infoRes = await client.query('SELECT board_id, name FROM groups WHERE id=$1', [req.params.id]);
    const info = infoRes.rows[0];
    if (!info) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'Group not found' });
    }

    if (!(await canAccessBoard(info.board_id, req.user, pool))) {
      await client.query('ROLLBACK');
      return res.status(403).json({ error: 'Access denied' });
    }

    await client.query('DELETE FROM groups WHERE id=$1', [req.params.id]);
    await logActivity(client, {
      board_id: info.board_id,
      user_id: req.user.id,
      user_name: req.user.name,
      action: 'group_deleted',
      field: info.name,
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

module.exports = router;
