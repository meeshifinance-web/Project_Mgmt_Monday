// ───────────────────────────────────────────────────────────────────────────
// OAuth 2.1 provider for the Simplix MCP server (monday.com-style "Connect").
//
// Implements just enough of OAuth 2.1 + the MCP authorization spec for an AI
// client (Claude, Cursor, …) to connect with a browser approval instead of a
// pasted token:
//   • RFC 9728  Protected Resource Metadata   (/.well-known/oauth-protected-resource)
//   • RFC 8414  Authorization Server Metadata  (/.well-known/oauth-authorization-server)
//   • RFC 7591  Dynamic Client Registration    (POST /oauth/register)
//   • Authorization Code + PKCE (S256)          (GET/POST /oauth/authorize, POST /oauth/token)
//
// The user authenticates with their normal Simplix email + password on the
// authorize page; the issued access token is bound to that user and still flows
// through every existing permission check (mcp_enabled gate, canAccessBoard,
// scope/role caps) exactly like an API key.
// ───────────────────────────────────────────────────────────────────────────

const express = require('express');
const crypto = require('crypto');
const bcrypt = require('bcryptjs');
const rateLimit = require('express-rate-limit');
const pool = require('../db');

const router = express.Router();

// ── Lifetimes ──────────────────────────────────────────────────────────────────
const CODE_TTL_SEC = 120;            // authorization code: 2 minutes
const ACCESS_TTL_SEC = 60 * 60;      // access token: 1 hour
const REFRESH_TTL_SEC = 60 * 60 * 24 * 30; // refresh token: 30 days

const sha256 = (s) => crypto.createHash('sha256').update(s).digest('hex');
const rand = (n = 32) => crypto.randomBytes(n).toString('base64url');

// Public base URL of this server. Prefer an explicit env (for prod behind a
// proxy); otherwise derive from the incoming request so discovery URLs match
// whatever host the client actually used.
function baseUrl(req) {
  if (process.env.MCP_PUBLIC_URL) return process.env.MCP_PUBLIC_URL.replace(/\/$/, '');
  return `${req.protocol}://${req.get('host')}`;
}

// Permissive CORS for the discovery/token endpoints — MCP clients fetch these
// from arbitrary origins and they carry no cookies/secrets-in-cookies.
function openCors(req, res, next) {
  res.set('Access-Control-Allow-Origin', '*');
  res.set('Access-Control-Allow-Headers', 'Content-Type, Authorization, mcp-protocol-version');
  res.set('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  if (req.method === 'OPTIONS') return res.status(204).end();
  next();
}

// ════════════════════════════════════════════════════════════════════════════
// Discovery metadata
// ════════════════════════════════════════════════════════════════════════════

// RFC 9728 — Protected Resource Metadata. Served at the bare path and the
// MCP-path-suffixed variant (clients try `/.well-known/oauth-protected-resource/mcp`).
function protectedResource(req, res) {
  const base = baseUrl(req);
  res.json({
    resource: `${base}/mcp`,
    authorization_servers: [base],
    bearer_methods_supported: ['header'],
    scopes_supported: ['mcp'],
    resource_name: 'Simplix MCP',
  });
}
router.get('/.well-known/oauth-protected-resource', openCors, protectedResource);
router.get('/.well-known/oauth-protected-resource/mcp', openCors, protectedResource);

// RFC 8414 — Authorization Server Metadata.
function authServerMeta(req, res) {
  const base = baseUrl(req);
  res.json({
    issuer: base,
    authorization_endpoint: `${base}/oauth/authorize`,
    token_endpoint: `${base}/oauth/token`,
    registration_endpoint: `${base}/oauth/register`,
    scopes_supported: ['mcp'],
    response_types_supported: ['code'],
    grant_types_supported: ['authorization_code', 'refresh_token'],
    code_challenge_methods_supported: ['S256'],
    token_endpoint_auth_methods_supported: ['none'],
  });
}
router.get('/.well-known/oauth-authorization-server', openCors, authServerMeta);
router.get('/.well-known/oauth-authorization-server/mcp', openCors, authServerMeta);

// ════════════════════════════════════════════════════════════════════════════
// Dynamic Client Registration (RFC 7591)
// ════════════════════════════════════════════════════════════════════════════
router.post('/oauth/register', openCors, async (req, res) => {
  const body = req.body || {};
  const redirectUris = Array.isArray(body.redirect_uris) ? body.redirect_uris.filter(u => typeof u === 'string') : [];
  if (!redirectUris.length)
    return res.status(400).json({ error: 'invalid_redirect_uri', error_description: 'At least one redirect_uri is required.' });

  const clientId = 'mcpc_' + rand(16);
  await pool.query(
    'INSERT INTO oauth_clients (client_id, client_name, redirect_uris) VALUES ($1,$2,$3)',
    [clientId, String(body.client_name || 'MCP Client').slice(0, 200), JSON.stringify(redirectUris)]
  );
  // Public client (PKCE) — no secret issued.
  res.status(201).json({
    client_id: clientId,
    client_name: body.client_name || 'MCP Client',
    redirect_uris: redirectUris,
    token_endpoint_auth_method: 'none',
    grant_types: ['authorization_code', 'refresh_token'],
    response_types: ['code'],
  });
});

// ════════════════════════════════════════════════════════════════════════════
// Authorization endpoint — login + consent in one step
// ════════════════════════════════════════════════════════════════════════════

async function loadClient(clientId) {
  const { rows } = await pool.query('SELECT * FROM oauth_clients WHERE client_id=$1', [clientId]);
  return rows[0] || null;
}
function redirectAllowed(client, redirectUri) {
  try {
    const list = typeof client.redirect_uris === 'string' ? JSON.parse(client.redirect_uris) : client.redirect_uris;
    return Array.isArray(list) && list.includes(redirectUri);
  } catch { return false; }
}

// Validate the common authorize params; returns {ok, error} without leaking
// via an open redirect (we only redirect once client+redirect_uri are trusted).
async function validateAuthorizeParams(q) {
  if (q.response_type !== 'code') return { error: 'unsupported_response_type' };
  if (!q.client_id) return { error: 'invalid_request', desc: 'client_id required' };
  if (!q.code_challenge || q.code_challenge_method !== 'S256')
    return { error: 'invalid_request', desc: 'PKCE S256 code_challenge required' };
  const client = await loadClient(q.client_id);
  if (!client) return { error: 'invalid_client', desc: 'Unknown client_id' };
  if (!q.redirect_uri || !redirectAllowed(client, q.redirect_uri))
    return { error: 'invalid_request', desc: 'redirect_uri not registered for this client' };
  return { ok: true, client };
}

function loginPage(params, errorMsg) {
  const hidden = ['client_id', 'redirect_uri', 'code_challenge', 'code_challenge_method', 'state', 'scope', 'resource', 'response_type']
    .map(k => `<input type="hidden" name="${k}" value="${escapeHtml(params[k] || '')}">`).join('\n');
  return `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>Connect to Simplix</title><style>
*{box-sizing:border-box}body{margin:0;font-family:Inter,system-ui,Arial,sans-serif;background:#f5f6f8;display:flex;align-items:center;justify-content:center;min-height:100vh}
.card{background:#fff;border-radius:14px;box-shadow:0 8px 40px rgba(0,0,0,.12);width:100%;max-width:380px;padding:30px 28px}
.logo{font-weight:800;font-size:22px;color:#1f2d3d;margin-bottom:4px}.logo span{color:#9b72f5}
.sub{font-size:13px;color:#676879;margin-bottom:20px;line-height:1.5}
label{display:block;font-size:12px;font-weight:600;color:#676879;margin:14px 0 6px}
input[type=email],input[type=password],input[type=text]{width:100%;padding:10px 12px;border:1.5px solid #e0e2e8;border-radius:8px;font-size:14px;outline:none}
input:focus{border-color:#9b72f5}
.pw-wrap{position:relative}
.pw-toggle{position:absolute;right:10px;top:50%;transform:translateY(-50%);background:none;border:none;color:#9b72f5;font-size:12px;font-weight:700;cursor:pointer;padding:4px 6px;width:auto;margin:0}
.pw-wrap input{padding-right:62px}
button{width:100%;margin-top:22px;padding:11px;border:none;border-radius:8px;background:#9b72f5;color:#fff;font-weight:700;font-size:14px;cursor:pointer}
button:hover{background:#8a5ee8}.err{background:#fff5f7;border:1px solid #f5c0ca;color:#c0334d;font-size:13px;padding:9px 12px;border-radius:8px;margin-bottom:8px}
.foot{font-size:11px;color:#9296a3;margin-top:16px;text-align:center;line-height:1.5}
</style></head><body><div class="card">
<div class="logo">Simpli<span>x</span></div>
<div class="sub">An AI assistant wants to connect to your Simplix account. Sign in to authorize access to <strong>your</strong> boards and items.</div>
${errorMsg ? `<div class="err">${escapeHtml(errorMsg)}</div>` : ''}
<form method="POST" action="/oauth/authorize">
${hidden}
<label>Email</label><input type="email" name="email" required autofocus autocomplete="username">
<label>Password</label>
<div class="pw-wrap">
<input id="pw" type="password" name="password" required autocomplete="current-password">
<button type="button" class="pw-toggle" id="pwToggle">Show</button>
</div>
<button type="submit">Authorize &amp; Connect</button>
</form>
<div class="foot">The assistant will act with your permissions only. You can revoke access anytime in Simplix settings.</div>
</div>
<script>
(function(){
  var b=document.getElementById('pwToggle'), p=document.getElementById('pw');
  if(b&&p){ b.addEventListener('click',function(){
    var show=p.type==='password'; p.type=show?'text':'password'; b.textContent=show?'Hide':'Show';
  }); }
})();
</script>
</body></html>`;
}
function escapeHtml(s) { return String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])); }

// The global helmet CSP sets `form-action 'self'`, which (in some embedded
// browsers, e.g. Electron) also blocks the post-login 302 redirect to the
// client's callback URL — making "Authorize" appear to do nothing. Relax CSP
// for the authorize pages so the OAuth redirect is allowed.
function authPageCsp(res) {
  res.set('Content-Security-Policy',
    "default-src 'self'; style-src 'self' 'unsafe-inline'; script-src 'self' 'unsafe-inline'; img-src 'self' data:; base-uri 'self'; form-action *");
}

// GET — show the login/consent page (after validating the request).
router.get('/oauth/authorize', async (req, res) => {
  authPageCsp(res);
  const v = await validateAuthorizeParams(req.query);
  if (v.error) return res.status(400).send(`<p>Authorization error: ${escapeHtml(v.error)}${v.desc ? ' — ' + escapeHtml(v.desc) : ''}</p>`);
  res.set('Content-Type', 'text/html').send(loginPage(req.query));
});

// Rate-limit credential submission.
const authorizeLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, max: 30,
  keyGenerator: (req) => (req.body && req.body.email ? String(req.body.email).toLowerCase() : rateLimit.ipKeyGenerator(req.ip)),
  standardHeaders: true, legacyHeaders: false,
});

// POST — verify credentials, then issue an authorization code via redirect.
router.post('/oauth/authorize', authorizeLimiter, async (req, res) => {
  authPageCsp(res);
  const p = req.body || {};
  const v = await validateAuthorizeParams(p);
  if (v.error) return res.status(400).send(`Authorization error: ${escapeHtml(v.error)}`);

  // Authenticate the Simplix user.
  const email = String(p.email || '').toLowerCase().trim();
  const { rows } = await pool.query('SELECT id, password_hash, is_active, role, COALESCE(mcp_enabled,false) AS mcp_enabled FROM users WHERE email=$1', [email]);
  const user = rows[0];
  const bad = () => res.status(401).set('Content-Type', 'text/html').send(loginPage(p, 'Incorrect email or password.'));
  if (!user || !user.password_hash) return bad();
  const okPw = await bcrypt.compare(String(p.password || ''), user.password_hash);
  if (!okPw) return bad();
  if (!user.is_active) return res.status(403).set('Content-Type', 'text/html').send(loginPage(p, 'Your account is disabled.'));
  // Enforce the same admin-controlled MCP gate as everywhere else.
  if (user.role !== 'admin' && user.mcp_enabled !== true)
    return res.status(403).set('Content-Type', 'text/html').send(loginPage(p, 'MCP access is disabled for your account. Ask an admin to enable it in User Management.'));

  // Issue a single-use, PKCE-bound authorization code.
  const code = rand(32);
  await pool.query(
    `INSERT INTO oauth_codes (code_hash, client_id, user_id, redirect_uri, code_challenge, scope, resource, expires_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7, NOW() + INTERVAL '${CODE_TTL_SEC} seconds')`,
    [sha256(code), p.client_id, user.id, p.redirect_uri, p.code_challenge, p.scope || 'mcp', p.resource || null]
  );

  const u = new URL(p.redirect_uri);
  u.searchParams.set('code', code);
  if (p.state) u.searchParams.set('state', p.state);
  res.redirect(302, u.toString());
});

// ════════════════════════════════════════════════════════════════════════════
// Token endpoint
// ════════════════════════════════════════════════════════════════════════════
router.post('/oauth/token', openCors, async (req, res) => {
  const p = req.body || {};
  try {
    if (p.grant_type === 'authorization_code') return await grantAuthCode(p, res);
    if (p.grant_type === 'refresh_token') return await grantRefresh(p, res);
    return res.status(400).json({ error: 'unsupported_grant_type' });
  } catch (err) {
    console.error('[oauth/token]', err);
    return res.status(500).json({ error: 'server_error' });
  }
});

async function issueTokens(res, { client_id, user_id, scope, resource }) {
  const access = 'smcp_at_' + rand(32);
  const refresh = 'smcp_rt_' + rand(32);
  await pool.query(
    `INSERT INTO oauth_tokens (access_token_hash, refresh_token_hash, client_id, user_id, scope, resource, expires_at, refresh_expires_at)
     VALUES ($1,$2,$3,$4,$5,$6, NOW() + INTERVAL '${ACCESS_TTL_SEC} seconds', NOW() + INTERVAL '${REFRESH_TTL_SEC} seconds')`,
    [sha256(access), sha256(refresh), client_id, user_id, scope || 'mcp', resource || null]
  );
  return res.json({
    access_token: access,
    token_type: 'Bearer',
    expires_in: ACCESS_TTL_SEC,
    refresh_token: refresh,
    scope: scope || 'mcp',
  });
}

async function grantAuthCode(p, res) {
  if (!p.code || !p.code_verifier || !p.client_id || !p.redirect_uri)
    return res.status(400).json({ error: 'invalid_request' });
  const { rows } = await pool.query('SELECT * FROM oauth_codes WHERE code_hash=$1', [sha256(p.code)]);
  const c = rows[0];
  if (!c) return res.status(400).json({ error: 'invalid_grant', error_description: 'Code not found or already used.' });
  // Single-use: delete immediately regardless of outcome.
  await pool.query('DELETE FROM oauth_codes WHERE code_hash=$1', [sha256(p.code)]);
  if (new Date(c.expires_at).getTime() < Date.now())
    return res.status(400).json({ error: 'invalid_grant', error_description: 'Authorization code expired.' });
  if (c.client_id !== p.client_id) return res.status(400).json({ error: 'invalid_grant', error_description: 'client_id mismatch.' });
  if (c.redirect_uri !== p.redirect_uri) return res.status(400).json({ error: 'invalid_grant', error_description: 'redirect_uri mismatch.' });
  // Verify PKCE: BASE64URL(SHA256(verifier)) === code_challenge
  const challenge = crypto.createHash('sha256').update(p.code_verifier).digest('base64url');
  if (challenge !== c.code_challenge) return res.status(400).json({ error: 'invalid_grant', error_description: 'PKCE verification failed.' });

  return issueTokens(res, { client_id: c.client_id, user_id: c.user_id, scope: c.scope, resource: c.resource });
}

async function grantRefresh(p, res) {
  if (!p.refresh_token) return res.status(400).json({ error: 'invalid_request' });
  const { rows } = await pool.query('SELECT * FROM oauth_tokens WHERE refresh_token_hash=$1 AND revoked=false', [sha256(p.refresh_token)]);
  const t = rows[0];
  if (!t) return res.status(400).json({ error: 'invalid_grant' });
  if (t.refresh_expires_at && new Date(t.refresh_expires_at).getTime() < Date.now())
    return res.status(400).json({ error: 'invalid_grant', error_description: 'Refresh token expired.' });
  // Rotate: revoke the old row, issue a fresh pair.
  await pool.query('UPDATE oauth_tokens SET revoked=true WHERE id=$1', [t.id]);
  return issueTokens(res, { client_id: t.client_id, user_id: t.user_id, scope: t.scope, resource: t.resource });
}

// ════════════════════════════════════════════════════════════════════════════
// Resource-server helper: validate an OAuth access token → user context.
// Returned shape matches what mcpAuth expects on req.user.
// ════════════════════════════════════════════════════════════════════════════
async function validateAccessToken(token) {
  if (!token || typeof token !== 'string' || !token.startsWith('smcp_at_')) return null;
  const { rows } = await pool.query(
    `SELECT t.user_id, t.scope, t.expires_at, t.revoked,
            u.name, u.email, u.role, u.is_active, COALESCE(u.mcp_enabled,false) AS mcp_enabled
       FROM oauth_tokens t JOIN users u ON u.id = t.user_id
      WHERE t.access_token_hash = $1`,
    [sha256(token)]
  );
  const r = rows[0];
  if (!r || r.revoked) return null;
  if (new Date(r.expires_at).getTime() < Date.now()) return null;
  if (!r.is_active) return null;
  return {
    user: { id: r.user_id, name: r.name, email: r.email, role: r.role, mcp_enabled: r.mcp_enabled },
    // OAuth-issued tokens grant full (read+write) access, still capped by the
    // user's role + canAccessBoard. No board allow-list (whole user scope).
    apiKey: { scope: 'full', board_ids: null, oauth: true },
  };
}

module.exports = { router, validateAccessToken };
