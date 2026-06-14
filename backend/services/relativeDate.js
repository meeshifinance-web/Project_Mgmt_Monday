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

function computeRelativeDate({ weekday, weeks_ahead = 1, days_ahead, today = new Date() } = {}) {
  // Strip time so we operate on calendar days.
  const base = new Date(today.getFullYear(), today.getMonth(), today.getDate());

  // days_ahead path: a fixed offset from today (0 = today, 1 = tomorrow, …).
  // Takes precedence over the weekday spec when provided. This is what powers
  // "set due date to tomorrow" style automations.
  if (days_ahead !== undefined && days_ahead !== null && days_ahead !== '') {
    const da = Number(days_ahead);
    if (!Number.isInteger(da) || da < 0) {
      throw new Error(`days_ahead must be a non-negative integer, got ${days_ahead}`);
    }
    const t = new Date(base);
    t.setDate(base.getDate() + da);
    return `${t.getFullYear()}-${String(t.getMonth() + 1).padStart(2, '0')}-${String(t.getDate()).padStart(2, '0')}`;
  }

  const wd = Number(weekday);
  const wa = Math.max(1, Number(weeks_ahead) || 1);
  if (!Number.isInteger(wd) || wd < 0 || wd > 6) {
    throw new Error(`weekday must be 0..6, got ${weekday}`);
  }

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
