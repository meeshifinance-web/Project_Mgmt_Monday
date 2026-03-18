import React, { useState, useRef, useEffect } from 'react';

const DEFAULT_STATUS_OPTIONS = [
  { label: 'Not Started', color: '#c4c4c4' },
  { label: 'In Progress', color: '#fdab3d' },
  { label: 'Done',        color: '#00c875' },
  { label: 'Stuck',       color: '#e2445c' },
];

const DEFAULT_PRIORITY_OPTIONS = [
  { label: 'Critical', color: '#e2445c' },
  { label: 'High',     color: '#ff642e' },
  { label: 'Medium',   color: '#fdab3d' },
  { label: 'Low',      color: '#00c875' },
];

const PRIORITY_ICONS = { Critical: '🔴', High: '🟠', Medium: '🟡', Low: '🟢' };

const NO_DEFAULT_TYPES = ['formula', 'creation_log'];

function DefaultInput({ col, value, onChange }) {
  const settings = col.settings || {};

  switch (col.type) {
    case 'status':
    case 'priority': {
      const isPriority = col.type === 'priority';
      const options = settings.options || (isPriority ? DEFAULT_PRIORITY_OPTIONS : DEFAULT_STATUS_OPTIONS);
      return (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
          {/* "None" clear option */}
          <div
            onClick={() => onChange('')}
            style={{
              padding: '5px 10px', borderRadius: 4, cursor: 'pointer', fontSize: 12,
              textAlign: 'center', fontWeight: 600,
              border: `2px solid ${value === '' ? '#323338' : '#e0e0e0'}`,
              color: value === '' ? '#323338' : '#aaa',
              background: value === '' ? '#f5f6f8' : '#fff',
            }}
          >None (no default)</div>
          {options.map(opt => (
            <div
              key={opt.label}
              onClick={() => onChange(opt.label)}
              style={{
                background: value === opt.label ? opt.color : '#fff',
                color: value === opt.label ? '#fff' : '#323338',
                border: `2px solid ${value === opt.label ? opt.color : '#e0e0e0'}`,
                borderRadius: 4, padding: '5px 10px', cursor: 'pointer',
                fontSize: 12, textAlign: 'center', fontWeight: 600,
              }}
            >{isPriority && PRIORITY_ICONS[opt.label] ? `${PRIORITY_ICONS[opt.label]} ${opt.label}` : opt.label}</div>
          ))}
        </div>
      );
    }

    case 'dropdown':
    case 'person': {
      const options = settings.options || [];
      return (
        <select
          value={value}
          onChange={e => onChange(e.target.value)}
          style={{ width: '100%', border: '1.5px solid #e0e0e0', borderRadius: 6, padding: '7px 8px', fontSize: 13, outline: 'none', boxSizing: 'border-box' }}
        >
          <option value="">— No default —</option>
          {options.map(o => <option key={o} value={o}>{o}</option>)}
        </select>
      );
    }

    case 'checkbox':
      return (
        <div
          onClick={() => onChange(value === 'true' ? 'false' : 'true')}
          style={{ display: 'flex', alignItems: 'center', gap: 10, cursor: 'pointer', padding: '4px 0' }}
        >
          <div style={{
            width: 22, height: 22, borderRadius: 5, border: `2px solid ${value === 'true' ? '#0073ea' : '#c4c4c4'}`,
            background: value === 'true' ? '#0073ea' : '#fff',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            transition: 'all 0.15s', flexShrink: 0,
          }}>
            {value === 'true' && <span style={{ color: '#fff', fontSize: 13, fontWeight: 700 }}>✓</span>}
          </div>
          <span style={{ fontSize: 13, color: '#323338', fontWeight: 500 }}>
            {value === 'true' ? 'Checked by default' : 'Unchecked by default'}
          </span>
        </div>
      );

    case 'rating': {
      const num = parseInt(value) || 0;
      return (
        <div style={{ display: 'flex', gap: 6, padding: '2px 0' }}>
          {[1, 2, 3, 4, 5].map(i => (
            <span
              key={i}
              onClick={() => onChange(i === num ? '' : String(i))}
              style={{ fontSize: 24, cursor: 'pointer', color: i <= num ? '#fdab3d' : '#c4c4c4', transition: 'color 0.1s' }}
              title={`${i} star${i > 1 ? 's' : ''}`}
            >
              {i <= num ? '★' : '☆'}
            </span>
          ))}
          {num > 0 && (
            <span
              onClick={() => onChange('')}
              style={{ fontSize: 11, color: '#aaa', cursor: 'pointer', alignSelf: 'center', marginLeft: 4 }}
            >clear</span>
          )}
        </div>
      );
    }

    case 'number':
      return (
        <input
          type="number" value={value} onChange={e => onChange(e.target.value)}
          placeholder="e.g. 0"
          style={{ width: '100%', border: '1.5px solid #e0e0e0', borderRadius: 6, padding: '7px 10px', fontSize: 13, outline: 'none', boxSizing: 'border-box' }}
          onFocus={e => e.target.style.borderColor = '#0073ea'}
          onBlur={e => e.target.style.borderColor = '#e0e0e0'}
        />
      );

    case 'progress':
      return (
        <div>
          <input
            type="number" min="0" max="100" value={value} onChange={e => onChange(e.target.value)}
            placeholder="0 – 100"
            style={{ width: '100%', border: '1.5px solid #e0e0e0', borderRadius: 6, padding: '7px 10px', fontSize: 13, outline: 'none', boxSizing: 'border-box' }}
            onFocus={e => e.target.style.borderColor = '#0073ea'}
            onBlur={e => e.target.style.borderColor = '#e0e0e0'}
          />
          {value !== '' && (
            <div style={{ marginTop: 6, background: '#e0e0e0', borderRadius: 4, height: 6, overflow: 'hidden' }}>
              <div style={{ width: `${Math.min(100, Math.max(0, parseInt(value) || 0))}%`, height: '100%', background: '#0073ea', borderRadius: 4, transition: 'width 0.2s' }} />
            </div>
          )}
        </div>
      );

    case 'date':
      return (
        <input
          type="date" value={value} onChange={e => onChange(e.target.value)}
          style={{ width: '100%', border: '1.5px solid #e0e0e0', borderRadius: 6, padding: '7px 10px', fontSize: 13, outline: 'none', boxSizing: 'border-box' }}
          onFocus={e => e.target.style.borderColor = '#0073ea'}
          onBlur={e => e.target.style.borderColor = '#e0e0e0'}
        />
      );

    case 'color_picker':
      return (
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <input
            type="color" value={value || '#0073ea'} onChange={e => onChange(e.target.value)}
            style={{ width: 40, height: 32, border: 'none', padding: 0, cursor: 'pointer', background: 'none' }}
          />
          <span style={{ fontSize: 12, color: '#555', fontFamily: 'monospace' }}>{value || '#0073ea'}</span>
        </div>
      );

    default:
      // text, long_text, email, phone, link, tags, location, time_tracking, file
      return (
        <input
          type="text" value={value} onChange={e => onChange(e.target.value)}
          placeholder="Enter default value…"
          style={{ width: '100%', border: '1.5px solid #e0e0e0', borderRadius: 6, padding: '7px 10px', fontSize: 13, outline: 'none', boxSizing: 'border-box' }}
          onFocus={e => e.target.style.borderColor = '#0073ea'}
          onBlur={e => e.target.style.borderColor = '#e0e0e0'}
        />
      );
  }
}

export default function DefaultValueEditor({ col, anchorRect, onSave, onClose }) {
  const [draft, setDraft] = useState(
    col.settings?.defaultValue !== undefined && col.settings?.defaultValue !== null
      ? String(col.settings.defaultValue)
      : ''
  );
  const ref = useRef(null);

  // Close on outside click
  useEffect(() => {
    const handler = (e) => { if (ref.current && !ref.current.contains(e.target)) onClose(); };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [onClose]);

  const noDefault = NO_DEFAULT_TYPES.includes(col.type);

  // Position: keep inside viewport
  const left = Math.min(anchorRect.left, window.innerWidth - 260);
  const top  = anchorRect.bottom + 6;

  return (
    <div
      ref={ref}
      style={{
        position: 'fixed', top, left, width: 250, zIndex: 1000,
        background: '#fff', borderRadius: 10,
        boxShadow: '0 6px 28px rgba(0,0,0,0.16)',
        border: '1px solid #e6e9ef',
        fontFamily: 'Figtree, Roboto, -apple-system, sans-serif',
        overflow: 'hidden',
      }}
    >
      {/* Header */}
      <div style={{ padding: '12px 14px 10px', borderBottom: '1px solid #f0f0f0', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <div>
          <div style={{ fontSize: 13, fontWeight: 700, color: '#323338' }}>Default Value</div>
          <div style={{ fontSize: 11, color: '#888', marginTop: 1 }}>Auto-filled when creating new items</div>
        </div>
        <button onClick={onClose} style={{ fontSize: 18, color: '#aaa', cursor: 'pointer', lineHeight: 1 }}>×</button>
      </div>

      <div style={{ padding: '12px 14px' }}>
        {noDefault ? (
          <div style={{ fontSize: 12, color: '#888', padding: '8px 0' }}>
            This column type doesn't support a default value.
          </div>
        ) : (
          <>
            <DefaultInput col={col} value={draft} onChange={setDraft} />

            <div style={{ display: 'flex', gap: 6, marginTop: 12 }}>
              {draft !== '' && (
                <button
                  onClick={() => onSave('')}
                  style={{ flex: 1, padding: '6px 0', border: '1px solid #ddd', borderRadius: 6, fontSize: 12, color: '#555', cursor: 'pointer' }}
                >Clear</button>
              )}
              <button
                onClick={() => onSave(draft)}
                style={{ flex: 2, padding: '6px 0', background: '#0073ea', color: '#fff', borderRadius: 6, fontSize: 12, fontWeight: 700, cursor: 'pointer' }}
              >Save Default</button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
