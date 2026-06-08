// ───────────────────────────────────────────────────────────────────────────
// Loopback REST client for MCP tools.
//
// Every MCP tool reaches Simplix data by calling the app's OWN REST API on
// localhost, authenticated with the caller's API key. This means the MCP layer
// inherits EVERY existing safeguard for free and can never diverge from it:
//   • requireApiKey / requireScope  → auth + read/write/full enforcement
//   • canAccessBoard                → board membership / org-wide / admin rules
//   • per-item owner-visibility     → applied by the board-load route
//   • validateColumnValue           → type validation & normalisation
//   • automations, date-cascade, activity logs, assignment emails
//
// A small concurrency limiter keeps a chatty agent from opening dozens of
// simultaneous DB connections, and every call has a hard timeout.
// ───────────────────────────────────────────────────────────────────────────

const axios = require('axios');
const { ToolError } = require('./format');

const PORT = process.env.PORT || 3001;
const BASE_URL = `http://127.0.0.1:${PORT}/api`;
const TIMEOUT_MS = 15000;

// ── Concurrency limiter ───────────────────────────────────────────────────────
// Cap simultaneous in-flight loopback requests so a single agent turn (which may
// chain several tool calls) can't exhaust the Postgres pool or spike CPU.
const MAX_CONCURRENT = 6;
let active = 0;
const waiters = [];
function acquire() {
  if (active < MAX_CONCURRENT) { active++; return Promise.resolve(); }
  return new Promise(resolve => waiters.push(resolve));
}
function release() {
  active--;
  const next = waiters.shift();
  if (next) { active++; next(); }
}

// Map an upstream HTTP failure to a clear, safe, user-facing message. The REST
// layer already returns specific messages (scope, validation, not-found); we
// pass those straight through and only add friendly wording for transport-level
// problems. Callers add board/item context for 403/404 where useful.
function mapHttpError(status, serverMessage) {
  const msg = serverMessage || `Request failed (${status})`;
  if (status === 401) return new ToolError('Authentication failed: your Simplix API key is missing, invalid, or revoked.', 401);
  if (status === 429) return new ToolError('Rate limit reached — too many requests. Please slow down and retry shortly.', 429);
  return new ToolError(msg, status);
}

/**
 * Call the Simplix REST API as the authenticated MCP user.
 * @param {{apiKey?:string, jwt?:string}} auth  how to authenticate the loopback:
 *        an API-key session forwards the wb_live_ key (preserving scope + board
 *        limits); an OAuth session forwards a short-lived user JWT.
 * @param {string} method  get|post|put|patch|delete
 * @param {string} path    path under /api, e.g. "/boards/12"
 * @param {{params?:object, data?:object}} [opts]
 * @returns parsed JSON body on 2xx; throws ToolError otherwise.
 */
async function callApi(auth, method, path, opts = {}) {
  const headers = { 'X-Simplix-MCP': '1' };
  if (auth && auth.apiKey) headers['X-API-Key'] = auth.apiKey;
  else if (auth && auth.jwt) headers['Authorization'] = `Bearer ${auth.jwt}`;
  await acquire();
  try {
    const resp = await axios({
      method,
      url: BASE_URL + path,
      params: opts.params,
      data: opts.data,
      timeout: TIMEOUT_MS,
      headers,
      validateStatus: () => true, // we handle all statuses ourselves
    });
    if (resp.status >= 200 && resp.status < 300) return resp.data;
    throw mapHttpError(resp.status, resp.data && resp.data.error);
  } catch (err) {
    if (err instanceof ToolError) throw err;
    if (err.code === 'ECONNABORTED')
      throw new ToolError('Simplix took too long to respond (request timed out). Nothing was changed.');
    throw new ToolError(`Could not reach the Simplix backend (${err.code || err.message}). Nothing was changed.`);
  } finally {
    release();
  }
}

module.exports = { callApi, BASE_URL };
