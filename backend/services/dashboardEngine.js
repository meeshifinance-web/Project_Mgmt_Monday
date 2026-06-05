// ───────────────────────────────────────────────────────────────────────────
// Dashboard engine
//   • Historical snapshots — captures one aggregate row per board per day so
//     dashboards can chart how metrics changed over time.
//   • Scheduled delivery — emails a digest of a dashboard's boards on a daily or
//     weekly schedule.
// ───────────────────────────────────────────────────────────────────────────
const pool = require('../db');
const { sendMail } = require('./email');

const TZ = 'Asia/Kolkata';
function nowIST(d = new Date()) {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', hour12: false, weekday: 'short' }).formatToParts(d);
  const get = (t) => parts.find(p => p.type === t)?.value;
  const dowMap = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };
  return { date: `${get('year')}-${get('month')}-${get('day')}`, hour: parseInt(get('hour'), 10), dow: dowMap[get('weekday')] };
}
function appUrl() { return (process.env.FRONTEND_URL || 'http://localhost:5173').replace(/\/$/, ''); }

// ── Snapshots ─────────────────────────────────────────────────────────────────
async function captureSnapshots(db = pool) {
  const boards = (await db.query(`SELECT id, name FROM boards WHERE is_deleted IS NOT TRUE`)).rows;
  let n = 0;
  for (const b of boards) {
    const cnt = (await db.query(
      `SELECT COUNT(*)::int AS n FROM items i JOIN groups g ON g.id=i.group_id WHERE g.board_id=$1 AND i.parent_item_id IS NULL`, [b.id]
    )).rows[0].n;
    const sc = (await db.query(`SELECT id, title FROM columns WHERE board_id=$1 AND type='status' ORDER BY position LIMIT 1`, [b.id])).rows[0];
    const statuses = {};
    if (sc) {
      const sr = await db.query(
        `SELECT cv.value, COUNT(*)::int AS n
           FROM column_values cv JOIN items i ON i.id=cv.item_id JOIN groups g ON g.id=i.group_id
          WHERE g.board_id=$1 AND cv.column_id=$2 AND i.parent_item_id IS NULL AND cv.value <> ''
          GROUP BY cv.value`, [b.id, sc.id]
      );
      sr.rows.forEach(r => { statuses[r.value] = r.n; });
    }
    const data = { items: cnt, status_column: sc ? sc.title : null, statuses };
    await db.query(
      `INSERT INTO board_snapshots (board_id, snapshot_date, data) VALUES ($1, CURRENT_DATE, $2)
       ON CONFLICT (board_id, snapshot_date) DO UPDATE SET data=EXCLUDED.data`, [b.id, JSON.stringify(data)]
    );
    n++;
  }
  return n;
}

// ── Scheduled delivery ────────────────────────────────────────────────────────
function isDue(dash, now = nowIST()) {
  if (!dash.schedule_enabled) return false;
  if ((dash.schedule_freq || 'daily') === 'weekly' && Number(dash.schedule_dow) !== now.dow) return false;
  if (Number(dash.schedule_hour) !== now.hour) return false;
  if (dash.last_sent_at) {
    const sent = nowIST(new Date(dash.last_sent_at));
    if (sent.date === now.date) return false; // already sent today
  }
  return true;
}

async function buildDigest(db, dashboard) {
  // Which boards does this dashboard reference?
  const widgets = (await db.query(`SELECT config FROM dashboard_widgets WHERE dashboard_id=$1`, [dashboard.id])).rows;
  const boardIds = new Set();
  for (const w of widgets) {
    const c = typeof w.config === 'string' ? JSON.parse(w.config || '{}') : (w.config || {});
    if (c.board_id) boardIds.add(Number(c.board_id));
    (c.metrics || []).forEach(m => m.board_id && boardIds.add(Number(m.board_id)));
    (c.board_ids || []).forEach(b => boardIds.add(Number(b)));
  }
  const rows = [];
  for (const bid of boardIds) {
    const b = (await db.query(`SELECT name FROM boards WHERE id=$1 AND is_deleted IS NOT TRUE`, [bid])).rows[0];
    if (!b) continue;
    const items = (await db.query(`SELECT COUNT(*)::int AS n FROM items i JOIN groups g ON g.id=i.group_id WHERE g.board_id=$1 AND i.parent_item_id IS NULL`, [bid])).rows[0].n;
    const sc = (await db.query(`SELECT id FROM columns WHERE board_id=$1 AND type='status' ORDER BY position LIMIT 1`, [bid])).rows[0];
    let statusHtml = '';
    if (sc) {
      const sr = (await db.query(
        `SELECT cv.value, COUNT(*)::int AS n FROM column_values cv JOIN items i ON i.id=cv.item_id JOIN groups g ON g.id=i.group_id
          WHERE g.board_id=$1 AND cv.column_id=$2 AND i.parent_item_id IS NULL AND cv.value<>'' GROUP BY cv.value ORDER BY n DESC`, [bid, sc.id]
      )).rows;
      statusHtml = sr.map(r => `${r.value}: <b>${r.n}</b>`).join(' &nbsp;·&nbsp; ');
    }
    rows.push(`<tr><td style="padding:8px 12px;border-bottom:1px solid #eee"><b>${b.name}</b></td><td style="padding:8px 12px;border-bottom:1px solid #eee">${items} items</td><td style="padding:8px 12px;border-bottom:1px solid #eee;color:#555">${statusHtml || '—'}</td></tr>`);
  }
  const url = `${appUrl()}/dashboards`;
  const html = `
    <div style="font-family:Inter,Arial,sans-serif;max-width:640px;margin:0 auto">
      <h2 style="color:#323338">📊 ${dashboard.name}</h2>
      <p style="color:#676879;font-size:13px">Your scheduled dashboard digest · ${nowIST().date}</p>
      <table style="border-collapse:collapse;width:100%;font-size:13px;border:1px solid #eee;border-radius:8px">
        <thead><tr style="background:#f7f8fc"><th align="left" style="padding:8px 12px">Board</th><th align="left" style="padding:8px 12px">Items</th><th align="left" style="padding:8px 12px">Status breakdown</th></tr></thead>
        <tbody>${rows.join('') || '<tr><td style="padding:12px" colspan="3">No boards on this dashboard.</td></tr>'}</tbody>
      </table>
      <p style="margin-top:18px"><a href="${url}" style="background:#9b72f5;color:#fff;text-decoration:none;padding:10px 18px;border-radius:8px;font-weight:600">Open dashboard →</a></p>
    </div>`;
  const text = `${dashboard.name} — dashboard digest (${nowIST().date})\n` + rows.length + ` boards. Open: ${url}`;
  return { html, text, boardCount: rows.length };
}

async function sendDashboard(db, dashboard) {
  const recipients = Array.isArray(dashboard.recipients) ? dashboard.recipients : (() => { try { return JSON.parse(dashboard.recipients || '[]'); } catch { return []; } })();
  if (!recipients.length) return { skipped: 'no recipients' };
  const { html, text } = await buildDigest(db, dashboard);
  await sendMail({ to: recipients, subject: `📊 ${dashboard.name} — dashboard digest`, html, text });
  await db.query(`UPDATE dashboards SET last_sent_at=NOW() WHERE id=$1`, [dashboard.id]);
  return { sent: recipients.length };
}

async function runScheduledDeliveries(db = pool) {
  const now = nowIST();
  const dashes = (await db.query(`SELECT * FROM dashboards WHERE schedule_enabled = true`)).rows;
  let sent = 0;
  for (const d of dashes) {
    if (!isDue(d, now)) continue;
    try { await sendDashboard(db, d); sent++; } catch (e) { console.error('[dashboardEngine] send failed:', e.message); }
  }
  return sent;
}

function start() {
  // Capture snapshots on boot, then every 6 hours (idempotent per day).
  captureSnapshots().then(n => console.log(`📸 Captured ${n} board snapshots`)).catch(e => console.error('[snapshots]', e.message));
  setInterval(() => captureSnapshots().catch(e => console.error('[snapshots]', e.message)), 6 * 3600 * 1000);
  // Check scheduled deliveries every 15 minutes.
  setInterval(() => runScheduledDeliveries().catch(e => console.error('[deliveries]', e.message)), 15 * 60 * 1000);
  console.log('✅ dashboardEngine started (snapshots + scheduled delivery)');
}

module.exports = { start, captureSnapshots, runScheduledDeliveries, isDue, buildDigest, sendDashboard, nowIST };
