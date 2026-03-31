const express = require('express');
const router = express.Router();
const pool = require('../db');
const { requireAuth, canAccessBoard } = require('../middleware/auth');

// GET /api/activity-logs/board/:boardId
router.get('/board/:boardId', requireAuth, async (req, res) => {
  const { boardId } = req.params;
  try {
    if (!(await canAccessBoard(boardId, req.user, pool)))
      return res.status(403).json({ error: 'Access denied' });

    const { rows } = await pool.query(
      `SELECT * FROM activity_logs WHERE board_id=$1 ORDER BY created_at DESC LIMIT 200`,
      [boardId]
    );
    res.json(rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// GET /api/activity-logs/item/:itemId — item-specific activity (for detail panel)
router.get('/item/:itemId', requireAuth, async (req, res) => {
  const { itemId } = req.params;
  try {
    // Resolve board from item so we can verify membership
    const boardRes = await pool.query(
      `SELECT g.board_id FROM items i JOIN groups g ON g.id = i.group_id WHERE i.id = $1`,
      [itemId]
    );
    if (!boardRes.rows.length) return res.status(404).json({ error: 'Item not found' });

    if (!(await canAccessBoard(boardRes.rows[0].board_id, req.user, pool)))
      return res.status(403).json({ error: 'Access denied' });

    const { rows } = await pool.query(
      `SELECT * FROM activity_logs WHERE item_id=$1 ORDER BY created_at ASC LIMIT 100`,
      [itemId]
    );
    res.json(rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

module.exports = router;
