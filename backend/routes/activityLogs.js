const express = require('express');
const router = express.Router();
const pool = require('../db');
const { requireAuth } = require('../middleware/auth');

router.get('/board/:boardId', requireAuth, async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT * FROM activity_logs WHERE board_id=$1 ORDER BY created_at DESC LIMIT 200`,
      [req.params.boardId]
    );
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Item-specific activity (for detail panel)
router.get('/item/:itemId', requireAuth, async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT * FROM activity_logs WHERE item_id=$1 ORDER BY created_at ASC LIMIT 100`,
      [req.params.itemId]
    );
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
