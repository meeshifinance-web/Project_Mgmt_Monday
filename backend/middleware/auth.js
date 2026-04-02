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

  const header = req.headers['authorization'];
  if (!header || !header.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Authentication required' });
  }
  const token = header.slice(7);
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

function requireRole(...roles) {
  return (req, res, next) => {
    if (!req.user) return res.status(401).json({ error: 'Authentication required' });
    if (!roles.includes(req.user.role)) {
      return res.status(403).json({ error: `Access denied. Required role: ${roles.join(' or ')}` });
    }
    next();
  };
}

// Shared board-access check used by all resource routes.
// Admins can access every board; other roles must be members.
// Pass `pool` explicitly so the function stays dependency-free and testable.
async function canAccessBoard(boardId, user, dbPool) {
  if (!boardId) return false;
  if (user.role === 'admin') return true;
  const result = await dbPool.query(
    `SELECT 1 FROM board_members WHERE board_id = $1 AND user_id = $2 LIMIT 1`,
    [boardId, user.id]
  );
  return result.rows.length > 0;
}

module.exports = { requireAuth, requireRole, canAccessBoard };
