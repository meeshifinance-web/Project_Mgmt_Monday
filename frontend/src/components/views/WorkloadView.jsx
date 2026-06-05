import React, { useMemo, useState } from 'react';
import { parsePersons } from '../dashboard/helpers';

// Workload view. Rows = people (from a People column), columns = week buckets
// (from a Date column). Each cell shows how many items that person is on in
// that week, heat-shaded by load so over-allocation is obvious at a glance.

const DAY_MS = 86400000;
const ISO = /^\d{4}-\d{2}-\d{2}$/;
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

function parseISO(s) {
  if (!s || !ISO.test(s)) return null;
  const [y, m, d] = s.split('-').map(Number);
  return new Date(y, m - 1, d);
}
function startOfWeek(d) {
  const x = new Date(d); x.setHours(0, 0, 0, 0);
  x.setDate(x.getDate() - x.getDay());
  return x;
}
function heat(load, max) {
  if (!load) return { bg: 'transparent', fg: 'var(--text-muted)' };
  const t = max ? load / max : 0;
  // green → amber → red as load grows
  const color = t > 0.66 ? '#e2445c' : t > 0.33 ? '#fdab3d' : '#00c875';
  return { bg: `${color}${t > 0.66 ? '33' : t > 0.33 ? '2a' : '22'}`, fg: 'var(--text-primary)', dot: color };
}

const WEEKS_AHEAD = 8;

export default function WorkloadView({ groups = [], columns = [], onOpenDetail }) {
  const personCols = columns.filter(c => c.type === 'person');
  const dateCols = columns.filter(c => c.type === 'date' || c.type === 'timeline');

  const [personId, setPersonId] = useState(personCols[0]?.id ?? null);
  const [dateId, setDateId] = useState(dateCols[0]?.id ?? null);
  const personCol = personCols.find(c => c.id === personId) || personCols[0];
  const dateCol = dateCols.find(c => c.id === dateId) || dateCols[0];

  // Eight week buckets starting from the current week.
  const weeks = useMemo(() => {
    const base = startOfWeek(new Date());
    return Array.from({ length: WEEKS_AHEAD }, (_, i) => {
      const start = new Date(base.getTime() + i * 7 * DAY_MS);
      return { start, end: new Date(start.getTime() + 6 * DAY_MS), key: start.toISOString().slice(0, 10) };
    });
  }, []);

  const itemDate = (item) => {
    if (!dateCol) return null;
    let raw = item.values?.[dateCol.id];
    if (dateCol.type === 'timeline') raw = String(raw || '').split('→')[0]?.trim();
    return parseISO(raw);
  };
  const weekIndex = (d) => {
    if (!d) return -1;
    const ws = startOfWeek(d).getTime();
    return weeks.findIndex(w => w.start.getTime() === ws);
  };

  // Build per-person rows: { name, cells:[{count, items}], noDate, total }
  const { rows, maxCell } = useMemo(() => {
    const acc = {}; // name → { cells: [...], noDate: [], total }
    const ensure = (name) => acc[name] || (acc[name] = { name, cells: weeks.map(() => []), noDate: [], total: 0 });
    if (personCol) {
      for (const g of groups) {
        for (const item of g.items || []) {
          let owners = parsePersons(item.values?.[personCol.id]);
          if (!owners.length) owners = ['Unassigned'];
          const wi = weekIndex(itemDate(item));
          for (const o of owners) {
            const row = ensure(o);
            row.total += 1;
            if (wi >= 0) row.cells[wi].push(item);
            else if (dateCol) row.noDate.push(item);
          }
        }
      }
    }
    let mx = 0;
    Object.values(acc).forEach(r => r.cells.forEach(c => { if (c.length > mx) mx = c.length; }));
    const ordered = Object.values(acc).sort((a, b) => b.total - a.total);
    return { rows: ordered, maxCell: mx };
  }, [groups, personCol, dateCol, weeks]);

  if (!personCols.length) {
    return (
      <div style={{ textAlign: 'center', padding: 60, color: 'var(--text-secondary)' }}>
        <div style={{ fontSize: 36, marginBottom: 10 }}>👥</div>
        <div>Add a People column to use Workload view</div>
      </div>
    );
  }

  const NAME_W = 180;

  return (
    <div style={{ padding: 16, height: '100%', display: 'flex', flexDirection: 'column' }}>
      {/* Toolbar */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 12, flexWrap: 'wrap' }}>
        {personCols.length > 1 && (
          <Selector label="People" value={personId} onChange={setPersonId} options={personCols} />
        )}
        {dateCols.length > 0 && (
          <Selector label="Schedule by" value={dateId} onChange={setDateId} options={dateCols} />
        )}
        <div style={{ flex: 1 }} />
        <Legend />
      </div>

      <div style={{ flex: 1, overflow: 'auto', border: '1px solid var(--border-color)', borderRadius: 10 }}>
        <table style={{ borderCollapse: 'collapse', width: '100%', minWidth: NAME_W + WEEKS_AHEAD * 90 + 70 }}>
          <thead>
            <tr style={{ position: 'sticky', top: 0, zIndex: 3, background: 'var(--card-bg)' }}>
              <th style={{ width: NAME_W, textAlign: 'left', padding: '10px 12px', fontSize: 11, fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase', position: 'sticky', left: 0, background: 'var(--card-bg)', borderRight: '1px solid var(--border-color)', borderBottom: '1px solid var(--border-color)' }}>Person</th>
              {weeks.map(w => (
                <th key={w.key} style={{ padding: '8px 6px', fontSize: 11, fontWeight: 700, color: 'var(--text-secondary)', textAlign: 'center', borderBottom: '1px solid var(--border-color)', minWidth: 78 }}>
                  {MONTHS[w.start.getMonth()]} {w.start.getDate()}
                </th>
              ))}
              <th style={{ padding: '8px 10px', fontSize: 11, fontWeight: 700, color: 'var(--text-muted)', textAlign: 'center', borderBottom: '1px solid var(--border-color)', borderLeft: '1px solid var(--border-color)' }}>Total</th>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 && (
              <tr><td colSpan={WEEKS_AHEAD + 2} style={{ padding: 40, textAlign: 'center', color: 'var(--text-secondary)' }}>No assigned items yet.</td></tr>
            )}
            {rows.map(row => (
              <tr key={row.name}>
                <td style={{ padding: '8px 12px', position: 'sticky', left: 0, background: 'var(--card-bg)', borderRight: '1px solid var(--border-color)', borderBottom: '1px solid var(--border-color)' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <span style={{ width: 26, height: 26, borderRadius: '50%', background: '#9b72f5', color: '#fff', fontSize: 11, fontWeight: 700, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                      {row.name === 'Unassigned' ? '—' : row.name.slice(0, 2).toUpperCase()}
                    </span>
                    <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--text-primary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{row.name}</span>
                  </div>
                </td>
                {row.cells.map((items, i) => {
                  const h = heat(items.length, maxCell);
                  return (
                    <td key={i} style={{ padding: 4, textAlign: 'center', borderBottom: '1px solid var(--border-color)', borderLeft: '1px solid var(--border-color)' }}>
                      {items.length > 0 ? (
                        <button
                          onClick={() => items.length === 1 && onOpenDetail?.(items[0].id)}
                          title={items.map(it => it.name).join('\n')}
                          style={{ width: '100%', background: h.bg, borderRadius: 6, padding: '7px 4px', cursor: items.length === 1 ? 'pointer' : 'default', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 2 }}
                        >
                          <span style={{ fontSize: 14, fontWeight: 800, color: h.fg }}>{items.length}</span>
                          <span style={{ width: 18, height: 3, borderRadius: 2, background: h.dot }} />
                        </button>
                      ) : null}
                    </td>
                  );
                })}
                <td style={{ padding: '8px 10px', textAlign: 'center', borderBottom: '1px solid var(--border-color)', borderLeft: '1px solid var(--border-color)', fontSize: 13, fontWeight: 800, color: 'var(--text-primary)' }}>
                  {row.total}
                  {row.noDate.length > 0 && <div style={{ fontSize: 10, fontWeight: 600, color: 'var(--text-muted)' }}>{row.noDate.length} undated</div>}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function Selector({ label, value, onChange, options }) {
  return (
    <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, color: 'var(--text-muted)', fontWeight: 600 }}>
      {label}
      <select value={value ?? ''} onChange={e => onChange(Number(e.target.value))}
        style={{ padding: '5px 8px', borderRadius: 7, border: '1px solid var(--border-color)', background: 'var(--card-bg)', color: 'var(--text-primary)', fontSize: 13 }}>
        {options.map(c => <option key={c.id} value={c.id}>{c.title}</option>)}
      </select>
    </label>
  );
}

function Legend() {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 10, fontSize: 11, color: 'var(--text-muted)' }}>
      {[['#00c875', 'Light'], ['#fdab3d', 'Busy'], ['#e2445c', 'Overloaded']].map(([c, l]) => (
        <span key={l} style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
          <span style={{ width: 10, height: 10, borderRadius: 3, background: c }} />{l}
        </span>
      ))}
    </div>
  );
}
