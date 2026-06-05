import React from 'react';
import { parsePersons } from '../dashboard/helpers';

// Cards / gallery view. A responsive grid of item cards grouped by group —
// good for browsing visually rather than row-by-row.

function StatusChip({ color, label }) {
  return (
    <span style={{ fontSize: 11, fontWeight: 600, color: '#fff', background: color || '#c4c4c4', borderRadius: 5, padding: '2px 8px', whiteSpace: 'nowrap' }}>{label}</span>
  );
}

function FieldValue({ col, raw }) {
  if (raw == null || raw === '') return <span style={{ color: 'var(--text-muted)' }}>—</span>;
  if (col.type === 'status' || col.type === 'priority') {
    const opt = (col.settings?.options || []).find(o => o.label === raw);
    return <StatusChip color={opt?.color} label={raw} />;
  }
  if (col.type === 'person') {
    const names = parsePersons(raw);
    if (!names.length) return <span style={{ color: 'var(--text-muted)' }}>—</span>;
    return (
      <span style={{ display: 'inline-flex', gap: 4, flexWrap: 'wrap' }}>
        {names.slice(0, 3).map((n, i) => (
          <span key={i} title={n} style={{ width: 22, height: 22, borderRadius: '50%', background: '#9b72f5', color: '#fff', fontSize: 10, fontWeight: 700, display: 'inline-flex', alignItems: 'center', justifyContent: 'center' }}>{n.slice(0, 2).toUpperCase()}</span>
        ))}
        {names.length > 3 && <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>+{names.length - 3}</span>}
      </span>
    );
  }
  if (col.type === 'checkbox') return <span>{raw === 'true' ? '✅' : '⬜'}</span>;
  if (col.type === 'rating') {
    const n = Math.round(Number(raw)) || 0;
    return <span style={{ color: '#fdab3d' }}>{'★'.repeat(n)}{'☆'.repeat(Math.max(0, 5 - n))}</span>;
  }
  return <span style={{ color: 'var(--text-secondary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{String(raw)}</span>;
}

export default function CardsView({ groups = [], columns = [], onOpenDetail }) {
  // Show up to four meaningful columns on each card (skip long_text/formula noise).
  const previewCols = columns.filter(c => !['long_text'].includes(c.type)).slice(0, 4);

  const hasItems = groups.some(g => (g.items || []).length);
  if (!hasItems) {
    return <div style={{ padding: 60, textAlign: 'center', color: 'var(--text-secondary)' }}>No items to show yet.</div>;
  }

  return (
    <div style={{ padding: 20, overflowY: 'auto', height: '100%' }}>
      {groups.map(group => {
        const items = group.items || [];
        if (!items.length) return null;
        return (
          <div key={group.id} style={{ marginBottom: 26 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12 }}>
              <span style={{ width: 11, height: 11, borderRadius: '50%', background: group.color }} />
              <span style={{ fontSize: 14, fontWeight: 800, color: 'var(--text-primary)' }}>{group.name}</span>
              <span style={{ fontSize: 12, color: 'var(--text-muted)', fontWeight: 600 }}>{items.length}</span>
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(240px, 1fr))', gap: 14 }}>
              {items.map(item => (
                <button
                  key={item.id}
                  onClick={() => onOpenDetail?.(item.id)}
                  style={{
                    textAlign: 'left', background: 'var(--card-bg)', borderRadius: 12,
                    border: '1px solid var(--border-color)', padding: 14, cursor: 'pointer',
                    position: 'relative', overflow: 'hidden', transition: 'box-shadow 0.15s, transform 0.1s',
                  }}
                  onMouseEnter={e => { e.currentTarget.style.boxShadow = '0 6px 20px rgba(80,60,160,0.14)'; e.currentTarget.style.transform = 'translateY(-2px)'; }}
                  onMouseLeave={e => { e.currentTarget.style.boxShadow = 'none'; e.currentTarget.style.transform = 'none'; }}
                >
                  <div style={{ position: 'absolute', left: 0, top: 0, bottom: 0, width: 4, background: group.color }} />
                  <div style={{ fontWeight: 700, fontSize: 14, color: 'var(--text-primary)', marginBottom: 12, paddingLeft: 4, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{item.name}</div>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 8, paddingLeft: 4 }}>
                    {previewCols.map(col => (
                      <div key={col.id} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, minHeight: 22 }}>
                        <span style={{ fontSize: 11, color: 'var(--text-muted)', fontWeight: 600, flexShrink: 0 }}>{col.title}</span>
                        <span style={{ fontSize: 12, overflow: 'hidden', maxWidth: '60%', textAlign: 'right' }}><FieldValue col={col} raw={item.values?.[col.id]} /></span>
                      </div>
                    ))}
                  </div>
                </button>
              ))}
            </div>
          </div>
        );
      })}
    </div>
  );
}
