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

function escapeHtml(s) {
  return String(s ?? '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

function buildHtml({ assigneeName, actorName, itemName, boardName, groupName, status, dueDate, itemUrl }) {
  const rows = [
    ['Board', boardName],
    ['Group', groupName],
    status   ? ['Status', status]     : null,
    dueDate  ? ['Due Date', dueDate]  : null,
  ].filter(Boolean).map(([k, v]) =>
    `<tr>
       <td style="padding:6px 12px;color:#676879;font-size:13px;width:90px">${escapeHtml(k)}</td>
       <td style="padding:6px 12px;color:#323338;font-size:14px;font-weight:500">${escapeHtml(v)}</td>
     </tr>`
  ).join('');

  return `
<!DOCTYPE html>
<html>
<body style="margin:0;padding:0;background:#f6f7fb;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif">
  <div style="max-width:560px;margin:0 auto;padding:32px 16px">
    <div style="text-align:center;margin-bottom:24px">
      <div style="display:inline-block;background:#0073ea;color:#fff;padding:8px 16px;border-radius:6px;font-weight:700;letter-spacing:0.5px;font-size:14px">TUESDAY.COM</div>
    </div>

    <div style="background:#fff;border-radius:12px;box-shadow:0 2px 12px rgba(0,0,0,0.06);overflow:hidden">
      <div style="padding:28px 28px 8px">
        <p style="margin:0 0 6px;color:#323338;font-size:16px">Hi ${escapeHtml(assigneeName)},</p>
        <p style="margin:0 0 20px;color:#676879;font-size:14px;line-height:1.5">
          <strong style="color:#323338">${escapeHtml(actorName)}</strong> assigned you to a new task on Tuesday.
        </p>
      </div>

      <div style="margin:0 28px;border:1px solid #e6e9ef;border-radius:8px;overflow:hidden">
        <div style="background:#f6f7fb;padding:14px 16px;border-bottom:1px solid #e6e9ef">
          <div style="color:#323338;font-size:16px;font-weight:600;line-height:1.3">${escapeHtml(itemName)}</div>
        </div>
        <table style="width:100%;border-collapse:collapse">${rows}</table>
      </div>

      <div style="padding:24px 28px;text-align:center">
        <a href="${escapeHtml(itemUrl)}" style="display:inline-block;padding:12px 28px;background:#0073ea;color:#fff;border-radius:6px;text-decoration:none;font-weight:600;font-size:14px">Open in Tuesday</a>
      </div>

      <div style="padding:16px 28px;border-top:1px solid #f0f1f5;color:#aab;font-size:12px;text-align:center">
        You received this because you were assigned an owner on this task.
      </div>
    </div>

    <p style="margin:20px 0 0;color:#aab;font-size:11px;text-align:center">
      D'Decor Home Fabrics Pvt. Ltd.
    </p>
  </div>
</body>
</html>`;
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

    const appUrl = (process.env.FRONTEND_URL || 'http://localhost:5173').replace(/\/$/, '');
    const itemUrl = `${appUrl}/board/${boardId}?item=${itemId}`;
    const from = process.env.EMAIL_FROM || process.env.EMAIL_USER;
    const actorName = actor?.name || 'Someone';

    for (const rcpt of recipients) {
      const html = buildHtml({
        assigneeName: rcpt.name,
        actorName,
        itemName:  ctx.item_name  || '(Untitled task)',
        boardName: ctx.board_name || '',
        groupName: ctx.group_name || '',
        status,
        dueDate,
        itemUrl,
      });
      const subject = `You've been assigned: ${ctx.item_name || 'a task'}`;

      try {
        await transporter.sendMail({
          from,
          to: rcpt.email,
          subject,
          html,
          text: `Hi ${rcpt.name},\n\n${actorName} assigned you to "${ctx.item_name || 'a task'}" on board "${ctx.board_name || ''}".\n\nOpen: ${itemUrl}\n\n— Tuesday.com (D'Decor)`,
        });

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
