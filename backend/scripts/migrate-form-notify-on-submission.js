/**
 * migrate-form-notify-on-submission.js
 *
 * Idempotent: adds forms.notify_on_submission (BOOLEAN, default false).
 * When enabled, every public submission notifies the board's team (in-app + email),
 * in addition to the optional confirmation email sent to the respondent.
 *
 *   node scripts/migrate-form-notify-on-submission.js
 */
require('dotenv').config();
const pool = require('../db');

(async () => {
  try {
    await pool.query(`ALTER TABLE forms ADD COLUMN IF NOT EXISTS notify_on_submission BOOLEAN DEFAULT false`);
    await pool.query(`UPDATE forms SET notify_on_submission=false WHERE notify_on_submission IS NULL`);
    console.log('✅ forms.notify_on_submission present.');
  } catch (err) {
    console.error('❌ migration failed:', err.message);
    process.exitCode = 1;
  } finally {
    await pool.end();
  }
})();
