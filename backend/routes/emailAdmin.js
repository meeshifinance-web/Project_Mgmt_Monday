const express = require('express');
const router  = express.Router();
const nodemailer = require('nodemailer');
const { requireAuth, requireRole } = require('../middleware/auth');

// ── POST /api/email/test  — verify SMTP and send a test email ────────────────
router.post('/test', requireAuth, requireRole('admin', 'manager'), async (req, res) => {
  const { to } = req.body;
  if (!to) return res.status(400).json({ error: 'to is required' });

  const { EMAIL_HOST, EMAIL_PORT, EMAIL_USER, EMAIL_PASS, EMAIL_FROM } = process.env;

  if (!EMAIL_HOST || !EMAIL_USER) {
    return res.status(400).json({
      error: 'SMTP not configured',
      detail: 'EMAIL_HOST and EMAIL_USER must be set in backend/.env',
    });
  }

  const port = parseInt(EMAIL_PORT) || 587;
  const transporter = nodemailer.createTransport({
    host:       EMAIL_HOST,
    port,
    secure:     port === 465,
    requireTLS: port !== 465,
    auth:       { user: EMAIL_USER, pass: EMAIL_PASS },
    tls:        { rejectUnauthorized: false },
  });

  try {
    await transporter.verify();
    await transporter.sendMail({
      from:    EMAIL_FROM || EMAIL_USER,
      to,
      subject: "D'Decor Workboard — SMTP Test",
      text:    `SMTP test successful.\n\nSent from: ${EMAIL_USER}\nHost: ${EMAIL_HOST}:${port}`,
    });
    console.log(`[EmailTest] ✅ Test email sent to <${to}>`);
    res.json({ success: true, from: EMAIL_FROM || EMAIL_USER, to, host: `${EMAIL_HOST}:${port}` });
  } catch (err) {
    console.error('[EmailTest] ❌', err.message, err.code || '', err.response || '');
    res.status(500).json({
      error:    err.message,
      code:     err.code || null,
      response: err.response || null,
    });
  }
});

module.exports = router;
