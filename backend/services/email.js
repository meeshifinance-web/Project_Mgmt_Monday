/**
 * email.js
 *
 * Account-lifecycle emails (password reset, welcome / onboarding).
 * Every message uses the shared brand shell from emailTemplate.js so the
 * whole platform's mail looks like it came from the same product.
 *
 * From-address logic (single source of truth):
 *   process.env.EMAIL_FROM   →  process.env.EMAIL_USER (fallback)
 * Set EMAIL_FROM=simplix@simplixart.com on the server to brand all
 * outbound mail.
 */

const nodemailer = require('nodemailer');
const {
  BRAND,
  renderEmailShell,
  renderHeroEmailShell,
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

function fromAddress() {
  return process.env.EMAIL_FROM || process.env.EMAIL_USER;
}

function appUrl() {
  return (process.env.FRONTEND_URL || 'http://localhost:5173').replace(/\/$/, '');
}

// ── Password reset ──────────────────────────────────────────────────────────
async function sendPasswordReset(to, name, resetUrl) {
  const transporter = getTransporter();
  if (!transporter) {
    console.log(`\n🔑 Password Reset Link for ${to}:\n${resetUrl}\n`);
    return;
  }

  const firstName = (name || '').split(/\s+/)[0] || name || '';
  const subject = 'Reset your Simplix password';

  const html = renderEmailShell({
    preheader:  'Reset your Simplix password — link expires in 1 hour.',
    greeting:   firstName,
    heading:    'Reset your password',
    introHtml:  'We received a request to reset the password for your <strong>Simplix</strong> account. Click the button below to choose a new one — this link expires in <strong>1 hour</strong>.',
    ctaUrl:     resetUrl,
    ctaLabel:   'Reset password',
    footerNote: "Didn't request this? You can safely ignore this email — your password will not change. If you keep getting these and didn't request them, contact your admin.",
  });

  const text = renderPlainText({
    greeting:   firstName,
    heading:    'Reset your Simplix password',
    introText:  'We received a request to reset the password for your account. The link below expires in 1 hour.',
    ctaUrl:     resetUrl,
    ctaLabel:   'Reset password',
    footerNote: "Didn't request this? Ignore this email — your password will not change.",
  });

  try {
    await transporter.sendMail({ from: fromAddress(), to, subject, html, text });
    console.log(`[PasswordReset] ✅ Sent to <${to}>`);
  } catch (err) {
    console.error(`[PasswordReset] ❌ Send failed:`, err.message);
    throw err;
  }
}

// ── Welcome / onboarding (sent on /register) ────────────────────────────────
async function sendWelcomeEmail(to, name) {
  const transporter = getTransporter();
  if (!transporter) {
    console.log(`\n👋 Welcome email skipped (SMTP not configured) — would go to ${to} (${name})\n`);
    return;
  }

  const firstName = (name || '').split(/\s+/)[0] || name || 'there';
  const subject = `Welcome to Simplix, ${firstName} 👋`;

  const html = renderHeroEmailShell({
    preheader:  'Your Simplix workspace is ready. Plan. Build. Ship. Repeat.',
    heroEmoji:  '🎉',
    heroTitle:  'Welcome to Simplix',
    heroSub:    'Plan. Build. Ship. Repeat.',
    greeting:   firstName,
    bodyHtml: `
      Your account is live and your workspace is ready. Simplix is built to help your
      team stop juggling spreadsheets, status meetings and email threads — so you can
      focus on the work that actually moves things forward.
    `,
    features: [
      { icon: '📋', title: 'Boards & items', body: 'Plan projects with status, owners, dates and custom columns.' },
      { icon: '⚡', title: 'Automations',    body: 'Auto-assign owners, route incoming email, send updates.' },
      { icon: '📊', title: 'Dashboards',     body: 'See progress at a glance with widgets you can drag around.' },
    ],
    ctaUrl:   `${appUrl()}/login`,
    ctaLabel: 'Open Simplix',
    secondaryHtml: `
      <strong style="color:${BRAND.ink}">A few quick wins to get rolling:</strong>
      <ul style="margin:8px 0 0;padding-left:20px;color:${BRAND.text}">
        <li style="margin-bottom:6px">Create your first board from the sidebar &mdash; pick a template or start blank.</li>
        <li style="margin-bottom:6px">Invite teammates from <em>Board members</em> so they can collaborate live.</li>
        <li style="margin-bottom:6px">Set up an automation to save yourself the busywork.</li>
      </ul>
    `,
    footerNote: "You're receiving this because an account was created with this email at simplixart.com. If this wasn't you, please contact your admin.",
  });

  const text = renderPlainText({
    greeting:   firstName,
    heading:    'Welcome to Simplix — Plan. Build. Ship. Repeat.',
    introText:  'Your account is live and your workspace is ready. Open Simplix to create your first board, invite teammates, and set up automations.',
    ctaUrl:     `${appUrl()}/login`,
    ctaLabel:   'Open Simplix',
    footerNote: 'You are receiving this because an account was created with this email at simplixart.com.',
  });

  try {
    await transporter.sendMail({ from: fromAddress(), to, subject, html, text });
    console.log(`[Welcome] ✅ Sent to <${to}>`);
  } catch (err) {
    console.error(`[Welcome] ❌ Send failed:`, err.message);
    // Welcome emails are fire-and-forget — never throw out of /register
  }
}

module.exports = { sendPasswordReset, sendWelcomeEmail };
