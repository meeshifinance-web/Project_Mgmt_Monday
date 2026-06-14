const jwt = require('jsonwebtoken');
const pool = require('../db');
const { requireApiKey } = require('./apiAuth');

if (!process.env.JWT_SECRET || process.env.JWT_SECRET.length < 32) {
  throw new Error('FATAL: JWT_SECRET env var must be set and be at least 32 characters long');
}
const JWT_SECRET = process.env.JWT_SECRET;

async function requireAuth(req, res, next) {
  // API key takes priority — if the header is present, use that auth path
  if (req.headers['x-api-key']) {
    return requireApiKey(req, res, next);
  }

  // Cookie-first: httpOnly cookie is invisible to JS and safe from XSS.
  // Authorization header is kept as fallback for API clients and backward compat.
  let token = req.cookies?.wb_token;
  if (!token) {
    const header = req.headers['authorization'];
    if (header?.startsWith('Bearer ')) token = header.slice(7);
  }
  if (!token) {
    return res.status(401).json({ error: 'Authentication required' });
  }
  try {
    const decoded = jwt.verify(token, JWT_SECRET);

    // Always read the current role + active status from DB.
    // This ensures role changes (admin panel) take effect immediately
    // without requiring the user to log out and back in.
    const { rows } = await pool.query(
      'SELECT role, is_active FROM users WHERE id=$1',
      [decoded.id]
    );
    if (!rows.length || !rows[0].is_active) {
      return res.status(401).json({ error: 'Account not found or has been deactivated' });
    }

    req.user = { ...decoded, role: rows[0].role };
    next();
  } catch (err) {
    if (err.name === 'TokenExpiredError')
      return res.status(401).json({ error: 'Session expired, please log in again' });
    return res.status(401).json({ error: 'Invalid token' });
  }
}

// Role helpers. The superadmin sits above every other role: it satisfies any
// role requirement and is granted every capability an admin has (and more).
function isSuperAdmin(user) { return user?.role === 'superadmin'; }
function isAdminOrAbove(user) { return user?.role === 'admin' || user?.role === 'superadmin'; }

function requireRole(...roles) {
  return (req, res, next) => {
    if (!req.user) return res.status(401).json({ error: 'Authentication required' });
    // Superadmin implicitly passes every role gate.
    if (req.user.role === 'superadmin') return next();
    if (!roles.includes(req.user.role)) {
      return res.status(403).json({ error: `Access denied. Required role: ${roles.join(' or ')}` });
    }
    next();
  };
}

// Shared board-access check used by all resource routes.
// Access is granted when ANY of these hold:
//   • the user is a superadmin (unrestricted), OR
//   • the board is org-wide ("public") — every authenticated user can see it, OR
//   • the user is a member of the board, OR
//   • the user created the board.
// Note: plain admins are NO LONGER granted blanket access — they see only public
// boards, boards they created, and boards they were added to. Only superadmin has
// the org-wide bypass.
// org-wide visibility is what the "Make Public" toggle sets; without consulting
// it here, public boards stayed members-only (the visibility flag was ignored).
// Pass `pool` explicitly so the function stays dependency-free and testable.
async function canAccessBoard(boardId, user, dbPool) {
  if (!boardId) return false;
  if (isSuperAdmin(user)) return true;
  const result = await dbPool.query(
    `SELECT 1 FROM boards b
      WHERE b.id = $1
        AND (b.is_deleted IS NULL OR b.is_deleted = false)
        AND ( b.visibility = 'org_wide'
           OR b.created_by = $2
           OR EXISTS (SELECT 1 FROM board_members bm
                       WHERE bm.board_id = b.id AND bm.user_id = $2) )
      LIMIT 1`,
    [boardId, user.id]
  );
  return result.rows.length > 0;
}

// Gate for API-key generation and MCP usage. Admins are always allowed; every
// other user must have been granted MCP access by an admin (users.mcp_enabled).
// Works for both auth paths: the API-key path already attaches mcp_enabled to
// req.user; the JWT path doesn't, so we look it up.
async function requireMcpAccess(req, res, next) {
  if (!req.user) return res.status(401).json({ error: 'Authentication required' });
  if (isAdminOrAbove(req.user)) return next();
  try {
    let enabled = req.user.mcp_enabled;
    if (enabled === undefined) {
      const { rows } = await pool.query('SELECT mcp_enabled FROM users WHERE id=$1', [req.user.id]);
      enabled = rows[0]?.mcp_enabled === true;
    }
    if (enabled === true) return next();
    return res.status(403).json({
      error: 'MCP access is disabled for your account. Ask an admin to enable it for you in User Management.',
    });
  } catch (err) {
    console.error('requireMcpAccess error:', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
}

module.exports = { requireAuth, requireRole, canAccessBoard, requireMcpAccess, isSuperAdmin, isAdminOrAbove };
