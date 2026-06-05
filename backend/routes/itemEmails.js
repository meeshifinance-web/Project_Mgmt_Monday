const express = require('express');
const router  = express.Router();
const pool    = require('../db');
const { requireAuth, canAccessBoard } = require('../middleware/auth');

// GET /api/items/:itemId/emails — all emails (incoming + outgoing) for an item
// Email threads can contain sensitive content, so access is gated on board
// membership/visibility — not just authentication (was an IDOR: any logged-in
// user could read any item's emails by guessing the id).
router.get('/:itemId/emails', requireAuth, async (req, res) => {
  try {
    const boardRes = await pool.query(
      `SELECT g.board_id FROM items i JOIN groups g ON g.id = i.group_id WHERE i.id = $1`,
      [req.params.itemId]
    );
    if (!boardRes.rows.length) return res.status(404).json({ error: 'Item not found' });
    if (!(await canAccessBoard(boardRes.rows[0].board_id, req.user, pool)))
      return res.status(403).json({ error: 'Access denied' });

    const { rows } = await pool.query(
      'SELECT * FROM item_emails WHERE item_id=$1 ORDER BY created_at ASC',
      [req.params.itemId]
    );
    res.json(rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

module.exports = router;
