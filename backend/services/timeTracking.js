// Shared helpers for the time-tracking suite.

// Recompute a cell's stored total (sum of COMPLETED sessions) and persist it
// into column_values so the column displays + sorts by accumulated time. Live
// running timers are added on top by the client; they are not stored here.
async function recomputeTotal(db, itemId, columnId) {
  const r = await db.query(
    `SELECT COALESCE(SUM(duration_seconds), 0)::int AS total
       FROM time_entries
      WHERE item_id = $1 AND column_id = $2 AND ended_at IS NOT NULL`,
    [itemId, columnId]
  );
  const total = r.rows[0].total;
  await db.query(
    `INSERT INTO column_values (item_id, column_id, value) VALUES ($1, $2, $3)
     ON CONFLICT (item_id, column_id) DO UPDATE SET value = EXCLUDED.value`,
    [itemId, columnId, String(total)]
  );
  return total;
}

// Stop every running timer for a user (used to enforce one active timer at a
// time). Returns the affected (item_id, column_id) cells so callers can react.
async function stopUserRunningTimers(db, userId) {
  const running = await db.query(
    `UPDATE time_entries
        SET ended_at = NOW(),
            duration_seconds = GREATEST(0, EXTRACT(EPOCH FROM (NOW() - started_at))::int)
      WHERE user_id = $1 AND ended_at IS NULL
      RETURNING item_id, column_id`,
    [userId]
  );
  const cells = [];
  const seen = new Set();
  for (const row of running.rows) {
    const key = `${row.item_id}:${row.column_id}`;
    if (seen.has(key)) continue;
    seen.add(key);
    await recomputeTotal(db, row.item_id, row.column_id);
    cells.push({ item_id: row.item_id, column_id: row.column_id });
  }
  return cells;
}

module.exports = { recomputeTotal, stopUserRunningTimers };
