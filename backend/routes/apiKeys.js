const express = require('express');
const router  = express.Router();
const crypto  = require('crypto');
const pool    = require('../db');
const { requireAuth, requireMcpAccess } = require('../middleware/auth');

// API keys (used for both REST integrations and MCP) may be managed by admins
// or any user an admin has granted MCP access to. Each user only ever sees and
// manages their OWN keys (every query below is scoped by user_id).
const requireKeyAccess = requireMcpAccess;

// ── GET /api/keys — list all keys owned by the current admin ─────────────────
router.get('/', requireAuth, requireKeyAccess, async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT id, name, key_prefix, scope, board_ids,
              last_used_at, request_count, created_at, is_active
       FROM api_keys
       WHERE user_id = $1
       ORDER BY created_at DESC`,
      [req.user.id]
    );
    res.json(rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ── POST /api/keys — generate a new API key ───────────────────────────────────
router.post('/', requireAuth, requireKeyAccess, async (req, res) => {
  const { name, scope, board_ids } = req.body;

  if (!name || !name.trim()) {
    return res.status(400).json({ error: 'Key name is required' });
  }
  if (!['read', 'write', 'full'].includes(scope)) {
    return res.status(400).json({ error: 'Scope must be read, write, or full' });
  }

  try {
    // Generate a cryptographically secure key
    const randomPart = crypto.randomBytes(36).toString('base64url');
    const rawKey     = `wb_live_${randomPart}`;

    // Only the prefix (for fast DB lookup) and the hash are stored — never the raw key
    const prefix  = rawKey.substring(0, 16); // "wb_live_" + 8 chars
    const keyHash = crypto.createHash('sha256').update(rawKey).digest('hex');

    const { rows } = await pool.query(
      `INSERT INTO api_keys (user_id, name, key_prefix, key_hash, scope, board_ids)
       VALUES ($1, $2, $3, $4, $5, $6)
       RETURNING id, name, key_prefix, scope, board_ids, created_at`,
      [
        req.user.id,
        name.trim(),
        prefix,
        keyHash,
        scope,
        board_ids?.length ? board_ids : null,
      ]
    );

    // raw_key is returned ONCE and never persisted
    res.status(201).json({
      ...rows[0],
      raw_key: rawKey,
      message: 'Save this key now — it will never be shown again!',
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ── DELETE /api/keys/:id — revoke (soft-delete) ───────────────────────────────
router.delete('/:id', requireAuth, requireKeyAccess, async (req, res) => {
  try {
    const { rows } = await pool.query(
      `UPDATE api_keys SET is_active = false
       WHERE id = $1 AND user_id = $2
       RETURNING id`,
      [req.params.id, req.user.id]
    );
    if (!rows.length) {
      return res.status(404).json({ error: 'Key not found' });
    }
    res.json({ success: true, message: 'API key revoked' });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ── PUT /api/keys/:id/rename — rename a key ───────────────────────────────────
router.put('/:id/rename', requireAuth, requireKeyAccess, async (req, res) => {
  const { name } = req.body;
  if (!name?.trim()) {
    return res.status(400).json({ error: 'Name is required' });
  }
  try {
    const { rows } = await pool.query(
      `UPDATE api_keys SET name = $1
       WHERE id = $2 AND user_id = $3
       RETURNING id, name`,
      [name.trim(), req.params.id, req.user.id]
    );
    if (!rows.length) {
      return res.status(404).json({ error: 'Key not found' });
    }
    res.json(rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

module.exports = router;
