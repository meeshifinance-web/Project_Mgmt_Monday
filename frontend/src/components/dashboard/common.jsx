import React, { useState } from 'react';

export function SkeletonPulse({ height = 100 }) {
  return (
    <div style={{
      height, borderRadius: 8,
      background: 'linear-gradient(90deg, #f0f0f0 25%, #e8e8e8 50%, #f0f0f0 75%)',
      backgroundSize: '400% 100%',
      animation: 'shimmer 1.4s ease-in-out infinite',
    }} />
  );
}

export function EmptyWidgetState({ text }) {
  return (
    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 8, padding: 20, textAlign: 'center' }}>
      <span style={{ fontSize: 28 }}>📭</span>
      <span style={{ fontSize: 12, color: '#9699a6' }}>{text}</span>
    </div>
  );
}

export function WidgetCard({ widget, onEdit, onDelete, isManager, children }) {
  const [hovered, setHovered] = useState(false);
  return (
    <div
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      data-widget-id={widget.id}
      style={{
        height: '100%', width: '100%',
        background: 'var(--card-bg, #fff)',
        borderRadius: 12,
        boxShadow: hovered ? '0 6px 24px rgba(0,0,0,0.12)' : '0 2px 8px rgba(0,0,0,0.07)',
        border: '1px solid var(--border-color, #e6e9ef)',
        display: 'flex', flexDirection: 'column',
        overflow: 'hidden',
        transition: 'box-shadow 0.2s',
        position: 'relative',
      }}
    >
      <div className="widget-drag-handle" style={{
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        padding: '12px 16px 8px',
        borderBottom: '1px solid var(--border-color, #f0f0f0)',
        cursor: isManager ? 'grab' : 'default',
        userSelect: 'none',
      }}>
        <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--text-secondary, #676879)', letterSpacing: 0.2, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', display: 'flex', alignItems: 'center', gap: 6 }}>
          {isManager && hovered && <span style={{ color: '#c5c7d0', fontSize: 12 }}>⋮⋮</span>}
          {widget.title || widget.type}
        </span>
        {isManager && hovered && (
          <div style={{ display: 'flex', gap: 4 }} onMouseDown={e => e.stopPropagation()}>
            <button onClick={() => onEdit(widget)} title="Configure"
              style={{ width: 26, height: 26, borderRadius: 6, border: 'none', background: '#f0f4ff', color: '#0073ea', fontSize: 13, cursor: 'pointer' }}>⚙</button>
            <button onClick={() => onDelete(widget.id)} title="Delete"
              style={{ width: 26, height: 26, borderRadius: 6, border: 'none', background: '#fff5f5', color: '#e2445c', fontSize: 14, cursor: 'pointer' }}>×</button>
          </div>
        )}
      </div>
      <div style={{ flex: 1, padding: '12px 16px 16px', display: 'flex', flexDirection: 'column', minWidth: 0, minHeight: 0, overflow: 'auto' }}>
        {children}
      </div>
    </div>
  );
}

// Simple form helpers
export const selectStyle = {
  width: '100%', padding: '7px 10px', borderRadius: 6, fontSize: 13,
  border: '1.5px solid var(--border-color,#e6e9ef)',
  background: 'var(--bg-primary,#fff)', color: 'var(--text-primary,#323338)',
  outline: 'none', boxSizing: 'border-box',
};
export const labelStyle = { fontSize: 12, fontWeight: 600, color: '#676879', display: 'block', marginBottom: 4 };

export function Field({ label, children }) {
  return (
    <div style={{ marginBottom: 14 }}>
      <label style={labelStyle}>{label}</label>
      {children}
    </div>
  );
}

export function ButtonGroup({ value, onChange, options }) {
  return (
    <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
      {options.map(([v, l]) => (
        <button key={v} onClick={() => onChange(v)}
          style={{ flex: 1, minWidth: 60, padding: '7px 8px', borderRadius: 6, fontSize: 11, fontWeight: 600, cursor: 'pointer', border: `2px solid ${value === v ? '#0073ea' : 'var(--border-color,#e6e9ef)'}`, background: value === v ? '#e8f0fe' : 'transparent', color: value === v ? '#0073ea' : '#676879' }}>
          {l}
        </button>
      ))}
    </div>
  );
}

export function Toggle({ checked, onChange, label }) {
  return (
    <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12, cursor: 'pointer', color: '#323338' }}>
      <input type="checkbox" checked={!!checked} onChange={e => onChange(e.target.checked)} style={{ accentColor: '#0073ea' }} />
      {label}
    </label>
  );
}

export function ColorPicker({ value, onChange, palette }) {
  return (
    <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
      {palette.map(c => (
        <div key={c} onClick={() => onChange(c)}
          style={{ width: 24, height: 24, borderRadius: '50%', background: c, cursor: 'pointer', outline: value === c ? `3px solid ${c}` : 'none', outlineOffset: 2 }} />
      ))}
    </div>
  );
}

export function GroupFilter({ groups, value, onChange }) {
  if (!groups?.length) return null;
  return (
    <Field label="Filter by Groups (optional)">
      <div style={{ display: 'flex', flexDirection: 'column', gap: 4, maxHeight: 120, overflowY: 'auto', padding: '4px 0' }}>
        {groups.map(g => (
          <label key={g.id} style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12, cursor: 'pointer' }}>
            <input
              type="checkbox"
              checked={(value || []).includes(String(g.id))}
              onChange={e => {
                const ids = value || [];
                onChange(e.target.checked ? [...ids, String(g.id)] : ids.filter(x => x !== String(g.id)));
              }}
              style={{ accentColor: '#0073ea' }}
            />
            <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <span style={{ width: 8, height: 8, borderRadius: 2, background: g.color || '#579bfc' }} />
              {g.name}
            </span>
          </label>
        ))}
      </div>
    </Field>
  );
}

export function BoardSelect({ boards, value, onChange }) {
  return (
    <Field label="Board">
      <select style={selectStyle} value={value || ''} onChange={e => onChange(e.target.value ? parseInt(e.target.value) : null)}>
        <option value="">— Select a board —</option>
        {boards.map(b => <option key={b.id} value={b.id}>{b.name}</option>)}
      </select>
    </Field>
  );
}
