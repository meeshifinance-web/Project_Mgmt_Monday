const express = require('express');
const router = express.Router();
const pool = require('../db');
const { requireAuth, canAccessBoard } = require('../middleware/auth');
const { requireScope } = require('../middleware/apiAuth');

// GET /api/trash/board/:boardId  — list non-expired trash items for a board
router.get('/board/:boardId', requireAuth, async (req, res) => {
  try {
    if (!(await canAccessBoard(req.params.boardId, req.user, pool)))
      return res.status(403).json({ error: 'Access denied' });
    const { rows } = await pool.query(
      `SELECT *,
              CEIL(EXTRACT(EPOCH FROM (deleted_at + INTERVAL '15 days' - NOW())) / 86400) AS days_left
       FROM trash_items
       WHERE board_id = $1
         AND deleted_at > NOW() - INTERVAL '15 days'
       ORDER BY deleted_at DESC`,
      [req.params.boardId]
    );
    res.json(rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// POST /api/trash/:id/restore  — restore an item from trash
router.post('/:id/restore', requireAuth, requireScope('write'), async (req, res) => {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const trashRes = await client.query('SELECT * FROM trash_items WHERE id=$1', [req.params.id]);
    const trashed = trashRes.rows[0];
    if (!trashed) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'Trash item not found' });
    }
    if (!(await canAccessBoard(trashed.board_id, req.user, pool))) {
      await client.query('ROLLBACK');
      return res.status(403).json({ error: 'Access denied' });
    }

    // Resolve target group — fall back to first group in board if original is gone
    const groupRes = await client.query(
      'SELECT id FROM groups WHERE id=$1 AND board_id=$2',
      [trashed.group_id, trashed.board_id]
    );
    let targetGroupId = groupRes.rows[0]?.id;
    if (!targetGroupId) {
      const fallback = await client.query(
        'SELECT id FROM groups WHERE board_id=$1 ORDER BY position LIMIT 1',
        [trashed.board_id]
      );
      targetGroupId = fallback.rows[0]?.id;
    }
    if (!targetGroupId) {
      await client.query('ROLLBACK');
      return res.status(400).json({ error: 'No group available to restore into' });
    }

    // Position at bottom of target group
    const posRes = await client.query(
      'SELECT COALESCE(MAX(position),0)+1 AS pos FROM items WHERE group_id=$1',
      [targetGroupId]
    );

    // Re-create item
    const itemRes = await client.query(
      'INSERT INTO items (group_id, name, position) VALUES ($1,$2,$3) RETURNING *',
      [targetGroupId, trashed.name, posRes.rows[0].pos]
    );
    const newItem = itemRes.rows[0];
    newItem.values = {};

    // Restore column values (skip columns that no longer exist)
    const savedValues = typeof trashed.values === 'string'
      ? JSON.parse(trashed.values)
      : (trashed.values || {});

    for (const [colId, val] of Object.entries(savedValues)) {
      const colCheck = await client.query('SELECT id FROM columns WHERE id=$1', [colId]);
      if (colCheck.rows.length) {
        await client.query(
          `INSERT INTO column_values (item_id, column_id, value)
           VALUES ($1,$2,$3)
           ON CONFLICT (item_id, column_id) DO UPDATE SET value=EXCLUDED.value`,
          [newItem.id, parseInt(colId), val]
        );
        newItem.values[parseInt(colId)] = val;
      }
    }

    // Remove from trash
    await client.query('DELETE FROM trash_items WHERE id=$1', [req.params.id]);

    await client.query('COMMIT');
    res.json({ item: newItem, group_id: targetGroupId });
  } catch (err) {
    await client.query('ROLLBACK');
    console.error(err);
    res.status(500).json({ error: 'Internal server error' });
  } finally {
    client.release();
  }
});

// DELETE /api/trash/board/:boardId/empty  — permanently delete ALL trash for a board
// (must come before /:id to avoid Express matching "board" as an id)
router.delete('/board/:boardId/empty', requireAuth, requireScope('full'), async (req, res) => {
  try {
    if (!(await canAccessBoard(req.params.boardId, req.user, pool)))
      return res.status(403).json({ error: 'Access denied' });
    await pool.query('DELETE FROM trash_items WHERE board_id=$1', [req.params.boardId]);
    res.json({ success: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// DELETE /api/trash/:id  — permanently delete one trash item
router.delete('/:id', requireAuth, requireScope('full'), async (req, res) => {
  try {
    const { rows } = await pool.query('SELECT board_id FROM trash_items WHERE id=$1', [req.params.id]);
    if (!rows.length) return res.status(404).json({ error: 'Trash item not found' });
    if (!(await canAccessBoard(rows[0].board_id, req.user, pool)))
      return res.status(403).json({ error: 'Access denied' });
    await pool.query('DELETE FROM trash_items WHERE id=$1', [req.params.id]);
    res.json({ success: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

module.exports = router;
