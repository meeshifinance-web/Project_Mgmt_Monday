/**
 * dateArrivesEngine.js
 *
 * The "When a date arrives" automation trigger had been a UI-only stub
 * for a while — users could create the rule but no backend ever fired it.
 * This engine closes the loop. It scans every enabled `date_arrives`
 * automation, finds items whose date column matches today (plus an
 * optional offset), and dispatches the configured action.
 *
 * Trigger config shape (stored in automations.trigger_config JSON):
 *   {
 *     column_id:    <date column id on the rule's board>,
 *     mode:         'on' | 'after'   (default 'on')
 *     offset_days:  0 | 1 | 2 | …    // for 'on' mode, days BEFORE the date
 *   }
 *
 *   'on' mode: rule fires today when an item's date column equals today +
 *   offset_days. With offset_days=3, fires 3 days before the date arrives.
 *
 *   'after' mode: rule fires for any item whose date column has already
 *   passed (column_value < today) — useful for "auto-mark Overdue".
 *   Each (rule, item, past_date) combination fires at most once, so a
 *   set_status action re-fires only if the date changes.
 *
 *   'after' mode also accepts an optional `min_days_past` integer. When
 *   set, the rule only fires once an item is at least N days past the
 *   date column. Lets users build SLA-style escalation tiers — e.g. four
 *   parallel rules with thresholds 10 / 20 / 30 / 50 each flipping the
 *   status to a more urgent value as time passes. Each rule has its own
 *   automation_id so the dedup table keeps them independent: a single
 *   item walks up the ladder as the days roll, firing each tier once.
 *
 * Action types supported (re-uses existing dispatchers from items.js etc.):
 *   - send_email     → services/automationEmail.sendAutomationEmail
 *   - set_status     → writes to column_values
 *   - set_due_date   → uses services/relativeDate.computeRelativeDate
 *   - notify         → creates a notification row for board members
 *
 * Dedup:
 *   The (automation_id, item_id, fire_date) primary key on
 *   `date_arrives_fired` makes every (rule, item) fire at most once per
 *   calendar day, even if the backend restarts mid-day or the engine
 *   ticks more than once.
 *
 * Schedule (wired in index.js):
 *   - Once at process boot
 *   - Every 60 minutes thereafter
 *   The hourly cadence + per-day dedup means missed firings are caught
 *   on the next hour without ever doubling up.
 */

const pool = require('../db');
const { sendAutomationEmail } = require('./automationEmail');
const { computeRelativeDate } = require('./relativeDate');
const { getConditions, getActions, evaluateConditions, executeActions, runDeferred } = require('./automationEngine');

function todayISO() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function shiftDate(iso, days) {
  const [y, m, d] = iso.split('-').map(Number);
  const dt = new Date(y, m - 1, d);
  dt.setDate(dt.getDate() + days);
  return `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, '0')}-${String(dt.getDate()).padStart(2, '0')}`;
}

function parseJSONField(v) {
  if (v == null) return {};
  if (typeof v === 'object') return v;
  try { return JSON.parse(v); } catch { return {}; }
}

// Match a date column's stored value to a target ISO date. Some users
// type DD/MM/YYYY directly into cells, so accept both formats.
function valueMatchesDate(rawValue, targetISO) {
  if (!rawValue) return false;
  const s = String(rawValue).trim().split('T')[0];
  if (s === targetISO) return true;
  // DD/MM/YYYY → YYYY-MM-DD
  const m = /^(\d{1,2})[\/.\-](\d{1,2})[\/.\-](\d{4})$/.exec(s);
  if (m) {
    const iso = `${m[3]}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}`;
    return iso === targetISO;
  }
  return false;
}

// ── Action dispatcher ─────────────────────────────────────────────────────────
// Delegates to the shared automation engine so date-arrives rules honour the
// same "only if" CONDITIONS and run the same ordered, multi-ACTION list as the
// status-change / item-created triggers. Returns true only when the rule's
// conditions passed and its actions ran (so the caller dedups correctly —
// a rule whose conditions aren't met yet stays eligible to fire later).
async function dispatchAction({ automation, item, board }) {
  const conditions = getConditions(automation);
  if (!(await evaluateConditions(pool, item.id, conditions))) return false;

  const r = await executeActions(pool, {
    actions: getActions(automation), auto: automation,
    itemId: item.id, boardId: board.id, itemName: item.name,
    actor: null, // engine-driven (no human actor) — notify fans out to all members
  });
  runDeferred(r.deferred);
  return true;
}

// ── Main loop ───────────────────────────────────────────────────────────────
async function runDateArrivesEngine() {
  const today = todayISO();

  let rules;
  try {
    // Order rules by min_days_past ascending so when an item is past multiple
    // tiers in the same tick (common when rules are first created against
    // already-overdue items), the HIGHEST tier fires last and its status
    // wins. NULL threshold ('after' with no min) sorts first.
    rules = await pool.query(
      `SELECT a.* FROM automations a
        WHERE a.trigger_type='date_arrives' AND a.enabled=true
        ORDER BY COALESCE((a.trigger_config->>'min_days_past')::int, 0) ASC,
                 a.id ASC`
    );
  } catch (err) {
    console.error('[dateArrivesEngine] fetch rules failed:', err.message);
    return;
  }
  if (!rules.rows.length) return;

  // Convert any stored date value (ISO or DD/MM/YYYY) to a YYYY-MM-DD string
  // so we can string-compare against `today` to detect past dates.
  const toISO = (raw) => {
    if (!raw) return null;
    const s = String(raw).trim().split('T')[0];
    if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
    const m = /^(\d{1,2})[\/.\-](\d{1,2})[\/.\-](\d{4})$/.exec(s);
    if (m) return `${m[3]}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}`;
    return null;
  };

  let totalFired = 0;
  for (const auto of rules.rows) {
    const tcfg = parseJSONField(auto.trigger_config);
    if (!tcfg.column_id) continue;
    const mode = (tcfg.mode || 'on').toLowerCase();

    let candidates;
    try {
      candidates = await pool.query(
        `SELECT i.id, i.name, b.id AS board_id, b.name AS board_name, cv.value
           FROM items i
           JOIN groups g ON g.id = i.group_id
           JOIN boards b ON b.id = g.board_id
           JOIN column_values cv ON cv.item_id = i.id AND cv.column_id = $1
          WHERE b.id = $2
            AND (b.is_deleted IS NULL OR b.is_deleted = false)`,
        [tcfg.column_id, auto.board_id]
      );
    } catch (err) {
      console.error(`[dateArrivesEngine] candidate query failed for rule ${auto.id}:`, err.message);
      continue;
    }

    for (const row of candidates.rows) {
      const itemDate = toISO(row.value);
      if (!itemDate) continue;

      let fireDate; // the dedup key — different per mode
      if (mode === 'after') {
        // Fire once per (rule, item, past_date). If the user later changes
        // the date to a different past date, this fires again. If they fix
        // it to a future date, no fire.
        if (itemDate >= today) continue;

        // Optional SLA-tier gate — only fire once N days have passed since
        // the date column. Lets users build "10/20/30/50-days past"
        // escalation chains using four parallel rules with no extra schema.
        const minDaysPast = parseInt(tcfg.min_days_past, 10);
        if (Number.isFinite(minDaysPast) && minDaysPast > 0) {
          // Day-difference between two YYYY-MM-DD strings, exclusive of time.
          const [y1, m1, d1] = itemDate.split('-').map(Number);
          const [y2, m2, d2] = today.split('-').map(Number);
          const a = new Date(y1, m1 - 1, d1);
          const b = new Date(y2, m2 - 1, d2);
          const daysPast = Math.round((b - a) / (24 * 60 * 60 * 1000));
          if (daysPast < minDaysPast) continue;
        }

        fireDate = itemDate; // dedup keyed on the actual past date
      } else {
        // 'on' mode: fire today if itemDate === today + offset_days
        const offset = parseInt(tcfg.offset_days, 10) || 0;
        const targetDate = shiftDate(today, offset);
        if (itemDate !== targetDate) continue;
        fireDate = today;
      }

      // Dedup
      const seen = await pool.query(
        'SELECT 1 FROM date_arrives_fired WHERE automation_id=$1 AND item_id=$2 AND fire_date=$3',
        [auto.id, row.id, fireDate]
      );
      if (seen.rows.length) continue;

      try {
        const ran = await dispatchAction({
          automation: auto,
          item:       { id: row.id, name: row.name },
          board:      { id: row.board_id, name: row.board_name },
        });
        // Only dedup-record a fire when the rule actually ran. If its "only if"
        // conditions weren't met, leave it eligible to fire on a later tick.
        if (!ran) continue;
        await pool.query(
          `INSERT INTO date_arrives_fired (automation_id, item_id, fire_date)
           VALUES ($1,$2,$3) ON CONFLICT DO NOTHING`,
          [auto.id, row.id, fireDate]
        );
        totalFired++;
      } catch (err) {
        console.error(`[dateArrivesEngine] dispatch failed (rule ${auto.id}, item ${row.id}):`, err.message);
      }
    }
  }

  // Periodic cleanup — drop dedup rows older than 60 days.
  try {
    await pool.query(`DELETE FROM date_arrives_fired WHERE fire_date < (CURRENT_DATE - INTERVAL '60 days')`);
  } catch { /* non-fatal */ }

  if (totalFired > 0) {
    console.log(`[dateArrivesEngine] ✅ fired ${totalFired} rule(s) for ${today}`);
  }
}

// Boot once + every hour. setInterval handle is unref'd so it doesn't keep
// the process alive on its own (Node will exit when other listeners close).
let intervalHandle = null;
function startDateArrivesEngine() {
  if (intervalHandle) return;
  // Initial run on a small delay so DB/connections are ready
  setTimeout(() => runDateArrivesEngine().catch(err => console.error('[dateArrivesEngine] initial run error:', err.message)), 5000);
  intervalHandle = setInterval(() => {
    runDateArrivesEngine().catch(err => console.error('[dateArrivesEngine] tick error:', err.message));
  }, 60 * 60 * 1000); // hourly
  if (intervalHandle.unref) intervalHandle.unref();
  console.log('[dateArrivesEngine] ✅ started — runs hourly');
}

function stopDateArrivesEngine() {
  if (intervalHandle) { clearInterval(intervalHandle); intervalHandle = null; }
}

module.exports = { startDateArrivesEngine, stopDateArrivesEngine, runDateArrivesEngine };
