/**
 * msGraph.js
 *
 * Minimal Microsoft Graph API client using app-only (client credentials)
 * authentication. The backend authenticates as itself — no user login.
 *
 * Requires Azure app with:
 *   - Application permission:  Mail.Read  (admin consent granted)
 *   - Application Access Policy restricting scope to EMAIL_M365_MAILBOX
 *
 * Env vars consumed:
 *   GRAPH_MAIL_TENANT_ID      — real tenant GUID (NOT "common")
 *   GRAPH_MAIL_CLIENT_ID      — from Azure app registration (mail-routing app)
 *   GRAPH_MAIL_CLIENT_SECRET  — from Azure app registration (mail-routing app)
 *   EMAIL_M365_MAILBOX        — e.g. simplix@simplixart.com
 *
 * NOTE: these are intentionally separate from the Microsoft SSO app's
 * MICROSOFT_* vars so the two Azure registrations don't collide.
 */

const GRAPH_BASE = 'https://graph.microsoft.com/v1.0';
const SCOPE = 'https://graph.microsoft.com/.default';

let cachedToken = null;     // { access_token, expires_at (ms epoch) }

function isConfigured() {
  return !!(
    process.env.GRAPH_MAIL_TENANT_ID &&
    process.env.GRAPH_MAIL_TENANT_ID !== 'common' &&
    process.env.GRAPH_MAIL_CLIENT_ID &&
    process.env.GRAPH_MAIL_CLIENT_SECRET &&
    process.env.EMAIL_M365_MAILBOX
  );
}

async function getAccessToken() {
  if (cachedToken && cachedToken.expires_at - Date.now() > 60_000) {
    return cachedToken.access_token;
  }

  const tokenUrl = `https://login.microsoftonline.com/${process.env.GRAPH_MAIL_TENANT_ID}/oauth2/v2.0/token`;
  const body = new URLSearchParams({
    client_id:     process.env.GRAPH_MAIL_CLIENT_ID,
    client_secret: process.env.GRAPH_MAIL_CLIENT_SECRET,
    scope:         SCOPE,
    grant_type:    'client_credentials',
  });

  const res = await fetch(tokenUrl, {
    method:  'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body,
  });
  if (!res.ok) {
    const txt = await res.text();
    throw new Error(`Graph token request failed (${res.status}): ${txt}`);
  }
  const data = await res.json();
  cachedToken = {
    access_token: data.access_token,
    expires_at:   Date.now() + (data.expires_in * 1000),
  };
  return cachedToken.access_token;
}

/**
 * GET from Graph with auto-auth + basic error handling.
 * @param {string} path — e.g. "/users/x@y.com/messages?$top=10"
 */
async function graphGet(path) {
  const token = await getAccessToken();
  const url = path.startsWith('http') ? path : GRAPH_BASE + path;
  const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
  if (!res.ok) {
    const txt = await res.text();
    throw new Error(`Graph GET ${path} failed (${res.status}): ${txt}`);
  }
  return res.json();
}

async function graphPatch(path, body) {
  const token = await getAccessToken();
  const url = path.startsWith('http') ? path : GRAPH_BASE + path;
  const res = await fetch(url, {
    method: 'PATCH',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const txt = await res.text();
    throw new Error(`Graph PATCH ${path} failed (${res.status}): ${txt}`);
  }
  return res.status === 204 ? null : res.json();
}

/**
 * Fetch unread messages from the configured mailbox, newest first.
 * We keep the query small ($top=25) and rely on isRead=false + our own
 * dedup table to avoid re-processing.
 */
async function fetchUnreadMessages({ top = 25 } = {}) {
  const mailbox = encodeURIComponent(process.env.EMAIL_M365_MAILBOX);
  const select = [
    'id', 'internetMessageId', 'subject', 'from', 'toRecipients',
    'ccRecipients', 'bccRecipients', 'body', 'receivedDateTime',
    'internetMessageHeaders', 'hasAttachments', 'isRead',
  ].join(',');
  const filter = "isRead eq false";
  const path = `/users/${mailbox}/messages?$top=${top}&$filter=${encodeURIComponent(filter)}&$orderby=receivedDateTime%20asc&$select=${select}`;
  const data = await graphGet(path);
  return data.value || [];
}

/** Mark a message as read so we don't fetch it again next cycle. */
async function markRead(messageId) {
  const mailbox = encodeURIComponent(process.env.EMAIL_M365_MAILBOX);
  await graphPatch(`/users/${mailbox}/messages/${messageId}`, { isRead: true });
}

/** Extract a header value case-insensitively from Graph's header list. */
function getHeader(headers, name) {
  if (!Array.isArray(headers)) return null;
  const lower = name.toLowerCase();
  const match = headers.find(h => (h.name || '').toLowerCase() === lower);
  return match ? match.value : null;
}

// Cheap HTML → text: drop <script>/<style>, convert <br>/</p> to newlines,
// strip remaining tags, decode common entities, collapse whitespace.
function htmlToText(html) {
  if (!html) return '';
  return String(html)
    .replace(/<style[\s\S]*?<\/style>/gi, '')
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/<\/(p|div|h[1-6]|li|tr)>/gi, '\n')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\r\n?/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

/** Convert Graph's message shape → our internal normalized email object. */
function normalizeMessage(msg) {
  const toAddr = r => ({
    address: r?.emailAddress?.address || '',
    name:    r?.emailAddress?.name    || '',
  });
  const isHtml  = msg.body?.contentType === 'html';
  const content = msg.body?.content || '';
  const bodyHtml = isHtml ? content : '';
  const bodyText = isHtml ? htmlToText(content) : content;
  return {
    graphId:     msg.id,
    messageId:   msg.internetMessageId || null,
    inReplyTo:   getHeader(msg.internetMessageHeaders, 'in-reply-to'),
    references:  getHeader(msg.internetMessageHeaders, 'references'),
    from:        toAddr(msg.from),
    to:          (msg.toRecipients  || []).map(toAddr),
    cc:          (msg.ccRecipients  || []).map(toAddr),
    bcc:         (msg.bccRecipients || []).map(toAddr),
    subject:     msg.subject || '',
    bodyText,
    bodyHtml,
    receivedAt:  msg.receivedDateTime || new Date().toISOString(),
    hasAttachments: !!msg.hasAttachments,
  };
}

module.exports = {
  isConfigured,
  getAccessToken,
  fetchUnreadMessages,
  markRead,
  normalizeMessage,
};
