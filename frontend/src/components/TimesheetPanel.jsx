import React, { useState, useEffect, useCallback } from 'react';
import { getTimesheet, setUserBilling } from '../api';
import { useAuth } from '../context/AuthContext';

// Board-level timesheet: per-person tracked vs billable hours, cost from each
// person's rate, and capacity utilisation over a date range.

function Avatar({ name }) {
  return <span style={{ width: 26, height: 26, borderRadius: '50%', background: '#9b72f5', color: '#fff', fontSize: 11, fontWeight: 700, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>{(name || '?').slice(0, 2).toUpperCase()}</span>;
}
const money = (n) => '₹' + (Number(n) || 0).toLocaleString('en-IN', { maximumFractionDigits: 0 });

export default function TimesheetPanel({ boardId, boardName, onClose }) {
  const { user } = useAuth();
  const isAdmin = user?.role === 'admin';
  const [from, setFrom] = useState(new Date(Date.now() - 29 * 86400000).toISOString().slice(0, 10));
  const [to, setTo] = useState(new Date().toISOString().slice(0, 10));
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try { setData(await getTimesheet({ board_id: boardId, from, to })); } catch { setData(null); } finally { setLoading(false); }
  }, [boardId, from, to]);
  useEffect(() => { load(); }, [load]);

  const saveBilling = async (u, rate, cap) => {
    try { await setUserBilling(u.user_id, { hourly_rate: rate, weekly_capacity: cap }); load(); } catch { /* ignore */ }
  };

  const presets = [['7d', 7], ['30d', 30], ['90d', 90]];
  const setPreset = (days) => { setFrom(new Date(Date.now() - (days - 1) * 86400000).toISOString().slice(0, 10)); setTo(new Date().toISOString().slice(0, 10)); };

  const inputStyle = { border: '1px solid var(--border-color)', borderRadius: 6, padding: '5px 8px', fontSize: 12, background: 'var(--input-bg, var(--bg-secondary))', color: 'var(--text-primary)' };

  return (
    <div onClick={onClose} style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.45)', zIndex: 600, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20 }}>
      <div onClick={e => e.stopPropagation()} style={{ background: 'var(--card-bg)', borderRadius: 14, width: 'min(880px, 96vw)', maxHeight: '88vh', display: 'flex', flexDirection: 'column', border: '1px solid var(--menu-border)', boxShadow: '0 20px 60px rgba(0,0,0,0.4)', overflow: 'hidden' }}>
        {/* Header */}
        <div style={{ padding: '16px 20px', borderBottom: '1px solid var(--border-color)', display: 'flex', alignItems: 'center', gap: 12 }}>
          <div style={{ flex: 1 }}>
            <div style={{ fontSize: 17, fontWeight: 800, color: 'var(--text-primary)' }}>⏱ Timesheets</div>
            <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>{boardName}</div>
          </div>
          {presets.map(([l, d]) => (
            <button key={l} onClick={() => setPreset(d)} style={{ ...inputStyle, cursor: 'pointer', fontWeight: 600 }}>{l}</button>
          ))}
          <input type="date" value={from} onChange={e => setFrom(e.target.value)} style={inputStyle} />
          <span style={{ color: 'var(--text-muted)' }}>→</span>
          <input type="date" value={to} onChange={e => setTo(e.target.value)} style={inputStyle} />
          <button onClick={onClose} style={{ marginLeft: 6, fontSize: 20, color: 'var(--text-muted)', background: 'none', border: 'none', cursor: 'pointer' }}>×</button>
        </div>

        {/* Totals strip */}
        {data && (
          <div style={{ display: 'flex', gap: 0, borderBottom: '1px solid var(--border-color)' }}>
            {[['Total tracked', `${data.totals.hours}h`, '#9b72f5'], ['Billable', `${data.totals.billable_hours}h`, '#00c875'], ['Billable value', money(data.totals.cost), '#0073ea'], ['People', String(data.users.length), '#fdab3d']].map(([l, v, c]) => (
              <div key={l} style={{ flex: 1, padding: '14px 18px', borderRight: '1px solid var(--border-color)' }}>
                <div style={{ fontSize: 22, fontWeight: 800, color: c, lineHeight: 1.1 }}>{v}</div>
                <div style={{ fontSize: 11, color: 'var(--text-secondary)', marginTop: 3 }}>{l}</div>
              </div>
            ))}
          </div>
        )}

        {/* Body */}
        <div style={{ overflowY: 'auto', padding: '8px 12px 16px' }}>
          {loading && <div style={{ padding: 40, textAlign: 'center', color: 'var(--text-muted)' }}>Loading…</div>}
          {!loading && data && data.users.length === 0 && (
            <div style={{ padding: 50, textAlign: 'center', color: 'var(--text-secondary)' }}>No time tracked in this range yet.</div>
          )}
          {!loading && data && data.users.map(u => (
            <div key={u.user_id || u.user_name} style={{ border: '1px solid var(--border-color)', borderRadius: 10, padding: 12, marginBottom: 10 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                <Avatar name={u.user_name} />
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 14, fontWeight: 700, color: 'var(--text-primary)' }}>{u.user_name || 'Unknown'}</div>
                  <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>{u.items.length} task{u.items.length !== 1 ? 's' : ''}</div>
                </div>
                <Metric label="Tracked" value={`${u.hours}h`} />
                <Metric label="Billable" value={`${u.billable_hours}h`} color="#00c875" />
                <Metric label="Value" value={money(u.cost)} color="#0073ea" />
                {/* Capacity / utilization */}
                <div style={{ width: 130 }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 10, color: 'var(--text-muted)', marginBottom: 3 }}>
                    <span>Utilization</span><span>{u.utilization == null ? '—' : u.utilization + '%'}</span>
                  </div>
                  <div style={{ height: 7, borderRadius: 4, background: 'var(--bg-secondary)', overflow: 'hidden' }}>
                    <div style={{ width: `${Math.min(100, u.utilization || 0)}%`, height: '100%', background: (u.utilization || 0) > 100 ? '#e2445c' : (u.utilization || 0) > 80 ? '#fdab3d' : '#00c875' }} />
                  </div>
                </div>
              </div>

              {/* Per-task breakdown */}
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginTop: 10 }}>
                {u.items.slice(0, 8).map(it => (
                  <span key={it.item_id} style={{ fontSize: 11, background: 'var(--bg-secondary)', borderRadius: 12, padding: '2px 9px', color: 'var(--text-secondary)' }}>
                    {it.name} · <b>{(it.seconds / 3600).toFixed(1)}h</b>
                  </span>
                ))}
              </div>

              {/* Admin: rate + capacity */}
              {isAdmin && (
                <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginTop: 10, paddingTop: 10, borderTop: '1px dashed var(--border-color)' }}>
                  <label style={{ fontSize: 11, color: 'var(--text-muted)', display: 'flex', alignItems: 'center', gap: 5 }}>
                    Rate ₹/hr
                    <input type="number" min="0" defaultValue={u.hourly_rate} onBlur={e => { const v = Number(e.target.value); if (v !== u.hourly_rate) saveBilling(u, v, u.weekly_capacity); }} style={{ ...inputStyle, width: 80 }} />
                  </label>
                  <label style={{ fontSize: 11, color: 'var(--text-muted)', display: 'flex', alignItems: 'center', gap: 5 }}>
                    Capacity h/wk
                    <input type="number" min="0" defaultValue={u.weekly_capacity} onBlur={e => { const v = Number(e.target.value); if (v !== u.weekly_capacity) saveBilling(u, u.hourly_rate, v); }} style={{ ...inputStyle, width: 70 }} />
                  </label>
                </div>
              )}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function Metric({ label, value, color }) {
  return (
    <div style={{ width: 78, textAlign: 'right' }}>
      <div style={{ fontSize: 15, fontWeight: 800, color: color || 'var(--text-primary)', fontVariantNumeric: 'tabular-nums' }}>{value}</div>
      <div style={{ fontSize: 10, color: 'var(--text-muted)' }}>{label}</div>
    </div>
  );
}
