import React, { useMemo, useState } from 'react';
import { toISODate } from '../../utils/dateFormat';

// ── Helpers ───────────────────────────────────────────────────────────────────
// Extract a YYYY-MM-DD date from a cell value. Date columns store ISO dates
// directly; timeline columns store "start → end" and we anchor on the start.
function cellDate(col, raw) {
  if (!raw) return null;
  if (col.type === 'timeline') {
    const start = String(raw).split('→')[0]?.trim();
    return /^\d{4}-\d{2}-\d{2}$/.test(start) ? start : null;
  }
  return /^\d{4}-\d{2}-\d{2}$/.test(raw) ? raw : (toISODate(raw) || null);
}

function statusInfo(columns, item) {
  const statusCol = columns.find(c => c.type === 'status');
  if (!statusCol) return null;
  const val = item.values?.[statusCol.id];
  if (!val) return null;
  const opt = (statusCol.settings?.options || []).find(o => o.label === val);
  return { label: val, color: opt?.color || '#c4c4c4' };
}

const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July',
  'August', 'September', 'October', 'November', 'December'];

export default function CalendarView({ groups = [], columns = [], onOpenDetail }) {
  const dateCols = useMemo(
    () => columns.filter(c => c.type === 'date' || c.type === 'timeline'),
    [columns]
  );
  const [colId, setColId] = useState(dateCols[0]?.id ?? null);
  const dateCol = dateCols.find(c => c.id === colId) || dateCols[0];

  const today = new Date();
  const [cursor, setCursor] = useState({ y: today.getFullYear(), m: today.getMonth() });
  const todayKey = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;

  // Map every item to its day bucket for the active date column.
  const byDay = useMemo(() => {
    const map = {};
    if (!dateCol) return map;
    for (const g of groups) {
      for (const item of g.items || []) {
        const key = cellDate(dateCol, item.values?.[dateCol.id]);
        if (!key) continue;
        (map[key] = map[key] || []).push({ item, group: g });
      }
    }
    return map;
  }, [groups, dateCol]);

  if (!dateCol) {
    return (
      <div style={{ textAlign: 'center', padding: 60, color: 'var(--text-secondary)' }}>
        <div style={{ fontSize: 36, marginBottom: 10 }}>📅</div>
        <div>Add a Date or Timeline column to use Calendar view</div>
      </div>
    );
  }

  // Build the 6×7 day grid (leading/trailing days from neighbouring months).
  const first = new Date(cursor.y, cursor.m, 1);
  const startOffset = first.getDay();
  const daysInMonth = new Date(cursor.y, cursor.m + 1, 0).getDate();
  const cells = [];
  for (let i = 0; i < startOffset; i++) cells.push(null);
  for (let d = 1; d <= daysInMonth; d++) cells.push(d);
  while (cells.length % 7 !== 0) cells.push(null);

  const go = (delta) => setCursor(c => {
    const nm = c.m + delta;
    return { y: c.y + Math.floor(nm / 12), m: ((nm % 12) + 12) % 12 };
  });

  const navBtn = (label, onClick, title) => (
    <button onClick={onClick} title={title} style={{
      padding: '5px 10px', fontSize: 13, fontWeight: 600, borderRadius: 7,
      border: '1px solid var(--border-color)', background: 'var(--card-bg)',
      color: 'var(--text-secondary)', cursor: 'pointer',
    }}>{label}</button>
  );

  return (
    <div style={{ padding: 16, height: '100%', display: 'flex', flexDirection: 'column' }}>
      {/* Toolbar */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 12 }}>
        <div style={{ fontSize: 18, fontWeight: 800, color: 'var(--text-primary)', minWidth: 180 }}>
          {MONTHS[cursor.m]} {cursor.y}
        </div>
        {navBtn('‹', () => go(-1), 'Previous month')}
        {navBtn('Today', () => setCursor({ y: today.getFullYear(), m: today.getMonth() }))}
        {navBtn('›', () => go(1), 'Next month')}
        <div style={{ flex: 1 }} />
        {dateCols.length > 1 && (
          <select
            value={colId ?? ''}
            onChange={e => setColId(Number(e.target.value))}
            style={{ padding: '5px 8px', borderRadius: 7, border: '1px solid var(--border-color)', background: 'var(--card-bg)', color: 'var(--text-primary)', fontSize: 13 }}
          >
            {dateCols.map(c => <option key={c.id} value={c.id}>{c.title}</option>)}
          </select>
        )}
      </div>

      {/* Weekday header */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', gap: 4, marginBottom: 4 }}>
        {WEEKDAYS.map(w => (
          <div key={w} style={{ fontSize: 11, fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase', textAlign: 'center', padding: '4px 0' }}>{w}</div>
        ))}
      </div>

      {/* Day grid */}
      <div style={{ flex: 1, display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', gridAutoRows: '1fr', gap: 4, minHeight: 0 }}>
        {cells.map((d, i) => {
          if (d === null) return <div key={i} style={{ background: 'var(--bg-secondary)', borderRadius: 8, opacity: 0.4 }} />;
          const key = `${cursor.y}-${String(cursor.m + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
          const entries = byDay[key] || [];
          const isToday = key === todayKey;
          return (
            <div key={i} style={{
              background: 'var(--card-bg)', borderRadius: 8, padding: 5,
              border: isToday ? '2px solid #9b72f5' : '1px solid var(--border-color)',
              display: 'flex', flexDirection: 'column', minHeight: 92, overflow: 'hidden',
            }}>
              <div style={{ fontSize: 12, fontWeight: isToday ? 800 : 600, color: isToday ? '#9b72f5' : 'var(--text-secondary)', marginBottom: 3, textAlign: 'right', paddingRight: 2 }}>{d}</div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 3, overflowY: 'auto' }}>
                {entries.slice(0, 4).map(({ item, group }) => {
                  const s = statusInfo(columns, item);
                  return (
                    <button
                      key={item.id}
                      onClick={() => onOpenDetail?.(item.id)}
                      title={item.name}
                      style={{
                        display: 'flex', alignItems: 'center', gap: 5, textAlign: 'left',
                        background: s ? `${s.color}1a` : `${group.color}1a`,
                        borderLeft: `3px solid ${s ? s.color : group.color}`,
                        borderRadius: 4, padding: '2px 5px', cursor: 'pointer', width: '100%',
                      }}
                    >
                      <span style={{ fontSize: 11, color: 'var(--text-primary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{item.name}</span>
                    </button>
                  );
                })}
                {entries.length > 4 && (
                  <span style={{ fontSize: 10, color: 'var(--text-muted)', fontWeight: 600, paddingLeft: 2 }}>+{entries.length - 4} more</span>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
