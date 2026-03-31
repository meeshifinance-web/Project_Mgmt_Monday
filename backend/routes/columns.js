const express = require('express');
const router = express.Router();
const pool = require('../db');
const { requireAuth, requireRole, canAccessBoard } = require('../middleware/auth');

const canWrite = [requireAuth, requireRole('admin', 'manager')];

// ── POST / — create column ────────────────────────────────────────────────────
router.post('/', ...canWrite, async (req, res) => {
  const { board_id, title, type, settings } = req.body;
  if (!board_id || !title) return res.status(400).json({ error: 'board_id and title are required' });

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

    const posRes = await client.query('SELECT COALESCE(MAX(position),0)+1 AS pos FROM columns WHERE board_id=$1', [board_id]);
    const colRes = await client.query(
      'INSERT INTO columns (board_id, title, type, settings, position) VALUES ($1,$2,$3,$4,$5) RETURNING *',
      [board_id, title, type || 'text', JSON.stringify(settings || {}), posRes.rows[0].pos]
    );
    const newCol = colRes.rows[0];

    // Create empty column_values for all existing items in this board
    await client.query(
      `INSERT INTO column_values (item_id, column_id, value)
       SELECT i.id, $1, ''
       FROM items i
       JOIN groups g ON g.id = i.group_id
       WHERE g.board_id = $2
       ON CONFLICT DO NOTHING`,
      [newCol.id, board_id]
    );

    await client.query('COMMIT');
    res.status(201).json(newCol);
  } catch (err) {
    await client.query('ROLLBACK');
    console.error(err);
    res.status(500).json({ error: 'Internal server error' });
  } finally {
    client.release();
  }
});

// ── PUT /:id — update column title / settings ─────────────────────────────────
router.put('/:id', ...canWrite, async (req, res) => {
  const { title, settings } = req.body;
  try {
    // Resolve board so we can verify membership
    const colRes = await pool.query('SELECT board_id FROM columns WHERE id=$1', [req.params.id]);
    if (!colRes.rows.length) return res.status(404).json({ error: 'Column not found' });

    if (!(await canAccessBoard(colRes.rows[0].board_id, req.user, pool)))
      return res.status(403).json({ error: 'Access denied' });

    const { rows } = await pool.query(
      'UPDATE columns SET title=$1, settings=$2 WHERE id=$3 RETURNING *',
      [title, JSON.stringify(settings || {}), req.params.id]
    );
    res.json(rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ── DELETE /:id — delete column ───────────────────────────────────────────────
router.delete('/:id', ...canWrite, async (req, res) => {
  try {
    // Resolve board so we can verify membership
    const colRes = await pool.query('SELECT board_id FROM columns WHERE id=$1', [req.params.id]);
    if (!colRes.rows.length) return res.status(404).json({ error: 'Column not found' });

    if (!(await canAccessBoard(colRes.rows[0].board_id, req.user, pool)))
      return res.status(403).json({ error: 'Access denied' });

    await pool.query('DELETE FROM columns WHERE id=$1', [req.params.id]);
    res.json({ success: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ── PATCH /reorder — reorder columns by updating positions ────────────────────
router.patch('/reorder', ...canWrite, async (req, res) => {
  const { board_id, ordered_ids } = req.body;
  if (!board_id || !Array.isArray(ordered_ids)) return res.status(400).json({ error: 'board_id and ordered_ids required' });

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
      await client.query('UPDATE columns SET position=$1 WHERE id=$2 AND board_id=$3', [i, ordered_ids[i], board_id]);
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
