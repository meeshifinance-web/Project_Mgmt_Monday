/**
 * imapClient.js
 *
 * Stateless helpers for the IMAP poller: configuration, a "configured?" check,
 * and conversion of a parsed MIME message (mailparser) into the same normalized
 * email shape that routeEmail() consumes (identical to msGraph.normalizeMessage).
 *
 * Works with any IMAP server (Gmail, Outlook/M365 IMAP, Zoho, custom). For
 * Gmail you MUST use an App Password (with 2-Step Verification on) — your normal
 * account password will not authenticate over IMAP.
 *
 * Env (IMAP_* fall back to the EMAIL_* SMTP creds where sensible, so Gmail users
 * who already configured sending only need IMAP_HOST + IMAP_MAILBOX):
 *   IMAP_HOST            e.g. imap.gmail.com           (required to enable)
 *   IMAP_PORT            default 993
 *   IMAP_TLS             default true ('false' to disable)
 *   IMAP_USER            default = EMAIL_USER
 *   IMAP_PASS            default = EMAIL_PASS           (Gmail App Password)
 *   IMAP_MAILBOX         default 'INBOX'
 *   IMAP_MAX_BODY_BYTES  default 262144 (256 KB) — hard cap fetched per message
 *   IMAP_POLL_INTERVAL_MS default 60000 — safety re-scan even when IDLE is live
 */

function config() {
  return {
    host:     process.env.IMAP_HOST,
    port:     parseInt(process.env.IMAP_PORT, 10) || 993,
    secure:   (process.env.IMAP_TLS ?? 'true') !== 'false',
    user:     process.env.IMAP_USER || process.env.EMAIL_USER,
    pass:     process.env.IMAP_PASS || process.env.EMAIL_PASS,
    mailbox:  process.env.IMAP_MAILBOX || 'INBOX',
    maxBytes: parseInt(process.env.IMAP_MAX_BODY_BYTES, 10) || 256 * 1024,
    sweepMs:  parseInt(process.env.IMAP_POLL_INTERVAL_MS, 10) || 60_000,
    // When false (default) the poller ignores the existing inbox backlog and only
    // processes mail that arrives after it first connects. Set true to also drain
    // everything currently UNSEEN (e.g. a dedicated, empty intake mailbox).
    processExisting: (process.env.IMAP_PROCESS_EXISTING || 'false') === 'true',
  };
}

// The poller activates only when a host + credentials are present, mirroring the
// Graph poller's opt-in behaviour so existing deployments are unaffected.
function isConfigured() {
  const c = config();
  return !!(c.host && c.user && c.pass);
}

// mailparser address container → [{ address, name }]
function addrList(a) {
  if (!a) return [];
  const values = Array.isArray(a) ? a : (a.value || []);
  return values
    .map(x => ({ address: String(x.address || '').trim(), name: String(x.name || '').trim() }))
    .filter(x => x.address);
}
function firstAddr(a) {
  return addrList(a)[0] || { address: '', name: '' };
}

// References header can be a string or an array depending on the source — coerce
// to the single space-joined string routeEmail()'s threading logic expects.
function refsToString(refs) {
  if (!refs) return null;
  if (Array.isArray(refs)) return refs.join(' ');
  return String(refs);
}

/**
 * Parsed MIME (mailparser simpleParser output) → normalized email object.
 * Shape matches msGraph.normalizeMessage so emailRouter is source-agnostic.
 */
function normalizeParsed(parsed) {
  return {
    messageId:  parsed.messageId || null,
    inReplyTo:  parsed.inReplyTo || null,
    references: refsToString(parsed.references),
    from:       firstAddr(parsed.from),
    to:         addrList(parsed.to),
    cc:         addrList(parsed.cc),
    bcc:        addrList(parsed.bcc),
    subject:    parsed.subject || '',
    bodyText:   parsed.text || '',
    bodyHtml:   parsed.html || '',
    receivedAt: (parsed.date instanceof Date ? parsed.date : new Date()).toISOString(),
    hasAttachments: Array.isArray(parsed.attachments) && parsed.attachments.length > 0,
  };
}

module.exports = { config, isConfigured, normalizeParsed, addrList, firstAddr };
