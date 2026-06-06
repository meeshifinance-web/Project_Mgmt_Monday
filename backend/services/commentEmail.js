/**
 * commentEmail.js
 *
 * Sends an email when a user is @mentioned in a comment, or when someone
 * replies to their comment. Previously these only produced an in-app bell
 * notification — no email was ever sent, so users who weren't actively
 * looking at the app missed them.
 *
 * Triggered from routes/comments.js after the comment + notifications are
 * persisted, fire-and-forget (never blocks the POST response).
 *
 * Kill switch:   NOTIFY_ON_MENTION=false   (defaults to true)
 * From address:  EMAIL_FROM env (falls back to EMAIL_USER)
 */

const nodemailer = require('nodemailer');
const pool = require('../db');
const {
  escapeHtml,
  avatarHtml,
  renderEmailShell,
  renderPlainText,
} = require('./emailTemplate');

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

/**
 * @param {object} opts
 * @param {Array}  opts.recipients   [{ id, name, email, reason: 'mention'|'reply' }]
 * @param {string} opts.actorName
 * @param {number} opts.itemId
 * @param {number} opts.boardId
 * @param {string} opts.itemName
 * @param {string} opts.boardName
 * @param {string} opts.groupName
 * @param {string} opts.commentBody
 */
async function notifyCommentRecipients(opts) {
  if (String(process.env.NOTIFY_ON_MENTION || 'true').toLowerCase() === 'false') return;

  const { recipients = [], actorName = 'Someone', itemId, boardId,
          itemName = '(Untitled task)', boardName = '', groupName = '', commentBody = '' } = opts;
  if (!recipients.length) return;

  const transporter = getTransporter();
  if (!transporter) {
    console.log(`[CommentEmail] SMTP not configured — skipping ${recipients.length} mention/reply email(s)`);
    return;
  }

  const fromAddr = process.env.EMAIL_FROM || process.env.EMAIL_USER;
  const from = process.env.EMAIL_FROM_NAME ? `${process.env.EMAIL_FROM_NAME} <${fromAddr}>` : fromAddr;
  const appUrl = (process.env.FRONTEND_URL || 'http://localhost:5173').replace(/\/$/, '');
  const itemUrl = `${appUrl}/board/${boardId}?item=${itemId}`;
  const breadcrumbHtml = [boardName, groupName].filter(Boolean).map(escapeHtml).join(' &nbsp;&rsaquo;&nbsp; ');
  const safeBody = escapeHtml(commentBody || '').replace(/\n/g, '<br>');
  const quoteHtml = safeBody
    ? `<div style="border-left:3px solid #9b72f5;padding:6px 12px;margin-top:6px;color:#42526e;font-size:14px;line-height:1.6;background:#fbf9ff;border-radius:0 8px 8px 0">${safeBody}</div>`
    : '';

  for (const r of recipients) {
    if (!r.email) continue;
    const isReply = r.reason === 'reply';
    const verb = isReply ? 'replied to your comment on' : 'mentioned you in';
    const heading = isReply ? 'New reply to your comment' : 'You were mentioned';
    const subject = `💬 ${actorName} ${verb} ${itemName}`;

    const introHtml =
      `${avatarHtml(actorName, { size: 28 })} ` +
      `<span style="vertical-align:middle;margin-left:8px">` +
      `<strong style="color:#172b4d">${escapeHtml(actorName)}</strong> ${verb} this item.` +
      `</span>`;

    const html = renderEmailShell({
      preheader: `${actorName} ${verb} "${itemName}"`,
      heading,
      greeting: (r.name || '').split(/\s+/)[0] || r.name || '',
      introHtml,
      itemName,
      breadcrumbHtml,
      extraHtml: quoteHtml,
      ctaUrl: itemUrl,
      ctaLabel: 'View & reply',
      footerNote: `You received this because ${actorName} ${verb} a comment on this task in Simplix.`,
    });

    const text = renderPlainText({
      heading,
      greeting: (r.name || '').split(/\s+/)[0] || r.name || '',
      introText: `${actorName} ${verb} "${itemName}".`,
      itemName,
      extraText: commentBody,
      ctaUrl: itemUrl,
      ctaLabel: 'View & reply',
      footerNote: 'You are receiving this because you were mentioned or replied to on Simplix.',
    });

    try {
      await transporter.sendMail({ from, to: r.email, subject, html, text });
      // Record outgoing so it shows in the item's Updates tab
      try {
        await pool.query(
          `INSERT INTO item_emails
             (item_id, board_id, direction, from_address, from_name, to_address, subject, body_text)
           VALUES ($1,$2,'outgoing',$3,'Simplix',$4,$5,$6)`,
          [itemId, boardId, from, r.email, subject, commentBody]
        );
      } catch (_) { /* non-fatal */ }
      console.log(`[CommentEmail] ✅ ${r.reason} email sent to <${r.email}> for item ${itemId}`);
    } catch (sendErr) {
      console.error(`[CommentEmail] ❌ Send to <${r.email}> failed:`, sendErr.message);
    }
  }
}

module.exports = { notifyCommentRecipients };
