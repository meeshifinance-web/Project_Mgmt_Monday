/**
 * myWork.js
 *
 * GET /api/my-work
 * Returns all items (and sub-items) where the logged-in user's name appears
 * in any person-type column, across all boards they can access.
 * Results are grouped-ready: each row contains board/group/item context plus
 * a JSON array of relevant column values (person, status, date, text).
 */

const express = require('express');
const router  = express.Router();
const pool    = require('../db');
const { requireAuth } = require('../middleware/auth');

// GET /api/my-work
router.get('/', requireAuth, async (req, res) => {
  const userId   = req.user.id;
  const userName = req.user.name;
  const isAdmin  = req.user.role === 'admin';

  if (!userName) return res.json({ items: [] });

  try {
    // Build board access clause
    const boardClause = isAdmin
      ? `b.is_deleted IS NOT TRUE`
      : `b.is_deleted IS NOT TRUE AND (
           b.visibility = 'org'
           OR EXISTS (
             SELECT 1 FROM board_members bm
             WHERE bm.board_id = b.id AND bm.user_id = $1
           )
         )`;

    const params = isAdmin ? [userName] : [userId, userName];

    const { rows } = await pool.query(
      `SELECT
         i.id          AS item_id,
         i.name        AS item_name,
         i.parent_item_id,
         g.id          AS group_id,
         g.name        AS group_name,
         b.id          AS board_id,
         b.name        AS board_name,
         (
           SELECT json_agg(
             json_build_object(
               'col_id',    cv2.column_id,
               'col_title', c2.title,
               'col_type',  c2.type,
               'value',     cv2.value,
               'settings',  c2.settings
             ) ORDER BY c2.position
           )
           FROM column_values cv2
           JOIN columns c2 ON c2.id = cv2.column_id
           WHERE cv2.item_id = i.id
             AND c2.type IN ('status','person','date','text','dropdown')
             AND cv2.value IS NOT NULL
             AND cv2.value <> ''
         ) AS col_values
       FROM items i
       JOIN groups g ON g.id = i.group_id
       JOIN boards b ON b.id = g.board_id
       WHERE ${boardClause}
         AND EXISTS (
           SELECT 1
           FROM column_values cv
           JOIN columns c ON c.id = cv.column_id AND c.type = 'person'
           WHERE cv.item_id = i.id
             AND cv.value LIKE '%' || $${isAdmin ? 1 : 2} || '%'
         )
       ORDER BY b.name, g.name, i.name`,
      params
    );

    res.json({ items: rows });
  } catch (err) {
    console.error('[my-work]', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

module.exports = router;
