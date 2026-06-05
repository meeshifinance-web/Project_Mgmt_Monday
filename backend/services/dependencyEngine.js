// ───────────────────────────────────────────────────────────────────────────
// Dependency engine — auto-shift + critical path.
//
//   • A `dependency` column stores, per item, a JSON array of predecessor item
//     ids (tasks this one waits for). Its settings name the `scheduleColumnId`
//     (a `timeline` column "start → end") that holds each task's dates, an
//     optional `lag` (gap in days), and an `autoShift` flag.
//
//   • Auto-shift: when a task's timeline changes, a Finish-to-Start forward pass
//     pushes every dependent task so it starts after its latest predecessor
//     finishes (push-only — slipping a task moves dependents later; it never
//     silently compresses a schedule). Transitive and cycle-safe.
//
//   • Critical path: the longest dependency chain (by total duration) that
//     determines the project end. Returned as an ordered list of item ids.
// ───────────────────────────────────────────────────────────────────────────

const ISO = /^\d{4}-\d{2}-\d{2}$/;
const DAY = 86400000;

function parseSettings(s) {
  if (!s) return {};
  return typeof s === 'string' ? (() => { try { return JSON.parse(s); } catch { return {}; } })() : s;
}
function parseIds(raw) {
  if (!raw) return [];
  try { const a = JSON.parse(raw); return Array.isArray(a) ? a.map(n => parseInt(n, 10)).filter(Number.isInteger) : []; }
  catch { return []; }
}
function parseTimeline(v) {
  if (!v) return null;
  const [s, e] = String(v).split('→').map(x => x.trim());
  const start = ISO.test(s) ? s : null;
  if (!start) return null;
  const end = ISO.test(e) ? e : start;
  return end < start ? { start, end: start } : { start, end };
}
function toDate(s) { const [y, m, d] = s.split('-').map(Number); return new Date(Date.UTC(y, m - 1, d)); }
function fmt(dt) { return dt.toISOString().slice(0, 10); }
function addDays(s, n) { const d = toDate(s); d.setUTCDate(d.getUTCDate() + n); return fmt(d); }
function offsetDays(start, end) { return Math.round((toDate(end) - toDate(start)) / DAY); } // span (end-start)

// Kahn topological order; returns null on cycle.
function topoOrder(ids, preds) {
  const indeg = {}, adj = {};
  ids.forEach(n => { indeg[n] = 0; adj[n] = []; });
  for (const n of ids) for (const p of (preds[n] || [])) if (adj[p] !== undefined) { adj[p].push(n); indeg[n]++; }
  const q = ids.filter(n => indeg[n] === 0);
  const order = [];
  while (q.length) { const n = q.shift(); order.push(n); for (const s of adj[n]) if (--indeg[s] === 0) q.push(s); }
  return order.length === ids.length ? order : null;
}

// Forward pass, push-only. `tasks`: [{ id, preds:[ids], start, end }] (scheduled only).
function computeShifts(tasks, lag = 0) {
  const byId = new Map(tasks.map(t => [t.id, t]));
  const ids = tasks.map(t => t.id);
  const preds = {};
  tasks.forEach(t => { preds[t.id] = t.preds.filter(p => byId.has(p)); });
  const order = topoOrder(ids, preds);
  if (!order) return { changes: [], cycle: true };

  const cur = new Map(tasks.map(t => [t.id, { start: t.start, end: t.end }]));
  const changes = [];
  for (const id of order) {
    if (!preds[id].length) continue;
    const sched = cur.get(id);
    const maxPredEnd = preds[id].map(p => cur.get(p).end).sort().pop(); // ISO strings sort chronologically
    const minStart = addDays(maxPredEnd, lag + 1);
    if (minStart > sched.start) {
      const span = offsetDays(sched.start, sched.end);
      const ns = minStart, ne = addDays(ns, span);
      cur.set(id, { start: ns, end: ne });
      changes.push({ id, start: ns, end: ne });
    }
  }
  return { changes, cycle: false };
}

// Longest path (by inclusive duration) through the dependency DAG → ordered ids.
function criticalPath(tasks) {
  const byId = new Map(tasks.map(t => [t.id, t]));
  const ids = tasks.map(t => t.id);
  const preds = {};
  tasks.forEach(t => { preds[t.id] = t.preds.filter(p => byId.has(p)); });
  const order = topoOrder(ids, preds);
  if (!order) return [];
  const dur = (id) => offsetDays(byId.get(id).start, byId.get(id).end) + 1; // inclusive days
  const ef = {}, parent = {};
  for (const id of order) {
    let best = 0, bp = null;
    for (const p of preds[id]) if (ef[p] > best) { best = ef[p]; bp = p; }
    ef[id] = best + dur(id); parent[id] = bp;
  }
  let endId = null, max = -1;
  for (const id of ids) if (ef[id] > max) { max = ef[id]; endId = id; }
  const path = [];
  for (let n = endId; n != null; n = parent[n]) path.push(n);
  // A path of a single task with no dependencies isn't a meaningful "critical path".
  return path.length > 1 ? path.reverse() : [];
}

// Load the scheduled tasks for a board's dependency column.
async function loadTasks(db, boardId, depColId, scheduleColId) {
  const { rows } = await db.query(
    `SELECT i.id,
            dep.value AS dep_value,
            sch.value AS sch_value
       FROM items i
       JOIN groups g ON g.id = i.group_id
       LEFT JOIN column_values dep ON dep.item_id = i.id AND dep.column_id = $2
       LEFT JOIN column_values sch ON sch.item_id = i.id AND sch.column_id = $3
      WHERE g.board_id = $1`,
    [boardId, depColId, scheduleColId]
  );
  const tasks = [];
  for (const r of rows) {
    const tl = parseTimeline(r.sch_value);
    if (!tl) continue;
    tasks.push({ id: r.id, preds: parseIds(r.dep_value), start: tl.start, end: tl.end });
  }
  return tasks;
}

// Find the dependency column on a board whose schedule column matches (or any).
async function getDepConfig(db, boardId, scheduleColId = null) {
  const { rows } = await db.query(
    "SELECT id, settings FROM columns WHERE board_id=$1 AND type='dependency' ORDER BY position",
    [boardId]
  );
  for (const r of rows) {
    const st = parseSettings(r.settings);
    if (!st.scheduleColumnId) continue;
    if (scheduleColId == null || parseInt(st.scheduleColumnId, 10) === parseInt(scheduleColId, 10)) {
      return { depColId: r.id, scheduleColumnId: parseInt(st.scheduleColumnId, 10), lag: parseInt(st.lag, 10) || 0, autoShift: st.autoShift !== false };
    }
  }
  return null;
}

// Run auto-shift after a timeline change. Writes shifted schedule values and
// returns the changes so the caller can surface them to the client.
async function runAutoShift(pool, boardId, changedScheduleColId) {
  const cfg = await getDepConfig(pool, boardId, changedScheduleColId);
  if (!cfg || !cfg.autoShift) return [];
  const tasks = await loadTasks(pool, boardId, cfg.depColId, cfg.scheduleColumnId);
  const { changes } = computeShifts(tasks, cfg.lag);
  if (!changes.length) return [];

  const client = await pool.connect();
  const applied = [];
  try {
    await client.query('BEGIN');
    for (const c of changes) {
      const value = `${c.start} → ${c.end}`;
      await client.query(
        `INSERT INTO column_values (item_id, column_id, value) VALUES ($1,$2,$3)
         ON CONFLICT (item_id, column_id) DO UPDATE SET value=EXCLUDED.value`,
        [c.id, cfg.scheduleColumnId, value]
      );
      applied.push({ item_id: c.id, column_id: cfg.scheduleColumnId, value });
    }
    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    console.error('[dependencyEngine] auto-shift failed:', err.message);
    client.release();
    return [];
  }
  client.release();
  return applied;
}

// Attach board.criticalPath (ordered ids) for the board's dependency column.
async function attachCriticalPath(pool, board) {
  const cfg = await getDepConfig(pool, board.id);
  if (!cfg) { board.criticalPath = []; return; }
  const tasks = await loadTasks(pool, board.id, cfg.depColId, cfg.scheduleColumnId);
  board.criticalPath = criticalPath(tasks);
  board.scheduleColumnId = cfg.scheduleColumnId;
}

module.exports = { runAutoShift, attachCriticalPath, computeShifts, criticalPath, parseTimeline, _internals: { topoOrder, addDays, offsetDays } };
