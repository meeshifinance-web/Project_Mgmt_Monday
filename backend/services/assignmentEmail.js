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
 * From address:  EMAIL_FROM env (tuesday@ddecor.com)
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

function parseOwners(val) {
  if (!val) return [];
  try {
    const p = JSON.parse(val);
    return Array.isArray(p) ? p.map(String) : p ? [String(p)] : [];
  } catch {
    return val.trim() ? [val.trim()] : [];
  }
}

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
  if (String(process.env.NOTIFY_ON_ASSIGN || 'true').toLowerCase() === 'false') return;

  const transporter = getTransporter();
  if (!transporter) {
    console.log('[AssignEmail] SMTP not configured — skipping');
    return;
  }

  const oldNames = new Set(parseOwners(oldValue));
  const newNames = parseOwners(newValue);
  const addedNames = newNames.filter(n => !oldNames.has(n));
  if (!addedNames.length) return;

  try {
    // Look up users by name (matches how person column stores values)
    const userRes = await pool.query(
      `SELECT id, name, email FROM users
        WHERE name = ANY($1) AND email IS NOT NULL AND email <> '' AND is_active = true`,
      [addedNames]
    );
    const recipients = userRes.rows;
    if (!recipients.length) return;

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
    const from = process.env.EMAIL_FROM || process.env.EMAIL_USER;
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
        heading: "You've been assigned a new task on Tuesday.com",
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
            [itemId, boardId, from, 'Tuesday.com', rcpt.email, subject, `Assignment notification to ${rcpt.name}`]
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
