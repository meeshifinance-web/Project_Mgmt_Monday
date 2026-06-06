/**
 * automationEmail.js
 *
 * Resolves board-item placeholder variables and sends emails for
 * "send_email" automation actions via server-side SMTP (nodemailer).
 *
 * Supported variables in subject / body:
 *   {Item Name}   — the item's name
 *   {Group Name}  — the group the item belongs to
 *   {Board Name}  — the board name
 *   {<ColTitle>}  — value of any column (e.g. {Status}, {Owner}, {Due Date})
 *
 * Recipient (to_type) options:
 *   "specific"      — static email address(es) in the `to` field
 *   "item_owner"    — email(s) of user(s) assigned in a person column
 *   "email_column"  — value of a text/email column on the item
 *   "board_members" — all members of the board
 *
 * From address priority:
 *   1. board.email_from  (per-board setting)
 *   2. EMAIL_FROM env var (system-wide display name / address)
 *   3. EMAIL_USER env var (SMTP login, fallback)
 */

const nodemailer = require('nodemailer');
const pool = require('../db');
const {
  escapeHtml,
  formatDueDate,
  statusBadgeHtml,
  dueDateChipHtml,
  renderEmailShell,
  renderPlainText,
} = require('./emailTemplate');

// Look up the configured color for a status option so the email badge matches
// the one users see in the app. Falls back to neutral grey on miss.
async function lookupStatusColor(boardId, statusValue) {
  if (!statusValue) return null;
  try {
    const res = await pool.query(
      `SELECT settings FROM columns WHERE board_id=$1 AND type='status'`,
      [boardId]
    );
    for (const row of res.rows) {
      const s = typeof row.settings === 'string' ? JSON.parse(row.settings) : (row.settings || {});
      const opts = Array.isArray(s.options) ? s.options : [];
      const match = opts.find(o => String(o.label || '').toLowerCase() === String(statusValue).toLowerCase());
      if (match && match.color) return match.color;
    }
  } catch (_) { /* non-fatal */ }
  return null;
}

function escapeRegex(str) {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Replace all {Placeholder} tokens in a template string.
 * @param {string} template
 * @param {{ itemName, groupName, boardName, columns: Array<{id,title}>, values: Record<id,string> }} ctx
 */
function resolvePlaceholders(template, ctx) {
  let result = template || '';
  const { itemName = '', groupName = '', boardName = '', columns = [], values = {} } = ctx;

  result = result.replace(/\{item\s*name\}/gi, itemName);
  result = result.replace(/\{group\s*name\}/gi, groupName);
  result = result.replace(/\{board\s*name\}/gi, boardName);

  for (const col of columns) {
    const pattern = new RegExp(`\\{${escapeRegex(col.title)}\\}`, 'gi');
    result = result.replace(pattern, values[col.id] || '');
  }
  return result;
}

/**
 * Resolve the actual recipient email address(es) based on to_type.
 * Returns a comma-separated string of email addresses, or '' if none found.
 */
async function resolveRecipients({ boardId, itemId, to, toType, toColumnId }) {
  const type = toType || 'specific';

  if (type === 'specific') {
    return to || '';
  }

  if (type === 'board_members') {
    const res = await pool.query(
      `SELECT u.email FROM board_members bm
       JOIN users u ON u.id = bm.user_id
       WHERE bm.board_id = $1 AND u.email IS NOT NULL AND u.email <> ''`,
      [boardId]
    );
    return res.rows.map(r => r.email).join(', ');
  }

  if (type === 'email_column') {
    if (!toColumnId) return '';
    const res = await pool.query(
      'SELECT value FROM column_values WHERE item_id=$1 AND column_id=$2',
      [itemId, toColumnId]
    );
    return res.rows[0]?.value || '';
  }

  if (type === 'item_owner') {
    if (!toColumnId) return '';
    const valRes = await pool.query(
      'SELECT value FROM column_values WHERE item_id=$1 AND column_id=$2',
      [itemId, toColumnId]
    );
    const raw = valRes.rows[0]?.value || '';
    let names = [];
    try {
      const p = JSON.parse(raw);
      names = Array.isArray(p) ? p : (p ? [String(p)] : []);
    } catch {
      names = raw.trim() ? [raw.trim()] : [];
    }
    if (!names.length) return '';
    const userRes = await pool.query(
      "SELECT email FROM users WHERE name = ANY($1) AND email IS NOT NULL AND email <> ''",
      [names]
    );
    return userRes.rows.map(r => r.email).join(', ');
  }

  return to || '';
}

/**
 * Send an automation email for a specific board item.
 * Fetches item context from DB, resolves placeholders, then sends via SMTP.
 *
 * @param {object} opts
 * @param {number} opts.boardId
 * @param {number} opts.itemId
 * @param {string} [opts.to]          — static recipient(s), used when toType='specific'
 * @param {string} [opts.toType]      — 'specific' | 'item_owner' | 'email_column' | 'board_members'
 * @param {number} [opts.toColumnId]  — column id for item_owner / email_column types
 * @param {string} opts.subject       — template with optional {tokens}
 * @param {string} opts.body          — template with optional {tokens}
 */
async function sendAutomationEmail({ boardId, itemId, to, toType, toColumnId, subject, body }) {
  if (!process.env.EMAIL_HOST || !process.env.EMAIL_USER) {
    console.log(`[AutomationEmail] SMTP not configured — skipping send_email`);
    return;
  }

  const rawResolvedTo = await resolveRecipients({ boardId, itemId, to, toType, toColumnId });

  // Keep only well-formed, de-duplicated addresses. Previously a typo in the
  // "specific" field (or a non-email value in a text column used as the
  // recipient) was passed straight to the SMTP server, which then threw.
  const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  const seenAddr = new Set();
  const resolvedTo = String(rawResolvedTo || '')
    .split(',')
    .map(a => a.trim())
    .filter(a => EMAIL_RE.test(a) && !seenAddr.has(a.toLowerCase()) && seenAddr.add(a.toLowerCase()))
    .join(', ');

  if (!resolvedTo) {
    console.log(`[AutomationEmail] No valid recipient resolved (to_type=${toType || 'specific'}, raw="${rawResolvedTo}") — skipping`);
    return;
  }

  try {
    // 1. Board name + per-board email_from
    const boardRes = await pool.query('SELECT name, email_from FROM boards WHERE id=$1', [boardId]);
    const board = boardRes.rows[0] || {};

    // 2. Item name + group name
    const itemRes = await pool.query(
      `SELECT i.name AS item_name, g.name AS group_name
       FROM items i JOIN groups g ON g.id = i.group_id
       WHERE i.id = $1`,
      [itemId]
    );
    const item = itemRes.rows[0] || { item_name: '', group_name: '' };

    // 3. Column definitions + column values for this item
    const colRes = await pool.query('SELECT id, title FROM columns WHERE board_id=$1', [boardId]);
    const valRes = await pool.query('SELECT column_id, value FROM column_values WHERE item_id=$1', [itemId]);
    const values = {};
    for (const v of valRes.rows) values[v.column_id] = v.value;

    const ctx = {
      itemName:  item.item_name,
      groupName: item.group_name,
      boardName: board.name || '',
      columns:   colRes.rows,
      values,
    };

    const resolvedSubject = resolvePlaceholders(subject, ctx);
    const resolvedBody    = resolvePlaceholders(body, ctx);

    // 4. Determine "from" address — prefix the configured display name
    //    (EMAIL_FROM_NAME) so recipients see e.g. "SIMPLIX <simplix@…>".
    const fromAddr = board.email_from || process.env.EMAIL_FROM || process.env.EMAIL_USER;
    const from = process.env.EMAIL_FROM_NAME ? `${process.env.EMAIL_FROM_NAME} <${fromAddr}>` : fromAddr;

    // 5. Send
    const port = parseInt(process.env.EMAIL_PORT) || 587;
    const transporter = nodemailer.createTransport({
      host:       process.env.EMAIL_HOST,
      port,
      secure:     port === 465,        // true only for SSL (465), not STARTTLS (587)
      requireTLS: port !== 465,        // force STARTTLS on 587 — required by Office 365
      auth:       { user: process.env.EMAIL_USER, pass: process.env.EMAIL_PASS },
      tls:        { rejectUnauthorized: false },
    });

    // Build the same item card the assignment email uses (status badge, due
    // date chip, breadcrumb) and embed the user-authored body underneath as
    // the message itself. Result: every automation email feels on-brand and
    // gives the recipient one-click access to the task.
    const statusVal = (() => {
      const col = colRes.rows.find(c => /status/i.test(c.title));
      return col ? values[col.id] || '' : '';
    })();
    const dueVal = (() => {
      // Pick the first date column with a value
      for (const c of colRes.rows) {
        if (/due|date/i.test(c.title) && values[c.id]) return values[c.id];
      }
      return '';
    })();
    const statusColor = await lookupStatusColor(boardId, statusVal);
    const dueInfo     = formatDueDate(dueVal);

    const facts = [];
    if (statusVal) facts.push({
      label: 'Status',
      valueHtml: statusBadgeHtml(statusVal, statusColor),
      valueText: statusVal,
    });
    if (dueInfo) facts.push({
      label: 'Due',
      valueHtml: dueDateChipHtml(dueInfo),
      valueText: dueInfo.relative ? `${dueInfo.absolute} (${dueInfo.relative})` : dueInfo.absolute,
    });

    const breadcrumbHtml = [board.name, item.group_name].filter(Boolean).map(escapeHtml).join(' &nbsp;&rsaquo;&nbsp; ');
    const appUrl  = (process.env.FRONTEND_URL || 'http://localhost:5173').replace(/\/$/, '');
    const itemUrl = `${appUrl}/board/${boardId}?item=${itemId}`;

    // User body becomes the "extraHtml" block — preserve their line breaks
    // but escape their text so any < > or & in plain content renders correctly.
    const escapedBody = escapeHtml(resolvedBody || '').replace(/\n/g, '<br>');
    const extraHtml = escapedBody
      ? `<div style="white-space:normal;font-size:14px;line-height:1.6;color:#42526e">${escapedBody}</div>`
      : '';

    const html = renderEmailShell({
      preheader: (resolvedSubject || resolvedBody || '').slice(0, 110),
      heading: resolvedSubject || 'Update from Simplix',
      itemName: item.item_name || '',
      breadcrumbHtml,
      facts,
      extraHtml,
      ctaUrl: itemUrl,
      ctaLabel: 'View task',
      footerNote: 'This message was triggered automatically by a workflow rule on this board.',
    });

    const text = renderPlainText({
      heading: resolvedSubject || 'Update from Simplix',
      itemName: item.item_name || '',
      extraText: resolvedBody || '',
      facts,
      ctaUrl: itemUrl,
      ctaLabel: 'View task',
      footerNote: 'Sent automatically by a Simplix automation rule.',
    });

    await transporter.sendMail({
      from,
      to: resolvedTo,
      subject: resolvedSubject || '(No subject)',
      text,
      html,
    });

    // Store the outgoing email so it appears in the item's Updates tab
    await pool.query(
      `INSERT INTO item_emails
         (item_id, board_id, direction, from_address, to_address, subject, body_text)
       VALUES ($1,$2,'outgoing',$3,$4,$5,$6)`,
      [itemId, boardId, from, resolvedTo, resolvedSubject || '', resolvedBody || '']
    );

    console.log(`[AutomationEmail] ✅ Sent to <${resolvedTo}> | subject: "${resolvedSubject}"`);
  } catch (err) {
    console.error('[AutomationEmail] ❌ Send error:', err.message);
    if (err.code) console.error('[AutomationEmail]    Code:', err.code);
    if (err.response) console.error('[AutomationEmail]    SMTP response:', err.response);
  }
}

module.exports = { sendAutomationEmail, resolvePlaceholders };
