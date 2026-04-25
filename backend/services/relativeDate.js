/**
 * relativeDate.js
 *
 * Helper to compute a target date from a weekday + weeks-ahead spec, used by
 * the `set_due_date` automation action so item-created automations can
 * auto-fill recurring review/meeting dates (e.g. "Monday next week",
 * "Thursday two weeks from now").
 *
 * Semantics:
 *   weekday      → 0..6  (Sun=0, Mon=1, Tue=2, Wed=3, Thu=4, Fri=5, Sat=6)
 *                  matches JavaScript's Date.getDay() so the same numbers
 *                  flow from the UI to the backend without translation.
 *   weeks_ahead  → 1, 2, 3, …
 *                  1 = the next upcoming occurrence of `weekday` that is at
 *                      least 1 day from today (so "next Monday" is always
 *                      genuinely next, never today).
 *                  2 = one week after that, and so on.
 *
 * Returns: 'YYYY-MM-DD' string (no time component — the date column stores
 *          calendar dates, not timestamps).
 *
 * Timezone: uses the server's local clock. For dates without time-of-day
 *          this is generally fine; if cross-tz drift becomes an issue, we
 *          can switch to a fixed IST anchor by adding +05:30 here.
 */

function computeRelativeDate({ weekday, weeks_ahead = 1, today = new Date() } = {}) {
  const wd = Number(weekday);
  const wa = Math.max(1, Number(weeks_ahead) || 1);
  if (!Number.isInteger(wd) || wd < 0 || wd > 6) {
    throw new Error(`weekday must be 0..6, got ${weekday}`);
  }

  // Strip time so we operate on calendar days.
  const base = new Date(today.getFullYear(), today.getMonth(), today.getDate());
  const dow  = base.getDay();

  // Days until the next occurrence of `weekday` (1..7, never 0 — "today" is
  // not the answer for "next <weekday>"; the user always wants a future date).
  let daysUntil = ((wd - dow + 7) % 7);
  if (daysUntil === 0) daysUntil = 7;

  // weeks_ahead = 1 → that next occurrence; 2 → one week later; etc.
  const totalDays = daysUntil + (wa - 1) * 7;

  const target = new Date(base);
  target.setDate(base.getDate() + totalDays);

  const yyyy = target.getFullYear();
  const mm   = String(target.getMonth() + 1).padStart(2, '0');
  const dd   = String(target.getDate()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}`;
}

module.exports = { computeRelativeDate };
