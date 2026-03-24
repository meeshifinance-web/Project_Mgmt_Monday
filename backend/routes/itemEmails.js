const express = require('express');
const router  = express.Router();
const pool    = require('../db');
const { requireAuth } = require('../middleware/auth');

// GET /api/items/:itemId/emails — all emails (incoming + outgoing) for an item
router.get('/:itemId/emails', requireAuth, async (req, res) => {
  try {
    const { rows } = await pool.query(
      'SELECT * FROM item_emails WHERE item_id=$1 ORDER BY created_at ASC',
      [req.params.itemId]
    );
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
