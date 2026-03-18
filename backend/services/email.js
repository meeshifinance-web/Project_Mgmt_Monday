const nodemailer = require('nodemailer');

function getTransporter() {
  if (!process.env.EMAIL_HOST || !process.env.EMAIL_USER) return null;
  return nodemailer.createTransport({
    host: process.env.EMAIL_HOST,
    port: parseInt(process.env.EMAIL_PORT) || 587,
    secure: false,
    auth: { user: process.env.EMAIL_USER, pass: process.env.EMAIL_PASS },
    tls: { rejectUnauthorized: false },
  });
}

async function sendPasswordReset(to, name, resetUrl) {
  const transporter = getTransporter();
  if (!transporter) {
    console.log(`\n🔑 Password Reset Link for ${to}:\n${resetUrl}\n`);
    return;
  }
  await transporter.sendMail({
    from: process.env.EMAIL_FROM || process.env.EMAIL_USER,
    to,
    subject: "Reset your D'Decor Workboard password",
    html: `
      <div style="font-family:sans-serif;max-width:480px;margin:0 auto;padding:24px">
        <h2 style="color:#323338">Password Reset</h2>
        <p>Hi ${name},</p>
        <p>We received a request to reset your D'Decor Workboard password. Click the button below — this link expires in <strong>1 hour</strong>.</p>
        <a href="${resetUrl}" style="display:inline-block;margin:16px 0;padding:12px 24px;background:#0073ea;color:#fff;border-radius:6px;text-decoration:none;font-weight:600">Reset Password</a>
        <p style="color:#888;font-size:12px">If you didn't request this, you can safely ignore this email.</p>
        <hr style="border:none;border-top:1px solid #eee;margin:24px 0"/>
        <p style="color:#aaa;font-size:11px">D'Decor Home Fabrics Pvt. Ltd.</p>
      </div>
    `,
  });
}

module.exports = { sendPasswordReset };
