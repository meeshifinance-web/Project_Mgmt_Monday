import React, { useState, useEffect, useCallback } from 'react';
import { getAuditLogs, getAuditMeta } from '../api';
import { toISODateTime } from '../utils/dateFormat';

// Admin Audit Center — cross-board activity with filters, per-user drill-down,
// pagination and CSV export.

const ACTION_LABEL = {
  item_created: 'Item created', item_renamed: 'Item renamed', item_deleted: 'Item deleted',
  item_moved: 'Item moved', value_changed: 'Value changed', subitem_created: 'Subitem created',
  group_created: 'Group created', group_deleted: 'Group deleted',
};
const labelFor = (a) => ACTION_LABEL[a] || (a || '').replace(/_/g, ' ');
const actionColor = (a) => /delete/.test(a) ? '#e2445c' : /create/.test(a) ? '#00c875' : /moved/.test(a) ? '#fdab3d' : '#0073ea';

function csvEscape(v) { const s = String(v ?? ''); return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; }

export default function AuditCenterPanel({ boards = [], onClose }) {
  const [filters, setFilters] = useState({ board_id: '', user_id: '', action: '', from: '', to: '', q: '' });
  const [meta, setMeta] = useState({ actions: [], users: [] });
  const [rows, setRows] = useState([]);
  const [total, setTotal] = useState(0);
  const [offset, setOffset] = useState(0);
  const [loading, setLoading] = useState(false);
  const PAGE = 100;

  useEffect(() => { getAuditMeta().then(setMeta).catch(() => {}); }, []);

  const load = useCallback(async (reset) => {
    setLoading(true);
    const off = reset ? 0 : offset;
    try {
      const clean = Object.fromEntries(Object.entries(filters).filter(([, v]) => v !== '' && v != null));
      const r = await getAuditLogs({ ...clean, limit: PAGE, offset: off });
      setTotal(r.total);
      setRows(reset ? r.rows : [...rows, ...r.rows]);
      setOffset(off + r.rows.length);
    } catch { /* ignore */ } finally { setLoading(false); }
  }, [filters, offset, rows]);

  // Reload from the start whenever filters change.
  useEffect(() => { setOffset(0); load(true); /* eslint-disable-next-line */ }, [filters]);

  const set = (k, v) => setFilters(f => ({ ...f, [k]: v }));
  const clearAll = () => setFilters({ board_id: '', user_id: '', action: '', from: '', to: '', q: '' });
  const hasFilter = Object.values(filters).some(v => v);

  const exportCsv = async () => {
    // Pull up to 5000 matching rows for the export.
    const clean = Object.fromEntries(Object.entries(filters).filter(([, v]) => v !== '' && v != null));
    const r = await getAuditLogs({ ...clean, limit: 500, offset: 0 });
    let all = r.rows; let off = all.length;
    while (off < Math.min(r.total, 5000)) { const more = await getAuditLogs({ ...clean, limit: 500, offset: off }); all = all.concat(more.rows); off += more.rows.length; if (!more.rows.length) break; }
    const headers = ['When', 'User', 'Board', 'Action', 'Item', 'Field', 'From', 'To'];
    const lines = all.map(a => [toISODateTime(a.created_at), a.user_name, a.board_name, labelFor(a.action), a.item_name, a.field, a.old_value, a.new_value]);
    const csv = [headers, ...lines].map(r2 => r2.map(csvEscape).join(',')).join('\n');
    const blob = new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob); const el = document.createElement('a');
    el.href = url; el.download = `audit-${new Date().toISOString().slice(0, 10)}.csv`;
    document.body.appendChild(el); el.click(); el.remove(); setTimeout(() => URL.revokeObjectURL(url), 1000);
  };

  const sel = { padding: '6px 8px', borderRadius: 7, border: '1px solid var(--border-color,#e6e9ef)', background: 'var(--input-bg,var(--bg-secondary))', color: 'var(--text-primary)', fontSize: 12 };

  return (
    <div onMouseDown={e => { if (e.target === e.currentTarget) onClose(); }} style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.45)', zIndex: 600, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 18 }}>
      <div style={{ background: 'var(--card-bg,#fff)', borderRadius: 14, width: 'min(1000px,97vw)', height: '88vh', display: 'flex', flexDirection: 'column', border: '1px solid var(--menu-border)', boxShadow: '0 20px 60px rgba(0,0,0,0.4)', overflow: 'hidden' }}>
        {/* Header + filters */}
        <div style={{ padding: '14px 18px', borderBottom: '1px solid var(--border-color)', flexShrink: 0 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 12 }}>
            <div style={{ flex: 1 }}>
              <div style={{ fontSize: 17, fontWeight: 800, color: 'var(--text-primary)' }}>🛡 Audit Center</div>
              <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>{total.toLocaleString()} events across all boards</div>
            </div>
            <button onClick={exportCsv} style={{ ...sel, cursor: 'pointer', fontWeight: 600 }}>⬇ Export CSV</button>
            <button onClick={onClose} style={{ fontSize: 22, color: 'var(--text-muted)', background: 'none', border: 'none', cursor: 'pointer' }}>×</button>
          </div>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
            <select style={sel} value={filters.board_id} onChange={e => set('board_id', e.target.value)}>
              <option value="">All boards</option>
              {boards.map(b => <option key={b.id} value={b.id}>{b.name}</option>)}
            </select>
            <select style={sel} value={filters.user_id} onChange={e => set('user_id', e.target.value)}>
              <option value="">All users</option>
              {meta.users.map(u => <option key={u.user_id} value={u.user_id}>{u.user_name} ({u.count})</option>)}
            </select>
            <select style={sel} value={filters.action} onChange={e => set('action', e.target.value)}>
              <option value="">All actions</option>
              {meta.actions.map(a => <option key={a} value={a}>{labelFor(a)}</option>)}
            </select>
            <input type="date" style={sel} value={filters.from} onChange={e => set('from', e.target.value)} />
            <span style={{ color: 'var(--text-muted)' }}>→</span>
            <input type="date" style={sel} value={filters.to} onChange={e => set('to', e.target.value)} />
            <input style={{ ...sel, flex: 1, minWidth: 140 }} placeholder="Search item / user / value…" value={filters.q} onChange={e => set('q', e.target.value)} />
            {hasFilter && <button onClick={clearAll} style={{ ...sel, cursor: 'pointer', color: '#e2445c', borderColor: 'transparent' }}>Clear</button>}
          </div>
        </div>

        {/* Table */}
        <div style={{ flex: 1, overflowY: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12.5 }}>
            <thead style={{ position: 'sticky', top: 0, background: 'var(--card-bg)', zIndex: 1 }}>
              <tr style={{ borderBottom: '1px solid var(--border-color)' }}>
                {['When', 'User', 'Board', 'Action', 'Item', 'Change'].map(h => (
                  <th key={h} style={{ textAlign: 'left', padding: '9px 14px', fontSize: 11, fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: 0.4 }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map(a => (
                <tr key={a.id} style={{ borderBottom: '1px solid var(--border-color,#f0f0f4)' }}>
                  <td style={{ padding: '8px 14px', color: 'var(--text-muted)', whiteSpace: 'nowrap', fontVariantNumeric: 'tabular-nums' }}>{toISODateTime(a.created_at)}</td>
                  <td style={{ padding: '8px 14px', color: 'var(--text-primary)', whiteSpace: 'nowrap' }}>{a.user_name || '—'}</td>
                  <td style={{ padding: '8px 14px', color: 'var(--text-secondary)', whiteSpace: 'nowrap', maxWidth: 140, overflow: 'hidden', textOverflow: 'ellipsis' }}>{a.board_name || '—'}</td>
                  <td style={{ padding: '8px 14px', whiteSpace: 'nowrap' }}><span style={{ fontSize: 11, fontWeight: 700, color: '#fff', background: actionColor(a.action), borderRadius: 5, padding: '2px 8px' }}>{labelFor(a.action)}</span></td>
                  <td style={{ padding: '8px 14px', color: 'var(--text-primary)', maxWidth: 180, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{a.item_name || '—'}</td>
                  <td style={{ padding: '8px 14px', color: 'var(--text-secondary)', maxWidth: 240, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {a.field ? <span><b style={{ color: 'var(--text-primary)' }}>{a.field}</b>{a.old_value || a.new_value ? <>: {a.old_value || '∅'} → {a.new_value || '∅'}</> : null}</span> : '—'}
                  </td>
                </tr>
              ))}
              {!loading && rows.length === 0 && (
                <tr><td colSpan={6} style={{ padding: 50, textAlign: 'center', color: 'var(--text-muted)' }}>No activity matches these filters.</td></tr>
              )}
            </tbody>
          </table>
        </div>

        {/* Footer */}
        <div style={{ padding: '10px 18px', borderTop: '1px solid var(--border-color)', display: 'flex', alignItems: 'center', gap: 12, flexShrink: 0 }}>
          <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>Showing {rows.length} of {total.toLocaleString()}</span>
          {rows.length < total && (
            <button onClick={() => load(false)} disabled={loading} style={{ ...sel, cursor: 'pointer', fontWeight: 600 }}>{loading ? 'Loading…' : 'Load more'}</button>
          )}
        </div>
      </div>
    </div>
  );
}
