const express = require('express');
const router = express.Router();
const pool = require('../db');
const { requireAuth } = require('../middleware/auth');

// Parse multi-owner value — handles JSON array or legacy single-name string.
function parseOwners(val) {
  if (!val) return [];
  try { const p = JSON.parse(val); return Array.isArray(p) ? p : p ? [String(p)] : []; }
  catch { return val.trim() ? [val.trim()] : []; }
}

// GET /api/search?q=<query>
// Returns items matching the query, grouped by board, scoped to boards the
// user can access AND filtered by the same per-item owner-visibility rule
// the board view applies — so confidential items don't leak through search.
router.get('/', requireAuth, async (req, res) => {
  const { q } = req.query;
  if (!q || q.trim().length < 2) return res.json([]);

  const userId   = req.user.id;
  const userName = req.user.name;
  const isAdmin  = req.user.role === 'admin';
  const term = `%${q.trim().toLowerCase()}%`;

  try {
    // Carry through enforce_owner_visibility and the user's per-board is_owner
    // flag so we can re-apply the same filter logic the board GET endpoint uses.
    const boardsQuery = isAdmin
      ? `SELECT b.id, b.name, b.enforce_owner_visibility, true AS is_board_owner
         FROM boards b WHERE b.deleted_at IS NULL ORDER BY b.name`
      : `SELECT b.id, b.name, b.enforce_owner_visibility,
                COALESCE(bm.is_owner, false) AS is_board_owner
         FROM boards b
         JOIN board_members bm ON bm.board_id = b.id AND bm.user_id = $1
         WHERE b.deleted_at IS NULL ORDER BY b.name`;
    const boardsRes = await pool.query(boardsQuery, isAdmin ? [] : [userId]);
    const boardIds = boardsRes.rows.map(r => r.id);
    if (!boardIds.length) return res.json([]);

    const boardMeta = Object.fromEntries(boardsRes.rows.map(b => [b.id, b]));

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

    // Build owner-column index per board (only for boards in the result set).
    const resultBoardIds = [...new Set(itemsRes.rows.map(r => r.board_id))];
    const ownerColsByBoard = {};
    if (resultBoardIds.length) {
      const colRes = await pool.query(
        `SELECT id, board_id, settings FROM columns
          WHERE board_id = ANY($1::int[]) AND type='person'`,
        [resultBoardIds]
      );
      for (const c of colRes.rows) {
        const s = typeof c.settings === 'string' ? JSON.parse(c.settings) : (c.settings || {});
        if (s.isOwnerColumn === true) {
          (ownerColsByBoard[c.board_id] = ownerColsByBoard[c.board_id] || []).push(c.id);
        }
      }
    }

    // Pull column-values once for the items in the result set.
    const itemIds = itemsRes.rows.map(r => r.id);
    const valsByItem = {};
    if (itemIds.length) {
      const valsRes = await pool.query(
        'SELECT item_id, column_id, value FROM column_values WHERE item_id = ANY($1::int[])',
        [itemIds]
      );
      for (const v of valsRes.rows) {
        (valsByItem[v.item_id] = valsByItem[v.item_id] || {})[v.column_id] = v.value;
      }
    }

    const visibleRows = itemsRes.rows.filter(row => {
      const meta = boardMeta[row.board_id];
      if (!meta) return false;
      const bypass = meta.enforce_owner_visibility
        ? (isAdmin || meta.is_board_owner)
        : (isAdmin || req.user.role === 'manager');
      if (bypass) return true;
      const ownerCols = ownerColsByBoard[row.board_id] || [];
      if (!ownerCols.length) return true;
      const vals = valsByItem[row.id] || {};
      for (const colId of ownerCols) {
        const owners = parseOwners(vals[colId]);
        if (owners.length > 0 && !owners.includes(userName)) return false;
      }
      return true;
    });

    const grouped = {};
    for (const row of visibleRows) {
      if (!grouped[row.board_id]) {
        grouped[row.board_id] = { board_id: row.board_id, board_name: boardMeta[row.board_id]?.name, items: [] };
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
