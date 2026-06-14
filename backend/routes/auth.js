const express = require('express');
const router = express.Router();
const bcrypt = require('bcryptjs');
const crypto = require('crypto');
const speakeasy = require('speakeasy');
const QRCode = require('qrcode');
const rateLimit = require('express-rate-limit');
const pool = require('../db');
const { signToken } = require('../services/token');
const { sendPasswordReset, sendWelcomeEmail } = require('../services/email');
const ms = require('../services/microsoft');
const { requireAuth } = require('../middleware/auth');

const APP_URL = () => process.env.FRONTEND_URL || 'http://localhost:5173';

const COOKIE_OPTIONS = {
  httpOnly: true,
  secure: process.env.NODE_ENV === 'production',
  sameSite: 'lax',
  maxAge: 24 * 60 * 60 * 1000, // 24 hours
  path: '/',
};

const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 15,
  message: { error: 'Too many attempts, please try again in 15 minutes' },
  standardHeaders: true,
  legacyHeaders: false,
});

// ── helpers ──────────────────────────────────────────────────────────────────
function safeUser(u) {
  return {
    id: u.id,
    email: u.email,
    name: u.name,
    role: u.role,
    avatar_url: u.avatar_url,
    mfa_enabled: u.mfa_enabled,
    is_sso: !!u.microsoft_id,
  };
}

// ── POST /auth/register ───────────────────────────────────────────────────────
router.post('/register', loginLimiter, async (req, res) => {
  const { email, password, name } = req.body;
  if (!email || !password || !name)
    return res.status(400).json({ error: 'Email, password and name are required' });
  if (password.length < 8)
    return res.status(400).json({ error: 'Password must be at least 8 characters' });

  try {
    const countRes = await pool.query('SELECT COUNT(*) FROM users');
    const isFirst = parseInt(countRes.rows[0].count) === 0;
    const role = isFirst ? 'admin' : 'member';
    const hash = await bcrypt.hash(password, 12);

    const { rows } = await pool.query(
      'INSERT INTO users (email, password_hash, name, role) VALUES ($1,$2,$3,$4) RETURNING *',
      [email.toLowerCase(), hash, name.trim(), role]
    );

    const token = signToken(rows[0]);
    res.cookie('wb_token', token, COOKIE_OPTIONS);
    res.status(201).json({ token, user: safeUser(rows[0]) });

    // Fire-and-forget welcome email — never block / fail the registration
    // response on SMTP issues.
    sendWelcomeEmail(rows[0].email, rows[0].name).catch(e =>
      console.error('[Welcome] dispatch failed:', e.message)
    );
  } catch (err) {
    if (err.code === '23505') return res.status(409).json({ error: 'Email already registered' });
    console.error(err);

    res.status(500).json({ error: 'Internal server error' });
  }
});

// ── POST /auth/login ──────────────────────────────────────────────────────────
router.post('/login', loginLimiter, async (req, res) => {
  const { email, password } = req.body;
  if (!email || !password) return res.status(400).json({ error: 'Email and password required' });

  try {
    const { rows } = await pool.query(
      'SELECT * FROM users WHERE email=$1 AND is_active=true',
      [email.toLowerCase()]
    );
    if (!rows.length) return res.status(401).json({ error: 'Invalid email or password' });

    const user = rows[0];
    if (!user.password_hash)
      return res.status(401).json({ error: 'This account uses Microsoft SSO. Use "Sign in with Microsoft".' });

    const valid = await bcrypt.compare(password, user.password_hash);
    if (!valid) return res.status(401).json({ error: 'Invalid email or password' });

    // MFA pending — issue short-lived temp token
    if (user.mfa_enabled) {
      const jwt = require('jsonwebtoken');
      const tempToken = jwt.sign(
        { id: user.id, mfa_pending: true },
        process.env.JWT_SECRET,
        { expiresIn: '5m' }
      );
      return res.json({ mfa_required: true, temp_token: tempToken });
    }

    await pool.query('UPDATE users SET last_login=NOW() WHERE id=$1', [user.id]);
    const token = signToken(user);
    res.cookie('wb_token', token, COOKIE_OPTIONS);
    res.json({ token, user: safeUser(user) });
  } catch (err) {
    console.error(err);

    res.status(500).json({ error: 'Internal server error' });
  }
});

// ── POST /auth/mfa/verify-login ───────────────────────────────────────────────
router.post('/mfa/verify-login', loginLimiter, async (req, res) => {
  const { temp_token, code } = req.body;
  if (!temp_token || !code) return res.status(400).json({ error: 'Token and code required' });

  try {
    const jwt = require('jsonwebtoken');
    const decoded = jwt.verify(
      temp_token,
      process.env.JWT_SECRET
    );
    if (!decoded.mfa_pending) return res.status(400).json({ error: 'Invalid token' });

    const { rows } = await pool.query('SELECT * FROM users WHERE id=$1 AND is_active=true', [decoded.id]);
    if (!rows.length) return res.status(404).json({ error: 'User not found' });

    const user = rows[0];
    const valid = speakeasy.totp.verify({
      secret: user.mfa_secret,
      encoding: 'base32',
      token: code,
      window: 1,
    });
    if (!valid) return res.status(401).json({ error: 'Invalid authenticator code' });

    await pool.query('UPDATE users SET last_login=NOW() WHERE id=$1', [user.id]);
    const token = signToken(user);
    res.cookie('wb_token', token, COOKIE_OPTIONS);
    res.json({ token, user: safeUser(user) });
  } catch (err) {
    if (err.name === 'JsonWebTokenError' || err.name === 'TokenExpiredError')
      return res.status(401).json({ error: 'Session expired, please log in again' });
    console.error(err);

    res.status(500).json({ error: 'Internal server error' });
  }
});

// ── GET /auth/microsoft ───────────────────────────────────────────────────────
router.get('/microsoft', (req, res) => {
  if (!ms.isConfigured()) {
    return res.redirect(`${APP_URL()}/login?error=microsoft_not_configured`);
  }
  const state = crypto.randomBytes(16).toString('hex');
  req.session.ms_oauth_state = state;
  res.redirect(ms.getAuthorizationUrl(state));
});

// ── GET /auth/microsoft/callback ──────────────────────────────────────────────
router.get('/microsoft/callback', async (req, res) => {
  const { code, state, error } = req.query;

  if (error) return res.redirect(`${APP_URL()}/login?error=${encodeURIComponent(error)}`);
  if (!code) return res.redirect(`${APP_URL()}/login?error=no_code`);
  if (state !== req.session.ms_oauth_state)
    return res.redirect(`${APP_URL()}/login?error=invalid_state`);

  req.session.ms_oauth_state = null;

  try {
    const tokens = await ms.exchangeCodeForTokens(code);
    const msUser = await ms.getUserInfo(tokens.access_token);

    if (!msUser.email) return res.redirect(`${APP_URL()}/login?error=no_email_from_microsoft`);

    const existing = await pool.query(
      'SELECT * FROM users WHERE microsoft_id=$1 OR email=$2',
      [msUser.microsoftId, msUser.email]
    );

    let user;
    if (existing.rows.length) {
      user = existing.rows[0];
      if (!user.is_active) return res.redirect(`${APP_URL()}/login?error=account_disabled`);
      await pool.query(
        'UPDATE users SET microsoft_id=$1, last_login=NOW() WHERE id=$2',
        [msUser.microsoftId, user.id]
      );
    } else {
      const countRes = await pool.query('SELECT COUNT(*) FROM users');
      const role = parseInt(countRes.rows[0].count) === 0 ? 'admin' : 'user';
      const { rows } = await pool.query(
        'INSERT INTO users (email, name, microsoft_id, role, last_login) VALUES ($1,$2,$3,$4,NOW()) RETURNING *',
        [msUser.email, msUser.name, msUser.microsoftId, role]
      );
      user = rows[0];
    }

    const token = signToken(user);
    res.cookie('wb_token', token, COOKIE_OPTIONS);
    res.redirect(`${APP_URL()}/auth/callback?success=true`);
  } catch (err) {
    console.error('Microsoft OAuth error:', err.response?.data || err.message);
    res.redirect(`${APP_URL()}/login?error=microsoft_auth_failed`);
  }
});

// ── GET /auth/me ──────────────────────────────────────────────────────────────
router.get('/me', requireAuth, async (req, res) => {
  try {
    const { rows } = await pool.query(
      'SELECT id,email,name,role,avatar_url,mfa_enabled,created_at,last_login,COALESCE(mcp_enabled,false) AS mcp_enabled,microsoft_id IS NOT NULL AS is_sso FROM users WHERE id=$1',
      [req.user.id]
    );
    if (!rows.length) return res.status(404).json({ error: 'User not found' });
    res.json(rows[0]);
  } catch (err) {
    console.error(err);

    res.status(500).json({ error: 'Internal server error' });
  }
});

// ── PUT /auth/me ──────────────────────────────────────────────────────────────
router.put('/me', requireAuth, async (req, res) => {
  const { name, avatar_url } = req.body;
  try {
    const { rows } = await pool.query(
      'UPDATE users SET name=$1, avatar_url=$2 WHERE id=$3 RETURNING id,email,name,role,avatar_url,mfa_enabled',
      [name, avatar_url || null, req.user.id]
    );
    res.json(rows[0]);
  } catch (err) {
    console.error(err);

    res.status(500).json({ error: 'Internal server error' });
  }
});

// ── PUT /auth/me/password ─────────────────────────────────────────────────────
router.put('/me/password', requireAuth, async (req, res) => {
  const { current_password, new_password } = req.body;
  if (!new_password || new_password.length < 8)
    return res.status(400).json({ error: 'New password must be at least 8 characters' });

  try {
    const { rows } = await pool.query('SELECT * FROM users WHERE id=$1', [req.user.id]);
    const user = rows[0];

    if (user.password_hash) {
      if (!current_password) return res.status(400).json({ error: 'Current password required' });
      const valid = await bcrypt.compare(current_password, user.password_hash);
      if (!valid) return res.status(401).json({ error: 'Current password is incorrect' });
    }

    const hash = await bcrypt.hash(new_password, 12);
    await pool.query('UPDATE users SET password_hash=$1 WHERE id=$2', [hash, user.id]);
    res.json({ success: true });
  } catch (err) {
    console.error(err);

    res.status(500).json({ error: 'Internal server error' });
  }
});

// ── POST /auth/forgot-password ────────────────────────────────────────────────
router.post('/forgot-password', loginLimiter, async (req, res) => {
  const { email } = req.body;
  if (!email) return res.status(400).json({ error: 'Email required' });

  try {
    const { rows } = await pool.query(
      'SELECT * FROM users WHERE email=$1 AND is_active=true',
      [email.toLowerCase()]
    );

    // Always respond success to prevent email enumeration
    if (!rows.length || !rows[0].password_hash) return res.json({ success: true });

    const user = rows[0];
    const token = crypto.randomBytes(32).toString('hex');
    const expires = new Date(Date.now() + 60 * 60 * 1000); // 1 hour

    await pool.query(
      'INSERT INTO password_reset_tokens (user_id, token, expires_at) VALUES ($1,$2,$3)',
      [user.id, token, expires]
    );

    const resetUrl = `${APP_URL()}/reset-password?token=${token}`;
    await sendPasswordReset(user.email, user.name, resetUrl);

    res.json({ success: true });
  } catch (err) {
    console.error(err);

    res.status(500).json({ error: 'Internal server error' });
  }
});

// ── POST /auth/reset-password ─────────────────────────────────────────────────
router.post('/reset-password', loginLimiter, async (req, res) => {
  const { token, password } = req.body;
  if (!token || !password) return res.status(400).json({ error: 'Token and password required' });
  if (password.length < 8) return res.status(400).json({ error: 'Password must be at least 8 characters' });

  try {
    const { rows } = await pool.query(
      'SELECT * FROM password_reset_tokens WHERE token=$1 AND used=false AND expires_at > NOW()',
      [token]
    );
    if (!rows.length) return res.status(400).json({ error: 'Reset link is invalid or has expired' });

    const hash = await bcrypt.hash(password, 12);
    await pool.query('UPDATE users SET password_hash=$1 WHERE id=$2', [hash, rows[0].user_id]);
    await pool.query('UPDATE password_reset_tokens SET used=true WHERE id=$1', [rows[0].id]);

    res.json({ success: true });
  } catch (err) {
    console.error(err);

    res.status(500).json({ error: 'Internal server error' });
  }
});

// ── POST /auth/mfa/setup ──────────────────────────────────────────────────────
router.post('/mfa/setup', requireAuth, async (req, res) => {
  try {
    const { rows } = await pool.query('SELECT email FROM users WHERE id=$1', [req.user.id]);
    const secret = speakeasy.generateSecret({
      name: `simplixart Workboard (${rows[0].email})`,
      length: 20,
    });
    await pool.query('UPDATE users SET mfa_secret=$1 WHERE id=$2', [secret.base32, req.user.id]);
    const qrCode = await QRCode.toDataURL(secret.otpauth_url);
    res.json({ secret: secret.base32, qrCode });
  } catch (err) {
    console.error(err);

    res.status(500).json({ error: 'Internal server error' });
  }
});

// ── POST /auth/mfa/enable ─────────────────────────────────────────────────────
router.post('/mfa/enable', requireAuth, async (req, res) => {
  const { code } = req.body;
  if (!code) return res.status(400).json({ error: 'Authenticator code required' });

  try {
    const { rows } = await pool.query('SELECT mfa_secret FROM users WHERE id=$1', [req.user.id]);
    if (!rows[0]?.mfa_secret) return res.status(400).json({ error: 'Run MFA setup first' });

    const valid = speakeasy.totp.verify({
      secret: rows[0].mfa_secret,
      encoding: 'base32',
      token: code,
      window: 1,
    });
    if (!valid) return res.status(401).json({ error: 'Invalid code — check your authenticator app' });

    await pool.query('UPDATE users SET mfa_enabled=true WHERE id=$1', [req.user.id]);
    res.json({ success: true });
  } catch (err) {
    console.error(err);

    res.status(500).json({ error: 'Internal server error' });
  }
});

// ── POST /auth/mfa/disable ────────────────────────────────────────────────────
router.post('/mfa/disable', requireAuth, async (req, res) => {
  const { password } = req.body;

  try {
    const { rows } = await pool.query('SELECT * FROM users WHERE id=$1', [req.user.id]);
    const user = rows[0];

    if (user.password_hash) {
      if (!password) return res.status(400).json({ error: 'Password required to disable MFA' });
      const valid = await bcrypt.compare(password, user.password_hash);
      if (!valid) return res.status(401).json({ error: 'Incorrect password' });
    }

    await pool.query('UPDATE users SET mfa_enabled=false, mfa_secret=NULL WHERE id=$1', [req.user.id]);
    res.json({ success: true });
  } catch (err) {
    console.error(err);

    res.status(500).json({ error: 'Internal server error' });
  }
});

// ── POST /auth/admin/create-user (admin only) ─────────────────────────────────
const { requireRole } = require('../middleware/auth');

router.post('/admin/create-user', requireAuth, requireRole('admin'), async (req, res) => {
  const { email, password, name, role = 'user' } = req.body;
  if (!email || !password || !name)
    return res.status(400).json({ error: 'Email, password and name are required' });
  if (password.length < 8)
    return res.status(400).json({ error: 'Password must be at least 8 characters' });
  if (!['admin', 'manager', 'member', 'user'].includes(role))
    return res.status(400).json({ error: 'Invalid role' });

  try {
    const hash = await bcrypt.hash(password, 12);
    const { rows } = await pool.query(
      'INSERT INTO users (email, password_hash, name, role) VALUES ($1,$2,$3,$4) RETURNING *',
      [email.toLowerCase(), hash, name.trim(), role]
    );
    res.status(201).json(safeUser(rows[0]));
  } catch (err) {
    if (err.code === '23505') return res.status(409).json({ error: 'Email already registered' });
    console.error(err);

    res.status(500).json({ error: 'Internal server error' });
  }
});

// ── GET /auth/users/search?q=... (any authenticated user, for board invite) ────
router.get('/users/search', requireAuth, async (req, res) => {
  const q = (req.query.q || '').trim();
  if (q.length < 3) return res.json([]);
  try {
    const { rows } = await pool.query(
      `SELECT id, name, email, avatar_url, role
       FROM users
       WHERE is_active = true
         AND COALESCE(is_hidden, false) = false
         AND (name ILIKE $1 OR email ILIKE $1)
       ORDER BY name
       LIMIT 10`,
      [`%${q}%`]
    );
    res.json(rows);
  } catch (err) {
    console.error(err);

    res.status(500).json({ error: 'Internal server error' });
  }
});

// ── GET /auth/users (admin only) ──────────────────────────────────────────────

router.get('/users', requireAuth, requireRole('admin'), async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT id,email,name,role,avatar_url,mfa_enabled,is_active,created_at,last_login,
              COALESCE(mcp_enabled,false) AS mcp_enabled,
              microsoft_id IS NOT NULL AS is_sso
       FROM users
       WHERE COALESCE(is_hidden, false) = false
       ORDER BY created_at DESC`
    );
    res.json(rows);
  } catch (err) {
    console.error(err);

    res.status(500).json({ error: 'Internal server error' });
  }
});

// ── PUT /auth/users/:id/role (admin only) ─────────────────────────────────────
router.put('/users/:id/role', requireAuth, requireRole('admin'), async (req, res) => {
  const { role } = req.body;
  if (!['admin', 'manager', 'member', 'user'].includes(role))
    return res.status(400).json({ error: 'Invalid role' });
  if (parseInt(req.params.id) === req.user.id)
    return res.status(400).json({ error: 'Cannot change your own role' });

  try {
    const { rows } = await pool.query(
      `UPDATE users SET role=$1
        WHERE id=$2 AND COALESCE(is_hidden,false) = false
        RETURNING id,email,name,role,is_active`,
      [role, req.params.id]
    );
    if (!rows.length) return res.status(404).json({ error: 'User not found' });
    res.json(rows[0]);
  } catch (err) {
    console.error(err);

    res.status(500).json({ error: 'Internal server error' });
  }
});

// ── PUT /auth/users/:id/active (admin only) ───────────────────────────────────
router.put('/users/:id/active', requireAuth, requireRole('admin'), async (req, res) => {
  const { is_active } = req.body;
  if (parseInt(req.params.id) === req.user.id)
    return res.status(400).json({ error: 'Cannot deactivate yourself' });

  try {
    const { rows } = await pool.query(
      `UPDATE users SET is_active=$1
        WHERE id=$2 AND COALESCE(is_hidden,false) = false
        RETURNING id,email,name,role,is_active`,
      [is_active, req.params.id]
    );
    if (!rows.length) return res.status(404).json({ error: 'User not found' });
    res.json(rows[0]);
  } catch (err) {
    console.error(err);

    res.status(500).json({ error: 'Internal server error' });
  }
});

// ── PUT /auth/users/:id/mcp (admin only) — grant/revoke MCP access ────────────
router.put('/users/:id/mcp', requireAuth, requireRole('admin'), async (req, res) => {
  const { mcp_enabled } = req.body;
  if (typeof mcp_enabled !== 'boolean')
    return res.status(400).json({ error: 'mcp_enabled (boolean) is required' });
  try {
    const target = await pool.query('SELECT role, COALESCE(is_hidden,false) AS is_hidden FROM users WHERE id=$1', [req.params.id]);
    if (!target.rows.length || target.rows[0].is_hidden) return res.status(404).json({ error: 'User not found' });
    if (target.rows[0].role === 'admin' || target.rows[0].role === 'superadmin')
      return res.status(400).json({ error: 'Admins always have MCP access — nothing to change.' });

    const { rows } = await pool.query(
      'UPDATE users SET mcp_enabled=$1 WHERE id=$2 RETURNING id,email,name,role,mcp_enabled',
      [mcp_enabled, req.params.id]
    );
    res.json(rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ── PUT /auth/admin/users/:id/reset-password (admin only) ────────────────────
router.put('/admin/users/:id/reset-password', requireAuth, requireRole('admin'), async (req, res) => {
  const { password } = req.body;
  if (!password || password.length < 8)
    return res.status(400).json({ error: 'Password must be at least 8 characters' });
  if (parseInt(req.params.id) === req.user.id)
    return res.status(400).json({ error: 'Use the Security tab to change your own password' });

  try {
    const { rows } = await pool.query('SELECT id FROM users WHERE id=$1 AND COALESCE(is_hidden,false) = false', [req.params.id]);
    if (!rows.length) return res.status(404).json({ error: 'User not found' });

    const hash = await bcrypt.hash(password, 12);
    await pool.query('UPDATE users SET password_hash=$1 WHERE id=$2', [hash, req.params.id]);
    res.json({ success: true });
  } catch (err) {
    console.error(err);

    res.status(500).json({ error: 'Internal server error' });
  }
});

// ── POST /auth/logout ─────────────────────────────────────────────────────────
router.post('/logout', (req, res) => {
  res.clearCookie('wb_token', { path: '/' });
  res.json({ success: true });
});

// ── DELETE /auth/users/:id (admin only) ───────────────────────────────────────
router.delete('/users/:id', requireAuth, requireRole('admin'), async (req, res) => {
  if (parseInt(req.params.id) === req.user.id)
    return res.status(400).json({ error: 'Cannot delete yourself' });
  try {
    const { rows } = await pool.query('DELETE FROM users WHERE id=$1 AND COALESCE(is_hidden,false) = false RETURNING id', [req.params.id]);
    if (!rows.length) return res.status(404).json({ error: 'User not found' });
    res.json({ success: true });
  } catch (err) {
    console.error(err);

    res.status(500).json({ error: 'Internal server error' });
  }
});

module.exports = router;
