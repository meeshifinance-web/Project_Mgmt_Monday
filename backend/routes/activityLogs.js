const express = require('express');
const router = express.Router();
const pool = require('../db');
const { requireAuth, requireRole, canAccessBoard } = require('../middleware/auth');

// Build a parameterized WHERE from filter query params, with an optional table
// prefix (e.g. "a." for joined queries). Returns an array of SQL fragments.
function buildFilters(q, params, { withBoard = false, prefix = '' } = {}) {
  const p = prefix;
  const where = [];
  if (withBoard && q.board_id) { params.push(parseInt(q.board_id, 10)); where.push(`${p}board_id = $${params.length}`); }
  if (q.user_id) { params.push(parseInt(q.user_id, 10)); where.push(`${p}user_id = $${params.length}`); }
  if (q.action) { params.push(q.action); where.push(`${p}action = $${params.length}`); }
  if (q.from) { params.push(q.from); where.push(`${p}created_at >= $${params.length}::date`); }
  if (q.to) { params.push(q.to); where.push(`${p}created_at < ($${params.length}::date + INTERVAL '1 day')`); }
  if (q.q) { params.push(`%${q.q}%`); where.push(`(${p}item_name ILIKE $${params.length} OR ${p}user_name ILIKE $${params.length} OR ${p}field ILIKE $${params.length} OR ${p}new_value ILIKE $${params.length})`); }
  return where;
}

// GET /api/activity-logs/board/:boardId — filtered + paginated (no 200 cap)
// Query: user_id, action, from, to, q (search), limit, offset.
router.get('/board/:boardId', requireAuth, async (req, res) => {
  const { boardId } = req.params;
  try {
    if (!(await canAccessBoard(boardId, req.user, pool)))
      return res.status(403).json({ error: 'Access denied' });

    const limit = Math.min(500, Math.max(1, parseInt(req.query.limit, 10) || 200));
    const offset = Math.max(0, parseInt(req.query.offset, 10) || 0);
    const params = [boardId];
    const extra = buildFilters(req.query, params);
    const whereSql = ['board_id = $1', ...extra].join(' AND ');
    params.push(limit); const limIdx = params.length;
    params.push(offset); const offIdx = params.length;
    const { rows } = await pool.query(
      `SELECT * FROM activity_logs WHERE ${whereSql} ORDER BY created_at DESC LIMIT $${limIdx} OFFSET $${offIdx}`,
      params
    );
    res.json(rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ── GET /api/activity-logs/audit — cross-board admin audit (filtered, paged) ──
router.get('/audit', requireAuth, requireRole('admin'), async (req, res) => {
  try {
    const limit = Math.min(500, Math.max(1, parseInt(req.query.limit, 10) || 100));
    const offset = Math.max(0, parseInt(req.query.offset, 10) || 0);
    // Count: plain table, no prefix.
    const countParams = [];
    const countWhere = buildFilters(req.query, countParams, { withBoard: true });
    const countWhereSql = countWhere.length ? `WHERE ${countWhere.join(' AND ')}` : '';
    const total = (await pool.query(`SELECT COUNT(*)::int AS n FROM activity_logs ${countWhereSql}`, countParams)).rows[0].n;

    // Page: joined to boards, "a." prefix.
    const pageParams = [];
    const pageWhere = buildFilters(req.query, pageParams, { withBoard: true, prefix: 'a.' });
    const pageWhereSql = pageWhere.length ? `WHERE ${pageWhere.join(' AND ')}` : '';
    pageParams.push(limit); const limIdx = pageParams.length;
    pageParams.push(offset); const offIdx = pageParams.length;
    const { rows } = await pool.query(
      `SELECT a.*, b.name AS board_name
         FROM activity_logs a LEFT JOIN boards b ON b.id = a.board_id
         ${pageWhereSql}
        ORDER BY a.created_at DESC LIMIT $${limIdx} OFFSET $${offIdx}`,
      pageParams
    );
    res.json({ rows, total, limit, offset, hasMore: offset + rows.length < total });
  } catch (err) {
    console.error('[audit]', err.message);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ── GET /api/activity-logs/audit/meta — distinct actions + per-user counts ────
router.get('/audit/meta', requireAuth, requireRole('admin'), async (req, res) => {
  try {
    const actions = (await pool.query(`SELECT DISTINCT action FROM activity_logs WHERE action IS NOT NULL ORDER BY action`)).rows.map(r => r.action);
    const users = (await pool.query(
      `SELECT user_id, MAX(user_name) AS user_name, COUNT(*)::int AS count
         FROM activity_logs WHERE user_id IS NOT NULL
        GROUP BY user_id ORDER BY count DESC LIMIT 100`
    )).rows;
    res.json({ actions, users });
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
