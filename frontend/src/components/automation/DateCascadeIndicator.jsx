import React, { useState } from 'react';

/**
 * Small inline badge shown next to a cell value that was auto-calculated
 * by the date cascade engine.
 *
 * Props:
 *   isAutoCascaded  {bool}     — whether this cell was auto-set
 *   onManualOverride {Function} — called when user explicitly overrides the cell
 */
export default function DateCascadeIndicator({ isAutoCascaded, onManualOverride }) {
  const [tooltip, setTooltip] = useState(false);

  if (!isAutoCascaded) return null;

  return (
    <span
      style={{ position: 'relative', display: 'inline-flex', alignItems: 'center' }}
      onMouseEnter={() => setTooltip(true)}
      onMouseLeave={() => setTooltip(false)}
    >
      <span
        onClick={e => { e.stopPropagation(); onManualOverride?.(); }}
        style={{
          display: 'inline-flex', alignItems: 'center',
          background: '#00c875', color: '#fff',
          borderRadius: 8, padding: '1px 6px',
          fontSize: 10, fontWeight: 700, cursor: 'pointer',
          userSelect: 'none', marginLeft: 4, lineHeight: 1.6,
          transition: 'background 0.15s',
        }}
        onMouseEnter={e => { e.currentTarget.style.background = '#00b369'; }}
        onMouseLeave={e => { e.currentTarget.style.background = '#00c875'; }}
        title="Auto-calculated. Click to override manually."
      >
        ⚡ auto
      </span>
      {tooltip && (
        <span style={{
          position: 'absolute', bottom: '130%', left: '50%',
          transform: 'translateX(-50%)',
          background: '#323338', color: '#fff',
          borderRadius: 6, padding: '5px 10px',
          fontSize: 11, whiteSpace: 'nowrap',
          zIndex: 9999, pointerEvents: 'none',
          boxShadow: '0 2px 8px rgba(0,0,0,0.2)',
        }}>
          Auto-calculated by Date Cascade. Click to override.
          <span style={{
            position: 'absolute', top: '100%', left: '50%',
            transform: 'translateX(-50%)',
            borderWidth: 5, borderStyle: 'solid',
            borderColor: '#323338 transparent transparent transparent',
          }} />
        </span>
      )}
    </span>
  );
}
