// ───────────────────────────────────────────────────────────────────────────
// Simplix MCP server — Streamable HTTP transport, mounted at /mcp.
//
// Lets any MCP-capable AI client (Claude Desktop/Code, Cursor, etc.) operate
// Simplix on behalf of a user, authenticated with that user's API key. Robustness
// measures baked in:
//   • Stateless transport (a fresh server per request) → no session memory to
//     leak or grow under load.
//   • Per-key rate limit + a global in-flight concurrency cap → an over-eager
//     agent can't flood the backend.
//   • Auth via the existing api_keys system; every tool runs with the user's own
//     permissions (see tools.js / loopback.js).
//
// Connect from a client with:
//   { "mcpServers": { "simplix": { "type": "http",
//       "url": "http://<host>:<port>/mcp",
//       "headers": { "Authorization": "Bearer wb_live_..." } } } }
// ───────────────────────────────────────────────────────────────────────────

const express = require('express');
const rateLimit = require('express-rate-limit');
const jwt = require('jsonwebtoken');
const { McpServer } = require('@modelcontextprotocol/sdk/server/mcp.js');
const { StreamableHTTPServerTransport } = require('@modelcontextprotocol/sdk/server/streamableHttp.js');

const { requireApiKey } = require('../middleware/apiAuth');
const { requireMcpAccess } = require('../middleware/auth');
const { validateAccessToken } = require('./oauth');
const { registerTools } = require('./tools');

const router = express.Router();

// Dynamic ("raw API") tool is opt-in and only for full-scope keys.
const DYNAMIC_ENABLED = process.env.MCP_ENABLE_DYNAMIC_API === 'true';

// ── Concurrency guard ──────────────────────────────────────────────────────────
// Cap simultaneous MCP requests across all clients so the server stays responsive.
const MAX_IN_FLIGHT = 12;
let inFlight = 0;

// ── Auth ───────────────────────────────────────────────────────────────────────
// Accept the key three ways, then validate it with the exact same logic the REST
// API uses:
//   1. `Authorization: Bearer wb_live_...`  (the MCP-standard way)
//   2. `X-API-Key: wb_live_...`             (header)
//   3. `?token=wb_live_...` query param     (for GUI "connector" UIs that only
//      accept a URL and can't set a custom header, e.g. Claude's Connectors panel)
//   4. `Authorization: Bearer smcp_at_...`  (OAuth 2.1 access token — the
//      monday.com-style "Connect" flow; see mcp/oauth.js)
async function mcpAuth(req, res, next) {
  // ── OAuth access token path ──────────────────────────────────────────────
  const authHeader = req.headers['authorization'];
  if (authHeader && authHeader.startsWith('Bearer ')) {
    const tok = authHeader.slice(7).trim();
    if (tok.startsWith('smcp_at_')) {
      try {
        const ctx = await validateAccessToken(tok);
        if (!ctx) return unauthorized(req, res, 'invalid_token', 'The access token is invalid or expired.');
        req.user = ctx.user;
        req.apiKey = ctx.apiKey;
        return requireMcpAccess(req, res, next); // still honours the per-user gate
      } catch (err) {
        console.error('[mcp oauth auth]', err);
        return res.status(500).json({ error: 'Internal server error' });
      }
    }
  }

  // ── API-key path (Bearer wb_live_ / X-API-Key / ?token=) ─────────────────
  if (!req.headers['x-api-key']) {
    if (authHeader && authHeader.startsWith('Bearer ')) {
      const tok = authHeader.slice(7).trim();
      if (tok.startsWith('wb_live_')) req.headers['x-api-key'] = tok;
    }
  }
  if (!req.headers['x-api-key']) {
    const q = req.query.token || req.query.key || req.query.apiKey || req.query.api_key;
    if (typeof q === 'string' && q.startsWith('wb_live_')) req.headers['x-api-key'] = q;
  }
  // No credential at all → emit the OAuth discovery challenge so clients can
  // start the browser "Connect" flow automatically.
  if (!req.headers['x-api-key']) {
    return unauthorized(req, res, 'Bearer', 'Authentication required.');
  }
  // Validate the key, then enforce the admin-controlled per-user MCP toggle.
  return requireApiKey(req, res, () => requireMcpAccess(req, res, next));
}

// Reply 401 with the RFC 9728 discovery pointer so MCP clients know where to
// begin OAuth. The header is what turns "no token" into a "Connect" button.
function unauthorized(req, res, errCode, desc) {
  const base = process.env.MCP_PUBLIC_URL
    ? process.env.MCP_PUBLIC_URL.replace(/\/$/, '')
    : `${req.protocol}://${req.get('host')}`;
  res.set('WWW-Authenticate',
    `Bearer resource_metadata="${base}/.well-known/oauth-protected-resource"` +
    (errCode && errCode !== 'Bearer' ? `, error="${errCode}", error_description="${desc}"` : ''));
  return res.status(401).json({ error: desc || 'Authentication required' });
}

// ── Per-key rate limit ───────────────────────────────────────────────────────
// A second line of defence in front of the data layer (loopback calls are also
// limited by the existing /api limiter). Keyed by API key so one noisy key can't
// affect others.
const mcpLimiter = rateLimit({
  windowMs: 60 * 60 * 1000, // 1 hour
  max: 600,
  keyGenerator: (req) => req.headers['x-api-key'] || rateLimit.ipKeyGenerator(req.ip),
  standardHeaders: true,
  legacyHeaders: false,
  message: { jsonrpc: '2.0', error: { code: -32000, message: 'MCP rate limit exceeded — slow down and retry shortly.' }, id: null },
});

// ── POST /mcp — the JSON-RPC entry point ────────────────────────────────────────
router.post('/', mcpLimiter, mcpAuth, async (req, res) => {
  if (inFlight >= MAX_IN_FLIGHT) {
    return res.status(503).json({
      jsonrpc: '2.0',
      error: { code: -32000, message: 'Server busy (too many concurrent MCP requests). Retry shortly.' },
      id: (req.body && req.body.id) || null,
    });
  }
  inFlight++;

  // How the loopback REST client authenticates as this user:
  //   • API-key session  → forward the same wb_live_ key (keeps scope + board limits)
  //   • OAuth session     → mint a short-lived JWT for the user (no wb_live_ key exists)
  // Either way the REST layer runs every permission check for that exact user.
  let auth;
  if (req.apiKey && req.apiKey.oauth) {
    auth = { jwt: jwt.sign({ id: req.user.id }, process.env.JWT_SECRET, { expiresIn: '5m' }) };
  } else {
    auth = { apiKey: req.headers['x-api-key'] };
  }

  const ctx = {
    auth,
    user: req.user,                                  // { id, name, email, role }
    key: req.apiKey,                                 // { scope, board_ids, ... }
  };

  const server = new McpServer(
    { name: 'simplix', version: '1.0.0' },
    { capabilities: { tools: {} } }
  );
  registerTools(server, ctx, { dynamic: DYNAMIC_ENABLED && ctx.key.scope === 'full' });

  // Stateless: one transport per request, torn down when the response closes.
  const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });
  res.on('close', () => {
    inFlight = Math.max(0, inFlight - 1);
    transport.close().catch(() => {});
    server.close().catch(() => {});
  });

  try {
    await server.connect(transport);
    await transport.handleRequest(req, res, req.body);
  } catch (err) {
    console.error('[mcp] request handling error:', err);
    if (!res.headersSent) {
      res.status(500).json({
        jsonrpc: '2.0',
        error: { code: -32603, message: 'Internal MCP server error.' },
        id: (req.body && req.body.id) || null,
      });
    }
  }
});

// Stateless mode does not support server-initiated SSE streams or session
// teardown, so GET/DELETE are not applicable.
function methodNotAllowed(_req, res) {
  res.status(405).json({
    jsonrpc: '2.0',
    error: { code: -32000, message: 'Method not allowed. This MCP server is stateless — use POST.' },
    id: null,
  });
}
router.get('/', methodNotAllowed);
router.delete('/', methodNotAllowed);

module.exports = router;
