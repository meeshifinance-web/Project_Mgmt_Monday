import React, { useState, useRef, useEffect, useCallback } from 'react';
import { updateColumn, uploadFile, deleteFile } from '../api';
import { evaluateFormula } from '../utils/formulaEngine';

const STAR = '★';
const STAR_E = '☆';

const STATUS_PALETTE = [
  '#c4c4c4', '#00c875', '#e2445c', '#fdab3d', '#0073ea',
  '#a25ddc', '#037f4c', '#ff5ac4', '#784bd1', '#ffcb00',
  '#ff642e', '#9aadbd', '#66ccff', '#bb3354', '#333333',
];

const DEFAULT_STATUS_OPTIONS = [
  { label: 'Not Started', color: '#c4c4c4' },
  { label: 'In Progress', color: '#fdab3d' },
  { label: 'Done', color: '#00c875' },
  { label: 'Stuck', color: '#e2445c' },
];

const DEFAULT_PRIORITY_OPTIONS = [
  { label: 'Critical', color: '#e2445c' },
  { label: 'High', color: '#ff642e' },
  { label: 'Medium', color: '#fdab3d' },
  { label: 'Low', color: '#00c875' },
];

const PRIORITY_ICONS = {
  Critical: '🔴',
  High: '🟠',
  Medium: '🟡',
  Low: '🟢',
};

function SwatchPicker({ current, onChange }) {
  return (
    <div style={{
      display: 'flex', flexWrap: 'wrap', gap: 4, padding: 8,
      background: '#fff', border: '1px solid #e0e0e0', borderRadius: 8,
      boxShadow: '0 4px 16px rgba(0,0,0,0.15)', width: 140,
    }}>
      {STATUS_PALETTE.map(c => (
        <div
          key={c}
          onClick={e => { e.stopPropagation(); onChange(c); }}
          style={{
            width: 20, height: 20, borderRadius: 3, background: c, cursor: 'pointer',
            border: c === current ? '2px solid #323338' : '2px solid transparent',
            boxSizing: 'border-box',
          }}
        />
      ))}
    </div>
  );
}

// Status cell with colored pills
function StatusCell({ value, settings, onChange, column, onSettingsUpdate, defaultOptions, iconMap }) {
  const [open, setOpen] = useState(false);
  const [editMode, setEditMode] = useState(false);
  const [draftOptions, setDraftOptions] = useState([]);
  const [openPickerIdx, setOpenPickerIdx] = useState(null);
  const [saving, setSaving] = useState(false);
  const popupRef = useRef(null);

  const options = settings?.options || defaultOptions || DEFAULT_STATUS_OPTIONS;
  const current = options.find(o => o.label === value);
  const bg = current?.color || '#c4c4c4';

  // Close on outside click or Escape
  useEffect(() => {
    if (!open) return;
    const onMouseDown = (e) => {
      if (popupRef.current && !popupRef.current.contains(e.target)) {
        setOpen(false);
        setEditMode(false);
        setOpenPickerIdx(null);
      }
    };
    const onKeyDown = (e) => {
      if (e.key === 'Escape') {
        if (editMode) {
          setEditMode(false);  // Escape in edit mode → back to list
          setOpenPickerIdx(null);
        } else {
          setOpen(false);       // Escape in list mode → close popup
        }
      }
    };
    document.addEventListener('mousedown', onMouseDown);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('mousedown', onMouseDown);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [open, editMode]);

  const openEditor = () => {
    setDraftOptions(options.map(o => ({ ...o })));
    setOpenPickerIdx(null);
    setEditMode(true);
  };

  const addDraftOption = () =>
    setDraftOptions(d => [...d, { label: '', color: '#0073ea' }]);

  const updateDraftLabel = (i, label) =>
    setDraftOptions(d => d.map((o, idx) => idx === i ? { ...o, label } : o));

  const updateDraftColor = (i, color) => {
    setDraftOptions(d => d.map((o, idx) => idx === i ? { ...o, color } : o));
    setOpenPickerIdx(null);
  };

  const removeDraftOption = (i) =>
    setDraftOptions(d => d.filter((_, idx) => idx !== i));

  const handleSave = async () => {
    if (!column || !onSettingsUpdate) return;
    setSaving(true);
    try {
      const newOptions = draftOptions.filter(o => o.label.trim());
      const r = await updateColumn(column.id, {
        title: column.title,
        settings: { ...column.settings, options: newOptions },
      });
      onSettingsUpdate(r.data);
      setEditMode(false);
      setOpen(false);
    } catch (_) {
      // silent – user can retry
    } finally {
      setSaving(false);
    }
  };
  return (
    <div style={{ position: 'relative', width: '100%', height: '100%' }}>
      <div
        onClick={() => { setOpen(o => !o); setEditMode(false); setOpenPickerIdx(null); }}
        title={value || ''}
        style={{
          background: bg, color: '#fff', fontWeight: 600,
          padding: '0 8px', borderRadius: 0, cursor: 'pointer',
          textAlign: 'center', fontSize: 13, userSelect: 'none',
          height: '100%', minHeight: 34,
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          overflow: 'hidden', width: '100%',
        }}
      >
        <span style={{ whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
          {iconMap && value && iconMap[value] ? `${iconMap[value]} ${value}` : (value || '')}
        </span>
      </div>

      {open && (
        <div ref={popupRef} style={{
          position: 'absolute', top: '100%', left: 0, zIndex: 100,
          background: '#fff', borderRadius: 8, boxShadow: '0 4px 20px rgba(0,0,0,0.15)',
          padding: 8, minWidth: 200,
        }}>

          {editMode ? (
            /* ── Inline label editor ── */
            <div>
              <div style={{ fontSize: 11, fontWeight: 700, color: '#676879', marginBottom: 8, textTransform: 'uppercase', letterSpacing: 0.5 }}>
                Edit Labels
              </div>

              <div style={{ maxHeight: 220, overflowY: 'auto', marginBottom: 4 }}>
                {draftOptions.map((opt, i) => (
                  <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 4 }}>
                    {/* Color swatch */}
                    <div style={{ position: 'relative', flexShrink: 0 }}>
                      <div
                        onClick={e => { e.stopPropagation(); setOpenPickerIdx(openPickerIdx === i ? null : i); }}
                        style={{
                          width: 20, height: 20, borderRadius: 3, background: opt.color,
                          cursor: 'pointer', border: '2px solid rgba(0,0,0,0.1)', boxSizing: 'border-box',
                        }}
                        title="Change color"
                      />
                      {openPickerIdx === i && (
                        <div style={{ position: 'absolute', top: 24, left: 0, zIndex: 200 }}
                          onClick={e => e.stopPropagation()}>
                          <SwatchPicker current={opt.color} onChange={c => updateDraftColor(i, c)} />
                        </div>
                      )}
                    </div>

                    {/* Label input */}
                    <input
                      value={opt.label}
                      onChange={e => updateDraftLabel(i, e.target.value)}
                      onClick={e => e.stopPropagation()}
                      style={{
                        flex: 1, border: '1px solid #e0e0e0', borderRadius: 4,
                        padding: '3px 6px', fontSize: 12, outline: 'none', minWidth: 0,
                      }}
                      onFocus={e => e.target.style.borderColor = '#0073ea'}
                      onBlur={e => e.target.style.borderColor = '#e0e0e0'}
                    />

                    {/* Delete */}
                    <button
                      onClick={e => { e.stopPropagation(); removeDraftOption(i); }}
                      style={{ color: '#ccc', fontSize: 16, flexShrink: 0, lineHeight: 1, padding: '1px 2px' }}
                      onMouseEnter={e => e.currentTarget.style.color = '#e2445c'}
                      onMouseLeave={e => e.currentTarget.style.color = '#ccc'}
                    >×</button>
                  </div>
                ))}
              </div>

              {/* Add Label */}
              <button
                onClick={e => { e.stopPropagation(); addDraftOption(); }}
                style={{
                  width: '100%', padding: '5px 8px', marginBottom: 8,
                  border: '1.5px dashed #d0d0d0', borderRadius: 4,
                  color: '#676879', fontSize: 12, cursor: 'pointer', background: '#f7f8fc',
                }}
              >+ Add Label</button>

              {/* Back / Save */}
              <div style={{ display: 'flex', gap: 6 }}>
                <button
                  onClick={e => { e.stopPropagation(); setEditMode(false); setOpenPickerIdx(null); }}
                  style={{ flex: 1, padding: '5px 8px', border: '1px solid #ddd', borderRadius: 4, fontSize: 12, color: '#555', cursor: 'pointer' }}
                >← Back</button>
                <button
                  onClick={e => { e.stopPropagation(); handleSave(); }}
                  disabled={saving}
                  style={{
                    flex: 1, padding: '5px 8px',
                    background: saving ? '#c5c7d0' : '#0073ea',
                    color: '#fff', borderRadius: 4, fontSize: 12, fontWeight: 700,
                    cursor: saving ? 'not-allowed' : 'pointer',
                  }}
                >{saving ? 'Saving…' : 'Save'}</button>
              </div>
            </div>

          ) : (
            /* ── Options list + footer ── */
            <div>
              {options.map(opt => (
                <div
                  key={opt.label}
                  onClick={() => { onChange(opt.label); setOpen(false); }}
                  title={opt.label}
                  style={{
                    background: opt.color, color: '#fff', fontWeight: 600,
                    padding: '6px 12px', borderRadius: 4, cursor: 'pointer',
                    marginBottom: 4, fontSize: 12, textAlign: 'center',
                    whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
                  }}
                >
                  {opt.label}
                </div>
              ))}
              <div
                onClick={() => { onChange(''); setOpen(false); }}
                style={{ padding: '4px 8px', color: '#888', cursor: 'pointer', fontSize: 12, textAlign: 'center' }}
              >
                Clear
              </div>

              {/* Footer */}
              <div style={{ borderTop: '1px solid #e6e9ef', marginTop: 4, paddingTop: 4 }}>
                {column && onSettingsUpdate && (
                  <div
                    onClick={e => { e.stopPropagation(); openEditor(); }}
                    style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '5px 8px', borderRadius: 4, cursor: 'pointer' }}
                    onMouseEnter={e => e.currentTarget.style.background = '#f5f6f8'}
                    onMouseLeave={e => e.currentTarget.style.background = 'transparent'}
                  >
                    <span style={{ fontSize: 13 }}>✏️</span>
                    <span style={{ fontSize: 12, color: '#676879' }}>Edit Labels</span>
                  </div>
                )}
                <div
                  style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '5px 8px', borderRadius: 4, cursor: 'default' }}
                >
                  <span style={{ fontSize: 12, color: '#c5c7d0' }}>Auto-assign labels</span>
                </div>
              </div>
            </div>
          )}

        </div>
      )}
    </div>
  );
}

// Dropdown cell
function DropdownCell({ value, settings, onChange }) {
  const options = settings?.options || [];
  return (
    <select
      value={value || ''}
      onChange={e => onChange(e.target.value)}
      style={{
        width: '100%', border: 'none', background: 'transparent',
        padding: '4px', cursor: 'pointer', outline: 'none',
      }}
    >
      <option value="">—</option>
      {options.map(o => <option key={o} value={o}>{o}</option>)}
    </select>
  );
}

// Rating cell (1-5 stars)
function RatingCell({ value, onChange }) {
  const num = parseInt(value) || 0;
  return (
    <div style={{ display: 'flex', gap: 2 }}>
      {[1, 2, 3, 4, 5].map(i => (
        <span
          key={i}
          onClick={() => onChange(i === num ? '' : String(i))}
          style={{ cursor: 'pointer', fontSize: 16, color: i <= num ? '#fdab3d' : '#c4c4c4' }}
        >
          {i <= num ? STAR : STAR_E}
        </span>
      ))}
    </div>
  );
}

// Progress cell (0-100 slider)
function ProgressCell({ value, onChange }) {
  const num = parseInt(value) || 0;
  const color = num >= 100 ? '#00c875' : num >= 50 ? '#fdab3d' : '#0073ea';
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
      <div style={{ flex: 1, background: '#e0e0e0', borderRadius: 4, height: 8, overflow: 'hidden' }}>
        <div style={{ width: `${num}%`, background: color, height: '100%', borderRadius: 4, transition: 'width 0.3s' }} />
      </div>
      <input
        type="number" min="0" max="100" value={value || ''}
        onChange={e => onChange(e.target.value)}
        onBlur={e => onChange(e.target.value)}
        style={{ width: 44, border: '1px solid #ddd', borderRadius: 4, padding: '2px 4px', textAlign: 'center' }}
      />
      <span style={{ fontSize: 11, color: '#888' }}>%</span>
    </div>
  );
}

// Checkbox cell
function CheckboxCell({ value, onChange }) {
  const checked = value === 'true' || value === '1';
  return (
    <div style={{ display: 'flex', justifyContent: 'center' }}>
      <input
        type="checkbox"
        checked={checked}
        onChange={e => onChange(e.target.checked ? 'true' : 'false')}
        style={{ width: 16, height: 16, cursor: 'pointer', accentColor: '#0073ea' }}
      />
    </div>
  );
}

// Tags cell
function TagsCell({ value, onChange }) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(value || '');
  const tags = (value || '').split(',').map(t => t.trim()).filter(Boolean);

  if (editing) {
    return (
      <input
        autoFocus
        value={draft}
        onChange={e => setDraft(e.target.value)}
        onBlur={() => { onChange(draft); setEditing(false); }}
        placeholder="tag1, tag2, tag3"
        style={{ width: '100%', border: '1px solid #0073ea', borderRadius: 4, padding: '3px 6px', outline: 'none' }}
      />
    );
  }

  return (
    <div onClick={() => { setDraft(value || ''); setEditing(true); }} style={{ display: 'flex', flexWrap: 'wrap', gap: 4, cursor: 'text', minHeight: 26 }}>
      {tags.map(tag => (
        <span key={tag} style={{
          background: '#e2f0ff', color: '#0073ea', borderRadius: 12,
          padding: '2px 8px', fontSize: 11, fontWeight: 600,
        }}>{tag}</span>
      ))}
      {!tags.length && <span style={{ color: '#ccc' }}>—</span>}
    </div>
  );
}

// Timeline (date range) cell
function TimelineCell({ value, onChange }) {
  const parts = (value || '').split(' → ');
  const [start, setStart] = useState(parts[0] || '');
  const [end, setEnd] = useState(parts[1] || '');

  const commit = (s, e) => onChange(`${s} → ${e}`);

  return (
    <div style={{ display: 'flex', gap: 4, alignItems: 'center' }}>
      <input type="date" value={start}
        onChange={ev => { setStart(ev.target.value); commit(ev.target.value, end); }}
        style={{ border: '1px solid #ddd', borderRadius: 4, padding: '2px 4px', fontSize: 12 }}
      />
      <span style={{ color: '#888' }}>→</span>
      <input type="date" value={end}
        onChange={ev => { setEnd(ev.target.value); commit(start, ev.target.value); }}
        style={{ border: '1px solid #ddd', borderRadius: 4, padding: '2px 4px', fontSize: 12 }}
      />
    </div>
  );
}

// Color picker cell
function ColorPickerCell({ value, onChange }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
      <input
        type="color"
        value={value || '#0073ea'}
        onChange={e => onChange(e.target.value)}
        style={{ width: 32, height: 28, border: 'none', padding: 0, cursor: 'pointer', background: 'none' }}
      />
      <span style={{ fontSize: 11, color: '#555' }}>{value || ''}</span>
    </div>
  );
}

// Link cell
function LinkCell({ value, onChange }) {
  const [editing, setEditing] = useState(false);
  if (editing) {
    return (
      <input
        autoFocus value={value || ''}
        onChange={e => onChange(e.target.value)}
        onBlur={() => setEditing(false)}
        placeholder="https://..."
        style={{ width: '100%', border: '1px solid #0073ea', borderRadius: 4, padding: '3px 6px', outline: 'none' }}
      />
    );
  }
  if (value) {
    return (
      <a href={value} target="_blank" rel="noreferrer" style={{ color: '#0073ea', textDecoration: 'none', fontSize: 12 }}
        onDoubleClick={e => { e.preventDefault(); setEditing(true); }}>
        {value.length > 30 ? value.slice(0, 30) + '…' : value}
      </a>
    );
  }
  return <span onClick={() => setEditing(true)} style={{ color: '#ccc', cursor: 'text' }}>—</span>;
}

// Generic text inline editor — with debounced auto-save
function TextCell({ value, onChange, multiline, type }) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(value || '');
  const [saveStatus, setSaveStatus] = useState(''); // '' | 'saving' | 'saved'
  const debounceRef = useRef(null);
  const lastSaved = useRef(value || '');

  // Keep draft in sync when external value changes (e.g. automation sets it)
  useEffect(() => {
    if (!editing) setDraft(value || '');
  }, [value, editing]);

  const save = useCallback((v) => {
    if (v === lastSaved.current) return;
    lastSaved.current = v;
    setSaveStatus('saving');
    onChange(v);
    setTimeout(() => setSaveStatus('saved'), 300);
    setTimeout(() => setSaveStatus(''), 1800);
  }, [onChange]);

  const handleChange = (e) => {
    const v = e.target.value;
    setDraft(v);
    clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => save(v), 600);
  };

  const commit = () => {
    clearTimeout(debounceRef.current);
    save(draft);
    setEditing(false);
  };

  if (editing) {
    if (multiline) {
      return (
        <textarea
          autoFocus value={draft} onChange={handleChange} onBlur={commit}
          style={{ width: '100%', minHeight: 60, border: '1px solid #0073ea', borderRadius: 4, padding: '4px 6px', resize: 'vertical', outline: 'none' }}
        />
      );
    }
    return (
      <input
        autoFocus type={type || 'text'} value={draft}
        onChange={handleChange}
        onBlur={commit}
        onKeyDown={e => { if (e.key === 'Enter') commit(); if (e.key === 'Escape') { setDraft(value || ''); setEditing(false); } }}
        style={{ width: '100%', border: '1px solid #0073ea', borderRadius: 4, padding: '3px 6px', outline: 'none' }}
      />
    );
  }

  return (
    <div
      onClick={() => { setDraft(value || ''); setEditing(true); }}
      style={{ cursor: 'text', minHeight: 26, padding: '3px 4px', color: value ? '#323338' : '#ccc', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', display: 'flex', alignItems: 'center', gap: 4 }}
    >
      <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{value || '—'}</span>
      {saveStatus === 'saving' && <span style={{ fontSize: 10, color: '#aaa', flexShrink: 0 }}>●</span>}
      {saveStatus === 'saved' && <span style={{ fontSize: 10, color: '#00c875', flexShrink: 0 }}>✓</span>}
    </div>
  );
}

// ── Deterministic avatar colour from a display name ───────────────────────────
const AVATAR_COLORS = [
  '#0073ea', '#00c875', '#fdab3d', '#e2445c',
  '#a25ddc', '#037f4c', '#ff642e', '#784bd1',
  '#ff5ac4', '#0099cc', '#bb3354', '#666666',
];
function nameToColor(name) {
  const n = name || '';
  const sum = n.split('').reduce((a, c) => a + c.charCodeAt(0), 0);
  return AVATAR_COLORS[sum % AVATAR_COLORS.length];
}
function nameToInitials(name) {
  const parts = (name || '').trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return '?';
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

// ── Creation Log cell — read-only, shows creator avatar + date/time ───────────
function CreationLogCell({ item }) {
  const [tooltip, setTooltip] = useState(false);

  if (!item?.created_at) {
    return <span style={{ color: '#c5c7d0', padding: '3px 4px', fontSize: 12 }}>—</span>;
  }

  const creatorName = item.created_by_user_name || 'Unknown';
  const initials = nameToInitials(creatorName);
  const avatarColor = nameToColor(creatorName);
  const dt = new Date(item.created_at);

  const dateStr = dt.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' });
  const timeStr = dt.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', hour12: true });

  return (
    <div
      style={{ display: 'flex', alignItems: 'center', gap: 7, padding: '2px 4px', position: 'relative', cursor: 'default' }}
      onMouseEnter={() => setTooltip(true)}
      onMouseLeave={() => setTooltip(false)}
    >
      {/* Initials avatar */}
      <div style={{
        width: 26, height: 26, borderRadius: '50%',
        background: avatarColor, color: '#fff',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        fontSize: 10, fontWeight: 700, flexShrink: 0, letterSpacing: 0.5,
        userSelect: 'none',
      }}>
        {initials}
      </div>

      {/* Date + time stacked */}
      <div style={{ lineHeight: 1.35, minWidth: 0 }}>
        <div style={{ fontSize: 10, color: '#676879', whiteSpace: 'nowrap' }}>{dateStr}</div>
        <div style={{ fontSize: 11, fontWeight: 600, color: '#323338', whiteSpace: 'nowrap' }}>{timeStr}</div>
      </div>

      {/* Hover tooltip — full name + full timestamp */}
      {tooltip && (
        <div style={{
          position: 'absolute', bottom: '110%', left: 0, zIndex: 300,
          background: '#323338', color: '#fff', borderRadius: 6,
          padding: '6px 10px', fontSize: 11, whiteSpace: 'nowrap',
          boxShadow: '0 3px 12px rgba(0,0,0,0.2)', pointerEvents: 'none',
        }}>
          <div style={{ fontWeight: 700, marginBottom: 2 }}>{creatorName}</div>
          <div style={{ color: '#c5c7d0' }}>{dateStr} · {timeStr}</div>
        </div>
      )}
    </div>
  );
}

// ── Parse multi-owner value (JSON array or legacy single string) ──────────────
export function parseOwners(val) {
  if (!val) return [];
  try { const p = JSON.parse(val); return Array.isArray(p) ? p : p ? [String(p)] : []; }
  catch { return val.trim() ? [val.trim()] : []; }
}

// ── Person cell: multi-select with avatar pills ───────────────────────────────
function PersonCell({ value, settings, onChange }) {
  const [open, setOpen] = useState(false);
  const popupRef = useRef(null);
  const options = settings?.options || [];
  const selected = parseOwners(value);
  const readOnly = !onChange;

  // Close on outside click or Escape
  useEffect(() => {
    if (!open) return;
    const onMouseDown = (e) => {
      if (popupRef.current && !popupRef.current.contains(e.target)) setOpen(false);
    };
    const onKeyDown = (e) => { if (e.key === 'Escape') setOpen(false); };
    document.addEventListener('mousedown', onMouseDown);
    document.addEventListener('keydown', onKeyDown);
    return () => { document.removeEventListener('mousedown', onMouseDown); document.removeEventListener('keydown', onKeyDown); };
  }, [open]);

  const toggle = (name) => {
    if (readOnly) return;
    const next = selected.includes(name)
      ? selected.filter(n => n !== name)
      : [...selected, name];
    onChange(next.length > 0 ? JSON.stringify(next) : '');
  };

  return (
    <div style={{ position: 'relative' }}>
      {/* Pill display */}
      <div
        onClick={() => { if (!readOnly) setOpen(o => !o); }}
        style={{ display: 'flex', flexDirection: 'row', flexWrap: 'nowrap', gap: 4, cursor: readOnly ? 'default' : 'pointer', minHeight: 28, padding: '2px 2px', alignItems: 'center', overflow: 'hidden' }}
      >
        {selected.map(name => (
          <div key={name} title={name} style={{
            width: 26, height: 26, borderRadius: '50%',
            background: nameToColor(name), color: '#fff',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            fontSize: 10, fontWeight: 700, flexShrink: 0, userSelect: 'none',
          }}>
            {nameToInitials(name)}
          </div>
        ))}
        {selected.length === 0
          ? <span style={{ color: '#ccc', fontSize: 12 }}>—</span>
          : null}
        {!readOnly && options.length > 0 && (
          <div style={{ width: 20, height: 20, borderRadius: '50%', background: '#f0f0f0', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 14, color: '#999' }}>+</div>
        )}
      </div>

      {/* Dropdown — only for managers */}
      {open && !readOnly && (
        <div ref={popupRef} style={{
          position: 'absolute', top: '100%', left: 0, zIndex: 300,
          background: '#fff', borderRadius: 10, boxShadow: '0 6px 24px rgba(0,0,0,0.15)',
          border: '1px solid #e6e9ef', minWidth: 210, padding: '6px 0', overflow: 'hidden',
        }}>
          <div style={{ padding: '6px 12px 4px', fontSize: 11, fontWeight: 700, color: '#888', textTransform: 'uppercase', letterSpacing: 0.5 }}>
            Assign people
          </div>
          {options.length === 0 && (
            <div style={{ padding: '8px 14px', fontSize: 12, color: '#aaa' }}>No members in this column</div>
          )}
          {options.map(name => {
            const isSelected = selected.includes(name);
            return (
              <div
                key={name}
                onClick={() => toggle(name)}
                style={{
                  display: 'flex', alignItems: 'center', gap: 10, padding: '7px 14px', cursor: 'pointer',
                  background: isSelected ? '#f0f6ff' : '#fff',
                }}
                onMouseEnter={e => { if (!isSelected) e.currentTarget.style.background = '#f5f6f8'; }}
                onMouseLeave={e => { if (!isSelected) e.currentTarget.style.background = '#fff'; }}
              >
                <div style={{
                  width: 28, height: 28, borderRadius: '50%',
                  background: nameToColor(name), color: '#fff',
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  fontSize: 11, fontWeight: 700, flexShrink: 0,
                }}>
                  {nameToInitials(name)}
                </div>
                <span style={{ flex: 1, fontSize: 13, color: '#323338', fontWeight: isSelected ? 600 : 400 }}>{name}</span>
                {isSelected && <span style={{ color: '#0073ea', fontSize: 14, fontWeight: 700 }}>✓</span>}
              </div>
            );
          })}
          {selected.length > 0 && (
            <>
              <div style={{ height: 1, background: '#f0f0f0', margin: '4px 0' }} />
              <div
                onClick={() => { onChange(''); setOpen(false); }}
                style={{ padding: '7px 14px', fontSize: 12, color: '#e2445c', cursor: 'pointer', fontWeight: 600 }}
                onMouseEnter={e => e.currentTarget.style.background = '#fff5f7'}
                onMouseLeave={e => e.currentTarget.style.background = ''}
              >✕ Clear all</div>
            </>
          )}
        </div>
      )}
    </div>
  );
}

// ── File attachment cell ───────────────────────────────────────────────────────
function FileCell({ value, onChange }) {
  const [uploading, setUploading] = useState(false);
  const inputRef = useRef(null);

  let files = [];
  try { files = value ? JSON.parse(value) : []; } catch { files = []; }
  if (!Array.isArray(files)) files = [];

  const handleFileChange = async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    e.target.value = '';
    setUploading(true);
    try {
      const uploaded = await uploadFile(file);
      const next = [...files, uploaded];
      onChange(JSON.stringify(next));
    } catch {
      // upload failed — silent
    } finally {
      setUploading(false);
    }
  };

  const handleRemove = async (index) => {
    const entry = files[index];
    const next = files.filter((_, i) => i !== index);
    onChange(next.length > 0 ? JSON.stringify(next) : '');
    if (entry?.name) deleteFile(entry.name).catch(() => { });
  };

  const fmt = (bytes) => {
    if (!bytes) return '';
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  };

  const icon = (mime) => {
    if (!mime) return '📄';
    if (mime.startsWith('image/')) return '🖼️';
    if (mime === 'application/pdf') return '📕';
    if (mime.includes('spreadsheet') || mime.includes('excel')) return '📊';
    if (mime.includes('word') || mime.includes('document')) return '📝';
    if (mime.includes('zip') || mime.includes('compressed')) return '🗜️';
    return '📎';
  };

  return (
    <div style={{ padding: '4px 2px' }}>
      {files.map((f, i) => (
        <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 4, marginBottom: 2 }}>
          <span style={{ fontSize: 13 }}>{icon(f.mimeType)}</span>
          <a
            href={f.url}
            target="_blank"
            rel="noopener noreferrer"
            onClick={e => e.stopPropagation()}
            style={{ fontSize: 12, color: '#0073ea', textDecoration: 'none', flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}
            title={f.originalName}
          >
            {f.originalName}
          </a>
          {f.size ? <span style={{ fontSize: 10, color: '#aaa', flexShrink: 0 }}>{fmt(f.size)}</span> : null}
          <button
            onClick={e => { e.stopPropagation(); handleRemove(i); }}
            style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#e2445c', fontSize: 13, padding: '0 2px', lineHeight: 1 }}
            title="Remove"
          >✕</button>
        </div>
      ))}
      <input ref={inputRef} type="file" style={{ display: 'none' }} onChange={handleFileChange} />
      <button
        onClick={e => { e.stopPropagation(); inputRef.current?.click(); }}
        disabled={uploading}
        style={{ fontSize: 11, color: '#0073ea', background: 'none', border: 'none', cursor: uploading ? 'default' : 'pointer', padding: '2px 0', opacity: uploading ? 0.5 : 1 }}
      >
        {uploading ? '⏳ Uploading…' : '📎 Attach file'}
      </button>
    </div>
  );
}

// ── Formula cell — computed read-only display ─────────────────────────────────
function FormulaCell({ column, item, columns }) {
  const formula = column?.settings?.formula || '';
  if (!formula.trim()) {
    return (
      <div style={{ padding: '3px 6px', color: '#c5c7d0', fontSize: 11, fontStyle: 'italic' }}
        title="No formula set — click column header ▸ Edit Formula">
        formula…
      </div>
    );
  }
  const result = evaluateFormula(formula, item, columns);
  const isErr = result.startsWith('#');
  return (
    <div
      title={isErr ? result : formula}
      style={{
        padding: '3px 6px', fontSize: 12,
        color: isErr ? '#e2445c' : 'var(--text-primary)',
        fontFamily: isErr ? 'monospace' : 'inherit',
        overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
        maxWidth: 200,
      }}
    >
      {result || <span style={{ color: '#c5c7d0' }}>—</span>}
    </div>
  );
}

export default function ColumnCell({ column, value, onChange, onEditSettings, item, columns }) {
  const { type, settings } = column;

  switch (type) {
    case 'status':
      return <StatusCell value={value} settings={settings} onChange={onChange} column={column} onSettingsUpdate={onEditSettings} />;
    case 'priority':
      return <StatusCell value={value} settings={settings} onChange={onChange} column={column} onSettingsUpdate={onEditSettings} defaultOptions={DEFAULT_PRIORITY_OPTIONS} iconMap={PRIORITY_ICONS} />;
    case 'dropdown':
      return <DropdownCell value={value} settings={settings} onChange={onChange} />;
    case 'rating':
      return <RatingCell value={value} onChange={onChange} />;
    case 'progress':
      return <ProgressCell value={value} onChange={onChange} />;
    case 'checkbox':
      return <CheckboxCell value={value} onChange={onChange} />;
    case 'tags':
      return <TagsCell value={value} onChange={onChange} />;
    case 'timeline':
      return <TimelineCell value={value} onChange={onChange} />;
    case 'color_picker':
      return <ColorPickerCell value={value} onChange={onChange} />;
    case 'link':
      return <LinkCell value={value} onChange={onChange} />;
    case 'date':
      return <TextCell value={value} onChange={onChange} type="date" />;
    case 'number':
      return <TextCell value={value} onChange={onChange} type="number" />;
    case 'email':
      return <TextCell value={value} onChange={onChange} type="email" />;
    case 'phone':
      return <TextCell value={value} onChange={onChange} type="tel" />;
    case 'long_text':
      return <TextCell value={value} onChange={onChange} multiline />;
    case 'time_tracking':
      return <TextCell value={value} onChange={onChange} type="text" />;
    case 'creation_log':
      return (
        <div style={{ cursor: 'default', userSelect: 'none' }} onClick={e => e.stopPropagation()}>
          <CreationLogCell item={item} />
        </div>
      );
    case 'formula':
      return <FormulaCell column={column} item={item} columns={columns || []} />;
    case 'person':
      return <PersonCell value={value} settings={settings} onChange={onChange} />;
    case 'file':
      return <FileCell value={value} onChange={onChange} />;
    case 'location':
    default:
      return <TextCell value={value} onChange={onChange} />;
  }
}
