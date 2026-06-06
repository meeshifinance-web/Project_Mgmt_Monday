/**
 * assignmentEmail.js
 *
 * Sends a "you've been assigned" email when a user is newly added to a
 * person-type column on any board item.
 *
 * Triggered from routes/columnValues.js after a successful column_values
 * upsert, fire-and-forget (never blocks the save).
 *
 * Kill switch:   NOTIFY_ON_ASSIGN=false   (defaults to true)
 * From address:  EMAIL_FROM env (simplix@simplixart.com)
 */

const nodemailer = require('nodemailer');
const pool = require('../db');
const {
  escapeHtml,
  formatDueDate,
  avatarHtml,
  statusBadgeHtml,
  dueDateChipHtml,
  renderEmailShell,
  renderPlainText,
} = require('./emailTemplate');

// People are stored as {id,name} objects (legacy: name strings). Return entries
// so we can diff by stable identity (id) and resolve recipients precisely.
function parseOwnerEntries(val) {
  if (!val) return [];
  let arr;
  try { arr = JSON.parse(val); } catch { return String(val).trim() ? [{ id: null, name: String(val).trim() }] : []; }
  if (!Array.isArray(arr)) arr = arr ? [arr] : [];
  return arr.map(e => (e && typeof e === 'object') ? { id: e.id ?? null, name: e.name || '' } : { id: null, name: String(e) })
            .filter(e => e.name || e.id != null);
}
const ownerKey = (e) => (e.id != null ? `id:${e.id}` : `nm:${e.name}`);

function getTransporter() {
  if (!process.env.EMAIL_HOST || !process.env.EMAIL_USER) return null;
  const port = parseInt(process.env.EMAIL_PORT) || 587;
  return nodemailer.createTransport({
    host:       process.env.EMAIL_HOST,
    port,
    secure:     port === 465,
    requireTLS: port !== 465,
    auth:       { user: process.env.EMAIL_USER, pass: process.env.EMAIL_PASS },
    tls:        { rejectUnauthorized: false },
  });
}

// Look up the brand color configured for a status option, so the badge in
// the email matches what users see in the app. Falls back to a neutral grey.
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
  } catch (_) { /* non-fatal — fall back to default badge color */ }
  return null;
}

/**
 * Main entry — call after a person-column column_values upsert.
 * Fire-and-forget: caller should NOT await if the save path is latency-sensitive.
 *
 * @param {object} opts
 * @param {string|null} opts.oldValue    — previous column_values.value (raw string)
 * @param {string|null} opts.newValue    — new column_values.value (raw string)
 * @param {number} opts.itemId
 * @param {number} opts.boardId
 * @param {object} opts.actor            — { id, name } (the user who assigned)
 */
async function notifyNewAssignees({ oldValue, newValue, itemId, boardId, actor }) {
  if (String(process.env.NOTIFY_ON_ASSIGN || 'true').toLowerCase() === 'false') {
    console.log(`[AssignEmail] skipped — NOTIFY_ON_ASSIGN is off (item ${itemId})`);
    return;
  }

  const transporter = getTransporter();
  if (!transporter) {
    console.log('[AssignEmail] SMTP not configured — skipping');
    return;
  }

  const oldKeys = new Set(parseOwnerEntries(oldValue).map(ownerKey));
  const added = parseOwnerEntries(newValue).filter(e => !oldKeys.has(ownerKey(e)));
  if (!added.length) {
    console.log(`[AssignEmail] skipped — no newly-added owner on item ${itemId} (assignee was already on the item, or the person column was cleared)`);
    return;
  }

  try {
    // Resolve newly-added owners to users — by stable id when present, else by
    // name (legacy). Email-matching this way means renamed users still notify.
    const addedIds = added.filter(e => e.id != null).map(e => e.id);
    const addedNames = added.filter(e => e.id == null).map(e => e.name);
    const userRes = await pool.query(
      `SELECT id, name, email FROM users
        WHERE (id = ANY($1) OR name = ANY($2))
          AND email IS NOT NULL AND email <> '' AND is_active = true`,
      [addedIds, addedNames]
    );
    const recipients = userRes.rows;
    if (!recipients.length) {
      // The assignee(s) didn't resolve to an emailable user. Spell out who was
      // attempted so the cause is obvious: free-typed name, inactive user, or
      // a user with no email on file.
      const attempted = added.map(e => e.name || `id:${e.id}`).join(', ');
      console.log(`[AssignEmail] skipped — newly-added owner(s) [${attempted}] did not match any active user with an email on file (item ${itemId}). Check the user exists, is active, and has an email.`);
      return;
    }

    // Fetch item + board + group context
    const ctxRes = await pool.query(
      `SELECT i.name AS item_name, g.name AS group_name, b.name AS board_name
         FROM items i
         JOIN groups g ON g.id = i.group_id
         JOIN boards b ON b.id = g.board_id
        WHERE i.id = $1`,
      [itemId]
    );
    const ctx = ctxRes.rows[0] || {};

    // Pull optional status + due date (first status / date column that has a value)
    const extrasRes = await pool.query(
      `SELECT c.type, cv.value
         FROM column_values cv
         JOIN columns c ON c.id = cv.column_id
        WHERE cv.item_id = $1 AND c.type IN ('status','date')
          AND cv.value IS NOT NULL AND cv.value <> ''`,
      [itemId]
    );
    const status  = extrasRes.rows.find(r => r.type === 'status')?.value || '';
    const dueDate = extrasRes.rows.find(r => r.type === 'date')?.value || '';
    const statusColor = await lookupStatusColor(boardId, status);
    const dueInfo = formatDueDate(dueDate);

    const appUrl = (process.env.FRONTEND_URL || 'http://localhost:5173').replace(/\/$/, '');
    const itemUrl = `${appUrl}/board/${boardId}?item=${itemId}`;
    const fromAddr = process.env.EMAIL_FROM || process.env.EMAIL_USER;
    const from = process.env.EMAIL_FROM_NAME ? `${process.env.EMAIL_FROM_NAME} <${fromAddr}>` : fromAddr;
    const actorName = actor?.name || 'Someone on your team';
    const itemName = ctx.item_name || '(Untitled task)';
    const boardName = ctx.board_name || '';
    const groupName = ctx.group_name || '';

    for (const rcpt of recipients) {
      // Build the contextual fact rows. We only show fields that have values
      // so the card looks clean — empty rows feel unfinished in email clients.
      const facts = [];
      if (status) {
        facts.push({
          label: 'Status',
          valueHtml: statusBadgeHtml(status, statusColor),
          valueText: status,
        });
      }
      if (dueInfo) {
        facts.push({
          label: 'Due',
          valueHtml: dueDateChipHtml(dueInfo),
          valueText: dueInfo.relative ? `${dueInfo.absolute} (${dueInfo.relative})` : dueInfo.absolute,
        });
      }
      facts.push({
        label: 'Assigned by',
        valueHtml: `${avatarHtml(actorName, { size: 22 })} <span style="vertical-align:middle;margin-left:6px">${escapeHtml(actorName)}</span>`,
        valueText: actorName,
      });

      const breadcrumbHtml = [boardName, groupName].filter(Boolean).map(escapeHtml).join(' &nbsp;&rsaquo;&nbsp; ');
      const introHtml =
        `${avatarHtml(actorName, { size: 28 })} ` +
        `<span style="vertical-align:middle;margin-left:8px">` +
        `<strong style="color:#172b4d">${escapeHtml(actorName)}</strong> assigned you to a task. ` +
        `Take a quick look when you have a moment.` +
        `</span>`;

      const subjectBits = [`📋 You've been assigned: ${itemName}`];
      if (dueInfo?.relative) subjectBits.push(`(${dueInfo.relative})`);
      const subject = subjectBits.join(' ');
      const preheader = `${actorName} added you as an owner${dueInfo ? ` — due ${dueInfo.relative || dueInfo.absolute}` : ''}.`;

      const html = renderEmailShell({
        preheader,
        heading: "You've been assigned a new task",
        greeting: rcpt.name.split(/\s+/)[0] || rcpt.name,
        introHtml,
        itemName,
        breadcrumbHtml,
        facts,
        ctaUrl:   itemUrl,
        ctaLabel: 'Open task',
        footerNote: `You're getting this because ${actorName} added you as an owner on this task. To stop these, ask your admin to disable assignment notifications.`,
      });

      const text = renderPlainText({
        heading: "You've been assigned a new task on Simplix",
        greeting: rcpt.name.split(/\s+/)[0] || rcpt.name,
        introText: `${actorName} added you as an owner. Take a quick look when you have a moment.`,
        itemName,
        facts,
        ctaUrl: itemUrl,
        ctaLabel: 'Open task',
        footerNote: 'You are receiving this because you were assigned to this task.',
      });

      try {
        await transporter.sendMail({ from, to: rcpt.email, subject, html, text });

        // Record in item_emails so it surfaces in the item's Updates tab
        try {
          await pool.query(
            `INSERT INTO item_emails
               (item_id, board_id, direction, from_address, from_name, to_address, subject, body_text)
             VALUES ($1,$2,'outgoing',$3,$4,$5,$6,$7)`,
            [itemId, boardId, from, 'Simplix', rcpt.email, subject, `Assignment notification to ${rcpt.name}`]
          );
        } catch (_) { /* non-fatal */ }

        console.log(`[AssignEmail] ✅ Sent to <${rcpt.email}> for item ${itemId}`);
      } catch (sendErr) {
        console.error(`[AssignEmail] ❌ Send to <${rcpt.email}> failed:`, sendErr.message);
      }
    }
  } catch (err) {
    console.error('[AssignEmail] error:', err.message);
  }
}

module.exports = { notifyNewAssignees };
