/**
 * cmdkSearch.js
 *
 * GET /api/cmdk-search?q=<query>
 *
 * Backend for the Cmd-K command palette. Returns the top boards + items
 * matching the query, scoped to what the current user can access. Shaped
 * to be cheap to render — no nested column data, just enough for the
 * palette to display a label, a subtitle, and a route.
 *
 * Response:
 *   {
 *     boards: [{ id, name, folder_name }],
 *     items:  [{ id, name, board_id, board_name, group_name }],
 *   }
 *
 * Visibility rules mirror the board GET endpoint:
 *   - Admin: sees every non-deleted board / item.
 *   - Everyone else: sees only boards they're a member of, AND items
 *     they're allowed to see on those boards (when strict-visibility
 *     is enforced, only items where they're an owner).
 */

const express = require('express');
const router  = express.Router();
const pool    = require('../db');
const { requireAuth } = require('../middleware/auth');

function parseOwners(val) {
  if (!val) return [];
  let arr;
  try { arr = JSON.parse(val); } catch { return String(val).trim() ? [String(val).trim()] : []; }
  if (!Array.isArray(arr)) arr = arr ? [arr] : [];
  return arr.map(e => (e && typeof e === 'object') ? (e.name || '') : String(e)).filter(Boolean);
}

router.get('/', requireAuth, async (req, res) => {
  const q = (req.query.q || '').trim();
  if (q.length < 1) return res.json({ boards: [], items: [] });

  const userId   = req.user.id;
  const userName = req.user.name;
  const isAdmin  = req.user.role === 'admin';
  const term     = `%${q.toLowerCase()}%`;

  try {
    // ── Boards the user can access (carry visibility flags for filtering items) ──
    const boardsQuery = isAdmin
      ? `SELECT b.id, b.name, b.enforce_owner_visibility, true AS is_board_owner,
                f.name AS folder_name
           FROM boards b
           LEFT JOIN board_folders f ON f.id = b.folder_id
          WHERE (b.is_deleted IS NULL OR b.is_deleted = false)
          ORDER BY b.name`
      : `SELECT b.id, b.name, b.enforce_owner_visibility,
                COALESCE(bm.is_owner, false) AS is_board_owner,
                f.name AS folder_name
           FROM boards b
           JOIN board_members bm ON bm.board_id = b.id AND bm.user_id = $1
           LEFT JOIN board_folders f ON f.id = b.folder_id
          WHERE (b.is_deleted IS NULL OR b.is_deleted = false)
          ORDER BY b.name`;
    const boardsRes = await pool.query(boardsQuery, isAdmin ? [] : [userId]);

    const accessibleBoardIds = boardsRes.rows.map(b => b.id);
    const boardMeta = Object.fromEntries(boardsRes.rows.map(b => [b.id, b]));

    // ── Top matching boards (substring on name) ──
    const matchingBoards = boardsRes.rows
      .filter(b => b.name.toLowerCase().includes(q.toLowerCase()))
      .slice(0, 8)
      .map(b => ({ id: b.id, name: b.name, folder_name: b.folder_name || null }));

    // ── Top matching items (only on accessible boards) ──
    let items = [];
    if (accessibleBoardIds.length) {
      const itemsRes = await pool.query(
        `SELECT i.id, i.name, i.group_id, g.board_id, g.name AS group_name
           FROM items i
           JOIN groups g ON g.id = i.group_id
          WHERE g.board_id = ANY($1::int[])
            AND i.parent_item_id IS NULL
            AND LOWER(i.name) LIKE $2
          ORDER BY i.id DESC
          LIMIT 50`,
        [accessibleBoardIds, term]
      );

      // Apply owner-visibility filter where applicable. For most boards this
      // is a no-op; only enforced boards need the per-item owner check.
      const enforcedBoardIds = itemsRes.rows
        .map(r => r.board_id)
        .filter(id => boardMeta[id]?.enforce_owner_visibility && !boardMeta[id]?.is_board_owner && !isAdmin);

      let valuesByItem = {};
      let ownerColsByBoard = {};
      if (enforcedBoardIds.length) {
        const uniqueEnforced = [...new Set(enforcedBoardIds)];
        // Owner columns per board
        const colsRes = await pool.query(
          `SELECT id, board_id, settings FROM columns
            WHERE board_id = ANY($1::int[]) AND type='person'`,
          [uniqueEnforced]
        );
        for (const c of colsRes.rows) {
          const s = typeof c.settings === 'string' ? JSON.parse(c.settings) : (c.settings || {});
          if (s.isOwnerColumn === true) {
            (ownerColsByBoard[c.board_id] = ownerColsByBoard[c.board_id] || []).push(c.id);
          }
        }
        // Fetch values for the items we need to check
        const enforcedItemIds = itemsRes.rows
          .filter(r => uniqueEnforced.includes(r.board_id))
          .map(r => r.id);
        if (enforcedItemIds.length) {
          const valsRes = await pool.query(
            'SELECT item_id, column_id, value FROM column_values WHERE item_id = ANY($1::int[])',
            [enforcedItemIds]
          );
          for (const v of valsRes.rows) {
            (valuesByItem[v.item_id] = valuesByItem[v.item_id] || {})[v.column_id] = v.value;
          }
        }
      }

      const isItemVisible = (row) => {
        const meta = boardMeta[row.board_id];
        if (!meta) return false;
        const bypass = meta.enforce_owner_visibility
          ? (isAdmin || meta.is_board_owner)
          : (isAdmin || req.user.role === 'manager');
        if (bypass) return true;
        const ownerCols = ownerColsByBoard[row.board_id] || [];
        if (!ownerCols.length) return true;
        const vals = valuesByItem[row.id] || {};
        for (const colId of ownerCols) {
          const owners = parseOwners(vals[colId]);
          if (owners.length > 0 && !owners.includes(userName)) return false;
        }
        return true;
      };

      items = itemsRes.rows
        .filter(isItemVisible)
        .slice(0, 12)
        .map(r => ({
          id:         r.id,
          name:       r.name,
          board_id:   r.board_id,
          board_name: boardMeta[r.board_id]?.name || '',
          group_name: r.group_name,
        }));
    }

    res.json({ boards: matchingBoards, items });
  } catch (err) {
    console.error('cmdk-search error:', err);
    res.status(500).json({ error: 'Search failed' });
  }
});

module.exports = router;
