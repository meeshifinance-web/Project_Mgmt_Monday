import React, { useMemo, useState } from 'react';

// Timeline / Gantt view. Renders each item as a horizontal bar on a day axis.
//
// Source of a bar's start/end:
//   1. A `timeline` column ("start → end")  — preferred.
//   2. Two `date` columns                   — first = start, second = end.
//   3. A single `date` column               — a one-day marker.

const DAY_MS = 86400000;
const ISO = /^\d{4}-\d{2}-\d{2}$/;
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

function parseISO(s) {
  if (!s || !ISO.test(s)) return null;
  const [y, m, d] = s.split('-').map(Number);
  return new Date(y, m - 1, d);
}
function daysBetween(a, b) { return Math.round((b - a) / DAY_MS); }
function parseDepIds(raw) {
  try { const a = JSON.parse(raw || '[]'); return Array.isArray(a) ? a.filter(Number.isInteger) : []; }
  catch { return []; }
}

function statusColor(columns, item, fallback) {
  const statusCol = columns.find(c => c.type === 'status');
  const val = statusCol && item.values?.[statusCol.id];
  if (!val) return fallback;
  const opt = (statusCol.settings?.options || []).find(o => o.label === val);
  return opt?.color || fallback;
}

// `showDependencies` distinguishes the two monday-style views that share this
// renderer: Timeline (clean roadmap, no dependency lines) vs Gantt (dependency
// arrows + critical-path highlighting).
export default function TimelineView({ groups = [], columns = [], onOpenDetail, criticalPath = [], showDependencies = true }) {
  const timelineCols = columns.filter(c => c.type === 'timeline');
  const dateCols = columns.filter(c => c.type === 'date');

  // Build the available "modes" the user can switch between.
  const modes = useMemo(() => {
    const m = timelineCols.map(c => ({ key: `tl:${c.id}`, label: c.title, kind: 'timeline', col: c }));
    if (dateCols.length >= 2) m.push({ key: `dd:${dateCols[0].id}:${dateCols[1].id}`, label: `${dateCols[0].title} → ${dateCols[1].title}`, kind: 'datepair', start: dateCols[0], end: dateCols[1] });
    for (const c of dateCols) m.push({ key: `d:${c.id}`, label: c.title, kind: 'date', col: c });
    return m;
  }, [columns]);

  const [modeKey, setModeKey] = useState(modes[0]?.key ?? null);
  const mode = modes.find(m => m.key === modeKey) || modes[0];

  // Resolve a {start,end} Date pair for an item under the active mode.
  function span(item) {
    if (!mode) return null;
    if (mode.kind === 'timeline') {
      const [s, e] = String(item.values?.[mode.col.id] || '').split('→').map(x => x.trim());
      const start = parseISO(s), end = parseISO(e) || start;
      return start ? { start, end: end || start } : null;
    }
    if (mode.kind === 'datepair') {
      const start = parseISO(item.values?.[mode.start.id]);
      const end = parseISO(item.values?.[mode.end.id]) || start;
      return start ? { start, end } : (end ? { start: end, end } : null);
    }
    const d = parseISO(item.values?.[mode.col.id]);
    return d ? { start: d, end: d } : null;
  }

  // Flatten to bars + compute axis bounds.
  const { bars, min, max } = useMemo(() => {
    const out = [];
    let lo = null, hi = null;
    for (const g of groups) {
      for (const item of g.items || []) {
        const sp = span(item);
        if (!sp) continue;
        if (!lo || sp.start < lo) lo = sp.start;
        if (!hi || sp.end > hi) hi = sp.end;
        out.push({ item, group: g, ...sp });
      }
    }
    return { bars: out, min: lo, max: hi };
  }, [groups, mode]);

  if (!modes.length) {
    return (
      <div style={{ textAlign: 'center', padding: 60, color: 'var(--text-secondary)' }}>
        <div style={{ fontSize: 36, marginBottom: 10 }}>📊</div>
        <div>Add a Timeline column (or a Date column) to use Timeline view</div>
      </div>
    );
  }
  if (!bars.length || !min || !max) {
    return (
      <div style={{ padding: 16 }}>
        <ModeBar modes={modes} modeKey={modeKey} setModeKey={setModeKey} />
        <div style={{ textAlign: 'center', padding: 50, color: 'var(--text-secondary)' }}>No dated items to plot yet.</div>
      </div>
    );
  }

  // Pad the axis by a few days on each side and pick a day width that keeps the
  // chart legible for both short and very long ranges.
  const axisStart = new Date(min.getFullYear(), min.getMonth(), min.getDate() - 2);
  const axisEnd = new Date(max.getFullYear(), max.getMonth(), max.getDate() + 2);
  const totalDays = daysBetween(axisStart, axisEnd) + 1;
  const dayPx = totalDays <= 45 ? 26 : totalDays <= 120 ? 12 : totalDays <= 400 ? 5 : 2.5;
  const chartW = totalDays * dayPx;
  const LABEL_W = 220;
  const ROW_H = 34;

  // Month header segments.
  const monthSegs = [];
  let cur = new Date(axisStart.getFullYear(), axisStart.getMonth(), 1);
  while (cur <= axisEnd) {
    const segStart = cur < axisStart ? axisStart : cur;
    const next = new Date(cur.getFullYear(), cur.getMonth() + 1, 1);
    const segEnd = next > axisEnd ? axisEnd : new Date(next - DAY_MS);
    const left = daysBetween(axisStart, segStart) * dayPx;
    const width = (daysBetween(segStart, segEnd) + 1) * dayPx;
    monthSegs.push({ key: `${cur.getFullYear()}-${cur.getMonth()}`, label: `${MONTHS[cur.getMonth()]} ${cur.getFullYear()}`, left, width });
    cur = next;
  }

  const today = new Date(); today.setHours(0, 0, 0, 0);
  const todayLeft = (today >= axisStart && today <= axisEnd) ? daysBetween(axisStart, today) * dayPx : null;

  // Build rows + per-bar geometry (used for dependency arrows + critical path).
  // In Timeline mode dependencies are hidden entirely (it's a roadmap view).
  const depCol = showDependencies ? columns.find(c => c.type === 'dependency') : null;
  const criticalSet = new Set(showDependencies ? criticalPath : []);
  const criticalEdges = new Set();
  for (let i = 0; i + 1 < criticalPath.length; i++) criticalEdges.add(criticalPath[i] + '->' + criticalPath[i + 1]);

  const rows = [];
  const geom = {};
  let yCursor = 0;
  for (const g of groups) {
    const gb = bars.filter(b => b.group.id === g.id);
    if (!gb.length) continue;
    rows.push({ type: 'group', group: g });
    yCursor += 28;
    gb.sort((a, b) => a.start - b.start);
    for (const b of gb) {
      const left = daysBetween(axisStart, b.start) * dayPx;
      const width = Math.max(dayPx, (daysBetween(b.start, b.end) + 1) * dayPx);
      geom[b.item.id] = { left, width, cy: yCursor + ROW_H / 2 };
      rows.push({ type: 'bar', left, width, ...b });
      yCursor += ROW_H;
    }
  }
  const totalHeight = yCursor;

  // Dependency arrows: predecessor right edge → successor left edge.
  const arrows = [];
  if (depCol) {
    for (const b of bars) {
      const succ = geom[b.item.id];
      if (!succ) continue;
      for (const pid of parseDepIds(b.item.values?.[depCol.id])) {
        const pred = geom[pid];
        if (!pred) continue;
        arrows.push({
          x1: LABEL_W + pred.left + pred.width, y1: pred.cy,
          x2: LABEL_W + succ.left, y2: succ.cy,
          crit: criticalEdges.has(pid + '->' + b.item.id),
        });
      }
    }
  }
  const hasCritical = criticalSet.size > 0;

  return (
    <div style={{ padding: 16, height: '100%', display: 'flex', flexDirection: 'column' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 10, flexWrap: 'wrap' }}>
        <ModeBar modes={modes} modeKey={modeKey} setModeKey={setModeKey} />
        {hasCritical && (
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 12, fontWeight: 600, color: '#e2445c' }}>
            <span style={{ width: 14, height: 4, borderRadius: 2, background: '#e2445c' }} /> Critical path ({criticalSet.size} tasks)
          </span>
        )}
      </div>
      <div style={{ flex: 1, overflow: 'auto', border: '1px solid var(--border-color)', borderRadius: 10 }}>
        <div style={{ minWidth: LABEL_W + chartW }}>
          {/* Month header */}
          <div style={{ display: 'flex', position: 'sticky', top: 0, zIndex: 5, background: 'var(--card-bg)', borderBottom: '1px solid var(--border-color)' }}>
            <div style={{ width: LABEL_W, flexShrink: 0, borderRight: '1px solid var(--border-color)', padding: '6px 12px', fontSize: 11, fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase', position: 'sticky', left: 0, background: 'var(--card-bg)' }}>Item</div>
            <div style={{ position: 'relative', width: chartW, height: 30 }}>
              {monthSegs.map(s => (
                <div key={s.key} style={{ position: 'absolute', left: s.left, width: s.width, top: 0, bottom: 0, borderRight: '1px solid var(--border-color)', fontSize: 11, fontWeight: 700, color: 'var(--text-secondary)', padding: '7px 6px', whiteSpace: 'nowrap', overflow: 'hidden' }}>{s.width > 44 ? s.label : ''}</div>
              ))}
            </div>
          </div>

          {/* Rows */}
          <div style={{ position: 'relative' }}>
            {todayLeft != null && (
              <div style={{ position: 'absolute', left: LABEL_W + todayLeft, top: 0, bottom: 0, width: 2, background: '#e2445c', zIndex: 2, pointerEvents: 'none' }} />
            )}

            {/* Dependency arrow overlay */}
            {arrows.length > 0 && (
              <svg width={LABEL_W + chartW} height={totalHeight} style={{ position: 'absolute', top: 0, left: 0, pointerEvents: 'none', zIndex: 4, overflow: 'visible' }}>
                <defs>
                  <marker id="tl-arrow" markerWidth="7" markerHeight="7" refX="5.5" refY="3" orient="auto">
                    <path d="M0,0 L6,3 L0,6 Z" fill="#9aa5b8" />
                  </marker>
                  <marker id="tl-arrow-crit" markerWidth="7" markerHeight="7" refX="5.5" refY="3" orient="auto">
                    <path d="M0,0 L6,3 L0,6 Z" fill="#e2445c" />
                  </marker>
                </defs>
                {arrows.map((a, i) => {
                  const gap = Math.min(16, Math.max(8, Math.abs(a.x2 - a.x1) / 2));
                  const d = `M ${a.x1} ${a.y1} C ${a.x1 + gap} ${a.y1}, ${a.x2 - gap} ${a.y2}, ${a.x2} ${a.y2}`;
                  return <path key={i} d={d} fill="none" stroke={a.crit ? '#e2445c' : '#9aa5b8'} strokeWidth={a.crit ? 2 : 1.3} strokeDasharray={a.crit ? '0' : '4 3'} markerEnd={`url(#${a.crit ? 'tl-arrow-crit' : 'tl-arrow'})`} opacity={a.crit ? 0.95 : 0.7} />;
                })}
              </svg>
            )}

            {rows.map((r, i) => {
              if (r.type === 'group') {
                return (
                  <div key={`g${r.group.id}-${i}`} style={{ display: 'flex', alignItems: 'center', height: 28, background: 'var(--bg-secondary)', borderBottom: '1px solid var(--border-color)' }}>
                    <div style={{ width: LABEL_W, flexShrink: 0, padding: '0 12px', position: 'sticky', left: 0, background: 'var(--bg-secondary)', display: 'flex', alignItems: 'center', gap: 7 }}>
                      <span style={{ width: 9, height: 9, borderRadius: '50%', background: r.group.color }} />
                      <span style={{ fontSize: 12, fontWeight: 700, color: 'var(--text-primary)' }}>{r.group.name}</span>
                    </div>
                  </div>
                );
              }
              const color = statusColor(columns, r.item, r.group.color);
              const isCritical = criticalSet.has(r.item.id);
              return (
                <div key={`b${r.item.id}-${i}`} style={{ display: 'flex', height: ROW_H, borderBottom: '1px solid var(--border-color)' }}>
                  <div style={{ width: LABEL_W, flexShrink: 0, padding: '0 12px', display: 'flex', alignItems: 'center', gap: 5, position: 'sticky', left: 0, background: 'var(--card-bg)', zIndex: 1 }}>
                    {isCritical && <span title="On the critical path" style={{ fontSize: 10, color: '#e2445c' }}>🔥</span>}
                    <span style={{ fontSize: 12, color: 'var(--text-primary)', fontWeight: isCritical ? 700 : 400, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{r.item.name}</span>
                  </div>
                  <div style={{ position: 'relative', width: chartW }}>
                    <button
                      onClick={() => onOpenDetail?.(r.item.id)}
                      title={`${r.item.name}\n${r.start.toISOString().slice(0, 10)} → ${r.end.toISOString().slice(0, 10)}${isCritical ? '\n⚠ On the critical path' : ''}`}
                      style={{
                        position: 'absolute', left: r.left, width: r.width, top: 6, height: ROW_H - 12,
                        background: color, borderRadius: 6, cursor: 'pointer',
                        display: 'flex', alignItems: 'center', padding: '0 7px', overflow: 'hidden',
                        border: isCritical ? '2px solid #e2445c' : 'none',
                        boxShadow: isCritical ? '0 0 0 2px rgba(226,68,92,0.25), 0 1px 3px rgba(0,0,0,0.18)' : '0 1px 3px rgba(0,0,0,0.18)',
                      }}
                    >
                      <span style={{ fontSize: 11, fontWeight: 600, color: '#fff', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{r.width > 60 ? r.item.name : ''}</span>
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
}

function ModeBar({ modes, modeKey, setModeKey }) {
  if (modes.length <= 1) return null;
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10 }}>
      <span style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-muted)' }}>Date range:</span>
      <select
        value={modeKey ?? ''}
        onChange={e => setModeKey(e.target.value)}
        style={{ padding: '5px 8px', borderRadius: 7, border: '1px solid var(--border-color)', background: 'var(--card-bg)', color: 'var(--text-primary)', fontSize: 13 }}
      >
        {modes.map(m => <option key={m.key} value={m.key}>{m.label}</option>)}
      </select>
    </div>
  );
}
