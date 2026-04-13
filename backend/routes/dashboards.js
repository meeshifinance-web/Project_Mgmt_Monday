const express = require('express');
const router  = express.Router();
const pool    = require('../db');
const { requireAuth, requireRole } = require('../middleware/auth');

const canWrite = [requireAuth, requireRole('admin', 'manager')];

// ── GET /api/dashboards — list all dashboards ─────────────────────────────────
router.get('/', requireAuth, async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT d.id, d.name, d.created_by, d.created_at, d.updated_at,
              u.name AS creator_name,
              COUNT(w.id)::int AS widget_count
         FROM dashboards d
         LEFT JOIN users         u ON u.id = d.created_by
         LEFT JOIN dashboard_widgets w ON w.dashboard_id = d.id
        GROUP BY d.id, u.name
        ORDER BY d.created_at DESC`
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
    const isAdmin = req.user.role === 'admin';
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
    const isAdmin = req.user.role === 'admin';
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

// ── GET /api/dashboards/:id/widgets ──────────────────────────────────────────
router.get('/:id/widgets', requireAuth, async (req, res) => {
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
router.post('/:id/widgets', ...canWrite, async (req, res) => {
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
router.put('/:id/widgets/:wid', ...canWrite, async (req, res) => {
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
router.delete('/:id/widgets/:wid', ...canWrite, async (req, res) => {
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

module.exports = router;
