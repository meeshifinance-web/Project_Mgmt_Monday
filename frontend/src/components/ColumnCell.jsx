import React, { useState, useRef, useEffect, useCallback } from 'react';
import { createPortal } from 'react-dom';
import { updateColumn, uploadFile, deleteFile } from '../api';
import { evaluateFormula } from '../utils/formulaEngine';
import { useThemeContext } from '../context/ThemeContext';

const STAR = '★';
const STAR_E = '☆';

const STATUS_PALETTE = [
  '#c4c4c4', '#808080', '#333333', '#00c875', '#037f4c',
  '#9cd326', '#cab641', '#ffcb00', '#fdab3d', '#ff8a00',
  '#ff642e', '#e2445c', '#bb3354', '#ff5ac4', '#ff158a',
  '#a25ddc', '#9b72f5', '#784bd1', '#5559df', '#401694',
  '#0073ea', '#0086c0', '#66ccff', '#4eccc6', '#9aadbd',
  '#225091', '#579bfc', '#66d9e8', '#7fdbff', '#00a9ff',
  '#2d7ff9', '#1f76c2', '#0f9d58', '#00854d', '#6cc644',
  '#f2c94c', '#f2994a', '#eb5757', '#d83a52', '#6b7280',
];

// Monday-style label colors: use the stored color as the button fill.
const SOFT_COLOR_MAP = {
  '#c4c4c4': { bg: '#F0F0F0', text: '#6B6B6B' },
  '#fdab3d': { bg: '#FBE7D6', text: '#F08A36' },
  '#00c875': { bg: '#DDF5EA', text: '#38A169' },
  '#e2445c': { bg: '#F9DDE3', text: '#E35D74' },
  '#a25ddc': { bg: '#E8DDFD', text: '#7A4DDB' },
  '#9b72f5': { bg: '#EDE4FD', text: '#7A4DDB' },
  '#a358df': { bg: '#EDE4FD', text: '#7A4DDB' },
  '#037f4c': { bg: '#D6F5E9', text: '#037f4c' },
  '#ff5ac4': { bg: '#FDE8F7', text: '#C94BA0' },
  '#784bd1': { bg: '#EDE4FD', text: '#6B3EC7' },
  '#ffcb00': { bg: '#FFF8D6', text: '#A68A00' },
  '#ff642e': { bg: '#FFE6DC', text: '#D14A15' },
  '#9aadbd': { bg: '#EEF2F5', text: '#5C7089' },
  '#66ccff': { bg: '#DAEEFF', text: '#1A82C3' },
  '#bb3354': { bg: '#F9D8E0', text: '#9C2240' },
  '#333333': { bg: '#E8E8E8', text: '#333333' },
};

const DARK_SOFT_COLOR_MAP = {
  '#c4c4c4': { bg: '#ECEFF8', text: '#5F6680', glow: 'rgba(236, 239, 248, 0.18)' },
  '#fdab3d': { bg: '#FFE6CF', text: '#B65A12', glow: 'rgba(255, 230, 207, 0.22)' },
  '#00c875': { bg: '#D8F7EA', text: '#087A4A', glow: 'rgba(216, 247, 234, 0.20)' },
  '#e2445c': { bg: '#FFD8E0', text: '#B72942', glow: 'rgba(255, 216, 224, 0.22)' },
  '#a25ddc': { bg: '#E8D9FF', text: '#6B36B8', glow: 'rgba(232, 217, 255, 0.22)' },
  '#9b72f5': { bg: '#E8D9FF', text: '#6C3DFF', glow: 'rgba(232, 217, 255, 0.22)' },
  '#a358df': { bg: '#E8D9FF', text: '#6B36B8', glow: 'rgba(232, 217, 255, 0.22)' },
  '#037f4c': { bg: '#D8F7EA', text: '#03633C', glow: 'rgba(216, 247, 234, 0.20)' },
  '#ff5ac4': { bg: '#FFE0F3', text: '#B92D83', glow: 'rgba(255, 224, 243, 0.22)' },
  '#784bd1': { bg: '#E5DAFF', text: '#5930A8', glow: 'rgba(229, 218, 255, 0.22)' },
  '#ffcb00': { bg: '#FFF3B8', text: '#9A7600', glow: 'rgba(255, 243, 184, 0.20)' },
  '#ff642e': { bg: '#FFE0D2', text: '#B83D12', glow: 'rgba(255, 224, 210, 0.22)' },
  '#9aadbd': { bg: '#E8EEF4', text: '#5C7089', glow: 'rgba(232, 238, 244, 0.18)' },
  '#66ccff': { bg: '#DDF4FF', text: '#1476B8', glow: 'rgba(221, 244, 255, 0.22)' },
  '#bb3354': { bg: '#FFD8E2', text: '#92213C', glow: 'rgba(255, 216, 226, 0.22)' },
  '#333333': { bg: '#E6E8F0', text: '#383D4D', glow: 'rgba(230, 232, 240, 0.16)' },
};

const DARK_STATUS_LABEL_MAP = {
  'in progress': { bg: '#E8D9FF', text: '#6C3DFF', glow: 'rgba(108, 61, 255, 0.22)' },
  done: { bg: '#FFE9D6', text: '#FF8A1F', glow: 'rgba(255, 138, 31, 0.22)' },
  stuck: { bg: '#FFD9DF', text: '#FF4D4F', glow: 'rgba(255, 77, 79, 0.22)' },
  review: { bg: '#DDF4FF', text: '#1D8FFF', glow: 'rgba(29, 143, 255, 0.22)' },
  completed: { bg: '#DDF8E8', text: '#16A34A', glow: 'rgba(22, 163, 74, 0.22)' },
  success: { bg: '#DDF8E8', text: '#16A34A', glow: 'rgba(22, 163, 74, 0.22)' },
  critical: { bg: '#FFD8E0', text: '#B72942', glow: 'rgba(255, 216, 224, 0.22)' },
  high: { bg: '#FFE0D2', text: '#B83D12', glow: 'rgba(255, 224, 210, 0.22)' },
  medium: { bg: '#FFE6CF', text: '#B65A12', glow: 'rgba(255, 230, 207, 0.22)' },
  low: { bg: '#D8F7EA', text: '#087A4A', glow: 'rgba(216, 247, 234, 0.20)' },
};

export function getSoftStyle(color, isDark = false, label = '') {
  const key = color?.toLowerCase();
  const labelKey = String(label || '').trim().toLowerCase();
  const solidColor = color || DARK_STATUS_LABEL_MAP[labelKey]?.text || SOFT_COLOR_MAP[key]?.text || '#c4c4c4';
  return {
    bg: solidColor,
    text: '#fff',
    glow: `${solidColor}44`,
  };
}

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

const PRIORITY_ICONS = {};

function SwatchPicker({ current, onChange }) {
  return (
    <div style={{
      display: 'grid', gridTemplateColumns: 'repeat(8, 22px)', gap: 6, padding: 10,
      background: '#fff', border: '1px solid #e0e0e0', borderRadius: 10,
      boxShadow: '0 12px 32px rgba(0,0,0,0.18)', width: 246,
    }}>
      {STATUS_PALETTE.map(c => (
        <div
          key={c}
          onClick={e => { e.stopPropagation(); onChange(c); }}
          style={{
            width: 22, height: 22, borderRadius: 5, background: c, cursor: 'pointer',
            border: c === current ? '2px solid #fff' : '2px solid rgba(255,255,255,0.72)',
            outline: c === current ? '2px solid #9b72f5' : '1px solid rgba(0,0,0,0.08)',
            boxSizing: 'border-box',
            boxShadow: c === current ? '0 0 0 3px rgba(155,114,245,0.18)' : 'none',
          }}
        />
      ))}
    </div>
  );
}

// Status cell with colored pills
function StatusCell({ value, settings, onChange, column, onSettingsUpdate, defaultOptions, iconMap }) {
  const [open, setOpen] = useState(false);
  const [hovered, setHovered] = useState(false);
  const [editMode, setEditMode] = useState(false);
  const [draftOptions, setDraftOptions] = useState([]);
  const [openPickerIdx, setOpenPickerIdx] = useState(null);
  const [saving, setSaving] = useState(false);
  const popupRef = useRef(null);
  const { resolvedTheme } = useThemeContext();
  const isDark = resolvedTheme === 'dark';

  const options = settings?.options || defaultOptions || DEFAULT_STATUS_OPTIONS;
  const current = options.find(o => o.label === value);
  const rawColor = current?.color || '#c4c4c4';
  const softStyle = getSoftStyle(rawColor, isDark, current?.label || value);
  const bg = softStyle.bg;
  const textColor = softStyle.text;
  const popupBg = isDark ? '#2c315f' : '#fff';
  const popupBorder = isDark ? 'rgba(255,255,255,0.12)' : '#e6e9ef';
  const textPrimary = isDark ? '#f6f7ff' : '#1a1a2e';
  const textSecondary = isDark ? '#cfd4ff' : '#676879';
  const inputBg = isDark ? 'rgba(255,255,255,0.06)' : '#fff';
  const footerHoverBg = isDark ? 'rgba(255,255,255,0.08)' : '#f5f6f8';

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
    setDraftOptions(d => [...d, { label: '', color: '#a25ddc' }]);

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
        onMouseEnter={() => setHovered(true)}
        onMouseLeave={() => setHovered(false)}
        title={value || ''}
        style={{
          padding: 0, cursor: 'pointer',
          height: '100%', minHeight: 34, width: '100%',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          overflow: 'hidden', userSelect: 'none',
        }}
      >
        <span className="status-pill-label" style={{
          width: '100%', height: '100%', minHeight: 28,
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          background: bg, color: textColor, fontWeight: 700,
          '--status-pill-text': textColor,
          padding: '6px 12px', borderRadius: 0,
          fontSize: 14, textAlign: 'center',
          whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
          letterSpacing: 0,
          border: 'none',
          boxShadow: hovered
            ? `0 4px 14px ${softStyle.glow || 'rgba(80,60,160,0.12)'}`
            : 'none',
          filter: hovered ? 'brightness(0.96)' : 'none',
          transition: 'box-shadow 0.12s ease, filter 0.12s ease',
        }}>
          {iconMap && value && iconMap[value] ? `${iconMap[value]} ${value}` : (value || '')}
        </span>
      </div>

      {open && (
        <div ref={popupRef} className="cell-dropdown-popup" style={{
          position: 'absolute', top: '100%', left: 0, zIndex: 100,
          background: popupBg, border: `1px solid ${popupBorder}`, borderRadius: 10,
          boxShadow: isDark ? '0 16px 36px rgba(0,0,0,0.44)' : '0 4px 20px rgba(0,0,0,0.15)',
          padding: 10, minWidth: editMode ? 330 : 200,
        }}>

          {editMode ? (
            /* ── Inline label editor ── */
            <div>
              <div style={{ fontSize: 11, fontWeight: 700, color: textSecondary, marginBottom: 10, textTransform: 'uppercase', letterSpacing: 0.5 }}>
                Edit Labels
              </div>

              <div style={{ maxHeight: 260, overflowY: 'auto', overflowX: 'hidden', marginBottom: 8, paddingRight: 2 }}>
                {draftOptions.map((opt, i) => (
                  <div key={i} style={{ marginBottom: openPickerIdx === i ? 10 : 6 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                      <button
                        type="button"
                        onClick={e => { e.stopPropagation(); setOpenPickerIdx(openPickerIdx === i ? null : i); }}
                        style={{
                          width: 32, height: 28, borderRadius: 5, background: opt.color,
                          cursor: 'pointer', border: `1px solid ${popupBorder}`, boxSizing: 'border-box',
                          boxShadow: 'inset 0 0 0 1px rgba(255,255,255,0.22)',
                        }}
                        title="Change color"
                      />

                      <input
                        value={opt.label}
                        onChange={e => updateDraftLabel(i, e.target.value)}
                        onClick={e => e.stopPropagation()}
                        style={{
                          flex: 1, border: `1px solid ${popupBorder}`, borderRadius: 5,
                          padding: '7px 9px', fontSize: 12, outline: 'none', minWidth: 0,
                          background: inputBg, color: textPrimary, fontWeight: 600,
                        }}
                        onFocus={e => e.target.style.borderColor = '#9b72f5'}
                        onBlur={e => e.target.style.borderColor = popupBorder}
                      />

                      <button
                        onClick={e => { e.stopPropagation(); removeDraftOption(i); }}
                        style={{ color: textSecondary, fontSize: 20, flexShrink: 0, lineHeight: 1, padding: '1px 4px' }}
                        onMouseEnter={e => e.currentTarget.style.color = '#e2445c'}
                        onMouseLeave={e => e.currentTarget.style.color = textSecondary}
                      >×</button>
                    </div>
                    {openPickerIdx === i && (
                      <div style={{ marginTop: 8 }} onClick={e => e.stopPropagation()}>
                        <SwatchPicker current={opt.color} onChange={c => updateDraftColor(i, c)} />
                      </div>
                    )}
                  </div>
                ))}
              </div>

              {/* Add Label */}
              <button
                onClick={e => { e.stopPropagation(); addDraftOption(); }}
                style={{
                  width: '100%', padding: '5px 8px', marginBottom: 8,
                  border: `1.5px dashed ${isDark ? 'rgba(255,255,255,0.42)' : '#d0d0d0'}`, borderRadius: 5,
                  color: textSecondary, fontSize: 12, fontWeight: 700, cursor: 'pointer',
                  background: isDark ? 'rgba(255,255,255,0.06)' : '#f7f8fc',
                }}
              >+ Add Label</button>

              {/* Back / Save */}
              <div style={{ display: 'flex', gap: 6 }}>
                <button
                  onClick={e => { e.stopPropagation(); setEditMode(false); setOpenPickerIdx(null); }}
                  style={{ flex: 1, padding: '7px 8px', border: `1px solid ${popupBorder}`, borderRadius: 5, fontSize: 12, color: textSecondary, cursor: 'pointer', background: 'transparent' }}
                >← Back</button>
                <button
                  onClick={e => { e.stopPropagation(); handleSave(); }}
                  disabled={saving}
                  style={{
                    flex: 1, padding: '5px 8px',
                    background: saving ? '#c5c7d0' : '#9b72f5',
                    color: '#fff', borderRadius: 5, fontSize: 12, fontWeight: 700,
                    cursor: saving ? 'not-allowed' : 'pointer',
                  }}
                >{saving ? 'Saving…' : 'Save'}</button>
              </div>
            </div>

          ) : (
            /* ── Options list + footer ── */
            <div>
              {/* Scroll cap so a column with many statuses (e.g. 20+) stays
                  navigable — the bottom options were unreachable when the
                  dropdown extended past the viewport. */}
              <div style={{ maxHeight: 280, overflowY: 'auto', paddingRight: 2 }}>
                {options.map(opt => (
                  <div
                    className="status-option-label"
                    key={opt.label}
                    onClick={() => { onChange(opt.label); setOpen(false); }}
                    title={opt.label}
                    style={(() => { const s = getSoftStyle(opt.color, isDark, opt.label); return {
                      '--status-option-text': s.text,
                      '--status-option-bg': s.bg,
                      background: s.bg, color: s.text, fontWeight: 700,
                      padding: '12px 14px', borderRadius: 0, cursor: 'pointer',
                      marginBottom: 8, fontSize: 14, textAlign: 'center',
                      whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
                      letterSpacing: 0, transition: 'filter 0.12s ease',
                    }; })()}
                    onMouseEnter={e => { e.currentTarget.style.filter = 'brightness(0.95)'; }}
                    onMouseLeave={e => { e.currentTarget.style.filter = 'none'; }}
                  >
                    {opt.label}
                  </div>
                ))}
              </div>
              <div
                onClick={() => { onChange(''); setOpen(false); }}
                style={{ padding: '7px 8px', color: textPrimary, cursor: 'pointer', fontSize: 13, fontWeight: 600, textAlign: 'center' }}
              >
                Clear
              </div>

              {/* Footer */}
              <div style={{ borderTop: `1px solid ${popupBorder}`, marginTop: 6, paddingTop: 6 }}>
                {column && onSettingsUpdate && (
                  <div
                    onClick={e => { e.stopPropagation(); openEditor(); }}
                    style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '8px 10px', borderRadius: 5, cursor: 'pointer', color: textPrimary }}
                    onMouseEnter={e => e.currentTarget.style.background = footerHoverBg}
                    onMouseLeave={e => e.currentTarget.style.background = 'transparent'}
                  >
                    <span style={{ fontSize: 13 }}>✏️</span>
                    <span style={{ fontSize: 13, color: textPrimary, fontWeight: 700 }}>Edit Labels</span>
                  </div>
                )}
                <div
                  style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '7px 10px', borderRadius: 4, cursor: 'default' }}
                >
                  <span style={{ fontSize: 13, color: textPrimary, fontWeight: 700 }}>Auto-assign labels</span>
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
// Normalize dropdown options to {label, color} (handles legacy string arrays)
function normalizeDdOptions(raw) {
  if (!Array.isArray(raw)) return [];
  return raw.map((o, i) =>
    typeof o === 'string'
      ? { label: o, color: STATUS_PALETTE[i % STATUS_PALETTE.length] }
      : o
  );
}

// Parse multi-select value (JSON array or legacy single string)
function parseDdValue(val) {
  if (!val) return [];
  try {
    const p = JSON.parse(val);
    return Array.isArray(p) ? p : p ? [String(p)] : [];
  } catch {
    return val.trim() ? [val.trim()] : [];
  }
}

function DropdownCell({ value, settings, onChange, column, onSettingsUpdate }) {
  const [open, setOpen] = useState(false);
  const [editMode, setEditMode] = useState(false);
  const [search, setSearch] = useState('');
  const [saving, setSaving] = useState(false);
  const [draftOptions, setDraftOptions] = useState([]);
  const [openPickerIdx, setOpenPickerIdx] = useState(null);
  const popupRef = useRef(null);
  const searchRef = useRef(null);
  const { resolvedTheme } = useThemeContext();
  const isDark = resolvedTheme === 'dark';

  const options = normalizeDdOptions(settings?.options || []);
  const selected = parseDdValue(value);
  const readOnly = !onChange;

  // Close popup on outside click or Escape
  useEffect(() => {
    if (!open) return;
    const onDown = (e) => {
      if (popupRef.current && !popupRef.current.contains(e.target)) {
        setOpen(false); setEditMode(false); setSearch('');
      }
    };
    const onKey = (e) => { if (e.key === 'Escape') { setOpen(false); setEditMode(false); setSearch(''); } };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => { document.removeEventListener('mousedown', onDown); document.removeEventListener('keydown', onKey); };
  }, [open]);

  // Auto-focus search when popup opens
  useEffect(() => {
    if (open && !editMode && searchRef.current) searchRef.current.focus();
  }, [open, editMode]);

  const toggle = (label) => {
    const next = selected.includes(label)
      ? selected.filter(l => l !== label)
      : [...selected, label];
    onChange(next.length > 0 ? JSON.stringify(next) : '');
  };

  const openEditor = () => {
    setDraftOptions(options.map(o => ({ ...o })));
    setEditMode(true);
    setOpenPickerIdx(null);
  };

  const saveDraft = async () => {
    if (!column || !onSettingsUpdate) return;
    const cleaned = draftOptions.filter(o => o.label.trim());
    setSaving(true);
    try {
      const r = await updateColumn(column.id, {
        title: column.title,
        settings: { ...(column.settings || {}), options: cleaned },
      });
      onSettingsUpdate(r.data);
      setEditMode(false);
    } catch (_) {
      // silent – user can retry
    } finally {
      setSaving(false);
    }
  };

  const filtered = options.filter(o =>
    !search || o.label.toLowerCase().includes(search.toLowerCase())
  );

  // Theme-aware colours
  const popupBg = isDark ? 'var(--card-bg)' : '#fff';
  const popupBorder = isDark ? 'var(--border-color)' : '#e6e9ef';
  const textPrimary = isDark ? 'var(--text-primary)' : '#1a1a2e';
  const textSecondary = isDark ? 'var(--text-secondary)' : '#676879';
  const rowHoverBg = isDark ? 'rgba(255,255,255,0.06)' : '#f5f6f8';
  const rowSelectedBg = isDark ? 'rgba(0,115,234,0.15)' : '#f0f6ff';
  const dividerColor = isDark ? 'var(--border-color)' : '#e6e9ef';
  const inputBg = isDark ? 'var(--input-bg)' : '#f7f8fc';

  return (
    <div style={{ position: 'relative', minHeight: 28, display: 'flex', alignItems: 'center' }}>
      {/* ── Chip display ── */}
      <div
        onClick={() => { if (!readOnly) { setOpen(o => !o); setEditMode(false); setSearch(''); } }}
        style={{ display: 'flex', flexWrap: 'wrap', gap: 3, cursor: readOnly ? 'default' : 'pointer', flex: 1, alignItems: 'center', padding: '2px 2px', minHeight: 28 }}
      >
        {selected.length === 0
          ? <span style={{ color: '#ccc', fontSize: 12 }}>—</span>
          : selected.map(label => {
              const opt = options.find(o => o.label === label);
              const c = opt?.color || '#c4c4c4';
              return (
                <span key={label} style={{
                  background: c + '22', color: c, border: `1px solid ${c}66`,
                  borderRadius: 4, padding: '1px 7px', fontSize: 11, fontWeight: 600,
                  maxWidth: 100, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                }}>{label}</span>
              );
            })
        }
      </div>

      {/* ── Popup ── */}
      {open && !readOnly && (
        <div ref={popupRef} className="cell-dropdown-popup" style={{
          position: 'absolute', top: '100%', left: 0, zIndex: 300,
          background: popupBg, borderRadius: 10,
          boxShadow: isDark ? '0 6px 24px rgba(0,0,0,0.5)' : '0 6px 24px rgba(0,0,0,0.15)',
          border: `1px solid ${popupBorder}`, minWidth: 230, padding: '6px 0', overflow: 'visible',
        }}>

          {editMode ? (
            /* ── Edit Options mode ── */
            <div style={{ padding: '0 10px 10px' }}>
              <div style={{ fontSize: 11, fontWeight: 700, color: textSecondary, padding: '8px 2px 10px', textTransform: 'uppercase', letterSpacing: 0.5 }}>
                Edit Options
              </div>
              {draftOptions.map((opt, i) => (
                <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 6 }}>
                  {/* Color swatch */}
                  <div style={{ position: 'relative', flexShrink: 0 }}>
                    <div
                      onClick={e => { e.stopPropagation(); setOpenPickerIdx(openPickerIdx === i ? null : i); }}
                      style={{ width: 20, height: 20, borderRadius: 4, background: opt.color, cursor: 'pointer', border: '2px solid rgba(0,0,0,0.12)', boxSizing: 'border-box' }}
                      title="Change color"
                    />
                    {openPickerIdx === i && (
                      <div style={{ position: 'absolute', top: 24, left: 0, zIndex: 20 }} onClick={e => e.stopPropagation()}>
                        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4, padding: 8, background: popupBg, border: `1px solid ${popupBorder}`, borderRadius: 8, boxShadow: '0 4px 16px rgba(0,0,0,0.18)', width: 162 }}>
                          {STATUS_PALETTE.map(c => (
                            <div key={c}
                              onClick={() => { setDraftOptions(d => d.map((x, idx) => idx === i ? { ...x, color: c } : x)); setOpenPickerIdx(null); }}
                              style={{ width: 22, height: 22, borderRadius: 4, background: c, cursor: 'pointer', border: c === opt.color ? '2px solid #323338' : '2px solid transparent', boxSizing: 'border-box' }}
                            />
                          ))}
                        </div>
                      </div>
                    )}
                  </div>
                  {/* Label */}
                  <input
                    value={opt.label}
                    onChange={e => setDraftOptions(d => d.map((x, idx) => idx === i ? { ...x, label: e.target.value } : x))}
                    placeholder="Label…"
                    style={{ flex: 1, border: `1.5px solid ${popupBorder}`, borderRadius: 5, padding: '4px 8px', fontSize: 12, background: inputBg, color: textPrimary, outline: 'none' }}
                    onFocus={e => e.target.style.borderColor = '#9b72f5'}
                    onBlur={e => e.target.style.borderColor = popupBorder}
                  />
                  {/* Delete */}
                  <button
                    onClick={() => setDraftOptions(d => d.filter((_, idx) => idx !== i))}
                    style={{ color: '#ccc', fontSize: 16, flexShrink: 0, lineHeight: 1, padding: '1px 3px', background: 'none', border: 'none', cursor: 'pointer' }}
                    onMouseEnter={e => e.currentTarget.style.color = '#e2445c'}
                    onMouseLeave={e => e.currentTarget.style.color = '#ccc'}
                  >×</button>
                </div>
              ))}
              <button
                onClick={() => setDraftOptions(d => [...d, { label: '', color: STATUS_PALETTE[d.length % STATUS_PALETTE.length] }])}
                style={{ width: '100%', padding: '5px 8px', marginBottom: 8, border: `1.5px dashed ${dividerColor}`, borderRadius: 4, color: textSecondary, fontSize: 12, cursor: 'pointer', background: 'none' }}
              >+ Add Option</button>
              <div style={{ display: 'flex', gap: 6 }}>
                <button onClick={() => { setEditMode(false); setOpenPickerIdx(null); }}
                  style={{ flex: 1, padding: '5px 8px', border: `1px solid ${dividerColor}`, borderRadius: 4, fontSize: 12, color: textSecondary, cursor: 'pointer', background: 'none' }}>← Back</button>
                <button onClick={saveDraft} disabled={saving}
                  style={{ flex: 1, padding: '5px 8px', background: saving ? '#c5c7d0' : '#9b72f5', color: '#fff', borderRadius: 4, fontSize: 12, fontWeight: 700, cursor: saving ? 'not-allowed' : 'pointer', border: 'none' }}>
                  {saving ? 'Saving…' : 'Save'}
                </button>
              </div>
            </div>
          ) : (
            /* ── Select mode ── */
            <>
              {/* Search */}
              <div style={{ padding: '4px 10px 6px' }}>
                <input
                  ref={searchRef}
                  value={search}
                  onChange={e => setSearch(e.target.value)}
                  placeholder="Search options…"
                  style={{ width: '100%', border: `1px solid ${popupBorder}`, borderRadius: 6, padding: '5px 10px', fontSize: 12, background: inputBg, color: textPrimary, outline: 'none', boxSizing: 'border-box' }}
                  onClick={e => e.stopPropagation()}
                />
              </div>

              {/* Options list */}
              <div style={{ maxHeight: 200, overflowY: 'auto' }}>
                {options.length === 0 && (
                  <div style={{ padding: '8px 14px', fontSize: 12, color: textSecondary }}>
                    No options yet — click Edit Options below
                  </div>
                )}
                {filtered.length === 0 && options.length > 0 && (
                  <div style={{ padding: '8px 14px', fontSize: 12, color: textSecondary }}>No matches</div>
                )}
                {filtered.map(opt => {
                  const isSel = selected.includes(opt.label);
                  return (
                    <div
                      key={opt.label}
                      onClick={() => toggle(opt.label)}
                      style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '7px 12px', cursor: 'pointer', background: isSel ? rowSelectedBg : 'transparent', transition: 'background 0.12s ease' }}
                      onMouseEnter={e => { e.currentTarget.style.background = isSel ? rowSelectedBg : rowHoverBg; }}
                      onMouseLeave={e => { e.currentTarget.style.background = isSel ? rowSelectedBg : 'transparent'; }}
                    >
                      <div style={{ width: 10, height: 10, borderRadius: 2, background: opt.color, flexShrink: 0 }} />
                      <span style={{ flex: 1, fontSize: 13, color: textPrimary, fontWeight: isSel ? 600 : 400 }}>{opt.label}</span>
                      {isSel && <span style={{ color: '#9b72f5', fontSize: 13, fontWeight: 700 }}>✓</span>}
                    </div>
                  );
                })}
              </div>

              {/* Footer */}
              <div style={{ borderTop: `1px solid ${dividerColor}`, marginTop: 2 }}>
                {selected.length > 0 && (
                  <div
                    onClick={() => { onChange(''); setOpen(false); }}
                    style={{ padding: '6px 12px', fontSize: 12, color: '#e2445c', cursor: 'pointer', fontWeight: 600 }}
                    onMouseEnter={e => e.currentTarget.style.background = isDark ? 'rgba(226,68,92,0.12)' : '#fff5f7'}
                    onMouseLeave={e => e.currentTarget.style.background = 'transparent'}
                  >✕ Clear all</div>
                )}
                {onSettingsUpdate && (
                  <div
                    onClick={e => { e.stopPropagation(); openEditor(); }}
                    style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '6px 12px', cursor: 'pointer', borderRadius: 0 }}
                    onMouseEnter={e => e.currentTarget.style.background = rowHoverBg}
                    onMouseLeave={e => e.currentTarget.style.background = 'transparent'}
                  >
                    <span style={{ fontSize: 12 }}>✏️</span>
                    <span style={{ fontSize: 12, color: textSecondary }}>Edit Options</span>
                  </div>
                )}
              </div>
            </>
          )}
        </div>
      )}
    </div>
  );
}

// Rating cell (1-5 stars)
function RatingCell({ value, onChange }) {
  const num = parseInt(value) || 0;
  const { resolvedTheme } = useThemeContext();
  const emptyColor = resolvedTheme === 'dark' ? '#4a5180' : '#c4c4c4';
  return (
    <div style={{ display: 'flex', gap: 2 }}>
      {[1, 2, 3, 4, 5].map(i => (
        <span
          key={i}
          className="rating-star"
          onClick={() => onChange(i === num ? '' : String(i))}
          style={{ cursor: 'pointer', fontSize: 16, color: i <= num ? '#fdab3d' : emptyColor }}
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
  const color = num >= 100 ? '#00c875' : num >= 50 ? '#fdab3d' : '#9b72f5';
  const { resolvedTheme } = useThemeContext();
  const isDark = resolvedTheme === 'dark';
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
      <div style={{
        flex: 1,
        background: isDark ? 'rgba(255,255,255,0.10)' : '#e0e0e0',
        borderRadius: 4, height: 8, overflow: 'hidden',
        border: isDark ? '1px solid rgba(255,255,255,0.08)' : 'none',
      }}>
        <div style={{ width: `${num}%`, background: color, height: '100%', borderRadius: 4, transition: 'width 0.3s' }} />
      </div>
      <input
        type="number" min="0" max="100" value={value || ''}
        onChange={e => onChange(e.target.value)}
        onBlur={e => onChange(e.target.value)}
        style={{
          width: 44,
          border: `1px solid ${isDark ? 'rgba(255,255,255,0.22)' : '#ddd'}`,
          borderRadius: 4, padding: '2px 4px', textAlign: 'center',
          background: isDark ? 'rgba(255,255,255,0.08)' : '#fff',
          color: isDark ? '#fff' : '#323338',
        }}
      />
      <span style={{ fontSize: 11, color: isDark ? 'var(--text-secondary)' : '#888' }}>%</span>
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
        style={{ width: 16, height: 16, cursor: 'pointer', accentColor: '#9b72f5' }}
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
        style={{ width: '100%', border: '1px solid #9b72f5', borderRadius: 4, padding: '3px 6px', outline: 'none' }}
      />
    );
  }

  return (
    <div onClick={() => { setDraft(value || ''); setEditing(true); }} style={{ display: 'flex', flexWrap: 'wrap', gap: 4, cursor: 'text', minHeight: 26 }}>
      {tags.map(tag => (
        <span key={tag} style={{
          background: '#e2f0ff', color: '#9b72f5', borderRadius: 12,
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
        value={value || '#9b72f5'}
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
        style={{ width: '100%', border: '1px solid #9b72f5', borderRadius: 4, padding: '3px 6px', outline: 'none' }}
      />
    );
  }
  if (value) {
    return (
      <a href={value} target="_blank" rel="noreferrer" style={{ color: '#9b72f5', textDecoration: 'none', fontSize: 12 }}
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
          style={{ width: '100%', minHeight: 60, border: '1px solid #9b72f5', borderRadius: 4, padding: '4px 6px', resize: 'vertical', outline: 'none' }}
        />
      );
    }
    return (
      <input
        autoFocus type={type || 'text'} value={draft}
        onChange={handleChange}
        onBlur={commit}
        onKeyDown={e => { if (e.key === 'Enter') commit(); if (e.key === 'Escape') { setDraft(value || ''); setEditing(false); } }}
        style={{ width: '100%', border: '1px solid #9b72f5', borderRadius: 4, padding: '3px 6px', outline: 'none' }}
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

// ── Long Text Cell – hover tooltip + click-to-open resizable popup ──────────
function LongTextCell({ value, onChange }) {
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState(value || '');
  const [hovered, setHovered] = useState(false);
  const [tooltipPos, setTooltipPos] = useState({ top: 0, left: 0 });
  const [popupSize, setPopupSize] = useState({ w: 380, h: 220 });
  const [popupPos, setPopupPos] = useState(null); // {top,left} after first open
  const saveStatus = useRef('');
  const debounceRef = useRef(null);
  const lastSaved = useRef(value || '');
  const cellRef = useRef(null);
  const popupRef = useRef(null);
  const dragState = useRef(null); // for resize
  const dragMoveState = useRef(null); // for popup drag

  // sync draft when value changes externally
  useEffect(() => {
    if (!open) { setDraft(value || ''); lastSaved.current = value || ''; }
  }, [value, open]);

  const save = useCallback((v) => {
    if (v === lastSaved.current) return;
    lastSaved.current = v;
    onChange(v);
  }, [onChange]);

  const handleChange = (e) => {
    const v = e.target.value;
    setDraft(v);
    clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => save(v), 500);
  };

  const handleOpen = (e) => {
    e.stopPropagation();
    setDraft(value || '');
    lastSaved.current = value || '';
    // position popup near the cell
    if (cellRef.current) {
      const rect = cellRef.current.getBoundingClientRect();
      const vpW = window.innerWidth, vpH = window.innerHeight;
      let top = rect.bottom + 4;
      let left = rect.left;
      // keep inside viewport
      if (left + 380 > vpW - 8) left = vpW - 388;
      if (top + 220 > vpH - 8) top = rect.top - 224;
      setPopupPos({ top, left });
    }
    setOpen(true);
    setHovered(false);
  };

  const handleClose = () => {
    clearTimeout(debounceRef.current);
    save(draft);
    setOpen(false);
  };

  // close on outside click
  useEffect(() => {
    if (!open) return;
    const onDown = (e) => {
      if (popupRef.current && !popupRef.current.contains(e.target)) handleClose();
    };
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, [open, draft]);

  // ── Resize handle drag ────────────────────────────────────────────────────
  const onResizeMouseDown = (e) => {
    e.preventDefault();
    e.stopPropagation();
    dragState.current = { startX: e.clientX, startY: e.clientY, startW: popupSize.w, startH: popupSize.h };
    const onMove = (ev) => {
      const dw = ev.clientX - dragState.current.startX;
      const dh = ev.clientY - dragState.current.startY;
      setPopupSize({
        w: Math.max(240, dragState.current.startW + dw),
        h: Math.max(140, dragState.current.startH + dh),
      });
    };
    const onUp = () => { dragState.current = null; document.removeEventListener('mousemove', onMove); document.removeEventListener('mouseup', onUp); };
    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
  };

  // ── Popup header drag (move) ──────────────────────────────────────────────
  const onHeaderMouseDown = (e) => {
    if (e.target.tagName === 'BUTTON') return;
    e.preventDefault();
    dragMoveState.current = { startX: e.clientX, startY: e.clientY, startTop: popupPos.top, startLeft: popupPos.left };
    const onMove = (ev) => {
      const dx = ev.clientX - dragMoveState.current.startX;
      const dy = ev.clientY - dragMoveState.current.startY;
      setPopupPos({ top: dragMoveState.current.startTop + dy, left: dragMoveState.current.startLeft + dx });
    };
    const onUp = () => { dragMoveState.current = null; document.removeEventListener('mousemove', onMove); document.removeEventListener('mouseup', onUp); };
    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
  };

  // ── Hover tooltip position ────────────────────────────────────────────────
  const handleMouseEnter = (e) => {
    if (!value) return;
    const rect = cellRef.current?.getBoundingClientRect();
    if (rect) {
      setTooltipPos({ top: rect.bottom + 6, left: rect.left });
    }
    setHovered(true);
  };

  return (
    <>
      {/* Cell display */}
      <div
        ref={cellRef}
        onClick={handleOpen}
        onMouseEnter={handleMouseEnter}
        onMouseLeave={() => setHovered(false)}
        style={{
          cursor: 'text', minHeight: 26, padding: '3px 4px',
          color: value ? 'var(--text-primary, #323338)' : '#ccc',
          overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
          display: 'flex', alignItems: 'center', gap: 4,
        }}
      >
        <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {value || '—'}
        </span>
        {value && (
          <span style={{ fontSize: 11, color: '#9b72f5', flexShrink: 0, opacity: 0.7 }} title="Click to expand">⤢</span>
        )}
      </div>

      {/* Hover tooltip – rendered via portal so it escapes overflow:hidden */}
      {hovered && !open && value && createPortal(
        <div
          style={{
            position: 'fixed',
            top: tooltipPos.top,
            left: tooltipPos.left,
            maxWidth: 320,
            background: '#323338',
            color: '#fff',
            padding: '8px 10px',
            borderRadius: 6,
            fontSize: 13,
            lineHeight: 1.5,
            whiteSpace: 'pre-wrap',
            wordBreak: 'break-word',
            boxShadow: '0 4px 16px rgba(0,0,0,0.22)',
            zIndex: 9999,
            pointerEvents: 'none',
            maxHeight: 180,
            overflow: 'hidden',
          }}
        >
          {value.length > 300 ? value.slice(0, 297) + '…' : value}
        </div>,
        document.body
      )}

      {/* Popup editor – rendered via portal */}
      {open && popupPos && createPortal(
        <div
          ref={popupRef}
          style={{
            position: 'fixed',
            top: popupPos.top,
            left: popupPos.left,
            width: popupSize.w,
            height: popupSize.h,
            background: 'var(--bg-primary, #fff)',
            border: '1px solid #c5c7d4',
            borderRadius: 8,
            boxShadow: '0 8px 32px rgba(0,0,0,0.18)',
            zIndex: 10000,
            display: 'flex',
            flexDirection: 'column',
            overflow: 'hidden',
            minWidth: 240,
            minHeight: 140,
          }}
          onClick={e => e.stopPropagation()}
        >
          {/* Header / drag handle */}
          <div
            onMouseDown={onHeaderMouseDown}
            style={{
              padding: '6px 10px',
              background: 'var(--bg-secondary, #f6f7fb)',
              borderBottom: '1px solid #e6e9ef',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              cursor: 'move',
              userSelect: 'none',
              flexShrink: 0,
            }}
          >
            <span style={{ fontSize: 12, color: 'var(--text-secondary, #676879)', fontWeight: 500 }}>Long text</span>
            <button
              onClick={handleClose}
              style={{
                background: 'none', border: 'none', cursor: 'pointer',
                color: 'var(--text-secondary, #676879)', fontSize: 16, lineHeight: 1,
                padding: '0 2px', display: 'flex', alignItems: 'center',
              }}
              title="Close"
            >×</button>
          </div>

          {/* Textarea */}
          <textarea
            autoFocus
            value={draft}
            onChange={handleChange}
            placeholder="Enter text here…"
            style={{
              flex: 1,
              resize: 'none',
              border: 'none',
              outline: 'none',
              padding: '10px 12px',
              fontSize: 14,
              lineHeight: 1.6,
              color: 'var(--text-primary, #323338)',
              background: 'var(--bg-primary, #fff)',
              fontFamily: 'inherit',
              overflowY: 'auto',
            }}
          />

          {/* Resize grip */}
          <div
            onMouseDown={onResizeMouseDown}
            style={{
              position: 'absolute',
              bottom: 0,
              right: 0,
              width: 18,
              height: 18,
              cursor: 'nwse-resize',
              display: 'flex',
              alignItems: 'flex-end',
              justifyContent: 'flex-end',
              padding: '3px',
              color: '#c5c7d4',
              userSelect: 'none',
            }}
          >
            <svg width="10" height="10" viewBox="0 0 10 10" fill="none">
              <path d="M9 1L1 9M9 5L5 9M9 9" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
            </svg>
          </div>
        </div>,
        document.body
      )}
    </>
  );
}

// ── Deterministic avatar colour from a display name ───────────────────────────
const AVATAR_COLORS = [
  '#9b72f5', '#00c875', '#fdab3d', '#e2445c',
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
  const [search, setSearch] = useState('');
  const searchInputRef = useRef(null);
  const popupRef = useRef(null);
  const { resolvedTheme } = useThemeContext();
  const isDark = resolvedTheme === 'dark';
  const options = settings?.options || [];
  const selected = parseOwners(value);
  const readOnly = !onChange;

  // Filter members by search term — shows selected first, then alphabetical.
  // Keeps the picker usable when a board has many members.
  const filteredOptions = (() => {
    const q = search.trim().toLowerCase();
    const list = q ? options.filter(n => n.toLowerCase().includes(q)) : options;
    // Pin currently-selected names to the top so a quick re-toggle is easy
    return [...list].sort((a, b) => {
      const aSel = selected.includes(a) ? 0 : 1;
      const bSel = selected.includes(b) ? 0 : 1;
      if (aSel !== bSel) return aSel - bSel;
      return a.localeCompare(b);
    });
  })();

  // Reset search and focus the box every time the picker opens
  useEffect(() => {
    if (open) {
      setSearch('');
      setTimeout(() => searchInputRef.current?.focus(), 30);
    }
  }, [open]);

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
          <div style={{ width: 20, height: 20, borderRadius: '50%', background: 'var(--bg-secondary)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 14, color: 'var(--text-secondary)' }}>+</div>
        )}
      </div>

      {/* Dropdown — only for managers */}
      {open && !readOnly && (
        <div ref={popupRef} className="cell-dropdown-popup" style={{
          position: 'absolute', top: '100%', left: 0, zIndex: 300,
          background: isDark ? 'var(--card-bg)' : '#fff',
          borderRadius: 10, boxShadow: isDark ? '0 6px 24px rgba(0,0,0,0.5)' : '0 6px 24px rgba(0,0,0,0.15)',
          border: `1px solid ${isDark ? 'var(--border-color)' : '#e6e9ef'}`,
          minWidth: 240, maxHeight: 360, padding: 0, overflow: 'hidden',
          display: 'flex', flexDirection: 'column',
        }}>
          {/* Sticky header with title + search box. Searching keeps the
              picker usable when a board has 30+ members — without it the
              bottom names get pushed off the screen with no way to reach. */}
          <div style={{
            padding: '8px 10px 6px', flexShrink: 0,
            background: isDark ? 'var(--card-bg)' : '#fff',
            borderBottom: `1px solid ${isDark ? 'var(--border-color)' : '#f0f0f0'}`,
          }}>
            <div style={{ fontSize: 11, fontWeight: 700, color: isDark ? 'var(--text-secondary)' : '#555', textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 6 }}>
              Assign people
            </div>
            {options.length > 6 && (
              <input
                ref={searchInputRef}
                value={search}
                onChange={e => setSearch(e.target.value)}
                placeholder="Type to filter…"
                style={{
                  width: '100%', boxSizing: 'border-box',
                  padding: '6px 10px', fontSize: 13, borderRadius: 6,
                  border: `1px solid ${isDark ? 'var(--border-color)' : '#e6e9ef'}`,
                  background: isDark ? 'var(--bg-secondary)' : '#fafbfc',
                  color: isDark ? 'var(--text-primary)' : '#1a1a2e',
                  outline: 'none',
                }}
              />
            )}
          </div>

          {/* Scrollable list */}
          <div style={{ flex: 1, overflowY: 'auto', padding: '4px 0' }}>
          {options.length === 0 && (
            <div style={{ padding: '8px 14px', fontSize: 12, color: isDark ? 'var(--text-secondary)' : '#aaa' }}>No members in this board</div>
          )}
          {options.length > 0 && filteredOptions.length === 0 && (
            <div style={{ padding: '12px 14px', fontSize: 12, color: isDark ? 'var(--text-secondary)' : '#aaa', textAlign: 'center' }}>
              No matches for "{search}"
            </div>
          )}
          {filteredOptions.map(name => {
            const isSelected = selected.includes(name);
            const rowBgSelected = isDark ? 'rgba(0,115,234,0.18)' : '#f0f6ff';
            const rowBgNormal = isDark ? 'transparent' : '#fff';
            const rowBgHover = isDark ? 'rgba(255,255,255,0.07)' : '#f5f6f8';
            return (
              <div
                key={name}
                onClick={() => toggle(name)}
                style={{
                  display: 'flex', alignItems: 'center', gap: 10, padding: '7px 14px', cursor: 'pointer',
                  background: isSelected ? rowBgSelected : rowBgNormal,
                  transition: 'background 0.12s ease',
                }}
                onMouseEnter={e => { e.currentTarget.style.background = isSelected ? rowBgSelected : rowBgHover; }}
                onMouseLeave={e => { e.currentTarget.style.background = isSelected ? rowBgSelected : rowBgNormal; }}
              >
                <div style={{
                  width: 28, height: 28, borderRadius: '50%',
                  background: nameToColor(name), color: '#fff',
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  fontSize: 11, fontWeight: 700, flexShrink: 0,
                }}>
                  {nameToInitials(name)}
                </div>
                <span style={{ flex: 1, fontSize: 13, color: isDark ? 'var(--text-primary)' : '#1a1a2e', fontWeight: isSelected ? 700 : 500 }}>{name}</span>
                {isSelected && <span style={{ color: '#9b72f5', fontSize: 14, fontWeight: 700 }}>✓</span>}
              </div>
            );
          })}
          </div>{/* /scrollable list */}
          {selected.length > 0 && (
            <div style={{
              flexShrink: 0,
              borderTop: `1px solid ${isDark ? 'var(--border-color)' : '#f0f0f0'}`,
              background: isDark ? 'var(--card-bg)' : '#fff',
            }}>
              <div
                onClick={() => { onChange(''); setOpen(false); }}
                style={{ padding: '8px 14px', fontSize: 12, color: '#e2445c', cursor: 'pointer', fontWeight: 600 }}
                onMouseEnter={e => e.currentTarget.style.background = isDark ? 'rgba(226,68,92,0.12)' : '#fff5f7'}
                onMouseLeave={e => e.currentTarget.style.background = 'transparent'}
              >✕ Clear all</div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ── File attachment cell ───────────────────────────────────────────────────────
const FILE_SIZE_LIMIT = 20 * 1024 * 1024; // 20 MB (match backend)

function FileCell({ value, onChange }) {
  // pending: { id, name, progress } — optimistic entries while uploading
  const [pending, setPending] = useState([]);
  const inputRef = useRef(null);

  let files = [];
  try { files = value ? JSON.parse(value) : []; } catch { files = []; }
  if (!Array.isArray(files)) files = [];

  const handleFileChange = async (e) => {
    const selected = Array.from(e.target.files);
    if (!selected.length) return;
    e.target.value = '';

    // client-side size guard
    const tooBig = selected.filter(f => f.size > FILE_SIZE_LIMIT);
    if (tooBig.length) {
      alert(`File too large (max 20 MB): ${tooBig.map(f => f.name).join(', ')}`);
      if (tooBig.length === selected.length) return;
    }
    const allowed = selected.filter(f => f.size <= FILE_SIZE_LIMIT);

    // add optimistic entries immediately so UI updates right away
    const ids = allowed.map(() => Math.random().toString(36).slice(2));
    setPending(p => [
      ...p,
      ...allowed.map((f, i) => ({ id: ids[i], name: f.name, progress: 0 })),
    ]);

    // upload each file (parallel)
    const results = await Promise.allSettled(
      allowed.map((file, i) =>
        uploadFile(file, (pct) =>
          setPending(p => p.map(x => x.id === ids[i] ? { ...x, progress: pct } : x))
        )
      )
    );

    // remove optimistic entries
    setPending(p => p.filter(x => !ids.includes(x.id)));

    const uploaded = results
      .map(r => r.status === 'fulfilled' ? r.value : null)
      .filter(Boolean);

    if (uploaded.length) {
      // re-read current files to avoid stale closure
      let current = [];
      try { current = value ? JSON.parse(value) : []; } catch { current = []; }
      if (!Array.isArray(current)) current = [];
      onChange(JSON.stringify([...current, ...uploaded]));
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
    <div
      className="file-chip-row"
      style={{
        display: 'flex',
        flexDirection: 'row',
        flexWrap: 'nowrap',
        overflowX: 'auto',
        overflowY: 'hidden',
        gap: 4,
        alignItems: 'center',
        maxHeight: 34,
        padding: '0 4px',
        scrollbarWidth: 'none',
        msOverflowStyle: 'none',
      }}
    >
      {files.map((f, i) => (
        <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 4, marginBottom: 2 }}>
          <span style={{ fontSize: 13 }}>{icon(f.mimeType)}</span>
          <a
            href={f.url}
            target="_blank"
            rel="noopener noreferrer"
            onClick={e => e.stopPropagation()}
            style={{ fontSize: 12, color: '#9b72f5', textDecoration: 'none', flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}
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
      {/* Optimistic pending entries with progress */}
      {pending.map(p => (
        <div key={p.id} style={{ display: 'flex', alignItems: 'center', gap: 6, minWidth: 120 }}>
          <span style={{ fontSize: 12, color: '#676879', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: 100 }}>{p.name}</span>
          <div style={{ flex: 1, minWidth: 50, height: 4, background: '#e6e9ef', borderRadius: 2, overflow: 'hidden' }}>
            <div style={{ width: `${p.progress}%`, height: '100%', background: '#9b72f5', borderRadius: 2, transition: 'width 0.15s ease' }} />
          </div>
          <span style={{ fontSize: 10, color: '#9b72f5', flexShrink: 0 }}>{p.progress}%</span>
        </div>
      ))}
      <input ref={inputRef} type="file" multiple style={{ display: 'none' }} onChange={handleFileChange} />
      <button
        onClick={e => { e.stopPropagation(); inputRef.current?.click(); }}
        disabled={pending.length > 0}
        style={{ fontSize: 11, color: '#9b72f5', background: 'none', border: 'none', cursor: pending.length > 0 ? 'default' : 'pointer', padding: '2px 0', opacity: pending.length > 0 ? 0.5 : 1, flexShrink: 0 }}
      >
        📎 Attach file
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
      return <DropdownCell value={value} settings={settings} onChange={onChange} column={column} onSettingsUpdate={onEditSettings} />;
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
      return <LongTextCell value={value} onChange={onChange} />;
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
