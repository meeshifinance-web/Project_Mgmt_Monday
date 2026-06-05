const express = require('express');
const router  = express.Router();
const pool    = require('../db');
const { requireAuth, requireRole, canAccessBoard } = require('../middleware/auth');

const canWrite = [requireAuth, requireRole('admin', 'manager')];

// ── GET all views for a board ─────────────────────────────────────────────────
// Auto-creates a default "Main Table" view if none exist yet.
router.get('/board/:boardId', requireAuth, async (req, res) => {
  const { boardId } = req.params;
  try {
    if (!(await canAccessBoard(boardId, req.user, pool)))
      return res.status(403).json({ error: 'Access denied' });

    let { rows } = await pool.query(
      `SELECT id, board_id, name, type, filters, position, is_main, created_at, updated_at
         FROM board_views
        WHERE board_id = $1
        ORDER BY position ASC, created_at ASC`,
      [boardId]
    );

    // Auto-create default view on first access
    if (rows.length === 0) {
      const insert = await pool.query(
        `INSERT INTO board_views (board_id, name, type, filters, position, is_main, created_by)
         VALUES ($1, 'Main Table', 'table', '[]', 1, true, $2)
         RETURNING id, board_id, name, type, filters, position, is_main, created_at, updated_at`,
        [boardId, req.user.id]
      );
      rows = insert.rows;
    }

    res.json(rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ── POST create a new view ────────────────────────────────────────────────────
router.post('/', ...canWrite, async (req, res) => {
  const { board_id, name, type = 'table', filters = [] } = req.body;
  if (!board_id || !name) {
    return res.status(400).json({ error: 'board_id and name are required' });
  }
  try {
    if (!(await canAccessBoard(board_id, req.user, pool)))
      return res.status(403).json({ error: 'Access denied' });

    // Place the new view at the end of the board's tab strip.
    const posRes = await pool.query(
      'SELECT COALESCE(MAX(position), 0) + 1 AS next_pos FROM board_views WHERE board_id = $1',
      [board_id]
    );
    const nextPos = posRes.rows[0].next_pos;

    // is_main is intentionally NEVER accepted from the request body — the
    // locked Main Table is auto-created on board first-access and there is
    // no path for users to mark a custom view as main.
    const { rows } = await pool.query(
      `INSERT INTO board_views (board_id, name, type, filters, position, is_main, created_by)
       VALUES ($1, $2, $3, $4, $5, false, $6)
       RETURNING id, board_id, name, type, filters, position, is_main, created_at, updated_at`,
      [board_id, name, type, JSON.stringify(filters), nextPos, req.user.id]
    );
    res.status(201).json(rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ── PUT update view name and/or filters ───────────────────────────────────────
router.put('/:id', ...canWrite, async (req, res) => {
  const { id } = req.params;
  const { name, filters, type } = req.body;
  const VIEW_TYPES = ['table', 'kanban', 'dashboard', 'calendar', 'timeline', 'gantt', 'workload', 'chart', 'cards', 'map'];
  if (type !== undefined && !VIEW_TYPES.includes(type))
    return res.status(400).json({ error: `Unknown view type: ${type}` });

  try {
    // Fetch view first so we can verify board membership
    const viewRes = await pool.query('SELECT board_id FROM board_views WHERE id = $1', [id]);
    if (!viewRes.rows.length) return res.status(404).json({ error: 'View not found' });

    if (!(await canAccessBoard(viewRes.rows[0].board_id, req.user, pool)))
      return res.status(403).json({ error: 'Access denied' });

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
    if (type !== undefined) {
      setClauses.push(`type = $${idx++}`);
      values.push(type);
    }

    values.push(id); // last param = WHERE id

    const { rows } = await pool.query(
      `UPDATE board_views
          SET ${setClauses.join(', ')}
        WHERE id = $${idx}
        RETURNING id, board_id, name, type, filters, position, is_main, created_at, updated_at`,
      values
    );
    if (!rows.length) return res.status(404).json({ error: 'View not found' });
    res.json(rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ── POST reorder views on a board ─────────────────────────────────────────────
// Body: { board_id, view_ids: [int, int, ...] }  — order = visual order left→right.
// Writes positions 1..N for the supplied IDs in a single transaction.
router.post('/reorder', ...canWrite, async (req, res) => {
  const { board_id, view_ids } = req.body;
  if (!board_id || !Array.isArray(view_ids) || view_ids.length === 0) {
    return res.status(400).json({ error: 'board_id and view_ids[] are required' });
  }
  const client = await pool.connect();
  try {
    if (!(await canAccessBoard(board_id, req.user, client)))
      return res.status(403).json({ error: 'Access denied' });

    await client.query('BEGIN');
    for (let i = 0; i < view_ids.length; i++) {
      await client.query(
        'UPDATE board_views SET position = $1, updated_at = NOW() WHERE id = $2 AND board_id = $3',
        [i + 1, view_ids[i], board_id]
      );
    }
    await client.query('COMMIT');
    res.json({ success: true });
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    console.error(err);
    res.status(500).json({ error: 'Internal server error' });
  } finally {
    client.release();
  }
});

// ── DELETE a view ─────────────────────────────────────────────────────────────
// Cannot delete the last remaining view on a board.
router.delete('/:id', ...canWrite, async (req, res) => {
  const { id } = req.params;
  try {
    // Find the view to get its board_id and lock-status
    const viewRes = await pool.query(
      'SELECT board_id, is_main FROM board_views WHERE id = $1',
      [id]
    );
    if (!viewRes.rows.length) return res.status(404).json({ error: 'View not found' });

    const { board_id, is_main } = viewRes.rows[0];

    if (!(await canAccessBoard(board_id, req.user, pool)))
      return res.status(403).json({ error: 'Access denied' });

    if (is_main) {
      return res.status(400).json({ error: 'The Main Table view is locked and cannot be deleted' });
    }

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
    console.error(err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

module.exports = router;
