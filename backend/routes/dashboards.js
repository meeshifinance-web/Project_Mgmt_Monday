const express = require('express');
const router  = express.Router();
const pool    = require('../db');
const { requireAuth, requireRole, isAdminOrAbove } = require('../middleware/auth');
const { requireScope } = require('../middleware/apiAuth');

const canWrite = [requireAuth, requireScope('write'), requireRole('admin', 'manager')];

// ── Access helpers ────────────────────────────────────────────────────────────
// A dashboard is visible to: its creator, anyone it's shared with, and admins.
// Only the creator (or an admin) may edit/share/delete it.
async function userCanView(dashboardId, user) {
  if (isAdminOrAbove(user)) {
    const { rows } = await pool.query('SELECT 1 FROM dashboards WHERE id=$1', [dashboardId]);
    return rows.length > 0;
  }
  const { rows } = await pool.query(
    `SELECT 1 FROM dashboards d
      WHERE d.id = $1
        AND (d.created_by = $2
             OR EXISTS (SELECT 1 FROM dashboard_shares s WHERE s.dashboard_id = d.id AND s.user_id = $2))`,
    [dashboardId, user.id]
  );
  return rows.length > 0;
}
async function userCanManage(dashboardId, user) {
  if (isAdminOrAbove(user)) {
    const { rows } = await pool.query('SELECT 1 FROM dashboards WHERE id=$1', [dashboardId]);
    return rows.length > 0;
  }
  const { rows } = await pool.query('SELECT 1 FROM dashboards WHERE id=$1 AND created_by=$2', [dashboardId, user.id]);
  return rows.length > 0;
}
// Express guards
async function requireView(req, res, next) {
  try {
    if (await userCanView(req.params.id, req.user)) return next();
    return res.status(403).json({ error: 'You do not have access to this dashboard' });
  } catch (err) { console.error(err); return res.status(500).json({ error: 'Internal server error' }); }
}
async function requireManage(req, res, next) {
  try {
    if (await userCanManage(req.params.id, req.user)) return next();
    return res.status(403).json({ error: 'Only the dashboard owner can change this' });
  } catch (err) { console.error(err); return res.status(500).json({ error: 'Internal server error' }); }
}

// ── GET /api/dashboards — list dashboards the user is allowed to see ───────────
router.get('/', requireAuth, async (req, res) => {
  try {
    const isAdmin = isAdminOrAbove(req.user);
    // Non-admins only see dashboards they own or that are shared with them.
    const visWhere = isAdmin ? '' :
      `WHERE d.created_by = $1
          OR EXISTS (SELECT 1 FROM dashboard_shares s WHERE s.dashboard_id = d.id AND s.user_id = $1)`;
    const params = isAdmin ? [] : [req.user.id];
    const { rows } = await pool.query(
      `SELECT d.id, d.name, d.created_by, d.created_at, d.updated_at,
              u.name AS creator_name,
              COUNT(DISTINCT w.id)::int  AS widget_count,
              COUNT(DISTINCT sh.user_id)::int AS shared_count
         FROM dashboards d
         LEFT JOIN users             u  ON u.id = d.created_by
         LEFT JOIN dashboard_widgets w  ON w.dashboard_id = d.id
         LEFT JOIN dashboard_shares  sh ON sh.dashboard_id = d.id
         ${visWhere}
        GROUP BY d.id, u.name
        ORDER BY d.created_at DESC`,
      params
    );
    res.json(rows.map(r => ({ ...r, is_owner: r.created_by === req.user.id })));
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ── GET /api/dashboards/users — people you can share a dashboard with ─────────
// Any authenticated user can fetch this lightweight directory for the share picker.
router.get('/users', requireAuth, async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT id, name, email FROM users WHERE is_active = true ORDER BY name ASC`
    );
    res.json(rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ── POST /api/dashboards — create ────────────────────────────────────────────
router.post('/', ...canWrite, async (req, res) => {
  const { name = 'New Dashboard' } = req.body;
  try {
    const { rows } = await pool.query(
      `INSERT INTO dashboards (name, created_by) VALUES ($1, $2) RETURNING *`,
      [name, req.user.id]
    );
    res.status(201).json(rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ── PUT /api/dashboards/:id — rename ─────────────────────────────────────────
router.put('/:id', ...canWrite, async (req, res) => {
  const { name } = req.body;
  if (!name?.trim()) return res.status(400).json({ error: 'Name is required' });
  try {
    const isAdmin = isAdminOrAbove(req.user);
    const whereExtra = isAdmin ? '' : 'AND created_by = $3';
    const params = isAdmin ? [name.trim(), req.params.id] : [name.trim(), req.params.id, req.user.id];
    const { rows } = await pool.query(
      `UPDATE dashboards SET name=$1, updated_at=NOW() WHERE id=$2 ${whereExtra} RETURNING *`,
      params
    );
    if (!rows.length) return res.status(404).json({ error: 'Dashboard not found' });
    res.json(rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ── DELETE /api/dashboards/:id ────────────────────────────────────────────────
router.delete('/:id', ...canWrite, async (req, res) => {
  try {
    const isAdmin = isAdminOrAbove(req.user);
    const whereExtra = isAdmin ? '' : 'AND created_by = $2';
    const params = isAdmin ? [req.params.id] : [req.params.id, req.user.id];
    const { rows } = await pool.query(
      `DELETE FROM dashboards WHERE id=$1 ${whereExtra} RETURNING id`,
      params
    );
    if (!rows.length) return res.status(404).json({ error: 'Dashboard not found' });
    res.json({ success: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ── GET /api/dashboards/:id/shares — who this dashboard is shared with ────────
router.get('/:id/shares', requireAuth, requireManage, async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT s.user_id, u.name, u.email
         FROM dashboard_shares s JOIN users u ON u.id = s.user_id
        WHERE s.dashboard_id = $1
        ORDER BY u.name ASC`,
      [req.params.id]
    );
    res.json(rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ── PUT /api/dashboards/:id/shares — replace the share list ───────────────────
router.put('/:id/shares', requireAuth, requireManage, async (req, res) => {
  const { user_ids } = req.body;
  if (!Array.isArray(user_ids)) return res.status(400).json({ error: 'user_ids (array) is required' });
  const client = await pool.connect();
  try {
    // Don't let the owner share-to-self (they already own it); keep only real user ids.
    const ownerRow = await client.query('SELECT created_by FROM dashboards WHERE id=$1', [req.params.id]);
    const ownerId = ownerRow.rows[0]?.created_by;
    const ids = [...new Set(user_ids.map(n => parseInt(n, 10)).filter(n => Number.isInteger(n) && n > 0 && n !== ownerId))];

    await client.query('BEGIN');
    await client.query('DELETE FROM dashboard_shares WHERE dashboard_id=$1', [req.params.id]);
    for (const uid of ids) {
      await client.query(
        `INSERT INTO dashboard_shares (dashboard_id, user_id) VALUES ($1, $2)
         ON CONFLICT DO NOTHING`,
        [req.params.id, uid]
      );
    }
    await client.query('COMMIT');
    const { rows } = await pool.query(
      `SELECT s.user_id, u.name, u.email
         FROM dashboard_shares s JOIN users u ON u.id = s.user_id
        WHERE s.dashboard_id = $1 ORDER BY u.name ASC`,
      [req.params.id]
    );
    res.json(rows);
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    console.error(err);
    res.status(500).json({ error: 'Internal server error' });
  } finally {
    client.release();
  }
});

// ── GET /api/dashboards/:id/widgets ──────────────────────────────────────────
router.get('/:id/widgets', requireAuth, requireView, async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT * FROM dashboard_widgets WHERE dashboard_id=$1 ORDER BY grid_y ASC, grid_x ASC`,
      [req.params.id]
    );
    res.json(rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ── POST /api/dashboards/:id/widgets — add widget ────────────────────────────
router.post('/:id/widgets', ...canWrite, requireManage, async (req, res) => {
  const { type, title = '', config = {}, grid_x = 0, grid_y = 9999, grid_w = 6, grid_h = 4 } = req.body;
  if (!type) return res.status(400).json({ error: 'type is required' });
  try {
    const { rows } = await pool.query(
      `INSERT INTO dashboard_widgets (dashboard_id, type, title, config, grid_x, grid_y, grid_w, grid_h)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING *`,
      [req.params.id, type, title, JSON.stringify(config), grid_x, grid_y, grid_w, grid_h]
    );
    res.status(201).json(rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ── PUT /api/dashboards/:id/widgets/:wid — update widget ─────────────────────
router.put('/:id/widgets/:wid', ...canWrite, requireManage, async (req, res) => {
  const { title, config, grid_x, grid_y, grid_w, grid_h } = req.body;
  const sets = [];
  const vals = [];
  let i = 1;
  if (title   !== undefined) { sets.push(`title=$${i++}`);   vals.push(title); }
  if (config  !== undefined) { sets.push(`config=$${i++}`);  vals.push(JSON.stringify(config)); }
  if (grid_x  !== undefined) { sets.push(`grid_x=$${i++}`);  vals.push(grid_x); }
  if (grid_y  !== undefined) { sets.push(`grid_y=$${i++}`);  vals.push(grid_y); }
  if (grid_w  !== undefined) { sets.push(`grid_w=$${i++}`);  vals.push(grid_w); }
  if (grid_h  !== undefined) { sets.push(`grid_h=$${i++}`);  vals.push(grid_h); }
  if (!sets.length) return res.status(400).json({ error: 'Nothing to update' });

  vals.push(req.params.wid, req.params.id);
  try {
    const { rows } = await pool.query(
      `UPDATE dashboard_widgets SET ${sets.join(', ')} WHERE id=$${i++} AND dashboard_id=$${i} RETURNING *`,
      vals
    );
    if (!rows.length) return res.status(404).json({ error: 'Widget not found' });
    res.json(rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ── DELETE /api/dashboards/:id/widgets/:wid ───────────────────────────────────
router.delete('/:id/widgets/:wid', ...canWrite, requireManage, async (req, res) => {
  try {
    await pool.query(
      `DELETE FROM dashboard_widgets WHERE id=$1 AND dashboard_id=$2`,
      [req.params.wid, req.params.id]
    );
    res.json({ success: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ── GET /api/dashboards/snapshots — historical board aggregates ───────────────
router.get('/snapshots', requireAuth, async (req, res) => {
  const boardId = parseInt(req.query.board_id, 10);
  const days = Math.min(365, Math.max(1, parseInt(req.query.days, 10) || 30));
  if (!boardId) return res.status(400).json({ error: 'board_id is required' });
  try {
    const { rows } = await pool.query(
      `SELECT snapshot_date, data FROM board_snapshots
        WHERE board_id=$1 AND snapshot_date >= CURRENT_DATE - $2::int
        ORDER BY snapshot_date ASC`,
      [boardId, days]
    );
    res.json(rows.map(r => ({ date: r.snapshot_date, ...r.data })));
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ── GET /api/dashboards/:id/schedule ──────────────────────────────────────────
router.get('/:id/schedule', requireAuth, requireManage, async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT id, schedule_enabled, schedule_freq, schedule_dow, schedule_hour, recipients, last_sent_at
         FROM dashboards WHERE id=$1`, [req.params.id]
    );
    if (!rows.length) return res.status(404).json({ error: 'Dashboard not found' });
    res.json(rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ── PUT /api/dashboards/:id/schedule ──────────────────────────────────────────
router.put('/:id/schedule', ...canWrite, requireManage, async (req, res) => {
  const { schedule_enabled, schedule_freq, schedule_dow, schedule_hour, recipients } = req.body;
  const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  const recips = Array.isArray(recipients) ? recipients.map(e => String(e).trim().toLowerCase()).filter(e => EMAIL_RE.test(e)) : [];
  try {
    const { rows } = await pool.query(
      `UPDATE dashboards SET
         schedule_enabled=$1, schedule_freq=$2, schedule_dow=$3, schedule_hour=$4, recipients=$5, updated_at=NOW()
       WHERE id=$6
       RETURNING id, schedule_enabled, schedule_freq, schedule_dow, schedule_hour, recipients, last_sent_at`,
      [
        !!schedule_enabled,
        ['daily', 'weekly'].includes(schedule_freq) ? schedule_freq : 'daily',
        Math.max(0, Math.min(6, parseInt(schedule_dow, 10) || 0)),
        Math.max(0, Math.min(23, parseInt(schedule_hour, 10) || 9)),
        JSON.stringify(recips),
        req.params.id,
      ]
    );
    if (!rows.length) return res.status(404).json({ error: 'Dashboard not found' });
    res.json(rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ── POST /api/dashboards/:id/send-now — send the digest immediately ───────────
router.post('/:id/send-now', ...canWrite, requireManage, async (req, res) => {
  try {
    const { rows } = await pool.query('SELECT * FROM dashboards WHERE id=$1', [req.params.id]);
    if (!rows.length) return res.status(404).json({ error: 'Dashboard not found' });
    const result = await require('../services/dashboardEngine').sendDashboard(pool, rows[0]);
    res.json({ success: true, ...result });
  } catch (err) {
    console.error('[send-now]', err.message);
    res.status(500).json({ error: 'Failed to send digest' });
  }
});

module.exports = router;
