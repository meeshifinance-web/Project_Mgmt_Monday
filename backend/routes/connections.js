const express = require('express');
const router = express.Router();
const pool = require('../db');
const { requireAuth, canAccessBoard } = require('../middleware/auth');

// ── GET items in a board (the "Connect Boards" item picker) ───────────────────
// Optional ?q= name filter, ?limit= (default 25, max 50), ?exclude= comma ids.
router.get('/board/:boardId/items', requireAuth, async (req, res) => {
  const { boardId } = req.params;
  const q = String(req.query.q || '').trim();
  const limit = Math.min(50, Math.max(1, parseInt(req.query.limit, 10) || 25));
  const exclude = String(req.query.exclude || '')
    .split(',').map(n => parseInt(n, 10)).filter(Number.isInteger);
  try {
    if (!(await canAccessBoard(boardId, req.user, pool)))
      return res.status(403).json({ error: 'Access denied' });

    const params = [boardId];
    let where = 'g.board_id = $1 AND i.parent_item_id IS NULL';
    if (q) { params.push(`%${q}%`); where += ` AND i.name ILIKE $${params.length}`; }
    if (exclude.length) { params.push(exclude); where += ` AND i.id <> ALL($${params.length})`; }
    params.push(limit);

    const { rows } = await pool.query(
      `SELECT i.id, i.name, g.name AS group_name, g.color AS group_color
         FROM items i JOIN groups g ON g.id = i.group_id
        WHERE ${where}
        ORDER BY i.name ASC
        LIMIT $${params.length}`,
      params
    );
    res.json(rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ── GET a board's columns (Mirror / Rollup source-column picker) ──────────────
router.get('/board/:boardId/columns', requireAuth, async (req, res) => {
  try {
    if (!(await canAccessBoard(req.params.boardId, req.user, pool)))
      return res.status(403).json({ error: 'Access denied' });
    const { rows } = await pool.query(
      'SELECT id, title, type, settings FROM columns WHERE board_id = $1 ORDER BY position',
      [req.params.boardId]
    );
    res.json(rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ── GET names for a set of item ids (resolve chips outside the board GET) ──────
router.get('/items', requireAuth, async (req, res) => {
  const ids = String(req.query.ids || '').split(',').map(n => parseInt(n, 10)).filter(Number.isInteger);
  if (!ids.length) return res.json([]);
  try {
    const { rows } = await pool.query(
      `SELECT i.id, i.name, g.board_id FROM items i JOIN groups g ON g.id = i.group_id WHERE i.id = ANY($1)`,
      [ids]
    );
    const out = [];
    for (const r of rows) {
      if (await canAccessBoard(r.board_id, req.user, pool)) out.push({ id: r.id, name: r.name, board_id: r.board_id });
    }
    res.json(out);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

module.exports = router;
