/**
 * emailTemplate.js
 *
 * Shared HTML / plain-text scaffolding for every automated email Tuesday.com
 * sends — assignment notifications, automation send_email actions, future
 * digests, etc. The goal: every transactional email feels like it came from
 * the same well-designed product, not a hand-rolled one-off.
 *
 * Design rules baked in:
 *   - Single-column, max-width 600px — works on every email client and
 *     renders well on mobile without media queries (some clients strip them).
 *   - Inline CSS only. Outlook ignores <style> blocks; Gmail's mobile app
 *     drops external stylesheets. Inline styles survive everywhere.
 *   - System font stack. No web fonts (they're often blocked / slow).
 *   - Color palette matches the in-app brand (#0073ea primary).
 *   - Plain-text fallback is generated from the same inputs so it stays
 *     consistent with the HTML — no drift between formats.
 *   - Preheader text (the snippet shown after the subject in inbox previews)
 *     is rendered into a hidden span so we control what people see before
 *     they open the email.
 */

const BRAND = {
  name:        'TUESDAY.COM',
  tagline:     "D'Decor Project Management",
  primary:     '#0073ea',
  primaryDark: '#0060c4',
  ink:         '#172b4d',
  text:        '#42526e',
  muted:       '#7a869a',
  border:      '#dfe1e6',
  bgPage:      '#f4f5f7',
  bgCard:      '#ffffff',
  bgSoft:      '#f7f8fa',
};

function escapeHtml(s) {
  return String(s ?? '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

// Stable color from a name — used for assignee/actor avatars when there's no
// uploaded picture. Same hash the frontend uses, so the same person always
// gets the same colored avatar across web and email.
function colorForName(name = '') {
  const palette = ['#0073ea','#00c875','#fdab3d','#e2445c','#a25ddc','#037f4c','#ff5ac4','#784bd1'];
  let h = 0;
  for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) & 0xffffffff;
  return palette[Math.abs(h) % palette.length];
}

function initials(name = '') {
  return name.split(/\s+/).filter(Boolean).map(p => p[0] || '').join('').slice(0, 2).toUpperCase() || '?';
}

// ── Date formatting ───────────────────────────────────────────────────────────
// Returns { absolute, relative, urgent } for a YYYY-MM-DD string.
//   absolute → "Mon, 28 April 2026"
//   relative → "Today" / "Tomorrow" / "In 3 days" / "5 days ago" / null
//   urgent   → true when due within 2 days OR overdue (used to color the chip)
function formatDueDate(raw) {
  if (!raw) return null;
  // Accept 'YYYY-MM-DD' or 'YYYY-MM-DDTHH:mm:ss…' — split on 'T' to avoid
  // timezone surprises on date-only values.
  const dateOnly = String(raw).split('T')[0];
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dateOnly);
  if (!m) return { absolute: String(raw), relative: null, urgent: false };

  const [, y, mo, d] = m;
  const dt = new Date(Number(y), Number(mo) - 1, Number(d));
  if (Number.isNaN(dt.getTime())) return { absolute: String(raw), relative: null, urgent: false };

  const today = new Date();
  const todayMid = new Date(today.getFullYear(), today.getMonth(), today.getDate());
  const diffDays = Math.round((dt - todayMid) / (24 * 60 * 60 * 1000));

  let relative = null;
  if      (diffDays === 0) relative = 'Today';
  else if (diffDays === 1) relative = 'Tomorrow';
  else if (diffDays === -1) relative = 'Yesterday';
  else if (diffDays > 1)   relative = `In ${diffDays} days`;
  else                     relative = `${Math.abs(diffDays)} days ago`;

  const months = ['January','February','March','April','May','June','July','August','September','October','November','December'];
  const days   = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];
  const absolute = `${days[dt.getDay()]}, ${dt.getDate()} ${months[dt.getMonth()]} ${dt.getFullYear()}`;

  return { absolute, relative, urgent: diffDays <= 2 };
}

// ── HTML fragments ────────────────────────────────────────────────────────────

function avatarHtml(name, { size = 32 } = {}) {
  const bg = colorForName(name);
  const init = escapeHtml(initials(name));
  return `<div style="display:inline-block;vertical-align:middle;width:${size}px;height:${size}px;border-radius:50%;background:${bg};color:#fff;text-align:center;line-height:${size}px;font-weight:700;font-size:${Math.round(size * 0.42)}px;font-family:Arial,sans-serif">${init}</div>`;
}

function statusBadgeHtml(label, color) {
  if (!label) return '';
  const bg = color || '#7a869a';
  return `<span style="display:inline-block;background:${bg};color:#fff;font-weight:700;font-size:12px;padding:3px 10px;border-radius:12px;letter-spacing:0.2px">${escapeHtml(label)}</span>`;
}

function dueDateChipHtml(dueInfo) {
  if (!dueInfo) return '';
  const bg = dueInfo.urgent ? '#fff1f0' : '#eef6ff';
  const fg = dueInfo.urgent ? '#cf1322' : '#0073ea';
  const rel = dueInfo.relative
    ? ` <span style="opacity:0.75">· ${escapeHtml(dueInfo.relative)}</span>`
    : '';
  return `<span style="display:inline-block;background:${bg};color:${fg};font-weight:600;font-size:13px;padding:4px 10px;border-radius:8px">${escapeHtml(dueInfo.absolute)}${rel}</span>`;
}

// Render a list of fact rows: [{ label, valueHtml }] (valueHtml is trusted —
// caller is expected to escape user data already).
function factsTableHtml(facts) {
  const rows = (facts || []).filter(f => f && f.valueHtml).map(f => `
    <tr>
      <td style="padding:8px 16px 8px 18px;vertical-align:top;color:${BRAND.muted};font-size:12px;text-transform:uppercase;letter-spacing:0.6px;font-weight:700;width:110px;font-family:Arial,sans-serif">${escapeHtml(f.label)}</td>
      <td style="padding:8px 18px 8px 0;vertical-align:top;color:${BRAND.ink};font-size:14px;font-family:Arial,sans-serif">${f.valueHtml}</td>
    </tr>`).join('');
  if (!rows) return '';
  return `<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="border-collapse:collapse;background:${BRAND.bgSoft};border:1px solid ${BRAND.border};border-radius:10px;overflow:hidden;margin-top:14px">${rows}</table>`;
}

// ── Main shell ────────────────────────────────────────────────────────────────
/**
 * @param {object} opts
 * @param {string} opts.preheader      Preview text shown after subject in inbox
 * @param {string} opts.heading        Big line at top of card  (e.g. "You've been assigned a task")
 * @param {string} opts.greeting       Optional "Hi <name>" greeting
 * @param {string} opts.introHtml      One-line context, supports inline html (avatar + actor name)
 * @param {string} opts.itemName       Big bolded task title
 * @param {string} opts.breadcrumbHtml Small "Board ▸ Group" line, inline html ok
 * @param {Array}  opts.facts          [{ label, valueHtml }] rendered as a clean table
 * @param {string} opts.extraHtml      Optional free-form HTML below facts (description, etc.)
 * @param {string} opts.ctaUrl
 * @param {string} opts.ctaLabel
 * @param {string} opts.footerNote     Why-you-got-this line
 */
function renderEmailShell(opts) {
  const {
    preheader = '',
    heading = '',
    greeting = '',
    introHtml = '',
    itemName = '',
    breadcrumbHtml = '',
    facts = [],
    extraHtml = '',
    ctaUrl,
    ctaLabel = 'Open in Tuesday',
    footerNote = '',
  } = opts;

  const brandTagline = BRAND.tagline;

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="x-apple-disable-message-reformatting">
<title>${escapeHtml(heading || BRAND.name)}</title>
</head>
<body style="margin:0;padding:0;background:${BRAND.bgPage};font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;color:${BRAND.text};-webkit-font-smoothing:antialiased">

<!-- Preheader (hidden, shows in inbox preview) -->
<div style="display:none;font-size:1px;color:${BRAND.bgPage};line-height:1px;max-height:0;max-width:0;opacity:0;overflow:hidden">${escapeHtml(preheader)}</div>

<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="background:${BRAND.bgPage};padding:32px 12px">
  <tr><td align="center">
    <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="600" style="max-width:600px;width:100%">

      <!-- Header / brand -->
      <tr><td style="padding:0 4px 18px;text-align:center">
        <div style="display:inline-block;background:${BRAND.primary};color:#fff;padding:8px 18px;border-radius:8px;font-weight:800;letter-spacing:1px;font-size:13px">${BRAND.name}</div>
        <div style="margin-top:8px;color:${BRAND.muted};font-size:12px">${escapeHtml(brandTagline)}</div>
      </td></tr>

      <!-- Card -->
      <tr><td style="background:${BRAND.bgCard};border:1px solid ${BRAND.border};border-radius:14px;padding:0;box-shadow:0 1px 4px rgba(9,30,66,0.05);overflow:hidden">

        <!-- Top accent bar -->
        <div style="height:4px;background:linear-gradient(90deg,${BRAND.primary} 0%,#5e9eff 100%)"></div>

        <!-- Hero -->
        <div style="padding:28px 28px 8px">
          ${greeting ? `<p style="margin:0 0 6px;color:${BRAND.text};font-size:14px">Hi ${escapeHtml(greeting)},</p>` : ''}
          ${heading ? `<h1 style="margin:0 0 10px;color:${BRAND.ink};font-size:20px;font-weight:700;line-height:1.35">${escapeHtml(heading)}</h1>` : ''}
          ${introHtml ? `<div style="color:${BRAND.text};font-size:14px;line-height:1.55">${introHtml}</div>` : ''}
        </div>

        <!-- Item card -->
        <div style="padding:18px 28px 4px">
          ${breadcrumbHtml ? `<div style="color:${BRAND.muted};font-size:12px;margin-bottom:6px;font-weight:600;letter-spacing:0.3px;text-transform:uppercase">${breadcrumbHtml}</div>` : ''}
          ${itemName ? `<div style="color:${BRAND.ink};font-size:18px;font-weight:700;line-height:1.4">${escapeHtml(itemName)}</div>` : ''}
          ${factsTableHtml(facts)}
          ${extraHtml ? `<div style="margin-top:14px;color:${BRAND.text};font-size:14px;line-height:1.6">${extraHtml}</div>` : ''}
        </div>

        <!-- CTA -->
        ${ctaUrl ? `
        <div style="padding:24px 28px 28px;text-align:center">
          <a href="${escapeHtml(ctaUrl)}" style="display:inline-block;background:${BRAND.primary};color:#ffffff;text-decoration:none;font-weight:600;font-size:14px;padding:12px 28px;border-radius:8px;box-shadow:0 1px 2px rgba(0,115,234,0.3)">${escapeHtml(ctaLabel)} &rarr;</a>
          <div style="margin-top:10px;color:${BRAND.muted};font-size:12px">
            or copy &amp; paste this URL: <a href="${escapeHtml(ctaUrl)}" style="color:${BRAND.primary};text-decoration:none">${escapeHtml(ctaUrl)}</a>
          </div>
        </div>` : ''}

        <!-- Inline footer note -->
        ${footerNote ? `<div style="padding:14px 28px;border-top:1px solid ${BRAND.border};background:${BRAND.bgSoft};color:${BRAND.muted};font-size:12px;line-height:1.5">${escapeHtml(footerNote)}</div>` : ''}
      </td></tr>

      <!-- Outer footer -->
      <tr><td style="padding:18px 8px;text-align:center;color:${BRAND.muted};font-size:11px;line-height:1.6">
        Sent by ${BRAND.name} &middot; D'Decor Home Fabrics Pvt. Ltd.<br>
        Please do not reply to this email — it is sent from an automated mailbox.
      </td></tr>

    </table>
  </td></tr>
</table>

</body>
</html>`;
}

// ── Plain-text fallback ──────────────────────────────────────────────────────
function renderPlainText({ heading, greeting, introText, itemName, facts, extraText, ctaUrl, ctaLabel = 'Open in Tuesday', footerNote }) {
  const lines = [];
  if (greeting) lines.push(`Hi ${greeting},`, '');
  if (heading)  lines.push(heading, '');
  if (introText) lines.push(introText, '');
  if (itemName)  lines.push(`▶ ${itemName}`, '');
  if (Array.isArray(facts)) {
    for (const f of facts) {
      if (!f || !f.valueText) continue;
      lines.push(`${f.label.padEnd(10, ' ')}  ${f.valueText}`);
    }
    if (facts.some(f => f && f.valueText)) lines.push('');
  }
  if (extraText) lines.push(extraText, '');
  if (ctaUrl)   lines.push(`${ctaLabel}: ${ctaUrl}`, '');
  if (footerNote) lines.push('— ', footerNote);
  lines.push('', `${BRAND.name} · D'Decor Home Fabrics Pvt. Ltd.`);
  return lines.join('\n');
}

module.exports = {
  BRAND,
  escapeHtml,
  colorForName,
  initials,
  formatDueDate,
  avatarHtml,
  statusBadgeHtml,
  dueDateChipHtml,
  factsTableHtml,
  renderEmailShell,
  renderPlainText,
};
