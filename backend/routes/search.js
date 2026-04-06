const express = require('express');
const router = express.Router();
const pool = require('../db');
const { requireAuth } = require('../middleware/auth');

// GET /api/search?q=<query>
// Returns items matching the query, grouped by board, scoped to boards the user can access.
router.get('/', requireAuth, async (req, res) => {
  const { q } = req.query;
  if (!q || q.trim().length < 2) return res.json([]);

  const userId = req.user.id;
  const isAdmin = req.user.role === 'admin';
  const term = `%${q.trim().toLowerCase()}%`;

  try {
    // Find boards the user has access to
    const boardsQuery = isAdmin
      ? `SELECT id, name FROM boards WHERE deleted_at IS NULL ORDER BY name`
      : `SELECT b.id, b.name FROM boards b
         JOIN board_members bm ON bm.board_id = b.id AND bm.user_id = $1
         WHERE b.deleted_at IS NULL
         ORDER BY b.name`;
    const boardsRes = await pool.query(boardsQuery, isAdmin ? [] : [userId]);
    const boardIds = boardsRes.rows.map(r => r.id);
    if (!boardIds.length) return res.json([]);

    // Search items by name or column values
    const itemsRes = await pool.query(
      `SELECT i.id, i.name, i.board_id, g.name AS group_name
       FROM items i
       JOIN groups g ON g.id = i.group_id
       WHERE i.board_id = ANY($1::int[])
         AND i.deleted_at IS NULL
         AND (
           LOWER(i.name) LIKE $2
           OR EXISTS (
             SELECT 1 FROM column_values cv
             WHERE cv.item_id = i.id AND LOWER(cv.value::text) LIKE $2
           )
         )
       ORDER BY i.board_id, g.position, i.position
       LIMIT 200`,
      [boardIds, term]
    );

    // Group results by board
    const boardMap = Object.fromEntries(boardsRes.rows.map(b => [b.id, b.name]));
    const grouped = {};
    for (const row of itemsRes.rows) {
      if (!grouped[row.board_id]) {
        grouped[row.board_id] = { board_id: row.board_id, board_name: boardMap[row.board_id], items: [] };
      }
      grouped[row.board_id].items.push({ id: row.id, name: row.name, group_name: row.group_name });
    }

    res.json(Object.values(grouped));
  } catch (err) {
    console.error('Search error:', err);
    res.status(500).json({ error: 'Search failed' });
  }
});

module.exports = router;
