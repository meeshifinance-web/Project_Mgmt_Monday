const express = require('express');
const router = express.Router();
const pool = require('../db');
const { requireAuth, requireRole, canAccessBoard } = require('../middleware/auth');
const rateLimit = require('express-rate-limit');

const canWrite = [requireAuth, requireRole('admin', 'manager')];

// Rate-limit unauthenticated form submissions: 10 per IP per hour
const formSubmitLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many submissions — please try again later' },
});

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
    if (!(await canAccessBoard(req.params.boardId, req.user, pool)))
      return res.status(403).json({ error: 'Access denied' });

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
    console.error(err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// POST /api/boards/:boardId/forms
router.post('/boards/:boardId/forms', ...canWrite, async (req, res) => {
  try {
    if (!(await canAccessBoard(req.params.boardId, req.user, pool)))
      return res.status(403).json({ error: 'Access denied' });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: 'Internal server error' });
  }

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
    console.error(err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// GET /api/forms/:id
router.get('/forms/:id', requireAuth, async (req, res) => {
  try {
    const formRes = await pool.query('SELECT * FROM forms WHERE id=$1', [req.params.id]);
    if (!formRes.rows.length) return res.status(404).json({ error: 'Form not found' });

    if (!(await canAccessBoard(formRes.rows[0].board_id, req.user, pool)))
      return res.status(403).json({ error: 'Access denied' });

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
    console.error(err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// PUT /api/forms/:id
router.put('/forms/:id', ...canWrite, async (req, res) => {
  try {
    const formRes = await pool.query('SELECT board_id FROM forms WHERE id=$1', [req.params.id]);
    if (!formRes.rows.length) return res.status(404).json({ error: 'Form not found' });

    if (!(await canAccessBoard(formRes.rows[0].board_id, req.user, pool)))
      return res.status(403).json({ error: 'Access denied' });

    const { title, description, cover_color, target_group_id, thank_you_message, is_active } = req.body;
    const { rows } = await pool.query(
      `UPDATE forms SET title=$1, description=$2, cover_color=$3, target_group_id=$4,
              thank_you_message=$5, is_active=$6
       WHERE id=$7 RETURNING *`,
      [title, description, cover_color, target_group_id || null, thank_you_message, is_active, req.params.id]
    );
    res.json(rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// DELETE /api/forms/:id
router.delete('/forms/:id', ...canWrite, async (req, res) => {
  try {
    const formRes = await pool.query('SELECT board_id FROM forms WHERE id=$1', [req.params.id]);
    if (!formRes.rows.length) return res.status(404).json({ error: 'Form not found' });

    if (!(await canAccessBoard(formRes.rows[0].board_id, req.user, pool)))
      return res.status(403).json({ error: 'Access denied' });

    await pool.query('DELETE FROM forms WHERE id=$1', [req.params.id]);
    res.json({ success: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// PUT /api/forms/:id/fields  (full replace)
router.put('/forms/:id/fields', ...canWrite, async (req, res) => {
  const client = await pool.connect();
  try {
    const formRes = await client.query('SELECT board_id FROM forms WHERE id=$1', [req.params.id]);
    if (!formRes.rows.length) return res.status(404).json({ error: 'Form not found' });

    if (!(await canAccessBoard(formRes.rows[0].board_id, req.user, pool)))
      return res.status(403).json({ error: 'Access denied' });

    await client.query('BEGIN');
    const { fields } = req.body;
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
    console.error(err);
    res.status(500).json({ error: 'Internal server error' });
  } finally {
    client.release();
  }
});

// ── Public endpoints (no auth required) ───────────────────────────────────────

// GET /api/public/forms/:slug
// Returns only the display fields needed for rendering — internal IDs stripped.
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
    console.error(err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// POST /api/public/forms/:slug/submit
// Rate-limited; only writes to columns that are part of this form's visible fields.
router.post('/public/forms/:slug/submit', formSubmitLimiter, async (req, res) => {
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

    // Build the set of column IDs that are actually part of this form's visible fields.
    // Any submitted key not in this set is silently ignored — prevents arbitrary column writes.
    const allowedFieldsRes = await client.query(
      `SELECT column_id FROM form_fields WHERE form_id = $1 AND is_visible = true`,
      [form.id]
    );
    const allowedColIds = new Set(allowedFieldsRes.rows.map(r => String(r.column_id)));

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

    // Insert column values — only for columns that are in the form's allowed field set
    for (const [colKey, value] of Object.entries(submittedFields)) {
      if (colKey === '_name') continue;
      if (!allowedColIds.has(colKey)) continue; // reject unauthorized column writes
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
    console.error(err);
    res.status(500).json({ error: 'Internal server error' });
  } finally {
    client.release();
  }
});

module.exports = router;
