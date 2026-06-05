/**
 * Rigorous email-system test. Stubs nodemailer so no real mail is sent, then
 * drives every outbound path against the live DB and asserts the right people
 * get the right message.  Run:  node backend/scripts/email-rigorous.js
 */
require('dotenv').config();
// Dummy SMTP so getTransporter() builds a transport (we stub the actual send).
process.env.EMAIL_HOST = 'smtp.test.local';
process.env.EMAIL_PORT = '587';
process.env.EMAIL_USER = 'bot@simplixart.test';
process.env.EMAIL_PASS = 'x';
process.env.EMAIL_FROM = 'Simplix <bot@simplixart.test>';

// ── Capture every outgoing message ──────────────────────────────────────────
const nodemailer = require('nodemailer');
let SENT = [];
nodemailer.createTransport = () => ({
  sendMail: async (msg) => { SENT.push(msg); return { messageId: 'stub-' + SENT.length }; },
  verify: async () => true,
});

const pool = require('../db');
const { notifyCommentRecipients } = require('../services/commentEmail');
const { notifyNewAssignees } = require('../services/assignmentEmail');
const { sendAutomationEmail } = require('../services/automationEmail');

let pass = 0, fail = 0;
const ck = (n, c, d = '') => { if (c) { pass++; console.log('  ✅', n); } else { fail++; console.log('  ❌', n, d); } };
const reset = () => { SENT = []; };
const flat = (m) => `${m.to} | ${m.subject} | ${m.html || ''}`;

async function main() {
  const b = (await pool.query("SELECT id FROM boards WHERE name='Sales CRM Pipeline'")).rows[0].id;
  const itemRow = (await pool.query(
    "SELECT i.id, i.name FROM items i JOIN groups g ON g.id=i.group_id WHERE g.board_id=$1 ORDER BY i.id LIMIT 1", [b])).rows[0];
  const itemId = itemRow.id, itemName = itemRow.name;
  const emailOf = async (name) => (await pool.query('SELECT email FROM users WHERE name=$1', [name])).rows[0]?.email;
  const nehaEmail = await emailOf('Neha Gupta');
  const poojaEmail = await emailOf('Pooja Mehta');
  const minId = (await pool.query('SELECT COALESCE(MAX(id),0) m FROM item_emails')).rows[0].m;

  console.log(`Board=${b} item=${itemId} "${itemName}"`);

  // ── 1. @mention email ──
  console.log('\n[1] @mention email');
  reset();
  await notifyCommentRecipients({
    recipients: [{ id: 20, name: 'Neha Gupta', email: nehaEmail, reason: 'mention' }],
    actorName: 'Admin', itemId, boardId: b, itemName, boardName: 'Sales CRM Pipeline',
    groupName: 'Leads', commentBody: 'please review this @Neha',
  });
  ck('exactly one mention email sent', SENT.length === 1, `got ${SENT.length}`);
  ck('addressed to the mentioned user', SENT[0]?.to === nehaEmail, SENT[0]?.to);
  ck('subject says "mentioned you in"', /mentioned you in/i.test(SENT[0]?.subject || ''), SENT[0]?.subject);
  ck('body contains the comment text', (SENT[0]?.html || '').includes('please review this'));
  ck('has plaintext + html parts', !!SENT[0]?.text && !!SENT[0]?.html);

  // ── 2. reply email ──
  console.log('\n[2] reply email');
  reset();
  await notifyCommentRecipients({
    recipients: [{ id: 20, name: 'Neha Gupta', email: nehaEmail, reason: 'reply' }],
    actorName: 'Admin', itemId, boardId: b, itemName, boardName: 'Sales CRM Pipeline', groupName: 'Leads',
    commentBody: 'thanks!',
  });
  ck('reply email sent', SENT.length === 1);
  ck('subject says "replied to your comment"', /replied to your comment/i.test(SENT[0]?.subject || ''), SENT[0]?.subject);

  // ── 3. XSS / HTML escaping ──
  console.log('\n[3] HTML escaping of comment body');
  reset();
  await notifyCommentRecipients({
    recipients: [{ id: 20, name: 'Neha', email: nehaEmail, reason: 'mention' }],
    actorName: '<b>Hacker</b>', itemId, boardId: b, itemName, boardName: 'X', groupName: 'Y',
    commentBody: '<script>alert(1)</script>',
  });
  ck('comment script tag is escaped', (SENT[0]?.html || '').includes('&lt;script&gt;'));
  ck('no raw <script> in html', !(SENT[0]?.html || '').includes('<script>'));
  ck('actor name is escaped', (SENT[0]?.html || '').includes('&lt;b&gt;Hacker'));

  // ── 4. assignment email (only NEW owners) ──
  console.log('\n[4] assignment email — diff only');
  reset();
  await notifyNewAssignees({
    oldValue: JSON.stringify(['Neha Gupta']),
    newValue: JSON.stringify(['Neha Gupta', 'Pooja Mehta']),
    itemId, boardId: b, actor: { id: 1, name: 'Admin' },
  });
  ck('exactly one assignment email (the newly-added owner)', SENT.length === 1, `got ${SENT.length}`);
  ck('sent to the NEW owner (Pooja), not the pre-existing one', SENT[0]?.to === poojaEmail, SENT[0]?.to);
  ck('subject says assigned', /assigned/i.test(SENT[0]?.subject || ''), SENT[0]?.subject);

  // ── 5. automation send_email: specific recipient + placeholder resolution ──
  console.log('\n[5] automation send_email — specific + placeholders');
  reset();
  await sendAutomationEmail({
    boardId: b, itemId, to: 'someone@example.com', toType: 'specific',
    subject: '{Item Name} status update', body: 'Hello {Board Name}',
  });
  ck('specific recipient email sent', SENT.length === 1, `got ${SENT.length}`);
  ck('sent to the specified address', SENT[0]?.to === 'someone@example.com', SENT[0]?.to);
  ck('{Item Name} placeholder resolved in subject', (SENT[0]?.subject || '').includes(itemName), SENT[0]?.subject);
  ck('{Board Name} placeholder resolved in body', (SENT[0]?.html || '').includes('Sales CRM Pipeline'));

  // ── 6. automation send_email: garbage recipient rejected ──
  console.log('\n[6] automation send_email — invalid recipient');
  reset();
  await sendAutomationEmail({ boardId: b, itemId, to: 'not-an-email', toType: 'specific', subject: 'x', body: 'y' });
  ck('garbage recipient → no email sent', SENT.length === 0, `got ${SENT.length}`);

  // ── 7. automation send_email: board_members fan-out ──
  console.log('\n[7] automation send_email — board_members');
  reset();
  await sendAutomationEmail({ boardId: b, itemId, toType: 'board_members', subject: 'Team update', body: 'hi' });
  ck('one email with all members in To', SENT.length === 1, `got ${SENT.length}`);
  ck('includes Neha + Pooja in recipients', (SENT[0]?.to || '').includes(nehaEmail) && (SENT[0]?.to || '').includes(poojaEmail), SENT[0]?.to);

  // ── 8. SMTP not configured → clean skip ──
  console.log('\n[8] SMTP off → no send, no throw');
  reset();
  const savedHost = process.env.EMAIL_HOST; delete process.env.EMAIL_HOST;
  let threw = false;
  try {
    await notifyCommentRecipients({ recipients: [{ id: 20, name: 'Neha', email: nehaEmail, reason: 'mention' }],
      actorName: 'Admin', itemId, boardId: b, itemName, boardName: 'X', groupName: 'Y', commentBody: 'z' });
  } catch { threw = true; }
  ck('no email sent when SMTP off', SENT.length === 0);
  ck('did not throw when SMTP off', !threw);
  process.env.EMAIL_HOST = savedHost;

  // cleanup the outgoing item_emails rows this test created
  await pool.query('DELETE FROM item_emails WHERE id > $1', [minId]);

  console.log(`\n══════════════\nPASS ${pass}   FAIL ${fail}`);
  await pool.end();
  process.exit(fail ? 1 : 0);
}
main().catch(e => { console.error('HARNESS ERROR:', e); process.exit(2); });
