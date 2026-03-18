/**
 * emailPoller.js
 *
 * Two backends — auto-selected at startup:
 *
 *  1. Microsoft Graph API  (preferred)
 *     Triggered when EMAIL_M365_MAILBOX is set in .env.
 *     Uses the same MICROSOFT_CLIENT_ID / SECRET / TENANT_ID already used for SSO.
 *     Polls GET /v1.0/users/{mailbox}/mailFolders/Inbox/messages?$filter=isRead eq false
 *     Marks each processed message as read via PATCH.
 *     ⚠ Requires:
 *        • Mail.ReadWrite  Application permission on the Azure AD app
 *        • Admin consent granted
 *        • MICROSOFT_TENANT_ID must be the real tenant GUID or domain (not "common")
 *
 *  2. IMAP fallback  (Gmail or any IMAP server)
 *     Triggered when EMAIL_IMAP_USER + EMAIL_IMAP_PASS are set and EMAIL_M365_MAILBOX is not.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * Email format (same for both backends):
 *
 *   To:      workboard@ddecor.com
 *   Subject: New fabric sample request          → item name
 *
 *   Optional group prefix in subject:
 *   Subject: [In Progress] New fabric sample    → item placed in "In Progress" group
 *
 *   Optional board/group via + subaddress:
 *   To: workboard+board3@ddecor.com             → board 3, default group
 *   To: workboard+board3-group7@ddecor.com      → board 3, group 7
 *
 * ─────────────────────────────────────────────────────────────────────────────
 */

const axios            = require('axios');
const { ImapFlow }     = require('imapflow');
const { simpleParser } = require('mailparser');
const pool             = require('../db');

// Used only for Graph API (polling). IMAP uses IDLE push — no interval needed.
const GRAPH_POLL_INTERVAL_MS = parseInt(process.env.EMAIL_POLL_INTERVAL_MS) || 30 * 1000;

// ─────────────────────────────────────────────────────────────────────────────
// Routing helpers — priority: address > keyword rules > .env default
// ─────────────────────────────────────────────────────────────────────────────

function stripHtml(html) {
  return (html || '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
}

/** Resolve board+group from +subaddress tag in To: field (e.g. workboard+board3-group7@...) */
async function resolveFromAddress(toAddresses) {
  for (const addr of (toAddresses || [])) {
    const local = addr.split('@')[0] || '';
    const plus  = local.indexOf('+');
    if (plus === -1) continue;
    const tag        = local.slice(plus + 1);
    const boardMatch = tag.match(/board(\d+)/i);
    const groupMatch = tag.match(/group(\d+)/i);
    if (!boardMatch) continue;
    let boardId = parseInt(boardMatch[1]);
    let groupId = groupMatch ? parseInt(groupMatch[1]) : null;
    const br = await pool.query('SELECT id FROM boards WHERE id=$1', [boardId]);
    if (!br.rows.length) return null;
    if (groupId) {
      const gr = await pool.query('SELECT id FROM groups WHERE id=$1 AND board_id=$2', [groupId, boardId]);
      if (!gr.rows.length) groupId = null;
    }
    if (!groupId) {
      const gr = await pool.query('SELECT id FROM groups WHERE board_id=$1 ORDER BY position LIMIT 1', [boardId]);
      groupId = gr.rows[0]?.id || null;
    }
    return boardId && groupId ? { boardId, groupId } : null;
  }
  return null;
}

/**
 * Check email_received automation rules stored in automations table.
 * First matching rule (ordered by board_id, then rule id) wins.
 */
async function resolveFromKeywordRules(subject, body) {
  const { rows } = await pool.query(
    `SELECT id, board_id, trigger_config, action_config
     FROM automations
     WHERE trigger_type = 'email_received' AND enabled = true
     ORDER BY board_id, id`
  );
  const subjectLower = (subject || '').toLowerCase();
  const bodyLower    = (body    || '').toLowerCase();

  for (const rule of rows) {
    const tcfg = typeof rule.trigger_config === 'string' ? JSON.parse(rule.trigger_config) : (rule.trigger_config || {});
    const acfg = typeof rule.action_config  === 'string' ? JSON.parse(rule.action_config)  : (rule.action_config  || {});
    const keyword    = (tcfg.keyword || '').toLowerCase().trim();
    const matchField = tcfg.match_field || 'subject';
    if (!keyword) continue;

    let matched = false;
    if (matchField === 'subject' || matchField === 'either') matched = subjectLower.includes(keyword);
    if (!matched && (matchField === 'body' || matchField === 'either')) matched = bodyLower.includes(keyword);
    if (!matched) continue;

    const boardId = rule.board_id;
    let groupId   = acfg.group_id ? parseInt(acfg.group_id) : null;
    if (groupId) {
      const gr = await pool.query('SELECT id FROM groups WHERE id=$1 AND board_id=$2', [groupId, boardId]);
      if (!gr.rows.length) groupId = null;
    }
    if (!groupId) {
      const gr = await pool.query('SELECT id FROM groups WHERE board_id=$1 ORDER BY position LIMIT 1', [boardId]);
      groupId = gr.rows[0]?.id || null;
    }
    if (boardId && groupId) {
      console.log(`[EmailPoller] Keyword rule matched: "${keyword}" → board=${boardId} group=${groupId}`);
      return { boardId, groupId };
    }
  }
  return null;
}

/** Fall back to EMAIL_DEFAULT_BOARD_ID / EMAIL_DEFAULT_GROUP_ID from .env */
async function resolveDefault() {
  let boardId = parseInt(process.env.EMAIL_DEFAULT_BOARD_ID) || null;
  let groupId = parseInt(process.env.EMAIL_DEFAULT_GROUP_ID) || null;
  if (boardId) {
    const r = await pool.query('SELECT id FROM boards WHERE id=$1', [boardId]);
    if (!r.rows.length) boardId = null;
  }
  if (!boardId) {
    const r = await pool.query('SELECT id FROM boards ORDER BY id LIMIT 1');
    boardId = r.rows[0]?.id || null;
  }
  if (!boardId) return null;
  if (groupId) {
    const r = await pool.query('SELECT id FROM groups WHERE id=$1 AND board_id=$2', [groupId, boardId]);
    if (!r.rows.length) groupId = null;
  }
  if (!groupId) {
    const r = await pool.query('SELECT id FROM groups WHERE board_id=$1 ORDER BY position LIMIT 1', [boardId]);
    groupId = r.rows[0]?.id || null;
  }
  return boardId && groupId ? { boardId, groupId } : null;
}

function parseSubject(subject) {
  const raw = (subject || 'Untitled').trim();
  const m   = raw.match(/^\[([^\]]+)\]\s*(.*)/);
  return m
    ? { groupName: m[1].trim(), itemName: (m[2].trim() || m[1].trim()) }
    : { groupName: null,        itemName: raw };
}

/**
 * Main handler — { subject, body, fromAddress, fromName, toAddresses }
 * body is plain text used only for keyword matching, not stored.
 */
async function createItemFromEmail({ subject, body, fromAddress, fromName, toAddresses }) {
  let target = await resolveFromAddress(toAddresses);
  if (!target) target = await resolveFromKeywordRules(subject, body);
  if (!target) target = await resolveDefault();
  if (!target) {
    console.warn('[EmailPoller] No valid board/group — skipping:', subject);
    return;
  }
  let { boardId, groupId } = target;

  const { groupName, itemName } = parseSubject(subject);
  if (!itemName) return;

  if (groupName) {
    const r = await pool.query(
      'SELECT id FROM groups WHERE board_id=$1 AND LOWER(name)=LOWER($2) LIMIT 1',
      [boardId, groupName]
    );
    if (r.rows.length) groupId = r.rows[0].id;
  }

  const userRes = await pool.query(
    'SELECT id, name FROM users WHERE LOWER(email)=LOWER($1) LIMIT 1',
    [fromAddress || '']
  );
  const user = userRes.rows[0];

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const posRes = await client.query(
      'SELECT COALESCE(MAX(position),0)+1 AS pos FROM items WHERE group_id=$1',
      [groupId]
    );
    const { rows } = await client.query(
      'INSERT INTO items (group_id, name, position, created_by_user_id, created_by_user_name) VALUES ($1,$2,$3,$4,$5) RETURNING *',
      [groupId, itemName, posRes.rows[0].pos, user?.id || null, user?.name || fromName]
    );
    await client.query(
      `INSERT INTO activity_logs
         (board_id, user_id, user_name, item_id, item_name, action, new_value)
       VALUES ($1,$2,$3,$4,$5,'item_created',$6)`,
      [boardId, user?.id || null, user?.name || fromName,
       rows[0].id, itemName, `via email from ${fromAddress}`]
    );
    await client.query('COMMIT');
    console.log(`[EmailPoller] ✅ "${itemName}"  board=${boardId} group=${groupId}  from=<${fromAddress}>`);
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('[EmailPoller] DB error:', err.message);
  } finally {
    client.release();
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// ① Microsoft Graph API backend
// ─────────────────────────────────────────────────────────────────────────────

let _graphToken       = null;
let _graphTokenExpiry = 0;

async function getGraphToken() {
  // Return cached token if still valid (with 60-second safety margin)
  if (_graphToken && Date.now() < _graphTokenExpiry - 60_000) return _graphToken;

  const tenant = process.env.MICROSOFT_TENANT_ID;
  if (!tenant || tenant === 'common') {
    throw new Error(
      'MICROSOFT_TENANT_ID must be your real tenant GUID or domain (e.g. ddecor.com), not "common"'
    );
  }

  const res = await axios.post(
    `https://login.microsoftonline.com/${tenant}/oauth2/v2.0/token`,
    new URLSearchParams({
      client_id:     process.env.MICROSOFT_CLIENT_ID,
      client_secret: process.env.MICROSOFT_CLIENT_SECRET,
      scope:         'https://graph.microsoft.com/.default',
      grant_type:    'client_credentials',
    }),
    { headers: { 'Content-Type': 'application/x-www-form-urlencoded' } }
  );

  _graphToken       = res.data.access_token;
  _graphTokenExpiry = Date.now() + res.data.expires_in * 1000;
  return _graphToken;
}

async function pollOnceGraph() {
  const mailbox = process.env.EMAIL_M365_MAILBOX;
  const token   = await getGraphToken();

  // Fetch up to 50 unread messages, oldest first
  const res = await axios.get(
    `https://graph.microsoft.com/v1.0/users/${encodeURIComponent(mailbox)}/mailFolders/Inbox/messages`,
    {
      params: {
        '$filter':  'isRead eq false',
        '$select':  'id,subject,from,toRecipients,receivedDateTime,body',
        '$top':     50,
        '$orderby': 'receivedDateTime asc',
      },
      headers: { Authorization: `Bearer ${token}` },
    }
  );

  const messages = res.data.value || [];
  if (messages.length === 0) {
    console.log('[EmailPoller:Graph] No new emails');
    return;
  }

  console.log(`[EmailPoller:Graph] Processing ${messages.length} email(s)…`);
  for (const msg of messages) {
    try {
      const rawBody  = msg.body?.content || '';
      const bodyText = msg.body?.contentType === 'html' ? stripHtml(rawBody) : rawBody;
      await createItemFromEmail({
        subject:     msg.subject,
        body:        bodyText,
        fromAddress: msg.from?.emailAddress?.address || '',
        fromName:    msg.from?.emailAddress?.name    || '',
        toAddresses: (msg.toRecipients || []).map(r => r.emailAddress?.address || ''),
      });

      // Mark as read
      await axios.patch(
        `https://graph.microsoft.com/v1.0/users/${encodeURIComponent(mailbox)}/messages/${msg.id}`,
        { isRead: true },
        { headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' } }
      );
    } catch (err) {
      console.error(`[EmailPoller:Graph] Error on message "${msg.subject}":`, err.message);
    }
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// ② IMAP IDLE backend  (Gmail / any IMAP) — push-based, ~1-3 sec latency
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Fetch and process all unseen messages on an already-open ImapFlow connection.
 * The mailbox lock must already be held by the caller.
 */
async function fetchUnseenImap(imap) {
  const msgs = [];
  for await (const msg of imap.fetch({ unseen: true }, { envelope: true, source: true })) {
    msgs.push({ uid: msg.uid, source: msg.source });
  }
  if (!msgs.length) return;
  console.log(`[EmailPoller:IMAP] Processing ${msgs.length} new email(s)…`);
  for (const { uid, source } of msgs) {
    try {
      const parsed = await simpleParser(source);
      await createItemFromEmail({
        subject:     parsed.subject,
        body:        parsed.text || stripHtml(parsed.html || ''),
        fromAddress: parsed.from?.value?.[0]?.address || '',
        fromName:    parsed.from?.value?.[0]?.name    || '',
        toAddresses: (parsed.to?.value || []).map(a => a.address || ''),
      });
      await imap.messageFlagsAdd({ uid }, ['\\Seen'], { uid: true });
    } catch (err) {
      console.error(`[EmailPoller:IMAP] Error on UID ${uid}:`, err.message);
    }
  }
}

/**
 * Persistent IMAP IDLE loop.
 *
 * How it works:
 *  1. Connect and open INBOX.
 *  2. Fetch any unseen messages that arrived before we connected.
 *  3. Enter IDLE — Gmail holds the connection open and sends an EXISTS
 *     notification the moment a new message arrives (typically < 3 sec).
 *  4. On notification: exit IDLE, fetch unseen, re-enter IDLE.
 *  5. RFC 2177 requires re-issuing IDLE every 29 min — imapflow handles this.
 *  6. On any connection error, wait RECONNECT_DELAY_MS and reconnect.
 */
const RECONNECT_DELAY_MS = 5000;
let _imapStopped = false;
let _imapClient  = null;

async function runImapIdle() {
  while (!_imapStopped) {
    const imap = new ImapFlow({
      host:   process.env.EMAIL_IMAP_HOST || 'imap.gmail.com',
      port:   parseInt(process.env.EMAIL_IMAP_PORT) || 993,
      secure: true,
      auth:   { user: process.env.EMAIL_IMAP_USER, pass: process.env.EMAIL_IMAP_PASS },
      logger: false,
    });
    _imapClient = imap;

    try {
      await imap.connect();
      console.log('[EmailPoller:IMAP] Connected — entering IDLE mode (push)');

      const lock = await imap.getMailboxLock('INBOX');
      try {
        // Process any messages that arrived before we connected
        await fetchUnseenImap(imap);

        // IDLE loop — re-enters IDLE after each notification
        while (!_imapStopped) {
          // idle() resolves when the server sends any notification (new mail,
          // flag change, etc.) or after ~28 min (RFC keep-alive)
          await imap.idle();
          if (_imapStopped) break;
          // Fetch whatever arrived
          await fetchUnseenImap(imap);
          _lastPollAt  = new Date().toISOString();
          _lastPollMsg = 'ok';
        }
      } finally {
        lock.release();
      }
    } catch (err) {
      if (!_imapStopped) {
        console.error(`[EmailPoller:IMAP] Connection lost: ${err.message} — reconnecting in ${RECONNECT_DELAY_MS / 1000}s`);
        _lastPollMsg = err.message;
        await new Promise(r => setTimeout(r, RECONNECT_DELAY_MS));
      }
    } finally {
      await imap.logout().catch(() => {});
      _imapClient = null;
    }
  }
  console.log('[EmailPoller:IMAP] Stopped');
}

// ─────────────────────────────────────────────────────────────────────────────
// Public API
// ─────────────────────────────────────────────────────────────────────────────

let _interval = null;  // used only for Graph polling

function startEmailPoller() {
  const useGraph = !!(
    process.env.EMAIL_M365_MAILBOX &&
    process.env.MICROSOFT_CLIENT_ID &&
    process.env.MICROSOFT_CLIENT_SECRET
  );
  const useImap = !!(process.env.EMAIL_IMAP_USER && process.env.EMAIL_IMAP_PASS);

  if (!useGraph && !useImap) {
    console.log('[EmailPoller] Disabled — configure EMAIL_M365_MAILBOX (M365) or EMAIL_IMAP_USER/PASS (Gmail) to enable');
    return;
  }

  if (useGraph) {
    const mailbox = process.env.EMAIL_M365_MAILBOX;
    console.log(`[EmailPoller] ▶ Started — backend: Microsoft Graph | mailbox: ${mailbox} | poll: ${GRAPH_POLL_INTERVAL_MS / 1000}s`);
    pollOnceGraph().catch(err => console.error('[EmailPoller] Startup poll error:', err.message));
    _interval = setInterval(
      () => pollOnceGraph().catch(err => console.error('[EmailPoller] Poll error:', err.message)),
      GRAPH_POLL_INTERVAL_MS
    );
  } else {
    console.log(`[EmailPoller] ▶ Started — backend: IMAP IDLE (push) | mailbox: ${process.env.EMAIL_IMAP_USER}`);
    _imapStopped = false;
    runImapIdle(); // runs indefinitely in background — no await
  }
}

function stopEmailPoller() {
  if (_interval) { clearInterval(_interval); _interval = null; }
  _imapStopped = true;
  if (_imapClient) { _imapClient.close(); }
}

let _lastPollAt  = null;
let _lastPollMsg = null;

async function triggerPoll() {
  const useGraph = !!(
    process.env.EMAIL_M365_MAILBOX &&
    process.env.MICROSOFT_CLIENT_ID &&
    process.env.MICROSOFT_CLIENT_SECRET
  );
  _lastPollAt = new Date().toISOString();
  try {
    if (useGraph) {
      await pollOnceGraph();
    } else {
      // For IMAP IDLE, notify the idle connection to wake up and re-fetch.
      // If somehow not connected yet, do a one-shot fetch.
      if (_imapClient) {
        _imapClient.idleNotify(); // breaks out of current IDLE → triggers fetchUnseenImap
      } else {
        // Fallback: one-shot fetch
        const imap = new ImapFlow({
          host: process.env.EMAIL_IMAP_HOST || 'imap.gmail.com',
          port: parseInt(process.env.EMAIL_IMAP_PORT) || 993,
          secure: true,
          auth: { user: process.env.EMAIL_IMAP_USER, pass: process.env.EMAIL_IMAP_PASS },
          logger: false,
        });
        try {
          await imap.connect();
          const lock = await imap.getMailboxLock('INBOX');
          try { await fetchUnseenImap(imap); } finally { lock.release(); }
        } finally { await imap.logout().catch(() => {}); }
      }
    }
    _lastPollMsg = 'ok';
  } catch (err) {
    _lastPollMsg = err.message;
    throw err;
  }
}

function getPollerStatus() {
  const useGraph = !!(
    process.env.EMAIL_M365_MAILBOX &&
    process.env.MICROSOFT_CLIENT_ID &&
    process.env.MICROSOFT_CLIENT_SECRET
  );
  const useImap = !!(process.env.EMAIL_IMAP_USER && process.env.EMAIL_IMAP_PASS);
  const imapConnected = !!(useImap && _imapClient);

  return {
    enabled:        useGraph || useImap,
    mode:           useGraph ? 'graph' : useImap ? 'imap-idle' : null,
    mailbox:        useGraph ? process.env.EMAIL_M365_MAILBOX : (process.env.EMAIL_IMAP_USER || null),
    intervalMin:    useGraph ? GRAPH_POLL_INTERVAL_MS / 60000 : null, // null = push mode
    running:        useGraph ? _interval !== null : imapConnected,
    lastPollAt:     _lastPollAt,
    lastPollMsg:    _lastPollMsg,
    defaultBoardId: parseInt(process.env.EMAIL_DEFAULT_BOARD_ID) || null,
    defaultGroupId: parseInt(process.env.EMAIL_DEFAULT_GROUP_ID) || null,
  };
}

module.exports = { startEmailPoller, stopEmailPoller, triggerPoll, getPollerStatus };
