import React, { useEffect, useRef, useState } from 'react';

const COLUMN_TYPES = [
  // Essentials
  { value: 'status',        label: 'Status',        icon: '◉',  color: '#00c875', group: 'essentials' },
  { value: 'dropdown',      label: 'Dropdown',      icon: '▾',  color: '#00c875', group: 'essentials' },
  { value: 'text',          label: 'Text',          icon: 'T',  color: '#fdab3d', group: 'essentials' },
  { value: 'date',          label: 'Date',          icon: '📅', color: '#a25ddc', group: 'essentials' },
  { value: 'person',        label: 'People',        icon: '👤', color: '#579bfc', group: 'essentials' },
  { value: 'number',        label: 'Numbers',       icon: '½',  color: '#fdab3d', group: 'essentials' },

  // Super useful
  { value: 'file',          label: 'Files',         icon: '📎', color: '#ff642e', group: 'useful' },
  { value: 'checkbox',      label: 'Checkbox',      icon: '✓',  color: '#fdab3d', group: 'useful' },
  { value: 'formula',       label: 'Formula',       icon: 'ƒ',  color: '#00c875', group: 'useful' },
  { value: 'priority',      label: 'Priority',      icon: '▲',  color: '#fdab3d', group: 'useful' },
  { value: 'timeline',      label: 'Timeline',      icon: '▭',  color: '#a25ddc', group: 'useful' },
  { value: 'rating',        label: 'Rating',        icon: '★',  color: '#fdab3d', group: 'useful' },

  // More
  { value: 'long_text',     label: 'Long Text',     icon: '¶',  color: '#9aa5b8', group: 'more' },
  { value: 'link',          label: 'Link',          icon: '🔗', color: '#66ccff', group: 'more' },
  { value: 'email',         label: 'Email',         icon: '✉',  color: '#66ccff', group: 'more' },
  { value: 'phone',         label: 'Phone',         icon: '☏',  color: '#00c875', group: 'more' },
  { value: 'progress',      label: 'Progress',      icon: '▰',  color: '#00c875', group: 'more' },
  { value: 'tags',          label: 'Tags',          icon: '#',  color: '#ff7575', group: 'more' },
  { value: 'color_picker',  label: 'Color',         icon: '◎',  color: '#ff158a', group: 'more' },
  { value: 'time_tracking', label: 'Time Tracking', icon: '⏱',  color: '#9aa5b8', group: 'more' },
  { value: 'location',      label: 'Location',      icon: '📍', color: '#ff642e', group: 'more' },
  { value: 'creation_log',  label: 'Creation Log',  icon: '🪵', color: '#9aa5b8', group: 'more' },
];

const GROUPS = [
  { key: 'essentials', label: 'Essentials' },
  { key: 'useful',     label: 'Super useful' },
  { key: 'more',       label: 'More columns' },
];

export default function AddColumnModal({ onAdd, onClose }) {
  const [query, setQuery] = useState('');
  const [hoverKey, setHoverKey] = useState(null);
  const inputRef = useRef(null);

  useEffect(() => { inputRef.current?.focus(); }, []);
  useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const q = query.trim().toLowerCase();
  const matches = q
    ? COLUMN_TYPES.filter(c => c.label.toLowerCase().includes(q) || c.value.includes(q))
    : COLUMN_TYPES;

  const handlePick = (ct) => onAdd({ title: ct.label, type: ct.value });

  const Tile = ({ ct }) => (
    <div
      key={ct.value}
      onClick={() => handlePick(ct)}
      onMouseEnter={() => setHoverKey(ct.value)}
      onMouseLeave={() => setHoverKey(null)}
      style={{
        display: 'flex', alignItems: 'center', gap: 10,
        padding: '7px 8px', borderRadius: 8, cursor: 'pointer',
        background: hoverKey === ct.value ? 'var(--menu-hover)' : 'transparent',
        transition: 'background 0.12s ease',
      }}
    >
      <div style={{
        width: 26, height: 26, borderRadius: 6, flexShrink: 0,
        background: ct.color, color: '#fff',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        fontSize: 14, fontWeight: 700, lineHeight: 1,
      }}>{ct.icon}</div>
      <span style={{ fontSize: 13, color: 'var(--text-primary)', fontWeight: 500 }}>{ct.label}</span>
    </div>
  );

  return (
    <div
      style={{
        position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.45)', zIndex: 500,
        display: 'flex', alignItems: 'center', justifyContent: 'center',
      }}
      onClick={onClose}
    >
      <div
        onClick={e => e.stopPropagation()}
        style={{
          background: 'var(--card-bg)',
          border: '1px solid var(--menu-border)',
          borderRadius: 12,
          width: 420,
          maxHeight: '80vh',
          display: 'flex', flexDirection: 'column',
          boxShadow: 'var(--menu-shadow, 0 12px 40px rgba(0,0,0,0.35))',
          overflow: 'hidden',
        }}
      >
        {/* Search */}
        <div style={{ padding: 12, borderBottom: '1px solid var(--menu-divider)' }}>
          <div style={{
            display: 'flex', alignItems: 'center', gap: 8,
            background: 'var(--bg-secondary)',
            border: '1px solid var(--border-color)',
            borderRadius: 8, padding: '8px 12px',
          }}>
            <span style={{ color: 'var(--text-muted)', fontSize: 14 }}>🔍</span>
            <input
              ref={inputRef}
              value={query}
              onChange={e => setQuery(e.target.value)}
              placeholder="Search or describe your column"
              style={{
                flex: 1, border: 'none', outline: 'none', background: 'transparent',
                fontSize: 13, color: 'var(--text-primary)',
              }}
            />
          </div>
        </div>

        {/* Body */}
        <div style={{ padding: '8px 12px 14px', overflowY: 'auto' }}>
          {q ? (
            matches.length === 0 ? (
              <div style={{ padding: 20, textAlign: 'center', fontSize: 13, color: 'var(--text-muted)' }}>
                No column types match "{query}"
              </div>
            ) : (
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 2, paddingTop: 6 }}>
                {matches.map(ct => <Tile key={ct.value} ct={ct} />)}
              </div>
            )
          ) : (
            GROUPS.map(g => {
              const items = COLUMN_TYPES.filter(c => c.group === g.key);
              if (!items.length) return null;
              return (
                <div key={g.key} style={{ marginTop: 10 }}>
                  <div style={{
                    fontSize: 11, color: 'var(--text-muted)', fontWeight: 600,
                    padding: '4px 8px', textTransform: 'none', letterSpacing: 0.2,
                  }}>
                    {g.label}
                  </div>
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 2 }}>
                    {items.map(ct => <Tile key={ct.value} ct={ct} />)}
                  </div>
                </div>
              );
            })
          )}
        </div>
      </div>
    </div>
  );
}
