const express = require('express');
const router = express.Router();
const pool = require('../db');
const { requireAuth, requireRole } = require('../middleware/auth');

const canWrite = [requireAuth, requireRole('admin', 'manager')];

function generateSlug() {
  const chars = 'abcdefghijklmnopqrstuvwxyz0123456789';
  let s = '';
  for (let i = 0; i < 8; i++) s += chars[Math.floor(Math.random() * chars.length)];
  return s;
}

// ── Authenticated endpoints ────────────────────────────────────────────────────

// GET /api/boards/:boardId/forms
router.get('/boards/:boardId/forms', requireAuth, async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT f.*, g.name AS target_group_name
       FROM forms f
       LEFT JOIN groups g ON g.id = f.target_group_id
       WHERE f.board_id = $1
       ORDER BY f.created_at DESC`,
      [req.params.boardId]
    );
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/boards/:boardId/forms
router.post('/boards/:boardId/forms', ...canWrite, async (req, res) => {
  const { title, description, cover_color, target_group_id, thank_you_message } = req.body;
  let slug;
  for (let i = 0; i < 10; i++) {
    slug = generateSlug();
    const existing = await pool.query('SELECT id FROM forms WHERE slug=$1', [slug]);
    if (!existing.rows.length) break;
  }
  try {
    const { rows } = await pool.query(
      `INSERT INTO forms (board_id, title, description, cover_color, target_group_id, thank_you_message, slug)
       VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING *`,
      [
        req.params.boardId,
        title || 'Untitled Form',
        description || '',
        cover_color || '#0073ea',
        target_group_id || null,
        thank_you_message || 'Thank you! Your response has been submitted.',
        slug,
      ]
    );
    res.status(201).json(rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/forms/:id
router.get('/forms/:id', requireAuth, async (req, res) => {
  try {
    const formRes = await pool.query('SELECT * FROM forms WHERE id=$1', [req.params.id]);
    if (!formRes.rows.length) return res.status(404).json({ error: 'Form not found' });
    const fieldsRes = await pool.query(
      `SELECT ff.*, c.title AS column_title, c.type AS column_type, c.settings AS column_settings
       FROM form_fields ff
       JOIN columns c ON c.id = ff.column_id
       WHERE ff.form_id = $1
       ORDER BY ff.position ASC`,
      [req.params.id]
    );
    res.json({ ...formRes.rows[0], fields: fieldsRes.rows });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// PUT /api/forms/:id
router.put('/forms/:id', ...canWrite, async (req, res) => {
  const { title, description, cover_color, target_group_id, thank_you_message, is_active } = req.body;
  try {
    const { rows } = await pool.query(
      `UPDATE forms SET title=$1, description=$2, cover_color=$3, target_group_id=$4,
              thank_you_message=$5, is_active=$6
       WHERE id=$7 RETURNING *`,
      [title, description, cover_color, target_group_id || null, thank_you_message, is_active, req.params.id]
    );
    if (!rows.length) return res.status(404).json({ error: 'Form not found' });
    res.json(rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// DELETE /api/forms/:id
router.delete('/forms/:id', ...canWrite, async (req, res) => {
  try {
    await pool.query('DELETE FROM forms WHERE id=$1', [req.params.id]);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// PUT /api/forms/:id/fields  (full replace)
router.put('/forms/:id/fields', ...canWrite, async (req, res) => {
  const { fields } = req.body;
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query('DELETE FROM form_fields WHERE form_id=$1', [req.params.id]);
    if (Array.isArray(fields)) {
      for (let i = 0; i < fields.length; i++) {
        const f = fields[i];
        await client.query(
          `INSERT INTO form_fields (form_id, column_id, label, is_required, position, is_visible)
           VALUES ($1,$2,$3,$4,$5,$6)`,
          [req.params.id, f.column_id, f.label || null, f.is_required || false, i, f.is_visible !== false]
        );
      }
    }
    await client.query('COMMIT');
    const { rows } = await pool.query(
      `SELECT ff.*, c.title AS column_title, c.type AS column_type, c.settings AS column_settings
       FROM form_fields ff JOIN columns c ON c.id = ff.column_id
       WHERE ff.form_id = $1 ORDER BY ff.position`,
      [req.params.id]
    );
    res.json(rows);
  } catch (err) {
    await client.query('ROLLBACK');
    res.status(500).json({ error: err.message });
  } finally {
    client.release();
  }
});

// ── Public endpoints (no auth required) ───────────────────────────────────────

// GET /api/public/forms/:slug
router.get('/public/forms/:slug', async (req, res) => {
  try {
    const formRes = await pool.query('SELECT * FROM forms WHERE slug=$1', [req.params.slug]);
    if (!formRes.rows.length) return res.status(404).json({ error: 'Form not found' });
    const form = formRes.rows[0];
    const fieldsRes = await pool.query(
      `SELECT ff.*, c.title AS column_title, c.type AS column_type, c.settings AS column_settings
       FROM form_fields ff
       JOIN columns c ON c.id = ff.column_id
       WHERE ff.form_id = $1 AND ff.is_visible = true
       ORDER BY ff.position ASC`,
      [form.id]
    );
    res.json({ ...form, fields: fieldsRes.rows });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/public/forms/:slug/submit
router.post('/public/forms/:slug/submit', async (req, res) => {
  const { fields: submittedFields } = req.body;
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const formRes = await client.query(
      'SELECT * FROM forms WHERE slug=$1 AND is_active=true',
      [req.params.slug]
    );
    if (!formRes.rows.length) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'Form not found or inactive' });
    }
    const form = formRes.rows[0];

    // Resolve target group
    let targetGroupId = form.target_group_id;
    if (!targetGroupId) {
      const gRes = await client.query(
        'SELECT id FROM groups WHERE board_id=$1 ORDER BY position ASC LIMIT 1',
        [form.board_id]
      );
      if (!gRes.rows.length) {
        await client.query('ROLLBACK');
        return res.status(400).json({ error: 'No groups found in board' });
      }
      targetGroupId = gRes.rows[0].id;
    }

    // Item name comes from the special _name key
    const itemName = (submittedFields['_name'] || '').trim() || 'Form Submission';

    const posRes = await client.query(
      'SELECT COALESCE(MAX(position),0)+1 AS pos FROM items WHERE group_id=$1',
      [targetGroupId]
    );
    const itemRes = await client.query(
      'INSERT INTO items (group_id, name, position) VALUES ($1,$2,$3) RETURNING *',
      [targetGroupId, itemName, posRes.rows[0].pos]
    );
    const item = itemRes.rows[0];

    // Insert column values
    for (const [colKey, value] of Object.entries(submittedFields)) {
      if (colKey === '_name') continue;
      const colId = parseInt(colKey);
      if (!colId || value === undefined || value === null || value === '') continue;
      await client.query(
        `INSERT INTO column_values (item_id, column_id, value)
         VALUES ($1,$2,$3)
         ON CONFLICT (item_id, column_id) DO UPDATE SET value=EXCLUDED.value`,
        [item.id, colId, String(value)]
      );
    }

    await client.query('COMMIT');
    res.status(201).json({ success: true, item_id: item.id });
  } catch (err) {
    await client.query('ROLLBACK');
    res.status(500).json({ error: err.message });
  } finally {
    client.release();
  }
});

module.exports = router;
