import React, { useState } from 'react';

const PALETTE = [
  '#c4c4c4','#00c875','#e2445c','#fdab3d','#9b72f5',
  '#a25ddc','#037f4c','#ff5ac4','#784bd1','#ffcb00',
  '#ff642e','#9aadbd','#66ccff','#bb3354','#333333',
];

function ColorPicker({ current, onChange }) {
  return (
    <div style={{
      display: 'flex', flexWrap: 'wrap', gap: 5, padding: 8,
      background: '#fff', border: '1px solid #e0e0e0', borderRadius: 8,
      boxShadow: '0 4px 16px rgba(0,0,0,0.12)', width: 178,
    }}>
      {PALETTE.map(c => (
        <div
          key={c}
          onClick={e => { e.stopPropagation(); onChange(c); }}
          style={{
            width: 24, height: 24, borderRadius: 4, background: c, cursor: 'pointer',
            border: c === current ? '2px solid #323338' : '2px solid transparent',
            boxSizing: 'border-box',
          }}
        />
      ))}
    </div>
  );
}

export default function StatusOptionsEditor({ column, onSave, onClose }) {
  const isDropdown = column.type === 'dropdown';
  const defaultOptions = isDropdown
    ? []
    : [
        { label: 'Not Started', color: '#c4c4c4' },
        { label: 'In Progress', color: '#fdab3d' },
        { label: 'Done',        color: '#00c875' },
        { label: 'Stuck',       color: '#e2445c' },
      ];
  const [options, setOptions] = useState(
    (column.settings?.options?.length ? column.settings.options : defaultOptions)
      .map(o => typeof o === 'string' ? { label: o, color: '#9b72f5' } : { ...o })
  );
  const [openPickerIdx, setOpenPickerIdx] = useState(null); // index of option whose picker is open
  const [newLabel, setNewLabel] = useState('');
  const [newColor, setNewColor] = useState('#9b72f5');
  const [showNewPicker, setShowNewPicker] = useState(false);
  const [search, setSearch] = useState('');
  const [addError, setAddError] = useState('');

  const norm = (s) => String(s || '').trim().toLowerCase();

  // Duplicate-name detection (case-insensitive). Blocks save so two options
  // can't share a label (which previously silently collided on the board).
  const labelCounts = {};
  options.forEach(o => { const k = norm(o.label); if (k) labelCounts[k] = (labelCounts[k] || 0) + 1; });
  const isDupe = (i) => { const k = norm(options[i].label); return k && labelCounts[k] > 1; };
  const hasDupes = Object.values(labelCounts).some(n => n > 1);
  const hasBlank = options.some(o => !o.label.trim());

  const q = search.trim().toLowerCase();
  const searching = q.length > 0;

  const updateLabel = (i, val) =>
    setOptions(o => o.map((opt, idx) => idx === i ? { ...opt, label: val } : opt));

  const updateColor = (i, color) => {
    setOptions(o => o.map((opt, idx) => idx === i ? { ...opt, color } : opt));
    setOpenPickerIdx(null);
  };

  const removeOption = (i) => {
    setOptions(o => o.filter((_, idx) => idx !== i));
    setOpenPickerIdx(null);
  };

  // Reorder by swapping with the neighbour (disabled while a search filter is on,
  // since positions would be ambiguous against the filtered view).
  const move = (i, dir) => {
    const j = i + dir;
    if (j < 0 || j >= options.length) return;
    setOptions(o => { const n = [...o]; [n[i], n[j]] = [n[j], n[i]]; return n; });
    setOpenPickerIdx(null);
  };

  const addOption = () => {
    const label = newLabel.trim();
    if (!label) return;
    if (labelCounts[norm(label)]) { setAddError('That label already exists'); return; }
    setOptions(o => [...o, { label, color: newColor }]);
    setNewLabel('');
    setNewColor('#9b72f5');
    setShowNewPicker(false);
    setAddError('');
  };

  const closeAllPickers = () => {
    setOpenPickerIdx(null);
    setShowNewPicker(false);
  };

  const canSave = !hasDupes && !hasBlank;

  return (
    <div style={{
      position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.4)', zIndex: 600,
      display: 'flex', alignItems: 'center', justifyContent: 'center',
    }} onClick={onClose}>
      <div onClick={e => e.stopPropagation()} style={{
        background: '#fff', borderRadius: 12, padding: 24, width: 460,
        maxHeight: '80vh', overflowY: 'auto',
        boxShadow: '0 8px 40px rgba(0,0,0,0.2)',
      }} onMouseDown={closeAllPickers}>

        <h3 style={{ marginBottom: 4, fontSize: 16, fontWeight: 700 }}>
          {isDropdown ? 'Edit Dropdown Options' : 'Edit Status Options'}
        </h3>
        <p style={{ fontSize: 12, color: '#888', marginBottom: 14 }}>
          {column.title} · reorder with ↑ ↓, click a swatch to recolour
        </p>

        {/* Search — keeps the list usable when there are many options */}
        {options.length > 6 && (
          <input
            value={search}
            onChange={e => setSearch(e.target.value)}
            onMouseDown={e => { e.stopPropagation(); closeAllPickers(); }}
            placeholder="Filter options…"
            style={{
              width: '100%', boxSizing: 'border-box', marginBottom: 12,
              border: '1.5px solid #e0e0e0', borderRadius: 6, padding: '6px 10px', fontSize: 13, outline: 'none',
            }}
          />
        )}

        {/* Existing options */}
        <div style={{ marginBottom: 16 }}>
          {options.map((opt, i) => {
            if (searching && !opt.label.toLowerCase().includes(q)) return null;
            const dupe = isDupe(i);
            return (
              <div key={i} style={{ marginBottom: 8 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>

                  {/* Reorder controls */}
                  <div style={{ display: 'flex', flexDirection: 'column', flexShrink: 0 }}>
                    <button onMouseDown={e => { e.stopPropagation(); move(i, -1); }} disabled={searching || i === 0}
                      title={searching ? 'Clear the filter to reorder' : 'Move up'}
                      style={{ fontSize: 9, lineHeight: 1, color: (searching || i === 0) ? '#d0d0d0' : '#9699a6', cursor: (searching || i === 0) ? 'default' : 'pointer', padding: '1px 3px' }}>▲</button>
                    <button onMouseDown={e => { e.stopPropagation(); move(i, 1); }} disabled={searching || i === options.length - 1}
                      title={searching ? 'Clear the filter to reorder' : 'Move down'}
                      style={{ fontSize: 9, lineHeight: 1, color: (searching || i === options.length - 1) ? '#d0d0d0' : '#9699a6', cursor: (searching || i === options.length - 1) ? 'default' : 'pointer', padding: '1px 3px' }}>▼</button>
                  </div>

                  {/* Color swatch — click to open picker */}
                  <div style={{ position: 'relative' }}>
                    <div
                      onMouseDown={e => { e.stopPropagation(); setOpenPickerIdx(openPickerIdx === i ? null : i); setShowNewPicker(false); }}
                      style={{
                        width: 28, height: 28, borderRadius: 6, background: opt.color,
                        cursor: 'pointer', flexShrink: 0, border: '2px solid rgba(0,0,0,0.1)',
                        boxSizing: 'border-box',
                      }}
                      title="Click to change colour"
                    />
                    {openPickerIdx === i && (
                      <div style={{ position: 'absolute', top: 32, left: 0, zIndex: 10 }}
                        onMouseDown={e => e.stopPropagation()}>
                        <ColorPicker current={opt.color} onChange={c => updateColor(i, c)} />
                      </div>
                    )}
                  </div>

                  {/* Label input */}
                  <input
                    value={opt.label}
                    onChange={e => updateLabel(i, e.target.value)}
                    onMouseDown={e => { e.stopPropagation(); closeAllPickers(); }}
                    style={{
                      flex: 1, border: `1.5px solid ${dupe ? '#e2445c' : '#e0e0e0'}`, borderRadius: 6,
                      padding: '5px 10px', fontSize: 13, outline: 'none',
                    }}
                    onFocus={e => { if (!dupe) e.target.style.borderColor = '#9b72f5'; }}
                    onBlur={e => { e.target.style.borderColor = dupe ? '#e2445c' : '#e0e0e0'; }}
                  />

                  {/* Preview pill */}
                  <div style={{
                    background: opt.color, color: '#fff', borderRadius: 4,
                    padding: '3px 12px', fontSize: 11, fontWeight: 700,
                    minWidth: 72, textAlign: 'center', flexShrink: 0,
                  }}>
                    {opt.label || '…'}
                  </div>

                  {/* Delete */}
                  <button
                    onMouseDown={e => { e.stopPropagation(); removeOption(i); }}
                    style={{ color: '#ccc', fontSize: 18, lineHeight: 1, flexShrink: 0, padding: '2px 4px' }}
                    onMouseEnter={e => e.currentTarget.style.color = '#e2445c'}
                    onMouseLeave={e => e.currentTarget.style.color = '#ccc'}
                  >×</button>
                </div>
                {dupe && <div style={{ fontSize: 10.5, color: '#e2445c', marginLeft: 40, marginTop: 2 }}>Duplicate label</div>}
              </div>
            );
          })}
          {searching && !options.some(o => o.label.toLowerCase().includes(q)) && (
            <div style={{ fontSize: 12, color: '#aaa', textAlign: 'center', padding: '8px 0' }}>No options match "{search}"</div>
          )}
        </div>

        {/* Add new option */}
        <div style={{
          background: '#f7f8fc', borderRadius: 8, padding: '12px 14px',
          border: '1.5px dashed #d0d0d0', marginBottom: 16,
        }}>
          <p style={{ fontSize: 11, fontWeight: 700, color: '#888', marginBottom: 8, textTransform: 'uppercase', letterSpacing: 0.5 }}>
            {isDropdown ? 'Add New Option' : 'Add New Level'}
          </p>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            {/* New color swatch */}
            <div style={{ position: 'relative' }}>
              <div
                onMouseDown={e => { e.stopPropagation(); setShowNewPicker(v => !v); setOpenPickerIdx(null); }}
                style={{
                  width: 28, height: 28, borderRadius: 6, background: newColor,
                  cursor: 'pointer', flexShrink: 0, border: '2px solid rgba(0,0,0,0.1)',
                  boxSizing: 'border-box',
                }}
                title="Click to pick colour"
              />
              {showNewPicker && (
                <div style={{ position: 'absolute', top: 32, left: 0, zIndex: 10 }}
                  onMouseDown={e => e.stopPropagation()}>
                  <ColorPicker current={newColor} onChange={c => { setNewColor(c); setShowNewPicker(false); }} />
                </div>
              )}
            </div>

            {/* New label input */}
            <input
              value={newLabel}
              onChange={e => { setNewLabel(e.target.value); if (addError) setAddError(''); }}
              onMouseDown={e => { e.stopPropagation(); closeAllPickers(); }}
              onKeyDown={e => e.key === 'Enter' && addOption()}
              placeholder="e.g. Blocked, On Hold…"
              style={{
                flex: 1, border: `1.5px solid ${addError ? '#e2445c' : '#e0e0e0'}`, borderRadius: 6,
                padding: '5px 10px', fontSize: 13, outline: 'none',
              }}
              onFocus={e => { if (!addError) e.target.style.borderColor = '#9b72f5'; }}
              onBlur={e => { e.target.style.borderColor = addError ? '#e2445c' : '#e0e0e0'; }}
            />

            <button
              onMouseDown={e => { e.stopPropagation(); addOption(); }}
              disabled={!newLabel.trim()}
              style={{
                background: newLabel.trim() ? '#9b72f5' : '#e0e0e0',
                color: '#fff', borderRadius: 6, padding: '6px 14px',
                fontWeight: 700, fontSize: 13, cursor: newLabel.trim() ? 'pointer' : 'not-allowed',
                flexShrink: 0,
              }}
            >+ Add</button>
          </div>
          {addError && <div style={{ fontSize: 11, color: '#e2445c', marginTop: 6 }}>{addError}</div>}
        </div>

        {/* Actions */}
        {!canSave && (
          <div style={{ fontSize: 12, color: '#e2445c', marginBottom: 10, textAlign: 'right' }}>
            {hasDupes ? 'Resolve duplicate labels before saving.' : 'Every option needs a label.'}
          </div>
        )}
        <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
          <button
            onMouseDown={e => { e.stopPropagation(); onClose(); }}
            style={{ padding: '8px 18px', border: '1px solid #ddd', borderRadius: 8, color: '#555', cursor: 'pointer', fontSize: 13 }}
          >Cancel</button>
          <button
            onMouseDown={e => { e.stopPropagation(); if (canSave) onSave(options.map(o => ({ ...o, label: o.label.trim() }))); }}
            disabled={!canSave}
            style={{ padding: '8px 20px', background: canSave ? '#9b72f5' : '#c9bdf0', color: '#fff', borderRadius: 8, fontWeight: 700, fontSize: 13, cursor: canSave ? 'pointer' : 'not-allowed' }}
          >Save</button>
        </div>

      </div>
    </div>
  );
}
