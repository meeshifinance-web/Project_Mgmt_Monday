const express = require('express');
const router = express.Router();
const pool = require('../db');
const { requireAuth, requireRole } = require('../middleware/auth');

const canWrite = [requireAuth, requireRole('admin', 'manager')];

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

router.post('/', ...canWrite, async (req, res) => {
  const { board_id, name, color } = req.body;
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
    res.status(500).json({ error: err.message });
  } finally {
    client.release();
  }
});

router.put('/:id', ...canWrite, async (req, res) => {
  const { name, color } = req.body;
  try {
    const { rows } = await pool.query(
      'UPDATE groups SET name=$1, color=$2 WHERE id=$3 RETURNING *',
      [name, color, req.params.id]
    );
    res.json(rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── PATCH /reorder — bulk update group positions ─────────────────────────────
router.patch('/reorder', ...canWrite, async (req, res) => {
  const { board_id, ordered_ids } = req.body;
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
    res.status(500).json({ error: err.message });
  } finally {
    client.release();
  }
});

router.delete('/:id', ...canWrite, async (req, res) => {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const infoRes = await client.query('SELECT board_id, name FROM groups WHERE id=$1', [req.params.id]);
    const info = infoRes.rows[0];
    await client.query('DELETE FROM groups WHERE id=$1', [req.params.id]);
    if (info) {
      await logActivity(client, {
        board_id: info.board_id,
        user_id: req.user.id,
        user_name: req.user.name,
        action: 'group_deleted',
        field: info.name,
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
