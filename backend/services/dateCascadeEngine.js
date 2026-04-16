// ── Date Cascade Engine ───────────────────────────────────────────────────────
// Calculates and upserts step dates for an item when an anchor date is set.
// Uses only the column_id integer (FK to columns.id) — no string column keys.

const pool = require('../db');

function toDateString(date) {
  // Returns 'YYYY-MM-DD' in UTC to avoid timezone shifts
  return date.toISOString().slice(0, 10);
}

function addDays(date, days) {
  const d = new Date(date);
  d.setUTCDate(d.getUTCDate() + days);
  return d;
}

/**
 * Run date cascade for a single board item.
 *
 * @param {object} opts
 * @param {number}  opts.boardId
 * @param {number}  opts.itemId
 * @param {number}  opts.anchorColumnId   - column_id of the anchor step (integer)
 * @param {string}  opts.anchorDate       - 'YYYY-MM-DD'
 * @param {string}  opts.direction        - 'forward' | 'backward' | 'both'
 * @param {number}  [opts.userId]
 * @param {number}  [opts.ruleId]
 * @param {boolean} [opts.forceOverwrite] - if true, overwrites manually-set cells
 * @returns {{ success, datesCalculated, stepsUpdated } | { success: false, reason }}
 */
async function runDateCascade({
  boardId, itemId, anchorColumnId, anchorDate, direction,
  userId, ruleId, forceOverwrite = false,
}) {
  // 1. Load all step templates for this board, ordered
  const { rows: steps } = await pool.query(
    `SELECT * FROM board_step_templates
     WHERE board_id=$1 ORDER BY step_order ASC`,
    [boardId]
  );
  if (!steps.length) return { success: false, reason: 'no_template' };

  // 2. Find anchor step index by column_id
  // Normalise all column_ids to integers so Map key comparisons are always number===number
  const anchorColIdInt = parseInt(anchorColumnId);
  steps.forEach(s => { s.column_id = parseInt(s.column_id); });

  const anchorIdx = steps.findIndex(s => s.column_id === anchorColIdInt);
  if (anchorIdx === -1) return { success: false, reason: 'anchor_not_found' };

  // 3. Build date map: { column_id (number) → Date }
  const dateMap = new Map();
  const anchorDateObj = new Date(anchorDate + 'T00:00:00Z');
  dateMap.set(anchorColIdInt, anchorDateObj);

  // 4. Forward: step[i].date = step[i-1].date + step[i-1].duration_days
  if (direction === 'forward' || direction === 'both') {
    for (let i = anchorIdx + 1; i < steps.length; i++) {
      const prev = steps[i - 1];
      const prevDate = dateMap.get(prev.column_id);
      if (!prevDate) continue;
      const dur = parseInt(prev.duration_days) || 0;
      dateMap.set(steps[i].column_id, dur === 0 ? prevDate : addDays(prevDate, dur));
    }
  }

  // 5. Backward: step[i].date = step[i+1].date - step[i].duration_days
  if (direction === 'backward' || direction === 'both') {
    for (let i = anchorIdx - 1; i >= 0; i--) {
      const next = steps[i + 1];
      const nextDate = dateMap.get(next.column_id);
      if (!nextDate) continue;
      const dur = parseInt(steps[i].duration_days) || 0;
      dateMap.set(steps[i].column_id, dur === 0 ? nextDate : addDays(nextDate, -dur));
    }
  }

  // 6. Persist calculated dates
  const datesCalculated = {};
  let stepsUpdated = 0;

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    for (const [colId, dateObj] of dateMap.entries()) {
      const colIdInt = parseInt(colId);
      const dateStr = toDateString(dateObj);

      // Anchor column: mark as NOT auto-cascaded (user entered this value)
      // and skip re-upsert — the caller already saved it
      if (colIdInt === anchorColIdInt) {
        await client.query(
          `INSERT INTO column_value_meta (item_id, column_id, is_auto_cascaded)
           VALUES ($1,$2,false)
           ON CONFLICT (item_id, column_id) DO UPDATE SET is_auto_cascaded=false`,
          [itemId, colIdInt]
        );
        continue;
      }

      // Respect manual overrides unless forceOverwrite
      if (!forceOverwrite) {
        const metaRes = await client.query(
          `SELECT is_auto_cascaded FROM column_value_meta
           WHERE item_id=$1 AND column_id=$2`,
          [itemId, colIdInt]
        );
        if (metaRes.rows.length > 0 && metaRes.rows[0].is_auto_cascaded === false) {
          continue; // user manually set this cell — leave it
        }
      }

      // Upsert date into column_values
      await client.query(
        `INSERT INTO column_values (item_id, column_id, value)
         VALUES ($1,$2,$3)
         ON CONFLICT (item_id, column_id) DO UPDATE SET value=EXCLUDED.value`,
        [itemId, colIdInt, dateStr]
      );

      // Mark as auto-cascaded
      await client.query(
        `INSERT INTO column_value_meta (item_id, column_id, is_auto_cascaded)
         VALUES ($1,$2,true)
         ON CONFLICT (item_id, column_id) DO UPDATE SET is_auto_cascaded=true`,
        [itemId, colIdInt]
      );

      datesCalculated[colIdInt] = dateStr;
      stepsUpdated++;
    }

    // 8. Write cascade log (only if something was actually updated)
    if (stepsUpdated > 0) {
      await client.query(
        `INSERT INTO automation_logs
           (board_id, item_id, rule_id, triggered_by, anchor_column_id, anchor_date, dates_calculated, performed_by)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
        [boardId, itemId, ruleId || null, direction, anchorColIdInt,
         anchorDate, JSON.stringify(datesCalculated), userId || null]
      );
    }

    await client.query('COMMIT');

    // Build a human-readable note when nothing was cascaded so the caller can surface it
    let note;
    if (stepsUpdated === 0) {
      if ((direction === 'backward' || direction === 'both') && anchorIdx === 0) {
        note = 'Anchor is the first step — no steps before it to cascade backward.';
      } else if ((direction === 'forward' || direction === 'both') && anchorIdx === steps.length - 1) {
        note = 'Anchor is the last step — no steps after it to cascade forward.';
      } else {
        note = 'All steps in cascade direction are manually set. Use Force Overwrite to recalculate.';
      }
    }

    return { success: true, datesCalculated, stepsUpdated, note };
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

module.exports = { runDateCascade };
