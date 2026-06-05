const express = require('express');
const router = express.Router();
const pool = require('../db');
const { requireAuth, canAccessBoard } = require('../middleware/auth');
const { recomputeTotal, stopUserRunningTimers } = require('../services/timeTracking');

const READ_ONLY_ROLES = ['user'];

// Resolve an item's board and verify the user can write to it.
async function resolveCell(itemId, user) {
  const r = await pool.query(
    'SELECT g.board_id FROM items i JOIN groups g ON g.id = i.group_id WHERE i.id = $1',
    [itemId]
  );
  if (!r.rows.length) return { error: 404 };
  const boardId = r.rows[0].board_id;
  if (!(await canAccessBoard(boardId, user, pool))) return { error: 403 };
  return { boardId };
}

// ── POST /start — begin a timer on a cell (auto-stops the user's other timers) ─
router.post('/start', requireAuth, async (req, res) => {
  if (READ_ONLY_ROLES.includes(req.user.role)) return res.status(403).json({ error: 'Read-only access' });
  const { item_id, column_id } = req.body;
  if (!item_id || !column_id) return res.status(400).json({ error: 'item_id and column_id are required' });
  const ctx = await resolveCell(item_id, req.user);
  if (ctx.error) return res.status(ctx.error).json({ error: ctx.error === 404 ? 'Item not found' : 'Access denied' });

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const stopped = await stopUserRunningTimers(client, req.user.id);
    const ins = await client.query(
      `INSERT INTO time_entries (item_id, column_id, board_id, user_id, user_name, started_at)
       VALUES ($1,$2,$3,$4,$5, NOW()) RETURNING *`,
      [item_id, column_id, ctx.boardId, req.user.id, req.user.name]
    );
    await client.query('COMMIT');
    res.status(201).json({ entry: ins.rows[0], stopped });
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    console.error('[time/start]', err.message);
    res.status(500).json({ error: 'Internal server error' });
  } finally {
    client.release();
  }
});

// ── POST /stop — stop the user's running timer on a cell ──────────────────────
router.post('/stop', requireAuth, async (req, res) => {
  if (READ_ONLY_ROLES.includes(req.user.role)) return res.status(403).json({ error: 'Read-only access' });
  const { item_id, column_id } = req.body;
  if (!item_id || !column_id) return res.status(400).json({ error: 'item_id and column_id are required' });
  const ctx = await resolveCell(item_id, req.user);
  if (ctx.error) return res.status(ctx.error).json({ error: 'Access denied' });
  try {
    const upd = await pool.query(
      `UPDATE time_entries
          SET ended_at = NOW(),
              duration_seconds = GREATEST(0, EXTRACT(EPOCH FROM (NOW() - started_at))::int)
        WHERE item_id=$1 AND column_id=$2 AND user_id=$3 AND ended_at IS NULL
        RETURNING *`,
      [item_id, column_id, req.user.id]
    );
    const total = await recomputeTotal(pool, item_id, column_id);
    res.json({ total, entry: upd.rows[0] || null });
  } catch (err) {
    console.error('[time/stop]', err.message);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ── POST /manual — add a completed session manually ───────────────────────────
router.post('/manual', requireAuth, async (req, res) => {
  if (READ_ONLY_ROLES.includes(req.user.role)) return res.status(403).json({ error: 'Read-only access' });
  let { item_id, column_id, duration_seconds, started_at, ended_at, note, billable } = req.body;
  if (!item_id || !column_id) return res.status(400).json({ error: 'item_id and column_id are required' });
  const ctx = await resolveCell(item_id, req.user);
  if (ctx.error) return res.status(ctx.error).json({ error: 'Access denied' });

  // Either an explicit duration, or a start/end window.
  let dur = parseInt(duration_seconds, 10);
  let start = started_at ? new Date(started_at) : null;
  let end = ended_at ? new Date(ended_at) : null;
  if (!Number.isFinite(dur) || dur <= 0) {
    if (start && end && end > start) dur = Math.round((end - start) / 1000);
    else return res.status(400).json({ error: 'Provide a positive duration or a valid start/end window' });
  }
  if (dur > 24 * 3600 * 31) return res.status(400).json({ error: 'Duration too large' });
  if (!start) start = new Date(Date.now() - dur * 1000);
  if (!end) end = new Date(start.getTime() + dur * 1000);

  try {
    const ins = await pool.query(
      `INSERT INTO time_entries (item_id, column_id, board_id, user_id, user_name, started_at, ended_at, duration_seconds, note, billable)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING *`,
      [item_id, column_id, ctx.boardId, req.user.id, req.user.name, start, end, dur, (note || '').slice(0, 500), billable !== false]
    );
    const total = await recomputeTotal(pool, item_id, column_id);
    res.status(201).json({ total, entry: ins.rows[0] });
  } catch (err) {
    console.error('[time/manual]', err.message);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ── GET /cell/:itemId/:columnId — entries + total + your running timer ─────────
router.get('/cell/:itemId/:columnId', requireAuth, async (req, res) => {
  const { itemId, columnId } = req.params;
  const ctx = await resolveCell(itemId, req.user);
  if (ctx.error) return res.status(ctx.error).json({ error: 'Access denied' });
  try {
    const entries = (await pool.query(
      'SELECT * FROM time_entries WHERE item_id=$1 AND column_id=$2 ORDER BY started_at DESC',
      [itemId, columnId]
    )).rows;
    const total = entries.filter(e => e.ended_at).reduce((s, e) => s + e.duration_seconds, 0);
    const running = entries.find(e => !e.ended_at && e.user_id === req.user.id) || null;
    res.json({ entries, total, running });
  } catch (err) {
    console.error('[time/cell]', err.message);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ── PUT /entry/:id — edit a session ───────────────────────────────────────────
router.put('/entry/:id', requireAuth, async (req, res) => {
  if (READ_ONLY_ROLES.includes(req.user.role)) return res.status(403).json({ error: 'Read-only access' });
  const { duration_seconds, note, billable } = req.body;
  try {
    const e = (await pool.query('SELECT * FROM time_entries WHERE id=$1', [req.params.id])).rows[0];
    if (!e) return res.status(404).json({ error: 'Entry not found' });
    if (!(await canAccessBoard(e.board_id, req.user, pool))) return res.status(403).json({ error: 'Access denied' });
    const dur = Number.isFinite(parseInt(duration_seconds, 10)) ? Math.max(0, parseInt(duration_seconds, 10)) : e.duration_seconds;
    await pool.query(
      `UPDATE time_entries SET duration_seconds=$1, note=$2, billable=$3 WHERE id=$4`,
      [dur, note !== undefined ? String(note).slice(0, 500) : e.note, billable !== undefined ? !!billable : e.billable, req.params.id]
    );
    const total = await recomputeTotal(pool, e.item_id, e.column_id);
    res.json({ total });
  } catch (err) {
    console.error('[time/edit]', err.message);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ── DELETE /entry/:id ─────────────────────────────────────────────────────────
router.delete('/entry/:id', requireAuth, async (req, res) => {
  if (READ_ONLY_ROLES.includes(req.user.role)) return res.status(403).json({ error: 'Read-only access' });
  try {
    const e = (await pool.query('SELECT * FROM time_entries WHERE id=$1', [req.params.id])).rows[0];
    if (!e) return res.status(404).json({ error: 'Entry not found' });
    if (!(await canAccessBoard(e.board_id, req.user, pool))) return res.status(403).json({ error: 'Access denied' });
    await pool.query('DELETE FROM time_entries WHERE id=$1', [req.params.id]);
    const total = await recomputeTotal(pool, e.item_id, e.column_id);
    res.json({ total });
  } catch (err) {
    console.error('[time/delete]', err.message);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ── GET /running — the current user's active timer (global indicator) ─────────
router.get('/running', requireAuth, async (req, res) => {
  try {
    const r = await pool.query(
      `SELECT te.*, i.name AS item_name, b.name AS board_name
         FROM time_entries te
         JOIN items i ON i.id = te.item_id
         LEFT JOIN boards b ON b.id = te.board_id
        WHERE te.user_id=$1 AND te.ended_at IS NULL
        ORDER BY te.started_at DESC LIMIT 1`,
      [req.user.id]
    );
    res.json(r.rows[0] || null);
  } catch (err) {
    console.error('[time/running]', err.message);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ── GET /timesheet — aggregate completed sessions w/ billing + capacity ───────
// Query: board_id (required), from, to (ISO dates), user_id (optional filter).
router.get('/timesheet', requireAuth, async (req, res) => {
  const boardId = parseInt(req.query.board_id, 10);
  if (!boardId) return res.status(400).json({ error: 'board_id is required' });
  if (!(await canAccessBoard(boardId, req.user, pool))) return res.status(403).json({ error: 'Access denied' });

  const from = req.query.from ? new Date(req.query.from) : new Date(Date.now() - 30 * 86400000);
  const to = req.query.to ? new Date(req.query.to) : new Date();
  to.setHours(23, 59, 59, 999);
  const params = [boardId, from, to];
  let userFilter = '';
  if (req.query.user_id) { params.push(parseInt(req.query.user_id, 10)); userFilter = ` AND te.user_id = $${params.length}`; }

  try {
    const rows = (await pool.query(
      `SELECT te.user_id, te.user_name,
              te.item_id, i.name AS item_name,
              te.duration_seconds, te.billable,
              te.started_at::date AS day,
              u.hourly_rate, u.weekly_capacity
         FROM time_entries te
         JOIN items i ON i.id = te.item_id
         LEFT JOIN users u ON u.id = te.user_id
        WHERE te.board_id = $1 AND te.ended_at IS NOT NULL
          AND te.started_at >= $2 AND te.started_at <= $3 ${userFilter}
        ORDER BY te.user_name, day`,
      params
    )).rows;

    // Aggregate per user.
    const byUser = {};
    let grandSeconds = 0, grandBillableSeconds = 0, grandCost = 0;
    for (const r of rows) {
      const k = r.user_id || 'unknown';
      const rate = Number(r.hourly_rate) || 0;
      const u = byUser[k] || (byUser[k] = {
        user_id: r.user_id, user_name: r.user_name, hourly_rate: rate,
        weekly_capacity: Number(r.weekly_capacity) || 0,
        total_seconds: 0, billable_seconds: 0, cost: 0, items: {}, days: {},
      });
      u.total_seconds += r.duration_seconds;
      if (r.billable) { u.billable_seconds += r.duration_seconds; u.cost += (r.duration_seconds / 3600) * rate; }
      u.items[r.item_id] = (u.items[r.item_id] || { name: r.item_name, seconds: 0 });
      u.items[r.item_id].seconds += r.duration_seconds;
      const dk = (r.day instanceof Date ? r.day.toISOString().slice(0, 10) : String(r.day));
      u.days[dk] = (u.days[dk] || 0) + r.duration_seconds;
      grandSeconds += r.duration_seconds;
      if (r.billable) { grandBillableSeconds += r.duration_seconds; grandCost += (r.duration_seconds / 3600) * rate; }
    }
    const users = Object.values(byUser).map(u => ({
      ...u,
      items: Object.entries(u.items).map(([id, v]) => ({ item_id: Number(id), ...v })).sort((a, b) => b.seconds - a.seconds),
      hours: +(u.total_seconds / 3600).toFixed(2),
      billable_hours: +(u.billable_seconds / 3600).toFixed(2),
      cost: +u.cost.toFixed(2),
      // capacity over the selected window (weeks * weekly capacity)
      capacity_hours: +((u.weekly_capacity || 0) * Math.max(1, (to - from) / (7 * 86400000))).toFixed(1),
    })).map(u => ({ ...u, utilization: u.capacity_hours ? Math.round((u.hours / u.capacity_hours) * 100) : null }))
      .sort((a, b) => b.total_seconds - a.total_seconds);

    res.json({
      from: from.toISOString().slice(0, 10), to: to.toISOString().slice(0, 10),
      users,
      totals: { hours: +(grandSeconds / 3600).toFixed(2), billable_hours: +(grandBillableSeconds / 3600).toFixed(2), cost: +grandCost.toFixed(2) },
    });
  } catch (err) {
    console.error('[time/timesheet]', err.message);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ── PUT /user/:id/billing — set a user's rate + capacity (admin, or self) ─────
router.put('/user/:id/billing', requireAuth, async (req, res) => {
  const targetId = parseInt(req.params.id, 10);
  if (req.user.role !== 'admin' && req.user.id !== targetId)
    return res.status(403).json({ error: 'Only admins can edit other users’ billing' });
  const { hourly_rate, weekly_capacity } = req.body;
  try {
    const rate = Math.max(0, Number(hourly_rate) || 0);
    const cap = Math.max(0, Number(weekly_capacity) || 0);
    const r = await pool.query(
      'UPDATE users SET hourly_rate=$1, weekly_capacity=$2 WHERE id=$3 RETURNING id, hourly_rate, weekly_capacity',
      [rate, cap, targetId]
    );
    if (!r.rows.length) return res.status(404).json({ error: 'User not found' });
    res.json(r.rows[0]);
  } catch (err) {
    console.error('[time/billing]', err.message);
    res.status(500).json({ error: 'Internal server error' });
  }
});

module.exports = router;
