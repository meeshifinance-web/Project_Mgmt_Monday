const crypto = require('crypto');
const pool = require('../db');

// ── Verify X-API-Key header ───────────────────────────────────────────────────
async function requireApiKey(req, res, next) {
  const apiKey = req.headers['x-api-key'];
  if (!apiKey) {
    return res.status(401).json({ error: 'API key required. Pass X-API-Key header.' });
  }

  // Key format: wb_live_<base64url> — prefix is first 16 chars
  if (!apiKey.startsWith('wb_live_') || apiKey.length < 20) {
    return res.status(401).json({ error: 'Invalid API key format' });
  }

  const prefix  = apiKey.substring(0, 16);
  const keyHash = crypto.createHash('sha256').update(apiKey).digest('hex');

  try {
    const result = await pool.query(
      `SELECT ak.*, u.id AS uid, u.name, u.email, u.role, u.is_active AS user_active
       FROM api_keys ak
       JOIN users u ON u.id = ak.user_id
       WHERE ak.key_prefix = $1
         AND ak.key_hash   = $2
         AND ak.is_active  = true`,
      [prefix, keyHash]
    );

    if (!result.rows.length) {
      return res.status(401).json({ error: 'Invalid or revoked API key' });
    }

    const key = result.rows[0];

    if (!key.user_active) {
      return res.status(401).json({ error: 'User account is disabled' });
    }

    req.user = {
      id:    key.uid,
      name:  key.name,
      email: key.email,
      role:  key.role,
    };
    req.apiKey = {
      id:        key.id,
      scope:     key.scope,
      board_ids: key.board_ids, // null = all boards; array = restricted
    };
    req.authMethod = 'api_key';

    // Fire-and-forget usage update — never block the request
    pool.query(
      `UPDATE api_keys
       SET last_used_at  = NOW(),
           request_count = request_count + 1
       WHERE id = $1`,
      [key.id]
    ).catch(() => {});

    next();
  } catch (err) {
    console.error('API key auth error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
}

// ── Scope hierarchy check ─────────────────────────────────────────────────────
// No-op when the request is authenticated via JWT (req.apiKey will be undefined).
const SCOPE_LEVELS = { read: 1, write: 2, full: 3 };

function requireScope(scope) {
  return (req, res, next) => {
    if (!req.apiKey) return next(); // JWT auth — skip scope check
    const keyLevel = SCOPE_LEVELS[req.apiKey.scope] || 0;
    const reqLevel = SCOPE_LEVELS[scope] || 0;
    if (keyLevel < reqLevel) {
      return res.status(403).json({
        error: `This action requires '${scope}' scope. Your key has '${req.apiKey.scope}' scope.`,
      });
    }
    next();
  };
}

// ── Board-access check for API keys ──────────────────────────────────────────
// No-op for JWT auth or keys with board_ids = null (all boards).
function requireBoardAccess(getBoardId) {
  return async (req, res, next) => {
    if (!req.apiKey) return next();
    const { board_ids } = req.apiKey;
    if (!board_ids) return next(); // null = unrestricted

    const boardId = typeof getBoardId === 'function'
      ? getBoardId(req)
      : req.params[getBoardId] || req.body[getBoardId];

    if (!boardId) return next();

    if (!board_ids.includes(parseInt(boardId))) {
      return res.status(403).json({
        error: `API key does not have access to board ${boardId}`,
      });
    }
    next();
  };
}

module.exports = { requireApiKey, requireScope, requireBoardAccess };
