/**
 * imapPoller.js
 *
 * Robust, low-memory inbound-email ingestion over IMAP. Drives every new
 * message through emailRouter.routeEmail() — the same dispatcher the Microsoft
 * Graph poller uses — so the "create item from email + capture sender" feature
 * works against any IMAP mailbox (Gmail App Password, Outlook, Zoho, …).
 *
 * DESIGN — why this is light on RAM and resilient:
 *   • IMAP IDLE (push): ImapFlow keeps ONE connection open and idles when free;
 *     the server pushes an 'exists' event the instant new mail arrives, so the
 *     process sits at ~idle CPU between emails instead of busy-polling.
 *   • Single persistent connection with auto-reconnect + exponential backoff.
 *   • Strictly SEQUENTIAL processing (one message at a time) — memory never
 *     scales with inbox size; only one parsed message is resident at once.
 *   • Hard per-message body cap (IMAP_MAX_BODY_BYTES) so one huge email can't
 *     balloon the heap; the MIME source is fetched only up to that many bytes.
 *   • Re-entrancy guard + "pending rescan" flag so overlapping 'exists' events
 *     coalesce into a single drain loop.
 *   • A periodic safety sweep re-checks UNSEEN even if an IDLE notification was
 *     ever missed or the connection silently stalled.
 *   • Per-message error isolation: a poison message is marked \Seen and skipped,
 *     never wedging the queue; dedup is enforced by emailRouter's seen-table.
 *
 * Lifecycle:  start() (idempotent) · stop() (graceful) · pollOnce() (manual scan)
 */

const { ImapFlow } = require('imapflow');
const { simpleParser } = require('mailparser');
const pool = require('../db');
const { config, isConfigured, normalizeParsed } = require('./imapClient');
const { routeEmail } = require('./emailRouter');

const INITIAL_BACKOFF_MS = 5_000;
const MAX_BACKOFF_MS     = 5 * 60_000; // cap reconnect wait at 5 min

let client        = null;
let stopped       = true;   // true until start(); flips processing/reconnect off
let scanning      = false;  // a drain loop is in progress
let pendingScan   = false;  // an 'exists' arrived mid-scan → rescan after
let sweepHandle   = null;   // safety interval
let reconnectTmr  = null;
let backoff       = INITIAL_BACKOFF_MS;

// UID watermark — we only ever process messages with UID strictly greater than
// `lastUid` (for the current uidValidity). This means the existing inbox backlog
// is never touched, and the watermark persists across restarts so mail that
// arrived while the backend was down is still picked up exactly once.
let lastUid       = 0;
let uidValidity   = null;

async function ensureStateTable() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS imap_state (
      mailbox      TEXT PRIMARY KEY,
      uid_validity BIGINT,
      last_uid     BIGINT NOT NULL DEFAULT 0,
      updated_at   TIMESTAMPTZ DEFAULT NOW()
    )`);
}

// Establish the starting watermark for a freshly-opened mailbox.
async function initWatermark(mbox) {
  const c = config();
  const row = (await pool.query('SELECT uid_validity, last_uid FROM imap_state WHERE mailbox=$1', [c.mailbox])).rows[0];
  uidValidity = mbox.uidValidity != null ? String(mbox.uidValidity) : null;

  const sameValidity = row && uidValidity != null && String(row.uid_validity) === uidValidity;
  if (sameValidity && !c.processExisting) {
    // Resume after a restart — continue from where we left off (catches downtime mail).
    lastUid = Number(row.last_uid) || 0;
  } else if (c.processExisting) {
    // Opt-in: drain the entire current backlog.
    lastUid = 0;
  } else {
    // First ever run (or uidValidity changed) — skip the backlog: start at the
    // newest UID so only future arrivals are processed.
    lastUid = Math.max(0, (Number(mbox.uidNext) || 1) - 1);
  }
  await persistWatermark();
  console.log(`[imapPoller] watermark: lastUid=${lastUid} (uidValidity=${uidValidity}, processExisting=${c.processExisting})`);
}

async function persistWatermark() {
  const c = config();
  await pool.query(
    `INSERT INTO imap_state (mailbox, uid_validity, last_uid, updated_at)
     VALUES ($1,$2,$3,NOW())
     ON CONFLICT (mailbox) DO UPDATE SET uid_validity=EXCLUDED.uid_validity, last_uid=EXCLUDED.last_uid, updated_at=NOW()`,
    [c.mailbox, uidValidity, lastUid]
  );
}

// ── Connection management ─────────────────────────────────────────────────────
async function connect() {
  if (stopped) return;
  const c = config();

  client = new ImapFlow({
    host: c.host,
    port: c.port,
    secure: c.secure,
    auth: { user: c.user, pass: c.pass },
    logger: false,       // keep our logs clean + avoid buffering verbose protocol logs
    emitLogs: false,
    qresync: false,
    missingIdleCommand: 'NOOP',
  });

  // Connection-level events. 'error'/'close' trigger a single backoff reconnect.
  client.on('error', (err) => console.error('[imapPoller] connection error:', err.message));
  client.on('close', () => {
    if (stopped) return;
    console.warn('[imapPoller] connection closed — scheduling reconnect');
    scheduleReconnect();
  });
  // New mail (or any mailbox size change) — drain UNSEEN.
  client.on('exists', () => { triggerScan('exists').catch(() => {}); });

  await client.connect();
  const mbox = await client.mailboxOpen(c.mailbox);
  backoff = INITIAL_BACKOFF_MS; // healthy connection → reset backoff
  await initWatermark(mbox);    // set/resume the UID watermark BEFORE any scan
  console.log(`[imapPoller] ✅ connected ${c.user} (${c.mailbox}) — IDLE push + ${c.sweepMs}ms safety sweep, body cap ${c.maxBytes}B`);

  // Process only mail newer than the watermark, then let IDLE + the sweep take over.
  await triggerScan('initial');
}

function scheduleReconnect() {
  if (stopped || reconnectTmr) return;
  const wait = backoff;
  backoff = Math.min(backoff * 2, MAX_BACKOFF_MS); // exponential, capped
  console.log(`[imapPoller] reconnecting in ${Math.round(wait / 1000)}s`);
  reconnectTmr = setTimeout(async () => {
    reconnectTmr = null;
    try { await safeLogout(); } catch (_) {}
    try { await connect(); }
    catch (err) {
      console.error('[imapPoller] reconnect failed:', err.message);
      scheduleReconnect();
    }
  }, wait);
  if (reconnectTmr.unref) reconnectTmr.unref();
}

async function safeLogout() {
  if (!client) return;
  const c = client; client = null;
  try { await c.logout(); } catch (_) { try { c.close(); } catch (__) {} }
}

// ── Scanning / processing ─────────────────────────────────────────────────────
// Coalesce overlapping triggers: if a scan is running, mark pending and return;
// the active loop will rescan until no new UNSEEN remain.
async function triggerScan(reason) {
  if (stopped || !client || !client.usable) return;
  if (scanning) { pendingScan = true; return; }
  scanning = true;
  try {
    do {
      pendingScan = false;
      await scanUnseen();
    } while (pendingScan && !stopped && client && client.usable);
  } catch (err) {
    console.error(`[imapPoller] scan error (${reason}):`, err.message);
  } finally {
    scanning = false;
  }
}

async function scanUnseen() {
  const c = config();
  // Exclusive access to the mailbox while we fetch (pauses IDLE cleanly).
  const lock = await client.getMailboxLock(c.mailbox);
  try {
    const found = await client.search({ seen: false }, { uid: true });
    if (!found || !found.length) return;
    // Only mail newer than the watermark — never the existing backlog. Sorted so
    // we advance the watermark monotonically.
    const uids = found.filter(u => u > lastUid).sort((a, b) => a - b);
    if (!uids.length) return;
    // One message at a time — bounded memory regardless of how many are unread.
    for (const uid of uids) {
      if (stopped) break;
      await processOne(uid, c);
      // Advance + persist the watermark after each message so a crash never
      // reprocesses it (the seen-table also dedups, this avoids even refetching).
      if (uid > lastUid) { lastUid = uid; await persistWatermark(); }
    }
  } finally {
    lock.release();
  }
}

async function processOne(uid, c) {
  let parsed = null;
  try {
    const msg = await client.fetchOne(
      uid,
      { uid: true, envelope: true, source: { maxLength: c.maxBytes } },
      { uid: true }
    );
    if (!msg || !msg.source) {
      await markSeen(uid);
      return;
    }
    parsed = await simpleParser(msg.source, { skipImageLinks: true });
  } catch (err) {
    // Poison message (un-parseable / fetch error): mark seen so it can't wedge
    // the queue, and move on. We never re-fetch it.
    console.error(`[imapPoller] fetch/parse failed uid=${uid}:`, err.message);
    await markSeen(uid);
    return;
  }

  const email = normalizeParsed(parsed);
  parsed = null; // release the parsed tree before the (async) DB work

  let result;
  try {
    result = await routeEmail(email);
  } catch (err) {
    console.error(`[imapPoller] routeEmail failed for "${email.subject}":`, err.message);
    result = { action: 'skipped', reason: 'router_error' };
  }

  await markSeen(uid); // mark read regardless of outcome (dedup table is the backstop)

  if (result.action !== 'skipped') {
    const tail = result.itemId ? `item ${result.itemId}` : (result.reason || '');
    console.log(`[imapPoller] → ${result.action} ${tail} | "${email.subject}"`);
  }
}

async function markSeen(uid) {
  try {
    await client.messageFlagsAdd([uid], ['\\Seen'], { uid: true });
  } catch (err) {
    console.error(`[imapPoller] markSeen failed uid=${uid}:`, err.message);
  }
}

// ── Public lifecycle ──────────────────────────────────────────────────────────
function start() {
  if (!stopped) return;                      // already running
  if (!isConfigured()) {
    console.log('[imapPoller] disabled — IMAP_HOST / credentials not configured');
    return;
  }
  stopped = false;
  backoff = INITIAL_BACKOFF_MS;

  ensureStateTable()
    .then(() => connect())
    .catch((err) => {
      console.error('[imapPoller] initial connect failed:', err.message);
      scheduleReconnect();
    });

  // Safety net: periodically force a rescan in case an IDLE event was missed.
  const { sweepMs } = config();
  sweepHandle = setInterval(() => { triggerScan('sweep').catch(() => {}); }, sweepMs);
  if (sweepHandle.unref) sweepHandle.unref();
}

async function stop() {
  stopped = true;
  if (sweepHandle) { clearInterval(sweepHandle); sweepHandle = null; }
  if (reconnectTmr) { clearTimeout(reconnectTmr); reconnectTmr = null; }
  await safeLogout();
  console.log('[imapPoller] stopped');
}

// Manual one-shot scan (used by tests / health checks). Connects if needed.
async function pollOnce() {
  if (!isConfigured()) return { ok: false, reason: 'not_configured' };
  const ownConnection = !client || !client.usable;
  if (ownConnection) {
    stopped = false;
    await ensureStateTable();
    client = new ImapFlow({
      host: config().host, port: config().port, secure: config().secure,
      auth: { user: config().user, pass: config().pass }, logger: false, emitLogs: false,
    });
    await client.connect();
    const mbox = await client.mailboxOpen(config().mailbox);
    await initWatermark(mbox); // respect the watermark — never drain the backlog
  }
  try { await scanUnseen(); return { ok: true }; }
  finally { if (ownConnection) { await safeLogout(); stopped = true; } }
}

module.exports = { start, stop, pollOnce, isConfigured };
