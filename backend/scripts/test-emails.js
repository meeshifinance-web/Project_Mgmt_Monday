/**
 * Diagnostic test for SMTP. Tries 465 (SSL) and 587 (STARTTLS) with verbose
 * logging to pinpoint a failing handshake / auth step on Titan.
 *
 * Usage:  node scripts/test-emails.js <recipient-email>
 */
require('dotenv').config();
const nodemailer = require('nodemailer');
const { sendWelcomeEmail, sendPasswordReset } = require('../services/email');

const to = process.argv[2];
if (!to) {
  console.error('Usage: node scripts/test-emails.js <email>');
  process.exit(1);
}

const HOST = process.env.EMAIL_HOST;
const USER = process.env.EMAIL_USER;
const PASS = process.env.EMAIL_PASS;
const FROM = process.env.EMAIL_FROM || USER;

console.log('\n[Test] Loaded env:');
console.log(`  EMAIL_HOST = ${HOST || '(unset)'}`);
console.log(`  EMAIL_USER = ${USER || '(unset)'}`);
console.log(`  EMAIL_FROM = ${FROM || '(unset)'}`);
console.log(`  EMAIL_PASS length = ${PASS ? PASS.length : 0}, first = ${PASS ? PASS[0] : ''}, last = ${PASS ? PASS[PASS.length - 1] : ''}`);
console.log(`  (no quotes, no spaces around password expected)\n`);

async function tryConfig(label, opts) {
  console.log(`──────── ${label} ────────`);
  const transporter = nodemailer.createTransport({
    ...opts,
    auth: { user: USER, pass: PASS },
    tls:  { rejectUnauthorized: false },
    logger: true,
    debug:  true,
  });

  try {
    await transporter.verify();
    console.log(`[${label}] ✅ verify() succeeded — auth + handshake OK`);
    const info = await transporter.sendMail({
      from: FROM,
      to,
      subject: `Simplix SMTP test (${label})`,
      text:    `If you can read this, the ${label} config works.\n\nFrom: ${FROM}\nHost: ${opts.host}:${opts.port}`,
    });
    console.log(`[${label}] ✅ sendMail() ok, messageId=${info.messageId}`);
    return true;
  } catch (err) {
    console.log(`[${label}] ❌ ${err.message}`);
    if (err.code)     console.log(`    code:     ${err.code}`);
    if (err.response) console.log(`    response: ${err.response}`);
    return false;
  }
}

(async () => {
  // 465 SSL
  const ok465 = await tryConfig('465 SSL (secure=true)', {
    host: HOST, port: 465, secure: true,
  });

  console.log('');

  // 587 STARTTLS
  const ok587 = await tryConfig('587 STARTTLS (secure=false, requireTLS=true)', {
    host: HOST, port: 587, secure: false, requireTLS: true,
  });

  if (!ok465 && !ok587) {
    console.log('\n[Test] Both ports failed — credentials or host issue.');
    process.exit(1);
  }

  // If at least one config works, fire the actual branded templates
  console.log('\n[Test] Working config found — sending the real branded templates via the email service…');
  await sendWelcomeEmail(to, 'Anup');
  await sendPasswordReset(
    to,
    'Anup',
    `${(process.env.FRONTEND_URL || 'http://localhost:5173').replace(/\/$/, '')}/reset-password?token=preview-token-123`
  );
  console.log(`\n[Test] ✅ done — check ${to}\n`);
  process.exit(0);
})();
