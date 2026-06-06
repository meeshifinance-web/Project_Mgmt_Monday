const express = require('express');
const router = express.Router();
const pool = require('../db');
const { requireAuth, requireRole, canAccessBoard } = require('../middleware/auth');
const rateLimit = require('express-rate-limit');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const nodemailer = require('nodemailer');
const QRCode = require('qrcode');
const { sendAutomationEmail } = require('../services/automationEmail');
const { computeRelativeDate } = require('../services/relativeDate');
const { notifyNewAssignees } = require('../services/assignmentEmail');
const { getConditions, getActions, evaluateConditions, executeActions, runDeferred } = require('../services/automationEngine');

// Activity-log helper (best-effort; never fails the submission).
async function logFormActivity(client, data) {
  try {
    await client.query(
      `INSERT INTO activity_logs (board_id,user_id,user_name,item_id,item_name,action,field,old_value,new_value)
       VALUES ($1,NULL,$2,$3,$4,$5,$6,$7,$8)`,
      [data.board_id, data.user_name, data.item_id, data.item_name, data.action, data.field || null, data.old_value || null, data.new_value || null]
    );
  } catch (_) { /* logging is best-effort */ }
}

const canWrite = [requireAuth, requireRole('admin', 'manager')];
const FILE_SIZE_LIMIT = 20 * 1024 * 1024;
const UPLOADS_DIR = path.join(__dirname, '..', 'uploads');
if (!fs.existsSync(UPLOADS_DIR)) fs.mkdirSync(UPLOADS_DIR, { recursive: true });

const upload = multer({
  storage: multer.diskStorage({
    destination: (_req, _file, cb) => cb(null, UPLOADS_DIR),
    filename: (_req, file, cb) => {
      const rand = crypto.randomBytes(16).toString('hex');
      const ext = path.extname(file.originalname).toLowerCase().replace(/[^a-z0-9.]/g, '');
      cb(null, `${rand}${ext}`);
    },
  }),
  limits: { fileSize: FILE_SIZE_LIMIT },
});

const formSubmitLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many submissions - please try again later' },
});

function generateSlug() {
  const chars = 'abcdefghijklmnopqrstuvwxyz0123456789';
  let s = '';
  for (let i = 0; i < 8; i++) s += chars[Math.floor(Math.random() * chars.length)];
  return s;
}

function bool(v, fallback = false) {
  if (v === undefined || v === null) return fallback;
  return v === true || v === 'true' || v === 1 || v === '1';
}

function nullableInt(v) {
  if (v === undefined || v === null || v === '') return null;
  const n = parseInt(v, 10);
  return Number.isFinite(n) && n > 0 ? n : null;
}

function nullableDate(v) {
  if (!v) return null;
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

function jsonArray(v) {
  if (!v) return [];
  if (Array.isArray(v)) return v;
  try {
    const parsed = typeof v === 'string' ? JSON.parse(v) : v;
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function formPayload(body = {}) {
  return {
    title: (body.title || 'Untitled Form').trim() || 'Untitled Form',
    description: body.description || '',
    cover_color: body.cover_color || '#0073ea',
    target_group_id: nullableInt(body.target_group_id),
    thank_you_message: body.thank_you_message || 'Your response has been submitted.',
    thank_you_title: body.thank_you_title || 'Thank you!',
    closed_message: body.closed_message || 'This form is no longer accepting responses.',
    is_active: bool(body.is_active, true),
    item_name_label: (body.item_name_label || 'Item Name').trim() || 'Item Name',
    opens_at: nullableDate(body.opens_at),
    closes_at: nullableDate(body.closes_at),
    response_limit: nullableInt(body.response_limit),
    captcha_enabled: bool(body.captcha_enabled, false),
    hide_branding: bool(body.hide_branding, false),
    progress_bar_enabled: bool(body.progress_bar_enabled, false),
    submit_button_text: (body.submit_button_text || 'Submit').trim() || 'Submit',
    redirect_url: body.redirect_url || '',
    confirmation_email_enabled: bool(body.confirmation_email_enabled, false),
    confirmation_email_column_id: nullableInt(body.confirmation_email_column_id),
    confirmation_email_subject: body.confirmation_email_subject || 'We received your response',
    confirmation_email_body: body.confirmation_email_body || 'Thanks for submitting the form. We have received your response.',
    notify_on_submission: bool(body.notify_on_submission, false),
  };
}

// Public URL for a form's slug (used by share-email + QR).
function formPublicUrl(slug) {
  return `${(process.env.FRONTEND_URL || 'http://localhost:5173').replace(/\/$/, '')}/form/${slug}`;
}

async function availability(client, form) {
  const now = new Date();
  if (!form.is_active) return { open: false, reason: 'inactive' };
  if (form.opens_at && new Date(form.opens_at) > now) return { open: false, reason: 'scheduled' };
  if (form.closes_at && new Date(form.closes_at) <= now) return { open: false, reason: 'closed' };
  if (form.response_limit) {
    const countRes = await client.query('SELECT COUNT(*)::int AS count FROM form_submissions WHERE form_id=$1', [form.id]);
    if ((countRes.rows[0]?.count || 0) >= form.response_limit) return { open: false, reason: 'limit' };
  }
  return { open: true, reason: '' };
}

function captchaSecret() {
  return process.env.FORM_CAPTCHA_SECRET || process.env.SESSION_SECRET || 'workboard_form_captcha_secret';
}

function signCaptcha(answer, ts) {
  return crypto.createHmac('sha256', captchaSecret()).update(`${answer}:${ts}`).digest('hex');
}

function makeCaptcha() {
  const a = 2 + Math.floor(Math.random() * 8);
  const b = 2 + Math.floor(Math.random() * 8);
  const answer = a + b;
  const ts = Date.now();
  return {
    question: `What is ${a} + ${b}?`,
    token: Buffer.from(`${answer}:${ts}:${signCaptcha(answer, ts)}`).toString('base64url'),
  };
}

function verifyCaptcha(token, answer) {
  try {
    const raw = Buffer.from(String(token || ''), 'base64url').toString('utf8');
    const [expected, ts, sig] = raw.split(':');
    if (!expected || !ts || !sig) return false;
    if (Date.now() - Number(ts) > 30 * 60 * 1000) return false;
    if (sig !== signCaptcha(expected, ts)) return false;
    return String(answer || '').trim() === String(expected);
  } catch {
    return false;
  }
}

function optionLabels(settings, type) {
  const s = typeof settings === 'string' ? JSON.parse(settings || '{}') : (settings || {});
  if (Array.isArray(s.options)) return s.options.map(o => typeof o === 'string' ? o : o.label).filter(Boolean);
  if (type === 'priority') return ['Critical', 'High', 'Medium', 'Low'];
  if (type === 'checkbox') return ['true', 'false'];
  return [];
}

function conditionMatches(rule, submittedFields) {
  const sourceId = String(rule.source_column_id || '');
  if (!sourceId) return true;
  const actual = submittedFields[sourceId] ?? '';
  const actualText = String(actual).trim();
  const values = Array.isArray(rule.values) ? rule.values.map(String) : [String(rule.value || '')];
  const op = rule.operator || 'equals';

  if (op === 'not_equals') return !values.includes(actualText);
  if (op === 'contains') return values.some(v => actualText.toLowerCase().includes(v.toLowerCase()));
  if (op === 'is_empty') return actualText === '';
  if (op === 'is_not_empty') return actualText !== '';
  return values.includes(actualText);
}

function fieldIsShown(field, submittedFields) {
  const rules = jsonArray(field.conditional_logic);
  if (!rules.length) return true;
  return rules.some(rule => conditionMatches(rule, submittedFields));
}

async function loadFields(client, formId, publicOnly = false) {
  const { rows } = await client.query(
    `SELECT ff.*, c.title AS column_title, c.type AS column_type, c.settings AS column_settings
       FROM form_fields ff
       JOIN columns c ON c.id = ff.column_id
      WHERE ff.form_id = $1 ${publicOnly ? 'AND ff.is_visible = true' : ''}
      ORDER BY ff.position ASC`,
    [formId]
  );
  return rows;
}

function getTransporter() {
  if (!process.env.EMAIL_HOST || !process.env.EMAIL_USER) return null;
  const port = parseInt(process.env.EMAIL_PORT, 10) || 587;
  return nodemailer.createTransport({
    host: process.env.EMAIL_HOST,
    port,
    secure: port === 465,
    requireTLS: port !== 465,
    auth: { user: process.env.EMAIL_USER, pass: process.env.EMAIL_PASS },
    tls: { rejectUnauthorized: false },
  });
}

async function sendConfirmation({ form, itemName, fields, submittedFields }) {
  if (!form.confirmation_email_enabled) return;
  const emailColId = form.confirmation_email_column_id || fields.find(f => f.column_type === 'email')?.column_id;
  const to = String(submittedFields[String(emailColId)] || '').trim();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(to)) return;
  const transporter = getTransporter();
  if (!transporter) {
    console.log(`[Forms] SMTP not configured - confirmation email skipped for ${to}`);
    return;
  }

  const answers = fields
    .filter(f => submittedFields[String(f.column_id)] !== undefined && submittedFields[String(f.column_id)] !== '')
    .map(f => `${f.label || f.column_title}: ${submittedFields[String(f.column_id)]}`)
    .join('\n');
  const body = `${form.confirmation_email_body || 'Thanks for submitting the form.'}\n\nSubmission: ${itemName}\n${answers ? `\n${answers}` : ''}`;

  await transporter.sendMail({
    from: process.env.EMAIL_FROM || process.env.EMAIL_USER,
    to,
    subject: form.confirmation_email_subject || 'We received your response',
    text: body,
  });
}

// New-submission notification to the board team (opt-in via notify_on_submission).
// Creates an in-app notification for every active board member and, if SMTP is
// configured, emails them a link to the new item. Best-effort, never throws.
async function notifySubmission({ form, itemId, itemName }) {
  if (!form.notify_on_submission) return;
  try {
    const bRes = await pool.query('SELECT name FROM boards WHERE id=$1', [form.board_id]);
    const boardName = bRes.rows[0]?.name || '';
    const members = await pool.query(
      `SELECT u.id, u.name, u.email FROM board_members bm
         JOIN users u ON u.id = bm.user_id
        WHERE bm.board_id = $1 AND u.is_active = true`,
      [form.board_id]
    );
    if (!members.rows.length) return;

    const message = `New form response on "${form.title}": ${itemName}`;
    for (const m of members.rows) {
      await pool.query(
        `INSERT INTO notifications (user_id, from_user_id, from_user_name, item_id, item_name, board_id, board_name, message)
         VALUES ($1,NULL,$2,$3,$4,$5,$6,$7)`,
        [m.id, `Form: ${form.title}`, itemId, itemName, form.board_id, boardName, message]
      );
    }

    const transporter = getTransporter();
    if (!transporter) return;
    const itemUrl = `${(process.env.FRONTEND_URL || 'http://localhost:5173').replace(/\/$/, '')}/board/${form.board_id}?item=${itemId}`;
    const recipients = members.rows.map(m => m.email).filter(e => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e || ''));
    if (!recipients.length) return;
    await transporter.sendMail({
      from: process.env.EMAIL_FROM || process.env.EMAIL_USER,
      to: recipients.join(', '),
      subject: `📥 New response on "${form.title}"`,
      text: `A new response was submitted to the form "${form.title}" on board "${boardName}".\n\nItem: ${itemName}\nOpen it: ${itemUrl}`,
    });
  } catch (err) {
    console.error('[Forms] submission notification failed:', err.message);
  }
}

router.get('/boards/:boardId/forms', requireAuth, async (req, res) => {
  try {
    if (!(await canAccessBoard(req.params.boardId, req.user, pool))) return res.status(403).json({ error: 'Access denied' });
    const { rows } = await pool.query(
      `SELECT f.*, g.name AS target_group_name,
              COALESCE(s.response_count, 0)::int AS response_count
         FROM forms f
         LEFT JOIN groups g ON g.id = f.target_group_id
         LEFT JOIN (
           SELECT form_id, COUNT(*) AS response_count FROM form_submissions GROUP BY form_id
         ) s ON s.form_id = f.id
        WHERE f.board_id = $1
        ORDER BY f.created_at DESC`,
      [req.params.boardId]
    );
    res.json(rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

router.post('/boards/:boardId/forms', ...canWrite, async (req, res) => {
  try {
    if (!(await canAccessBoard(req.params.boardId, req.user, pool))) return res.status(403).json({ error: 'Access denied' });
    let slug;
    for (let i = 0; i < 10; i++) {
      slug = generateSlug();
      const existing = await pool.query('SELECT id FROM forms WHERE slug=$1', [slug]);
      if (!existing.rows.length) break;
    }
    const p = formPayload(req.body);
    const { rows } = await pool.query(
      `INSERT INTO forms (
        board_id, title, description, cover_color, target_group_id, thank_you_message, item_name_label, slug,
        closed_message, opens_at, closes_at, response_limit, captcha_enabled, hide_branding,
        progress_bar_enabled, submit_button_text, thank_you_title, redirect_url,
        confirmation_email_enabled, confirmation_email_column_id, confirmation_email_subject, confirmation_email_body,
        notify_on_submission
      )
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23)
       RETURNING *`,
      [
        req.params.boardId, p.title, p.description, p.cover_color, p.target_group_id, p.thank_you_message, p.item_name_label, slug,
        p.closed_message, p.opens_at, p.closes_at, p.response_limit, p.captcha_enabled, p.hide_branding,
        p.progress_bar_enabled, p.submit_button_text, p.thank_you_title, p.redirect_url,
        p.confirmation_email_enabled, p.confirmation_email_column_id, p.confirmation_email_subject, p.confirmation_email_body,
        p.notify_on_submission,
      ]
    );
    res.status(201).json(rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

router.get('/forms/:id', requireAuth, async (req, res) => {
  try {
    const formRes = await pool.query('SELECT * FROM forms WHERE id=$1', [req.params.id]);
    if (!formRes.rows.length) return res.status(404).json({ error: 'Form not found' });
    if (!(await canAccessBoard(formRes.rows[0].board_id, req.user, pool))) return res.status(403).json({ error: 'Access denied' });
    const fields = await loadFields(pool, req.params.id, false);
    res.json({ ...formRes.rows[0], fields });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

router.put('/forms/:id', ...canWrite, async (req, res) => {
  try {
    const formRes = await pool.query('SELECT board_id FROM forms WHERE id=$1', [req.params.id]);
    if (!formRes.rows.length) return res.status(404).json({ error: 'Form not found' });
    if (!(await canAccessBoard(formRes.rows[0].board_id, req.user, pool))) return res.status(403).json({ error: 'Access denied' });
    const p = formPayload(req.body);
    const { rows } = await pool.query(
      `UPDATE forms SET
        title=$1, description=$2, cover_color=$3, target_group_id=$4, thank_you_message=$5,
        is_active=$6, item_name_label=$7, closed_message=$8, opens_at=$9, closes_at=$10,
        response_limit=$11, captcha_enabled=$12, hide_branding=$13, progress_bar_enabled=$14,
        submit_button_text=$15, thank_you_title=$16, redirect_url=$17,
        confirmation_email_enabled=$18, confirmation_email_column_id=$19,
        confirmation_email_subject=$20, confirmation_email_body=$21, notify_on_submission=$22
       WHERE id=$23 RETURNING *`,
      [
        p.title, p.description, p.cover_color, p.target_group_id, p.thank_you_message,
        p.is_active, p.item_name_label, p.closed_message, p.opens_at, p.closes_at,
        p.response_limit, p.captcha_enabled, p.hide_branding, p.progress_bar_enabled,
        p.submit_button_text, p.thank_you_title, p.redirect_url,
        p.confirmation_email_enabled, p.confirmation_email_column_id,
        p.confirmation_email_subject, p.confirmation_email_body, p.notify_on_submission, req.params.id,
      ]
    );
    res.json(rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

router.delete('/forms/:id', ...canWrite, async (req, res) => {
  try {
    const formRes = await pool.query('SELECT board_id FROM forms WHERE id=$1', [req.params.id]);
    if (!formRes.rows.length) return res.status(404).json({ error: 'Form not found' });
    if (!(await canAccessBoard(formRes.rows[0].board_id, req.user, pool))) return res.status(403).json({ error: 'Access denied' });
    await pool.query('DELETE FROM forms WHERE id=$1', [req.params.id]);
    res.json({ success: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ── Share the form by email ───────────────────────────────────────────────────
// Body: { emails?: string|string[], include_members?: boolean }
// Emails the public form link to the given addresses and/or every board member.
// Recipients are BCC'd so external addresses never see each other.
router.post('/forms/:id/share', ...canWrite, async (req, res) => {
  try {
    const fRes = await pool.query('SELECT * FROM forms WHERE id=$1', [req.params.id]);
    if (!fRes.rows.length) return res.status(404).json({ error: 'Form not found' });
    const form = fRes.rows[0];
    if (!(await canAccessBoard(form.board_id, req.user, pool))) return res.status(403).json({ error: 'Access denied' });

    const emailRe = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    const recipients = new Set();
    const raw = Array.isArray(req.body.emails) ? req.body.emails : String(req.body.emails || '').split(',');
    raw.map(e => String(e).trim()).filter(e => emailRe.test(e)).forEach(e => recipients.add(e));
    if (req.body.include_members) {
      const m = await pool.query(
        `SELECT u.email FROM board_members bm JOIN users u ON u.id = bm.user_id
          WHERE bm.board_id = $1 AND u.is_active = true AND u.email IS NOT NULL AND u.email <> ''`,
        [form.board_id]
      );
      m.rows.forEach(r => { if (emailRe.test(r.email)) recipients.add(r.email); });
    }
    const list = [...recipients];
    if (!list.length) return res.status(400).json({ error: 'No valid recipients' });

    const transporter = getTransporter();
    if (!transporter) return res.status(400).json({ error: 'Email is not configured on the server' });

    const url = formPublicUrl(form.slug);
    const sender = req.user?.name || 'A teammate';
    await transporter.sendMail({
      from: process.env.EMAIL_FROM || process.env.EMAIL_USER,
      to: process.env.EMAIL_FROM || process.env.EMAIL_USER,
      bcc: list.join(', '),
      subject: `${sender} shared a form with you: ${form.title}`,
      text: `${sender} invited you to fill out the form "${form.title}".\n\nOpen it here:\n${url}\n${form.description ? `\n${form.description}` : ''}`,
    });
    res.json({ success: true, sent: list.length });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ── QR code for the public form link (PNG data URL) ───────────────────────────
router.get('/forms/:id/qr', requireAuth, async (req, res) => {
  try {
    const fRes = await pool.query('SELECT slug, board_id FROM forms WHERE id=$1', [req.params.id]);
    if (!fRes.rows.length) return res.status(404).json({ error: 'Form not found' });
    if (!(await canAccessBoard(fRes.rows[0].board_id, req.user, pool))) return res.status(403).json({ error: 'Access denied' });
    const url = formPublicUrl(fRes.rows[0].slug);
    const data_url = await QRCode.toDataURL(url, { width: 240, margin: 1, color: { dark: '#1f2d3d', light: '#ffffff' } });
    res.json({ data_url, url });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to generate QR code' });
  }
});

router.put('/forms/:id/fields', ...canWrite, async (req, res) => {
  const client = await pool.connect();
  try {
    const formRes = await client.query('SELECT board_id FROM forms WHERE id=$1', [req.params.id]);
    if (!formRes.rows.length) return res.status(404).json({ error: 'Form not found' });
    if (!(await canAccessBoard(formRes.rows[0].board_id, req.user, pool))) return res.status(403).json({ error: 'Access denied' });

    await client.query('BEGIN');
    const { fields } = req.body;
    await client.query('DELETE FROM form_fields WHERE form_id=$1', [req.params.id]);
    if (Array.isArray(fields)) {
      for (let i = 0; i < fields.length; i++) {
        const f = fields[i];
        await client.query(
          `INSERT INTO form_fields (
            form_id, column_id, label, is_required, position, is_visible,
            help_text, placeholder, conditional_logic
          )
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9::jsonb)`,
          [
            req.params.id,
            f.column_id,
            f.label || null,
            bool(f.is_required, false),
            i,
            f.is_visible !== false,
            f.help_text || '',
            f.placeholder || '',
            JSON.stringify(jsonArray(f.conditional_logic)),
          ]
        );
      }
    }
    await client.query('COMMIT');
    const rows = await loadFields(pool, req.params.id, false);
    res.json(rows);
  } catch (err) {
    await client.query('ROLLBACK');
    console.error(err);
    res.status(500).json({ error: 'Internal server error' });
  } finally {
    client.release();
  }
});

router.get('/public/forms/:slug', async (req, res) => {
  const client = await pool.connect();
  try {
    const formRes = await client.query('SELECT * FROM forms WHERE slug=$1', [req.params.slug]);
    if (!formRes.rows.length) return res.status(404).json({ error: 'Form not found' });
    const form = formRes.rows[0];
    const fields = await loadFields(client, form.id, true);
    const openState = await availability(client, form);
    const captcha = form.captcha_enabled ? makeCaptcha() : null;
    res.json({
      ...form,
      is_active: openState.open,
      unavailable_reason: openState.reason,
      fields,
      captcha,
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Internal server error' });
  } finally {
    client.release();
  }
});

router.post('/public/forms/:slug/upload', formSubmitLimiter, upload.single('file'), async (req, res) => {
  try {
    const formRes = await pool.query('SELECT id FROM forms WHERE slug=$1', [req.params.slug]);
    if (!formRes.rows.length) return res.status(404).json({ error: 'Form not found' });
    if (!req.file) return res.status(400).json({ error: 'No file uploaded' });
    res.json({
      name: req.file.filename,
      originalName: req.file.originalname,
      url: `/api/files/${req.file.filename}`,
      size: req.file.size,
      mimeType: req.file.mimetype,
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

router.post('/public/forms/:slug/submit', formSubmitLimiter, async (req, res) => {
  const { fields: submittedFields = {}, captcha_token, captcha_answer } = req.body;
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const formRes = await client.query('SELECT * FROM forms WHERE slug=$1', [req.params.slug]);
    if (!formRes.rows.length) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'Form not found' });
    }
    const form = formRes.rows[0];
    const openState = await availability(client, form);
    if (!openState.open) {
      await client.query('ROLLBACK');
      return res.status(403).json({ error: form.closed_message || 'This form is no longer accepting responses.' });
    }
    if (form.captcha_enabled && !verifyCaptcha(captcha_token, captcha_answer)) {
      await client.query('ROLLBACK');
      return res.status(400).json({ error: 'CAPTCHA answer is incorrect. Please try again.' });
    }

    const allFields = await loadFields(client, form.id, true);
    const activeFields = allFields.filter(f => fieldIsShown(f, submittedFields));
    const allowedColIds = new Set(activeFields.map(r => String(r.column_id)));

    const itemName = String(submittedFields._name || '').trim() || 'Form Submission';
    if (!String(submittedFields._name || '').trim()) {
      await client.query('ROLLBACK');
      return res.status(400).json({ error: `${form.item_name_label || 'Item Name'} is required` });
    }
    for (const f of activeFields) {
      const value = submittedFields[String(f.column_id)];
      if (f.is_required && (value === undefined || value === null || String(value).trim() === '')) {
        await client.query('ROLLBACK');
        return res.status(400).json({ error: `${f.label || f.column_title} is required` });
      }
    }

    let targetGroupId = form.target_group_id;
    if (!targetGroupId) {
      const gRes = await client.query('SELECT id FROM groups WHERE board_id=$1 ORDER BY position ASC LIMIT 1', [form.board_id]);
      if (!gRes.rows.length) {
        await client.query('ROLLBACK');
        return res.status(400).json({ error: 'No groups found in board' });
      }
      targetGroupId = gRes.rows[0].id;
    }

    const posRes = await client.query('SELECT COALESCE(MAX(position),0)+1 AS pos FROM items WHERE group_id=$1', [targetGroupId]);
    const itemRes = await client.query(
      'INSERT INTO items (group_id, name, position) VALUES ($1,$2,$3) RETURNING *',
      [targetGroupId, itemName, posRes.rows[0].pos]
    );
    const item = itemRes.rows[0];

    const setColIds = new Set();
    const responseSnapshot = { _name: itemName };
    const titleByCol = {};
    activeFields.forEach(f => { titleByCol[String(f.column_id)] = f.column_title || f.label || `col #${f.column_id}`; });
    const formActor = `Form: ${form.title || 'Untitled'}`;
    // Map column id → type so we can detect person-column assignments and email
    // the new owner (form submissions previously skipped assignment emails).
    const colTypeRes = await client.query('SELECT id, type FROM columns WHERE board_id=$1', [form.board_id]);
    const colTypeById = {};
    for (const c of colTypeRes.rows) colTypeById[String(c.id)] = c.type;
    const formAssignments = [];
    for (const [colKey, value] of Object.entries(submittedFields)) {
      if (colKey === '_name') continue;
      if (!allowedColIds.has(colKey)) continue;
      const colId = parseInt(colKey, 10);
      if (!colId || value === undefined || value === null || value === '') continue;
      await client.query(
        `INSERT INTO column_values (item_id, column_id, value)
         VALUES ($1,$2,$3)
         ON CONFLICT (item_id, column_id) DO UPDATE SET value=EXCLUDED.value`,
        [item.id, colId, String(value)]
      );
      setColIds.add(colId);
      if (colTypeById[String(colId)] === 'person') formAssignments.push(String(value));
      responseSnapshot[colKey] = value;
      // Log the form-driven value so it shows in the item's history (previously
      // only the item-created event was recorded for form submissions).
      await logFormActivity(client, {
        board_id: form.board_id, user_name: formActor, item_id: item.id, item_name: itemName,
        action: 'value_changed', field: titleByCol[colKey], old_value: '', new_value: String(value),
      });
    }

    await client.query(
      `INSERT INTO form_submissions (form_id, item_id, response)
       VALUES ($1,$2,$3::jsonb)`,
      [form.id, item.id, JSON.stringify(responseSnapshot)]
    );

    await client.query(
      `INSERT INTO activity_logs (board_id,user_id,user_name,item_id,item_name,action,field,old_value,new_value)
       VALUES ($1,NULL,$2,$3,$4,'item_created',NULL,NULL,NULL)`,
      [form.board_id, `Form: ${form.title || 'Untitled'}`, item.id, itemName]
    );

    // item_created automations — run through the shared engine so form-triggered
    // rules honour "only if" conditions + multiple actions AND log their changes
    // (author "Automation: <name>"), exactly like board-driven item creation.
    const autoRes = await client.query(
      "SELECT * FROM automations WHERE board_id=$1 AND trigger_type='item_created' AND enabled=true",
      [form.board_id]
    );
    const deferredEffects = [];
    for (const auto of autoRes.rows) {
      if (!(await evaluateConditions(client, item.id, getConditions(auto)))) continue;
      const r = await executeActions(client, {
        actions: getActions(auto), auto,
        itemId: item.id, boardId: form.board_id, itemName,
        actor: { id: null, name: 'Form submission' },
      });
      for (const sv of r.setValues) setColIds.add(parseInt(sv.column_id, 10));
      deferredEffects.push(...r.deferred);
    }

    const colsRes = await client.query('SELECT id, settings FROM columns WHERE board_id=$1', [form.board_id]);
    for (const col of colsRes.rows) {
      const s = typeof col.settings === 'string' ? JSON.parse(col.settings) : (col.settings || {});
      const dv = s?.defaultValue;
      if (dv !== undefined && dv !== null && String(dv) !== '' && !setColIds.has(col.id)) {
        await client.query(
          `INSERT INTO column_values (item_id, column_id, value)
           VALUES ($1,$2,$3)
           ON CONFLICT (item_id, column_id) DO NOTHING`,
          [item.id, col.id, String(dv)]
        );
      }
    }

    await client.query('COMMIT');

    // Automation side-effects (send_email, assignment notifications) now that
    // the submission is durable.
    runDeferred(deferredEffects);

    // Email anyone the form directly assigned via a person field. New item, so
    // every owner is "newly added" (oldValue ''). Fire-and-forget.
    for (const assignedValue of formAssignments) {
      notifyNewAssignees({ oldValue: '', newValue: assignedValue, itemId: item.id, boardId: form.board_id, actor: { id: null, name: formActor } })
        .catch(err => console.error('[Forms] assignment email error:', err.message));
    }
    setImmediate(() => sendConfirmation({ form, itemName, fields: activeFields, submittedFields })
      .catch(err => console.error('[Forms] confirmation email error:', err.message)));
    setImmediate(() => notifySubmission({ form, itemId: item.id, itemName })
      .catch(err => console.error('[Forms] submission notify error:', err.message)));

    res.status(201).json({ success: true, item_id: item.id, redirect_url: form.redirect_url || '' });
  } catch (err) {
    await client.query('ROLLBACK');
    console.error(err);
    res.status(500).json({ error: 'Internal server error' });
  } finally {
    client.release();
  }
});

module.exports = router;
