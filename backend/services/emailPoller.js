/**
 * emailPoller.js
 *
 * Periodically polls the configured M365 mailbox via Microsoft Graph and
 * routes each new message through emailRouter.routeEmail().
 *
 * Activation:
 *   The poller runs ONLY if EMAIL_M365_MAILBOX is set AND the Graph auth
 *   credentials (tenant/client/secret) are configured. Otherwise start()
 *   is a no-op — existing deployments are unaffected.
 *
 * Tunables:
 *   EMAIL_POLL_INTERVAL_MS  default 60000 (1 minute)
 *
 * Lifecycle:
 *   - start()  → begin interval (idempotent; safe to call twice)
 *   - stop()   → clear interval (used in tests / graceful shutdown)
 */

const graph = require('./msGraph');
const { routeEmail } = require('./emailRouter');

let intervalHandle = null;
let running = false;                 // re-entrancy guard — one cycle at a time

async function pollOnce() {
  if (running) return;               // skip if previous cycle still in-flight
  running = true;
  try {
    const messages = await graph.fetchUnreadMessages({ top: 25 });
    if (!messages.length) return;
    console.log(`[emailPoller] ${messages.length} new message(s) from ${process.env.EMAIL_M365_MAILBOX}`);

    for (const raw of messages) {
      const email = graph.normalizeMessage(raw);
      let result;
      try {
        result = await routeEmail(email);
      } catch (err) {
        console.error(`[emailPoller] routeEmail failed for "${email.subject}":`, err.message);
        result = { action: 'skipped', reason: 'router_error' };
      }

      // Mark read so we don't re-fetch, regardless of outcome. Dedup table
      // prevents double-processing if read-marking fails.
      try { await graph.markRead(raw.id); } catch (err) {
        console.error('[emailPoller] markRead failed:', err.message);
      }

      // TEMP DEBUG: log every outcome including skipped/no_match with from + subject,
      // so we can diagnose why prod emails aren't matching automation rules.
      // Revert to the quiet version (skip-guard) once filter behavior is confirmed.
      const summary = result.itemId ? `item ${result.itemId}` : (result.reason || '');
      console.log(`[emailPoller] → ${result.action} ${summary} | from="${email.from?.address || ''}" subj="${email.subject}"`);
    }
  } catch (err) {
    console.error('[emailPoller] cycle error:', err.message);
  } finally {
    running = false;
  }
}

function start() {
  if (intervalHandle) return;                       // already running
  if (!graph.isConfigured()) {
    console.log('[emailPoller] disabled — EMAIL_M365_MAILBOX or MS Graph credentials not configured');
    return;
  }
  const intervalMs = parseInt(process.env.EMAIL_POLL_INTERVAL_MS) || 60_000;
  console.log(`[emailPoller] ✅ started — polling ${process.env.EMAIL_M365_MAILBOX} every ${intervalMs}ms`);
  pollOnce().catch(err => console.error('[emailPoller] initial poll error:', err.message));
  intervalHandle = setInterval(() => {
    pollOnce().catch(err => console.error('[emailPoller] poll error:', err.message));
  }, intervalMs);
  if (intervalHandle.unref) intervalHandle.unref();
}

function stop() {
  if (intervalHandle) {
    clearInterval(intervalHandle);
    intervalHandle = null;
    console.log('[emailPoller] stopped');
  }
}

module.exports = { start, stop, pollOnce };
