const express = require('express');
const router  = express.Router();
const pool    = require('../db');
const { requireAuth, requireRole } = require('../middleware/auth');

const canWrite = [requireAuth, requireRole('admin', 'manager')];

// ── GET all views for a board ─────────────────────────────────────────────────
// Auto-creates a default "Main Table" view if none exist yet.
router.get('/board/:boardId', requireAuth, async (req, res) => {
  const { boardId } = req.params;
  try {
    let { rows } = await pool.query(
      `SELECT id, board_id, name, type, filters, created_at, updated_at
         FROM board_views
        WHERE board_id = $1
        ORDER BY created_at ASC`,
      [boardId]
    );

    // Auto-create default view on first access
    if (rows.length === 0) {
      const insert = await pool.query(
        `INSERT INTO board_views (board_id, name, type, filters, created_by)
         VALUES ($1, 'Main Table', 'table', '[]', $2)
         RETURNING id, board_id, name, type, filters, created_at, updated_at`,
        [boardId, req.user.id]
      );
      rows = insert.rows;
    }

    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── POST create a new view ────────────────────────────────────────────────────
router.post('/', ...canWrite, async (req, res) => {
  const { board_id, name, type = 'table', filters = [] } = req.body;
  if (!board_id || !name) {
    return res.status(400).json({ error: 'board_id and name are required' });
  }
  try {
    const { rows } = await pool.query(
      `INSERT INTO board_views (board_id, name, type, filters, created_by)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING id, board_id, name, type, filters, created_at, updated_at`,
      [board_id, name, type, JSON.stringify(filters), req.user.id]
    );
    res.status(201).json(rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── PUT update view name and/or filters ───────────────────────────────────────
router.put('/:id', ...canWrite, async (req, res) => {
  const { id } = req.params;
  const { name, filters } = req.body;

  try {
    // Build a partial update — only set columns that were supplied
    const setClauses = ['updated_at = NOW()'];
    const values = [];
    let idx = 1;

    if (name !== undefined) {
      setClauses.push(`name = $${idx++}`);
      values.push(name);
    }
    if (filters !== undefined) {
      setClauses.push(`filters = $${idx++}`);
      values.push(JSON.stringify(filters));
    }

    values.push(id); // last param = WHERE id

    const { rows } = await pool.query(
      `UPDATE board_views
          SET ${setClauses.join(', ')}
        WHERE id = $${idx}
        RETURNING id, board_id, name, type, filters, created_at, updated_at`,
      values
    );
    if (!rows.length) return res.status(404).json({ error: 'View not found' });
    res.json(rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── DELETE a view ─────────────────────────────────────────────────────────────
// Cannot delete the last remaining view on a board.
router.delete('/:id', ...canWrite, async (req, res) => {
  const { id } = req.params;
  try {
    // Find the view to get its board_id
    const viewRes = await pool.query(
      'SELECT board_id FROM board_views WHERE id = $1',
      [id]
    );
    if (!viewRes.rows.length) return res.status(404).json({ error: 'View not found' });

    const { board_id } = viewRes.rows[0];

    // Count remaining views on this board
    const countRes = await pool.query(
      'SELECT COUNT(*) FROM board_views WHERE board_id = $1',
      [board_id]
    );
    if (parseInt(countRes.rows[0].count) <= 1) {
      return res.status(400).json({ error: 'Cannot delete the last view on a board' });
    }

    await pool.query('DELETE FROM board_views WHERE id = $1', [id]);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
