import React, { useState, useRef, useEffect, useCallback, useContext } from 'react';
import { createPortal } from 'react-dom';
import { updateColumn, uploadFile, deleteFile, searchConnectItems, upsertColumnValue,
  timeStart, timeStop, timeManual, timeCell, timeDeleteEntry, timeEditEntry } from '../api';
import { useAuth } from '../context/AuthContext';
import { evaluateFormula } from '../utils/formulaEngine';
import { useThemeContext } from '../context/ThemeContext';
import { toISODate, toISTTime } from '../utils/dateFormat';
import { safeHref, sanitizePhone, parseLink, formatNumber, computeWeightedProgress } from '../utils/cellFormat';
import { aiCompute } from '../utils/aiColumn';

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
// Rating: configurable max (settings.max, 1–10), half-stars, and a tooltip.
// Click the LEFT half of a star for ½, the right half for a full star; click
// the current value again to clear.
function RatingCell({ value, onChange, settings }) {
  const max = Math.max(1, Math.min(10, parseInt(settings?.max) || 5));
  const num = Math.max(0, Math.min(max, parseFloat(value) || 0));
  const { resolvedTheme } = useThemeContext();
  const emptyColor = resolvedTheme === 'dark' ? '#4a5180' : '#c4c4c4';
  const readOnly = !onChange;
  // Live preview of the value under the cursor so half vs full is obvious before
  // clicking (the cell supports ½-star steps; hovering the left half of a star
  // previews ½, the right half previews a full star).
  const [hover, setHover] = useState(null); // previewed numeric value, or null

  const valueAt = (i, e) => {
    const r = e.currentTarget.getBoundingClientRect();
    return (e.clientX - r.left) < r.width / 2 ? i - 0.5 : i;
  };
  const pick = (i, e) => {
    if (readOnly) return;
    const v = valueAt(i, e);
    onChange(v === num ? '' : String(v));
  };
  const shown = hover != null ? hover : num; // what the stars currently reflect
  const label = num ? `${num} / ${max} stars` : 'Not rated — click to rate';

  return (
    <div
      style={{ display: 'flex', gap: 2 }}
      title={label}
      onMouseLeave={() => setHover(null)}
    >
      {Array.from({ length: max }, (_, k) => k + 1).map(i => {
        const fill = shown >= i ? 'full' : (shown >= i - 0.5 ? 'half' : 'empty');
        return (
          <span key={i} className="rating-star"
            onClick={e => pick(i, e)}
            onMouseMove={readOnly ? undefined : e => setHover(valueAt(i, e))}
            style={{ cursor: readOnly ? 'default' : 'pointer', fontSize: 16, position: 'relative', display: 'inline-block', width: '1em', lineHeight: 1, color: fill === 'empty' ? emptyColor : '#fdab3d' }}>
            {fill === 'half' ? (
              <>
                <span style={{ color: emptyColor }}>{STAR_E}</span>
                <span style={{ position: 'absolute', left: 0, top: 0, width: '50%', overflow: 'hidden', color: '#fdab3d' }}>{STAR}</span>
              </>
            ) : (fill === 'full' ? STAR : STAR_E)}
          </span>
        );
      })}
    </div>
  );
}

// Progress cell — Monday-style "battery": a weighted average of the item's
// Status columns. Each status column contributes a segment (coloured by its
// current value), filled to that status's done %. Weights and which status
// columns to include are configurable via column settings; falls back to a
// manual 0–100 slider when settings.source === 'manual' or there are no
// status columns on the board.
function ProgressCell({ value, onChange, column, item, columns }) {
  const { resolvedTheme } = useThemeContext();
  const isDark = resolvedTheme === 'dark';
  const settings = column?.settings || {};

  // Which status columns count toward progress. When `statusColumnIds` is
  // undefined the column tracks every status column (monday's default for a new
  // progress column); once the user configures it via Progress Settings, only
  // the explicitly selected columns are included — so a status column used for
  // something else (e.g. "Department") can be excluded.
  const statusCols = Array.isArray(columns)
    ? columns.filter(c => c.type === 'status' && c.id !== column?.id &&
        (!Array.isArray(settings.statusColumnIds) || settings.statusColumnIds.includes(c.id)))
    : [];
  const useWeighted = settings.source !== 'manual' && statusCols.length > 0 && !!item;

  if (useWeighted) {
    const { overall, segments } = computeWeightedProgress(statusCols, item.values || {}, settings, DEFAULT_STATUS_OPTIONS);
    // A single bar filled to the weighted average across all status columns.
    const barColor = overall >= 100 ? '#00c875' : overall >= 50 ? '#fdab3d' : '#9b72f5';
    const tip = `Weighted progress ${overall}%\n` + segments.map(s => `• ${s.title}: ${s.value || '—'} (${s.pct}%)`).join('\n');
    return (
      <div title={tip} onClick={e => e.stopPropagation()} style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'default' }}>
        <div style={{
          flex: 1, height: 10, borderRadius: 5, overflow: 'hidden',
          background: isDark ? 'rgba(255,255,255,0.10)' : '#e0e0e0',
          border: isDark ? '1px solid rgba(255,255,255,0.08)' : 'none',
        }}>
          <div style={{ width: `${overall}%`, height: '100%', background: barColor, borderRadius: 5, transition: 'width 0.35s ease' }} />
        </div>
        <span style={{ fontSize: 11, fontWeight: 800, color: isDark ? 'var(--text-secondary)' : '#676879', minWidth: 32, textAlign: 'right' }}>{overall}%</span>
      </div>
    );
  }

  // ── Manual fallback (no status columns, or settings.source === 'manual') ──
  const clampPct = (raw) => {
    if (raw === '' || raw == null) return '';
    const n = Math.round(Number(raw));
    if (!Number.isFinite(n)) return '';
    return String(Math.max(0, Math.min(100, n)));
  };
  const num = Math.max(0, Math.min(100, parseInt(value) || 0));
  const color = num >= 100 ? '#00c875' : num >= 50 ? '#fdab3d' : '#9b72f5';
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
        onChange={e => onChange(clampPct(e.target.value))}
        onBlur={e => onChange(clampPct(e.target.value))}
        style={{
          width: 44,
          border: `1px solid ${isDark ? 'rgba(255,255,255,0.22)' : '#ddd'}`,
          borderRadius: 4, padding: '2px 4px', textAlign: 'center',
          background: isDark ? 'rgba(255,255,255,0.08)' : '#fff',
          color: isDark ? '#fff' : '#323338',
        }}
      />
      <span style={{ fontSize: 11, color: isDark ? 'var(--text-secondary)' : '#888' }}>%</span>
      {value !== '' && value != null && (
        <span onClick={() => onChange('')} title="Clear" style={{ cursor: 'pointer', fontSize: 12, color: '#c5c7d0', marginLeft: 2 }}>×</span>
      )}
    </div>
  );
}

// Checkbox cell
function CheckboxCell({ value, onChange }) {
  const checked = value === 'true' || value === '1';
  const isSet = value === 'true' || value === 'false' || value === '1' || value === '0';
  return (
    <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', gap: 4 }}>
      <input
        type="checkbox"
        checked={checked}
        onChange={e => onChange(e.target.checked ? 'true' : 'false')}
        style={{ width: 16, height: 16, cursor: 'pointer', accentColor: '#9b72f5' }}
      />
      {/* Reset to the blank/unset state (previously a checkbox could never be cleared) */}
      {isSet && (
        <span onClick={() => onChange('')} title="Clear" style={{ cursor: 'pointer', fontSize: 11, color: '#c5c7d0' }}>×</span>
      )}
    </div>
  );
}

// Distinct, stable colour per tag. Saturated background + white text reads
// clearly in BOTH light and dark themes (the old single washed-out pill was
// nearly invisible on dark). Same tag text always maps to the same colour.
const TAG_PALETTE = [
  '#0073ea', '#00c875', '#e2445c', '#fdab3d', '#a25ddc',
  '#ff642e', '#037f4c', '#ff158a', '#9d50dd', '#0086c0',
  '#bb3354', '#7e3b8a', '#4eccc6', '#ff7575', '#cab641',
];
function colorForTag(tag) {
  let h = 0;
  for (let i = 0; i < tag.length; i++) h = (h * 31 + tag.charCodeAt(i)) >>> 0;
  return TAG_PALETTE[h % TAG_PALETTE.length];
}

// Tags cell
function TagsCell({ value, onChange }) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(value || '');
  // de-dupe (case-insensitive) so the cell matches the server's normalisation
  const seen = new Set();
  const tags = (value || '').split(',').map(t => t.trim()).filter(t => {
    const k = t.toLowerCase();
    if (!t || seen.has(k)) return false;
    seen.add(k);
    return true;
  });

  if (editing) {
    return (
      <input
        autoFocus
        value={draft}
        onChange={e => setDraft(e.target.value)}
        onBlur={() => { onChange(draft); setEditing(false); }}
        onKeyDown={e => { if (e.key === 'Enter') { onChange(draft); setEditing(false); } if (e.key === 'Escape') setEditing(false); }}
        placeholder="tag1, tag2, tag3"
        style={{ width: '100%', border: '1px solid #9b72f5', borderRadius: 4, padding: '3px 6px', outline: 'none', background: 'var(--input-bg, #fff)', color: 'var(--text-primary, #323338)' }}
      />
    );
  }

  return (
    <div onClick={() => { setDraft(value || ''); setEditing(true); }} style={{ display: 'flex', flexWrap: 'wrap', gap: 4, cursor: 'text', minHeight: 26, alignItems: 'center' }}>
      {tags.map(tag => {
        const c = colorForTag(tag);
        return (
          <span key={tag} style={{
            background: c, color: '#fff', borderRadius: 12,
            padding: '2px 9px', fontSize: 11, fontWeight: 700,
            boxShadow: '0 1px 2px rgba(0,0,0,0.18)', whiteSpace: 'nowrap',
          }}>{tag}</span>
        );
      })}
      {!tags.length && <span style={{ color: 'var(--text-muted, #c5c7d0)' }}>—</span>}
    </div>
  );
}

// Timeline (date range) cell
function TimelineCell({ value, onChange }) {
  const parts = (value || '').split(' → ');
  const [start, setStart] = useState(parts[0] || '');
  const [end, setEnd] = useState(parts[1] || '');

  // Clearing both ends stores '' (an empty cell) rather than the stray " → ".
  const commit = (s, e) => onChange((s || e) ? `${s} → ${e}` : '');
  const clear = () => { setStart(''); setEnd(''); onChange(''); };

  return (
    <div style={{ display: 'flex', gap: 4, alignItems: 'center' }}>
      <input type="date" value={start}
        onChange={ev => { setStart(ev.target.value); commit(ev.target.value, end); }}
        style={{ border: '1px solid #ddd', borderRadius: 4, padding: '2px 4px', fontSize: 12 }}
      />
      <span style={{ color: '#888' }}>→</span>
      <input type="date" value={end} min={start || undefined}
        onChange={ev => { setEnd(ev.target.value); commit(start, ev.target.value); }}
        style={{ border: '1px solid #ddd', borderRadius: 4, padding: '2px 4px', fontSize: 12 }}
      />
      {start && end && (() => {
        // Inclusive duration in days (e.g. 1 May → 1 May = 1 day).
        const days = Math.round((new Date(end) - new Date(start)) / 86400000) + 1;
        if (!Number.isFinite(days) || days <= 0) return null;
        return <span title="Duration" style={{ fontSize: 11, fontWeight: 600, color: '#9b72f5', background: 'rgba(155,114,245,0.14)', borderRadius: 8, padding: '1px 7px', whiteSpace: 'nowrap' }}>{days}d</span>;
      })()}
      {(start || end) && (
        <span onClick={clear} title="Clear timeline" style={{ cursor: 'pointer', fontSize: 12, color: '#c5c7d0' }}>×</span>
      )}
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

// Link cell — URL + optional display label
function LinkCell({ value, onChange }) {
  const [editing, setEditing] = useState(false);
  const { url, label } = parseLink(value);
  const [draftUrl, setDraftUrl] = useState(url);
  const [draftLabel, setDraftLabel] = useState(label);

  const startEdit = () => { const p = parseLink(value); setDraftUrl(p.url); setDraftLabel(p.label); setEditing(true); };
  const commit = () => {
    const u = draftUrl.trim(), l = draftLabel.trim();
    onChange(!u ? '' : (l ? JSON.stringify({ url: u, label: l }) : u));
    setEditing(false);
  };

  const inputStyle = { border: '1px solid #9b72f5', borderRadius: 4, padding: '3px 6px', outline: 'none', fontSize: 12, background: 'var(--input-bg, #fff)', color: 'var(--text-primary, #323338)' };
  if (editing) {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }} onKeyDown={e => { if (e.key === 'Enter') commit(); if (e.key === 'Escape') setEditing(false); }}>
        <input autoFocus value={draftUrl} onChange={e => setDraftUrl(e.target.value)} placeholder="https://…" style={inputStyle} />
        <input value={draftLabel} onChange={e => setDraftLabel(e.target.value)} onBlur={commit} placeholder="Display text (optional)" style={inputStyle} />
      </div>
    );
  }
  if (url) {
    const href = safeHref(url);
    const shown = label || url;
    const display = shown.length > 28 ? shown.slice(0, 28) + '…' : shown;
    return (
      <div style={{ display: 'flex', alignItems: 'center', gap: 4, minWidth: 0 }}>
        {href
          ? <a href={href} target="_blank" rel="noreferrer noopener" title={url} style={{ color: '#9b72f5', textDecoration: 'none', fontSize: 12, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>🔗 {display}</a>
          : <span title="Blocked link scheme" style={{ color: '#e2445c', fontSize: 12, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>⚠ {display}</span>}
        <span onClick={startEdit} title="Edit link" style={{ cursor: 'pointer', fontSize: 11, color: '#c5c7d0' }}>✎</span>
        <span onClick={() => onChange('')} title="Clear link" style={{ cursor: 'pointer', fontSize: 12, color: '#c5c7d0' }}>×</span>
      </div>
    );
  }
  return <span onClick={startEdit} style={{ color: '#ccc', cursor: 'text' }}>—</span>;
}


// Generic text inline editor — with debounced auto-save
function TextCell({ value, onChange, multiline, type, sanitize }) {
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
    const v = sanitize ? sanitize(e.target.value) : e.target.value;
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

  const dateStr = toISODate(dt);
  const timeStr = toISTTime(dt); // IST, matching the rest of the app (was browser-local)

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

// ── Parse multi-owner value ───────────────────────────────────────────────────
// People are stored as a JSON array of { id, name } objects (id = stable user
// identity; name is denormalised so name-matching consumers keep working).
// Legacy values may be a JSON array of name strings or a single string — both
// are still understood. parseOwners() returns NAMES (back-compat for every
// existing caller); parseOwnerEntries() returns the {id,name} objects.
export function parseOwnerEntries(val) {
  if (!val) return [];
  let arr;
  try { arr = JSON.parse(val); } catch { return String(val).trim() ? [{ id: null, name: String(val).trim() }] : []; }
  if (!Array.isArray(arr)) arr = arr ? [arr] : [];
  return arr
    .map(e => (e && typeof e === 'object')
      ? { id: e.id ?? null, name: e.name || e.label || '' }
      : { id: null, name: String(e) })
    .filter(e => e.name || e.id != null);
}
export function parseOwners(val) {
  return parseOwnerEntries(val).map(e => e.name).filter(Boolean);
}

// Normalise a board member option (object or legacy name string) to {id,name,avatar_url}.
function normMember(o) {
  if (o && typeof o === 'object') return { id: o.id ?? null, name: o.name || o.label || '', avatar_url: o.avatar_url || null };
  return { id: null, name: String(o), avatar_url: null };
}

function PersonAvatar({ member, size = 26 }) {
  if (member.avatar_url) {
    return <img src={member.avatar_url} alt={member.name} loading="lazy" width={size} height={size}
      title={member.name}
      style={{ width: size, height: size, borderRadius: '50%', objectFit: 'cover', flexShrink: 0, background: '#eef0f5' }} />;
  }
  return (
    <div title={member.name} style={{
      width: size, height: size, borderRadius: '50%', background: nameToColor(member.name), color: '#fff',
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      fontSize: Math.round(size * 0.4), fontWeight: 700, flexShrink: 0, userSelect: 'none',
    }}>{nameToInitials(member.name)}</div>
  );
}

// ── Person cell: store-by-ID, avatars, "+N more", always-on search, self-assign ─
function PersonCell({ value, settings, onChange }) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState('');
  const searchInputRef = useRef(null);
  const popupRef = useRef(null);
  const { resolvedTheme } = useThemeContext();
  const isDark = resolvedTheme === 'dark';
  const { user, isManager } = useAuth();

  const members = (settings?.options || []).map(normMember).filter(m => m.name);
  const memberByKey = new Map(members.map(m => [m.id != null ? `id:${m.id}` : `nm:${m.name}`, m]));
  const keyOf = (m) => (m.id != null ? `id:${m.id}` : `nm:${m.name}`);

  // Resolve stored entries to the current member record (by id, then name) so
  // a renamed user shows their CURRENT name + avatar, not the stored snapshot.
  const selected = parseOwnerEntries(value).map(e => {
    const m = (e.id != null && memberByKey.get(`id:${e.id}`)) || memberByKey.get(`nm:${e.name}`);
    return m || { id: e.id, name: e.name, avatar_url: null };
  });
  const selectedKeys = new Set(selected.map(keyOf));

  // Permissions: managers edit everyone; everyone else (incl. read-only members)
  // may toggle ONLY themselves (self-assign). Backend enforces the same rule.
  const canEditAll = isManager && !!onChange;
  const selfId = user?.id;
  const canToggle = (m) => !!onChange && (canEditAll || (selfId != null && m.id === selfId));
  const interactive = !!onChange && (canEditAll || members.some(m => m.id === selfId));
  const readOnly = !interactive;

  const filtered = (() => {
    const q = search.trim().toLowerCase();
    const list = q ? members.filter(m => m.name.toLowerCase().includes(q)) : members;
    return [...list].sort((a, b) => {
      const aSel = selectedKeys.has(keyOf(a)) ? 0 : 1;
      const bSel = selectedKeys.has(keyOf(b)) ? 0 : 1;
      if (aSel !== bSel) return aSel - bSel;
      return a.name.localeCompare(b.name);
    });
  })();

  useEffect(() => {
    if (open) { setSearch(''); setTimeout(() => searchInputRef.current?.focus(), 30); }
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onMouseDown = (e) => { if (popupRef.current && !popupRef.current.contains(e.target)) setOpen(false); };
    const onKeyDown = (e) => { if (e.key === 'Escape') setOpen(false); };
    document.addEventListener('mousedown', onMouseDown);
    document.addEventListener('keydown', onKeyDown);
    return () => { document.removeEventListener('mousedown', onMouseDown); document.removeEventListener('keydown', onKeyDown); };
  }, [open]);

  const writeSelected = (list) => onChange(list.length ? JSON.stringify(list.map(m => ({ id: m.id ?? null, name: m.name }))) : '');

  const toggle = (m) => {
    if (!canToggle(m)) return;
    const next = selectedKeys.has(keyOf(m)) ? selected.filter(s => keyOf(s) !== keyOf(m)) : [...selected, m];
    writeSelected(next);
  };

  // Compact display: up to 3 avatars + "+N".
  const MAX_AVATARS = 3;
  const shownAvatars = selected.slice(0, MAX_AVATARS);
  const overflow = selected.length - shownAvatars.length;

  return (
    <div style={{ position: 'relative' }}>
      <div
        onClick={() => { if (!readOnly) setOpen(o => !o); }}
        style={{ display: 'flex', flexDirection: 'row', flexWrap: 'nowrap', gap: 3, cursor: readOnly ? 'default' : 'pointer', minHeight: 28, padding: '2px 2px', alignItems: 'center', overflow: 'hidden' }}
      >
        {shownAvatars.map(m => <PersonAvatar key={keyOf(m)} member={m} size={26} />)}
        {overflow > 0 && (
          <div title={selected.slice(MAX_AVATARS).map(m => m.name).join(', ')} style={{
            width: 26, height: 26, borderRadius: '50%', background: 'var(--bg-secondary, #e6e9ef)',
            color: 'var(--text-secondary, #676879)', display: 'flex', alignItems: 'center', justifyContent: 'center',
            fontSize: 10, fontWeight: 700, flexShrink: 0,
          }}>+{overflow}</div>
        )}
        {selected.length === 0 && <span style={{ color: '#ccc', fontSize: 12 }}>—</span>}
        {!readOnly && members.length > 0 && (
          <div style={{ width: 20, height: 20, borderRadius: '50%', background: 'var(--bg-secondary)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 14, color: 'var(--text-secondary)' }}>+</div>
        )}
      </div>

      {open && !readOnly && (
        <div ref={popupRef} className="cell-dropdown-popup" style={{
          position: 'absolute', top: '100%', left: 0, zIndex: 300,
          background: isDark ? 'var(--card-bg)' : '#fff',
          borderRadius: 10, boxShadow: isDark ? '0 6px 24px rgba(0,0,0,0.5)' : '0 6px 24px rgba(0,0,0,0.15)',
          border: `1px solid ${isDark ? 'var(--border-color)' : '#e6e9ef'}`,
          minWidth: 250, maxHeight: 360, padding: 0, overflow: 'hidden',
          display: 'flex', flexDirection: 'column',
        }}>
          <div style={{ padding: '8px 10px 6px', flexShrink: 0, background: isDark ? 'var(--card-bg)' : '#fff', borderBottom: `1px solid ${isDark ? 'var(--border-color)' : '#f0f0f0'}` }}>
            <div style={{ fontSize: 11, fontWeight: 700, color: isDark ? 'var(--text-secondary)' : '#555', textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 6 }}>
              {canEditAll ? 'Assign people' : 'Assign yourself'}
            </div>
            {/* Always-on search (previously only appeared with >6 members) */}
            <input
              ref={searchInputRef} value={search} onChange={e => setSearch(e.target.value)}
              placeholder="Search people…"
              style={{
                width: '100%', boxSizing: 'border-box', padding: '6px 10px', fontSize: 13, borderRadius: 6,
                border: `1px solid ${isDark ? 'var(--border-color)' : '#e6e9ef'}`,
                background: isDark ? 'var(--bg-secondary)' : '#fafbfc',
                color: isDark ? 'var(--text-primary)' : '#1a1a2e', outline: 'none',
              }}
            />
          </div>

          <div style={{ flex: 1, overflowY: 'auto', padding: '4px 0' }}>
            {members.length === 0 && <div style={{ padding: '8px 14px', fontSize: 12, color: isDark ? 'var(--text-secondary)' : '#aaa' }}>No members in this board</div>}
            {members.length > 0 && filtered.length === 0 && <div style={{ padding: '12px 14px', fontSize: 12, color: isDark ? 'var(--text-secondary)' : '#aaa', textAlign: 'center' }}>No matches for "{search}"</div>}
            {filtered.map(m => {
              const isSel = selectedKeys.has(keyOf(m));
              const allowed = canToggle(m);
              const rowSel = isDark ? 'rgba(0,115,234,0.18)' : '#f0f6ff';
              const rowNorm = isDark ? 'transparent' : '#fff';
              const rowHover = isDark ? 'rgba(255,255,255,0.07)' : '#f5f6f8';
              return (
                <div key={keyOf(m)} onClick={() => toggle(m)}
                  title={allowed ? '' : 'Only managers can assign other people'}
                  style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '7px 14px', cursor: allowed ? 'pointer' : 'not-allowed', opacity: allowed ? 1 : 0.5, background: isSel ? rowSel : rowNorm, transition: 'background 0.12s ease' }}
                  onMouseEnter={e => { if (allowed) e.currentTarget.style.background = isSel ? rowSel : rowHover; }}
                  onMouseLeave={e => { e.currentTarget.style.background = isSel ? rowSel : rowNorm; }}
                >
                  <PersonAvatar member={m} size={28} />
                  <span style={{ flex: 1, fontSize: 13, color: isDark ? 'var(--text-primary)' : '#1a1a2e', fontWeight: isSel ? 700 : 500 }}>
                    {m.name}{m.id === selfId ? ' (you)' : ''}
                  </span>
                  {isSel && <span style={{ color: '#9b72f5', fontSize: 14, fontWeight: 700 }}>✓</span>}
                </div>
              );
            })}
          </div>

          {canEditAll && selected.length > 0 && (
            <div style={{ flexShrink: 0, borderTop: `1px solid ${isDark ? 'var(--border-color)' : '#f0f0f0'}`, background: isDark ? 'var(--card-bg)' : '#fff' }}>
              <div onClick={() => { onChange(''); setOpen(false); }} style={{ padding: '8px 14px', fontSize: 12, color: '#e2445c', cursor: 'pointer', fontWeight: 600 }}
                onMouseEnter={e => e.currentTarget.style.background = isDark ? 'rgba(226,68,92,0.12)' : '#fff5f7'}
                onMouseLeave={e => e.currentTarget.style.background = 'transparent'}>✕ Clear all</div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ── File attachment cell ───────────────────────────────────────────────────────
const FILE_SIZE_LIMIT = 100 * 1024 * 1024; // 100 MB (matches backend default FILE_MAX_MB)

const fmtSize = (bytes) => {
  if (!bytes) return '';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
};

// Upload sources. Computer uploads a real blob; the cloud providers + external
// link attach the file by its share URL (works with zero setup — paste a link
// from the provider). Native one-click pickers can be layered on later behind
// per-provider API keys.
const FILE_SOURCES = [
  { key: 'computer',   label: 'Computer / Desktop', icon: '💻', link: false },
  { key: 'gdrive',     label: 'Google Drive',       icon: '🟩', link: true, hint: 'Paste a Google Drive share link' },
  { key: 'dropbox',    label: 'Dropbox',            icon: '🟦', link: true, hint: 'Paste a Dropbox share link' },
  { key: 'onedrive',   label: 'OneDrive',           icon: '🔵', link: true, hint: 'Paste a OneDrive share link' },
  { key: 'sharepoint', label: 'SharePoint',         icon: '🟦', link: true, hint: 'Paste a SharePoint link' },
  { key: 'box',        label: 'Box',                icon: '🟫', link: true, hint: 'Paste a Box share link' },
  { key: 'link',       label: 'External link',      icon: '🔗', link: true, hint: 'Paste any file URL' },
];
const SOURCE_BY_KEY = Object.fromEntries(FILE_SOURCES.map(s => [s.key, s]));

// Derive a friendly name from a URL when the user doesn't type one.
function nameFromUrl(url) {
  try {
    const u = new URL(url);
    const last = decodeURIComponent(u.pathname.split('/').filter(Boolean).pop() || '');
    return last && last.length < 80 ? last : u.hostname.replace(/^www\./, '');
  } catch { return 'Linked file'; }
}

const fileIcon = (mime) => {
  if (!mime) return '📄';
  if (mime.startsWith('link')) return '🔗';
  if (mime.startsWith('image/')) return '🖼️';
  if (mime === 'application/pdf') return '📕';
  if (mime.includes('spreadsheet') || mime.includes('excel') || mime.includes('csv')) return '📊';
  if (mime.includes('word') || mime.includes('document')) return '📝';
  if (mime.includes('zip') || mime.includes('compressed') || mime.includes('rar')) return '🗜️';
  if (mime.startsWith('video/')) return '🎬';
  if (mime.startsWith('audio/')) return '🎵';
  return '📎';
};
const isImage = (f) => (f?.mimeType || '').startsWith('image/');

// Downscale an image File to a small JPEG thumbnail Blob so the grid stays light
// even with many large images. Returns null for non-images or on any failure.
function makeThumbnail(file, max = 256) {
  return new Promise((resolve) => {
    if (!file.type || !file.type.startsWith('image/')) return resolve(null);
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      try {
        const scale = Math.min(1, max / Math.max(img.width, img.height));
        const w = Math.max(1, Math.round(img.width * scale));
        const h = Math.max(1, Math.round(img.height * scale));
        const canvas = document.createElement('canvas');
        canvas.width = w; canvas.height = h;
        canvas.getContext('2d').drawImage(img, 0, 0, w, h);
        canvas.toBlob(b => { URL.revokeObjectURL(url); resolve(b); }, 'image/jpeg', 0.72);
      } catch { URL.revokeObjectURL(url); resolve(null); }
    };
    img.onerror = () => { URL.revokeObjectURL(url); resolve(null); };
    img.src = url;
  });
}

// Upload one File: original + (for images) a generated thumbnail.
async function uploadOne(file, onProgress) {
  let thumb = null;
  const thumbBlob = await makeThumbnail(file).catch(() => null);
  if (thumbBlob) {
    try {
      const tf = new File([thumbBlob], 'thumb.jpg', { type: 'image/jpeg' });
      const tr = await uploadFile(tf);
      thumb = { thumbName: tr.name, thumbUrl: tr.url };
    } catch { /* thumbnail is best-effort — original still uploads */ }
  }
  const r = await uploadFile(file, onProgress);
  return {
    name: r.name, originalName: r.originalName, url: r.url, size: r.size, mimeType: r.mimeType,
    uploadedAt: new Date().toISOString(), version: 1, versions: [],
    ...(thumb || {}),
  };
}

// Best-effort cleanup of every blob a file entry references (current + thumb + history).
function purgeEntryBlobs(entry) {
  const names = new Set();
  const add = (e) => { if (e?.name) names.add(e.name); if (e?.thumbName) names.add(e.thumbName); };
  add(entry);
  (entry?.versions || []).forEach(add);
  names.forEach(n => deleteFile(n).catch(() => {}));
}

function FileThumb({ f, size = 24 }) {
  const src = f.thumbUrl || (isImage(f) ? f.url : null);
  if (src) {
    return <img src={src} alt={f.originalName} loading="lazy" width={size} height={size}
      style={{ width: size, height: size, objectFit: 'cover', borderRadius: 4, display: 'block', background: '#eef0f5' }} />;
  }
  return <span style={{ fontSize: size > 28 ? 22 : 14, width: size, height: size, display: 'inline-flex', alignItems: 'center', justifyContent: 'center' }}>{fileIcon(f.mimeType)}</span>;
}

function FileCell({ value, onChange }) {
  const [pending, setPending] = useState([]);   // optimistic uploads { id, name, progress }
  const [open, setOpen] = useState(false);       // manage popover
  const [dragOver, setDragOver] = useState(false);
  const [renaming, setRenaming] = useState(null); // index being renamed
  const [showHistory, setShowHistory] = useState(null); // index whose history is expanded
  const [addSource, setAddSource] = useState(null); // provider key while its link form is open
  const [linkUrl, setLinkUrl] = useState('');
  const [linkName, setLinkName] = useState('');
  const [popLimit, setPopLimit] = useState(30); // paginate the manage list for huge cells
  const inputRef = useRef(null);
  const versionInputRef = useRef(null);
  const versionTargetRef = useRef(null);
  const wrapRef = useRef(null);
  const { resolvedTheme } = useThemeContext();
  const isDark = resolvedTheme === 'dark';
  const readOnly = !onChange;

  let files = [];
  try { files = value ? JSON.parse(value) : []; } catch { files = []; }
  if (!Array.isArray(files)) files = [];

  const writeFiles = (next) => onChange(next.length ? JSON.stringify(next) : '');

  // Close popover on outside click / Escape
  useEffect(() => {
    if (!open) return;
    const onDown = (e) => { if (wrapRef.current && !wrapRef.current.contains(e.target)) { setOpen(false); setRenaming(null); } };
    const onKey = (e) => { if (e.key === 'Escape') { setOpen(false); setRenaming(null); } };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => { document.removeEventListener('mousedown', onDown); document.removeEventListener('keydown', onKey); };
  }, [open]);

  const uploadFiles = async (selected) => {
    if (readOnly || !selected.length) return;
    const tooBig = selected.filter(f => f.size > FILE_SIZE_LIMIT);
    if (tooBig.length) {
      alert(`File too large (max ${Math.round(FILE_SIZE_LIMIT / 1024 / 1024)} MB): ${tooBig.map(f => f.name).join(', ')}`);
    }
    const allowed = selected.filter(f => f.size <= FILE_SIZE_LIMIT);
    if (!allowed.length) return;
    const ids = allowed.map(() => Math.random().toString(36).slice(2));
    setPending(p => [...p, ...allowed.map((f, i) => ({ id: ids[i], name: f.name, progress: 0 }))]);
    const results = await Promise.allSettled(
      allowed.map((file, i) => uploadOne(file, pct => setPending(p => p.map(x => x.id === ids[i] ? { ...x, progress: pct } : x))))
    );
    setPending(p => p.filter(x => !ids.includes(x.id)));
    const uploaded = results.map(r => r.status === 'fulfilled' ? r.value : null).filter(Boolean);
    if (uploaded.length) {
      let current = [];
      try { current = value ? JSON.parse(value) : []; } catch { current = []; }
      if (!Array.isArray(current)) current = [];
      writeFiles([...current, ...uploaded]);
    }
  };

  const handleInput = (e) => { const sel = Array.from(e.target.files || []); e.target.value = ''; uploadFiles(sel); };

  // Attach a file from a cloud provider / external URL by its share link.
  const pickSource = (key) => {
    if (key === 'computer') { inputRef.current?.click(); return; }
    setAddSource(key); setLinkUrl(''); setLinkName('');
  };
  const addLink = () => {
    const url = linkUrl.trim();
    const href = safeHref(url);
    if (!href) { alert('Enter a valid http(s) link'); return; }
    let current = [];
    try { current = value ? JSON.parse(value) : []; } catch { current = []; }
    if (!Array.isArray(current)) current = [];
    writeFiles([...current, {
      isLink: true, source: addSource, url: href,
      originalName: linkName.trim() || nameFromUrl(href),
      mimeType: `link/${addSource}`, uploadedAt: new Date().toISOString(), version: 1, versions: [],
    }]);
    setLinkUrl(''); setLinkName(''); setAddSource(null);
  };

  const handleDrop = (e) => {
    e.preventDefault(); e.stopPropagation(); setDragOver(false);
    if (readOnly) return;
    const sel = Array.from(e.dataTransfer?.files || []);
    if (sel.length) uploadFiles(sel);
  };

  const handleRemove = (index) => {
    const entry = files[index];
    writeFiles(files.filter((_, i) => i !== index));
    purgeEntryBlobs(entry);
    setShowHistory(null);
  };

  const commitRename = (index, name) => {
    const trimmed = (name || '').trim();
    if (trimmed && trimmed !== files[index].originalName) {
      writeFiles(files.map((f, i) => i === index ? { ...f, originalName: trimmed } : f));
    }
    setRenaming(null);
  };

  // New-version flow: a hidden input is reused, target index stashed in a ref
  const startNewVersion = (index) => { versionTargetRef.current = index; versionInputRef.current?.click(); };
  const handleVersionInput = async (e) => {
    const file = (e.target.files || [])[0]; e.target.value = '';
    const index = versionTargetRef.current;
    if (!file || index == null) return;
    const ids = ['v' + Math.random().toString(36).slice(2)];
    setPending(p => [...p, { id: ids[0], name: file.name, progress: 0 }]);
    try {
      const up = await uploadOne(file, pct => setPending(p => p.map(x => x.id === ids[0] ? { ...x, progress: pct } : x)));
      const cur = files[index];
      const prev = { name: cur.name, originalName: cur.originalName, url: cur.url, size: cur.size, mimeType: cur.mimeType, thumbName: cur.thumbName, thumbUrl: cur.thumbUrl, uploadedAt: cur.uploadedAt, version: cur.version || 1 };
      writeFiles(files.map((f, i) => i === index ? {
        ...up, originalName: cur.originalName, version: (cur.version || 1) + 1, versions: [prev, ...(cur.versions || [])],
      } : f));
    } catch { alert('Failed to upload new version'); }
    finally { setPending(p => p.filter(x => x.id !== ids[0])); versionTargetRef.current = null; }
  };

  const restoreVersion = (index, vIndex) => {
    const cur = files[index];
    const v = (cur.versions || [])[vIndex];
    if (!v) return;
    const curAsVersion = { name: cur.name, originalName: cur.originalName, url: cur.url, size: cur.size, mimeType: cur.mimeType, thumbName: cur.thumbName, thumbUrl: cur.thumbUrl, uploadedAt: cur.uploadedAt, version: cur.version || 1 };
    const restVersions = (cur.versions || []).filter((_, i) => i !== vIndex);
    writeFiles(files.map((f, i) => i === index ? {
      ...v, originalName: cur.originalName, version: (cur.version || 1) + 1, versions: [curAsVersion, ...restVersions],
    } : f));
  };

  const visible = files.slice(0, 4);
  const extra = files.length - visible.length;
  const popupBg = isDark ? 'var(--card-bg)' : '#fff';
  const border = isDark ? 'var(--border-color)' : '#e6e9ef';

  return (
    <div
      ref={wrapRef}
      style={{ position: 'relative' }}
      onDragOver={readOnly ? undefined : (e) => { e.preventDefault(); if (!dragOver) setDragOver(true); }}
      onDragLeave={readOnly ? undefined : (e) => { if (!e.currentTarget.contains(e.relatedTarget)) setDragOver(false); }}
      onDrop={readOnly ? undefined : handleDrop}
    >
      {/* Compact in-cell view: thumbnails + count + attach */}
      <div className="file-chip-row" style={{ display: 'flex', flexWrap: 'nowrap', gap: 4, alignItems: 'center', minHeight: 28, padding: '0 2px', overflow: 'hidden' }}>
        {visible.map((f, i) => (
          <a key={i} href={f.url} target="_blank" rel="noopener noreferrer" onClick={e => e.stopPropagation()} title={f.originalName} style={{ flexShrink: 0, lineHeight: 0 }}>
            <FileThumb f={f} size={24} />
          </a>
        ))}
        {extra > 0 && (
          <span onClick={e => { e.stopPropagation(); setOpen(true); }} style={{ fontSize: 11, fontWeight: 700, color: 'var(--text-secondary)', cursor: 'pointer', flexShrink: 0 }}>+{extra}</span>
        )}
        {pending.map(p => (
          <div key={p.id} title={`${p.name} — ${p.progress}%`} style={{ width: 24, height: 24, borderRadius: 4, background: '#eef0f5', position: 'relative', flexShrink: 0, overflow: 'hidden' }}>
            <div style={{ position: 'absolute', bottom: 0, left: 0, width: '100%', height: `${p.progress}%`, background: 'rgba(155,114,245,0.5)' }} />
          </div>
        ))}
        {!readOnly && (
          <>
            {files.length > 0 && (
              <button onClick={e => { e.stopPropagation(); setOpen(o => !o); }} title="Manage files" style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-secondary)', fontSize: 13, flexShrink: 0, padding: '0 2px' }}>⋯</button>
            )}
            <button onClick={e => { e.stopPropagation(); setOpen(true); }} disabled={pending.length > 0} title="Add files" style={{ fontSize: 12, color: '#9b72f5', background: 'none', border: 'none', cursor: pending.length ? 'default' : 'pointer', padding: '2px', opacity: pending.length ? 0.5 : 1, flexShrink: 0 }}>📎</button>
          </>
        )}
        {files.length === 0 && pending.length === 0 && readOnly && <span style={{ color: '#ccc', fontSize: 12 }}>—</span>}
      </div>

      {/* Drag-over highlight */}
      {dragOver && !readOnly && (
        <div style={{ position: 'absolute', inset: -2, border: '2px dashed #9b72f5', borderRadius: 6, background: 'rgba(155,114,245,0.10)', pointerEvents: 'none', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 11, fontWeight: 700, color: '#9b72f5' }}>Drop to upload</div>
      )}

      <input ref={inputRef} type="file" multiple style={{ display: 'none' }} onChange={handleInput} />
      <input ref={versionInputRef} type="file" style={{ display: 'none' }} onChange={handleVersionInput} />

      {/* Manage popover */}
      {open && !readOnly && (
        <div className="cell-dropdown-popup" onClick={e => e.stopPropagation()} style={{
          position: 'absolute', top: '100%', left: 0, zIndex: 320, marginTop: 4,
          width: 320, maxHeight: 380, overflowY: 'auto', background: popupBg,
          border: `1px solid ${border}`, borderRadius: 10,
          boxShadow: isDark ? '0 6px 24px rgba(0,0,0,0.5)' : '0 6px 24px rgba(0,0,0,0.15)',
        }}>
          <div style={{ padding: '8px 12px', borderBottom: `1px solid ${border}` }}>
            <div style={{ fontSize: 11, fontWeight: 800, textTransform: 'uppercase', letterSpacing: 0.5, color: 'var(--text-secondary)', marginBottom: 8 }}>
              Add from
            </div>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
              {FILE_SOURCES.map(s => (
                <button key={s.key} onClick={() => pickSource(s.key)} title={s.label}
                  style={{
                    display: 'flex', alignItems: 'center', gap: 5, fontSize: 11.5, fontWeight: 600,
                    padding: '5px 9px', borderRadius: 7, cursor: 'pointer',
                    border: `1px solid ${addSource === s.key ? '#9b72f5' : border}`,
                    background: addSource === s.key ? 'rgba(155,114,245,0.12)' : (isDark ? 'var(--bg-secondary)' : '#fff'),
                    color: 'var(--text-primary)',
                  }}>
                  <span>{s.icon}</span>{s.label}
                </button>
              ))}
            </div>
            {addSource && SOURCE_BY_KEY[addSource]?.link && (
              <div style={{ marginTop: 10, display: 'flex', flexDirection: 'column', gap: 6 }}>
                <div style={{ fontSize: 11, color: 'var(--text-secondary)' }}>{SOURCE_BY_KEY[addSource].hint}</div>
                <input value={linkUrl} autoFocus onChange={e => setLinkUrl(e.target.value)}
                  onKeyDown={e => { if (e.key === 'Enter') addLink(); }}
                  placeholder="https://…" style={{ fontSize: 12, border: `1px solid ${border}`, borderRadius: 6, padding: '6px 8px', background: 'var(--input-bg,#fff)', color: 'var(--text-primary,#222)' }} />
                <input value={linkName} onChange={e => setLinkName(e.target.value)}
                  onKeyDown={e => { if (e.key === 'Enter') addLink(); }}
                  placeholder="Display name (optional)" style={{ fontSize: 12, border: `1px solid ${border}`, borderRadius: 6, padding: '6px 8px', background: 'var(--input-bg,#fff)', color: 'var(--text-primary,#222)' }} />
                <div style={{ display: 'flex', gap: 6 }}>
                  <button onClick={addLink} style={{ flex: 1, fontSize: 12, fontWeight: 700, color: '#fff', background: '#9b72f5', border: 'none', borderRadius: 6, padding: '6px 0', cursor: 'pointer' }}>Add link</button>
                  <button onClick={() => setAddSource(null)} style={{ fontSize: 12, color: 'var(--text-secondary)', background: 'none', border: `1px solid ${border}`, borderRadius: 6, padding: '6px 12px', cursor: 'pointer' }}>Cancel</button>
                </div>
              </div>
            )}
          </div>
          {files.slice(0, popLimit).map((f, i) => (
            <div key={i} style={{ padding: '8px 12px', borderBottom: `1px solid ${border}` }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                <a href={f.url} target="_blank" rel="noopener noreferrer" style={{ flexShrink: 0, lineHeight: 0 }}><FileThumb f={f} size={36} /></a>
                <div style={{ flex: 1, minWidth: 0 }}>
                  {renaming === i ? (
                    <input autoFocus defaultValue={f.originalName}
                      onBlur={e => commitRename(i, e.target.value)}
                      onKeyDown={e => { if (e.key === 'Enter') commitRename(i, e.target.value); if (e.key === 'Escape') setRenaming(null); }}
                      style={{ width: '100%', fontSize: 12, border: '1px solid #9b72f5', borderRadius: 4, padding: '2px 6px', background: 'var(--input-bg,#fff)', color: 'var(--text-primary,#222)' }} />
                  ) : (
                    <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-primary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={f.originalName}>
                      {f.originalName}
                      {(f.version > 1 || (f.versions || []).length) ? <span style={{ marginLeft: 6, fontSize: 10, fontWeight: 700, color: '#9b72f5', background: 'rgba(155,114,245,0.14)', borderRadius: 6, padding: '1px 5px' }}>v{f.version || 1}</span> : null}
                    </div>
                  )}
                  <div style={{ fontSize: 10, color: 'var(--text-muted)' }}>{fmtSize(f.size)}</div>
                </div>
              </div>
              <div style={{ display: 'flex', gap: 12, marginTop: 6, paddingLeft: 46, fontSize: 11 }}>
                {f.isLink
                  ? <a href={f.url} target="_blank" rel="noopener noreferrer" style={{ color: '#9b72f5', textDecoration: 'none' }}>Open</a>
                  : <a href={f.url} download={f.originalName} style={{ color: '#9b72f5', textDecoration: 'none', cursor: 'pointer' }}>Download</a>}
                <span onClick={() => setRenaming(i)} style={{ color: 'var(--text-secondary)', cursor: 'pointer' }}>Rename</span>
                {!f.isLink && <span onClick={() => startNewVersion(i)} style={{ color: 'var(--text-secondary)', cursor: 'pointer' }}>New version</span>}
                {(f.versions || []).length > 0 && (
                  <span onClick={() => setShowHistory(showHistory === i ? null : i)} style={{ color: 'var(--text-secondary)', cursor: 'pointer' }}>
                    History ({f.versions.length})
                  </span>
                )}
                <span onClick={() => handleRemove(i)} style={{ color: '#e2445c', cursor: 'pointer', marginLeft: 'auto' }}>Delete</span>
              </div>
              {showHistory === i && (f.versions || []).map((v, vi) => (
                <div key={vi} style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 6, paddingLeft: 46, fontSize: 11, color: 'var(--text-secondary)' }}>
                  <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>v{v.version || (f.versions.length - vi)} · {fmtSize(v.size)} · {v.uploadedAt ? toISODate(v.uploadedAt) : ''}</span>
                  <a href={v.url} target="_blank" rel="noopener noreferrer" style={{ color: '#9b72f5', textDecoration: 'none' }}>Open</a>
                  <span onClick={() => restoreVersion(i, vi)} style={{ color: '#9b72f5', cursor: 'pointer' }}>Restore</span>
                </div>
              ))}
            </div>
          ))}
          {files.length > popLimit && (
            <button onClick={() => setPopLimit(n => n + 50)} style={{ width: '100%', padding: '8px 0', fontSize: 12, fontWeight: 700, color: '#9b72f5', background: 'none', border: 'none', cursor: 'pointer' }}>
              Show {Math.min(50, files.length - popLimit)} more ({files.length - popLimit} hidden)
            </button>
          )}
          {files.length === 0 && <div style={{ padding: 16, textAlign: 'center', fontSize: 12, color: 'var(--text-muted)' }}>No files. Drag & drop or use Add.</div>}
        </div>
      )}
    </div>
  );
}

// ── Email cell — clickable mailto link ────────────────────────────────────────
function EmailCell({ value, onChange }) {
  const [editing, setEditing] = useState(false);
  const inputStyle = { width: '100%', border: '1px solid #9b72f5', borderRadius: 4, padding: '3px 6px', outline: 'none', background: 'var(--input-bg, #fff)', color: 'var(--text-primary, #323338)' };
  if (editing) {
    return (
      <input autoFocus type="email" defaultValue={value || ''} placeholder="name@example.com" style={inputStyle}
        onBlur={e => { onChange(e.target.value.trim()); setEditing(false); }}
        onKeyDown={e => { if (e.key === 'Enter') { onChange(e.target.value.trim()); setEditing(false); } if (e.key === 'Escape') setEditing(false); }} />
    );
  }
  if (value) {
    return (
      <div style={{ display: 'flex', alignItems: 'center', gap: 4, minWidth: 0 }}>
        <a href={`mailto:${value}`} title={`Email ${value}`} style={{ color: '#9b72f5', textDecoration: 'none', fontSize: 12, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>✉ {value}</a>
        <span onClick={() => setEditing(true)} title="Edit" style={{ cursor: 'pointer', fontSize: 11, color: '#c5c7d0' }}>✎</span>
        <span onClick={() => onChange('')} title="Clear" style={{ cursor: 'pointer', fontSize: 12, color: '#c5c7d0' }}>×</span>
      </div>
    );
  }
  return <span onClick={() => setEditing(true)} style={{ color: '#ccc', cursor: 'text' }}>—</span>;
}

// ── Phone cell — click-to-call (tel:) + 10-digit input limit ───────────────────
function PhoneCell({ value, onChange }) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(value || '');
  useEffect(() => { if (!editing) setDraft(value || ''); }, [value, editing]);
  const inputStyle = { width: '100%', border: '1px solid #9b72f5', borderRadius: 4, padding: '3px 6px', outline: 'none', background: 'var(--input-bg, #fff)', color: 'var(--text-primary, #323338)' };
  if (editing) {
    return (
      <input autoFocus type="tel" value={draft} placeholder="9876543210" style={inputStyle}
        onChange={e => setDraft(sanitizePhone(e.target.value))}
        onBlur={() => { onChange(draft); setEditing(false); }}
        onKeyDown={e => { if (e.key === 'Enter') { onChange(draft); setEditing(false); } if (e.key === 'Escape') setEditing(false); }} />
    );
  }
  if (value) {
    return (
      <div style={{ display: 'flex', alignItems: 'center', gap: 4, minWidth: 0 }}>
        <a href={`tel:${value.replace(/[^\d+]/g, '')}`} title={`Call ${value}`} style={{ color: '#9b72f5', textDecoration: 'none', fontSize: 12, whiteSpace: 'nowrap' }}>☏ {value}</a>
        <span onClick={() => setEditing(true)} title="Edit" style={{ cursor: 'pointer', fontSize: 11, color: '#c5c7d0' }}>✎</span>
        <span onClick={() => onChange('')} title="Clear" style={{ cursor: 'pointer', fontSize: 12, color: '#c5c7d0' }}>×</span>
      </div>
    );
  }
  return <span onClick={() => setEditing(true)} style={{ color: '#ccc', cursor: 'text' }}>—</span>;
}

// ── Number cell — raw numeric input, formatted display ────────────────────────
function NumberCell({ value, onChange, settings }) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(value || '');
  useEffect(() => { if (!editing) setDraft(value || ''); }, [value, editing]);
  if (editing) {
    return (
      <input autoFocus type="number" value={draft}
        style={{ width: '100%', border: '1px solid #9b72f5', borderRadius: 4, padding: '3px 6px', outline: 'none', background: 'var(--input-bg, #fff)', color: 'var(--text-primary, #323338)' }}
        onChange={e => setDraft(e.target.value)}
        onBlur={() => { onChange(draft); setEditing(false); }}
        onKeyDown={e => { if (e.key === 'Enter') { onChange(draft); setEditing(false); } if (e.key === 'Escape') setEditing(false); }} />
    );
  }
  const has = value !== '' && value != null;
  return (
    <div onClick={() => setEditing(true)} style={{ cursor: 'text', minHeight: 20, padding: '3px 2px', fontSize: 13, textAlign: 'right', color: has ? 'var(--text-primary, #323338)' : '#ccc' }}>
      {has ? formatNumber(value, settings) : '—'}
    </div>
  );
}

// ── Formula evaluation cache ──────────────────────────────────────────────────
// evaluateFormula() parses + evaluates the expression, which is wasteful to run
// on every render — and on a virtualized board each cell remounts as you scroll,
// so a per-component useMemo wouldn't survive. Instead we memoize at module level
// keyed by the EXACT inputs that affect the result (formula text, the item's
// values, the item identity, and the columns' id/title/type used for token
// resolution). A coarse day bucket lets TODAY()/date-based formulas refresh once
// a day while still caching within a day. The key is content-derived, so it
// self-invalidates the instant any input changes — no manual cache busting.
const _formulaCache = new Map();
let _colsSig = '', _colsSigRef = null;
function columnsSignature(columns) {
  if (columns === _colsSigRef) return _colsSig; // cheap: same array reference → reuse
  _colsSigRef = columns;
  _colsSig = (columns || []).map(c => `${c.id}:${c.title}:${c.type}`).join('|');
  return _colsSig;
}
function evaluateFormulaCached(column, item, columns) {
  const formula = column?.settings?.formula || '';
  const day = new Date().toISOString().slice(0, 10);
  const sig = `${column.id}|${day}|${formula}|${item?.id}|${item?.name || ''}|${JSON.stringify(item?.values || {})}|${columnsSignature(columns)}`;
  const hit = _formulaCache.get(sig);
  if (hit !== undefined) return hit;
  const result = evaluateFormula(formula, item, columns);
  if (_formulaCache.size > 8000) _formulaCache.clear(); // simple bound
  _formulaCache.set(sig, result);
  return result;
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
  const result = evaluateFormulaCached(column, item, columns);
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

// ── Connect Boards cell ─────────────────────────────────────────────────────
// Stores a JSON array of linked item ids. Renders chips of the linked items'
// names and opens a searchable picker to add/remove links from the target board.
function parseConnectIds(value) {
  if (!value) return [];
  try { const a = JSON.parse(value); return Array.isArray(a) ? a.filter(n => Number.isInteger(n)) : []; }
  catch { return []; }
}

// Board provides { items: { itemId: { name, board_name } }, reload } so connect
// chips can show linked-item names and mirror cells can refresh after editing a
// source value through the mirror.
export const LinkedItemsContext = React.createContext({ items: {}, reload: null, runningTimers: {} });

// ── Time tracking cell ───────────────────────────────────────────────────────
// Live start/stop timer + accumulated total + a session log popup (manual
// entries, billable toggle, delete). The stored cell value is the accumulated
// completed seconds; a running timer ticks on top of it live.
function fmtHMS(s) {
  s = Math.max(0, Math.floor(s));
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), sec = s % 60;
  return h > 0 ? `${h}:${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')}` : `${m}:${String(sec).padStart(2, '0')}`;
}
function fmtHM(s) {
  s = Math.max(0, Math.floor(s));
  const h = Math.floor(s / 3600), m = Math.round((s % 3600) / 60);
  return h > 0 ? `${h}h ${m}m` : `${m}m`;
}

function TimeTrackingCell({ value, column, item, onChange }) {
  const ctx = useContext(LinkedItemsContext);
  const { user } = useAuth();
  const readOnly = !onChange || !item;
  const key = `${item?.id}:${column.id}`;
  const ctxRunning = ctx?.runningTimers?.[key];
  const mineFromCtx = ctxRunning && user && ctxRunning.user_id === user.id ? ctxRunning : null;
  const othersRunning = ctxRunning && (!user || ctxRunning.user_id !== user.id) ? ctxRunning : null;

  const [total, setTotal] = useState(Number(value) || 0);
  const [running, setRunning] = useState(mineFromCtx ? { started_at: mineFromCtx.started_at } : null);
  const [, setTick] = useState(0);
  const [open, setOpen] = useState(false);
  const [entries, setEntries] = useState(null);
  const [mh, setMh] = useState(''); const [mm, setMm] = useState('');
  const [busy, setBusy] = useState(false);
  const popupRef = useRef(null);

  useEffect(() => { setTotal(Number(value) || 0); }, [value]);
  useEffect(() => { setRunning(mineFromCtx ? { started_at: mineFromCtx.started_at } : null); }, [ctxRunning?.started_at, ctxRunning?.user_id]); // eslint-disable-line
  useEffect(() => { if (!running) return; const id = setInterval(() => setTick(t => t + 1), 1000); return () => clearInterval(id); }, [running]);
  useEffect(() => {
    if (!open) return;
    const onDown = (e) => { if (popupRef.current && !popupRef.current.contains(e.target)) setOpen(false); };
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, [open]);

  const liveExtra = running ? Math.max(0, (Date.now() - new Date(running.started_at).getTime()) / 1000) : 0;
  const display = total + liveExtra;

  const start = async (e) => { e.stopPropagation(); if (readOnly) return; try { const r = await timeStart(item.id, column.id); setRunning({ started_at: r.entry.started_at }); } catch { /* ignore */ } };
  const stop = async (e) => { e.stopPropagation(); try { const r = await timeStop(item.id, column.id); setRunning(null); if (typeof r.total === 'number') setTotal(r.total); } catch { /* ignore */ } };

  const loadEntries = async () => { try { const r = await timeCell(item.id, column.id); setEntries(r.entries); setTotal(r.total + (running ? 0 : 0)); } catch { setEntries([]); } };
  const openLog = (e) => { e.stopPropagation(); setOpen(true); setEntries(null); loadEntries(); };

  const addManual = async () => {
    const secs = (parseInt(mh, 10) || 0) * 3600 + (parseInt(mm, 10) || 0) * 60;
    if (secs <= 0) return;
    setBusy(true);
    try { const r = await timeManual({ item_id: item.id, column_id: column.id, duration_seconds: secs, billable: true }); setTotal(r.total); setMh(''); setMm(''); await loadEntries(); }
    catch { /* ignore */ } finally { setBusy(false); }
  };
  const delEntry = async (id) => { try { const r = await timeDeleteEntry(id); setTotal(r.total); await loadEntries(); } catch { /* ignore */ } };
  const toggleBillable = async (en) => { try { const r = await timeEditEntry(en.id, { billable: !en.billable }); setTotal(r.total); await loadEntries(); } catch { /* ignore */ } };

  return (
    <div style={{ position: 'relative', display: 'flex', alignItems: 'center', gap: 6, minHeight: 28 }}>
      {!readOnly && (
        running
          ? <button onClick={stop} title="Stop timer" style={{ width: 22, height: 22, borderRadius: '50%', background: '#e2445c', color: '#fff', fontSize: 10, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0, border: 'none', cursor: 'pointer' }}>■</button>
          : <button onClick={start} title="Start timer" style={{ width: 22, height: 22, borderRadius: '50%', background: 'var(--bg-secondary)', color: '#00c875', fontSize: 11, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0, border: '1px solid var(--border-color)', cursor: 'pointer' }}>▶</button>
      )}
      <span onClick={openLog} title="View time log" style={{ cursor: 'pointer', fontVariantNumeric: 'tabular-nums', fontWeight: running ? 800 : 600, fontSize: 13, color: running ? '#e2445c' : (display > 0 ? 'var(--text-primary)' : '#ccc') }}>
        {fmtHMS(display)}
      </span>
      {running && <span style={{ width: 7, height: 7, borderRadius: '50%', background: '#e2445c', flexShrink: 0, animation: 'pulse 1.2s infinite' }} />}
      {!running && othersRunning && <span title={`${othersRunning.user_name} is tracking`} style={{ width: 7, height: 7, borderRadius: '50%', background: '#fdab3d', flexShrink: 0 }} />}

      {open && (
        <div ref={popupRef} className="cell-dropdown-popup" onClick={e => e.stopPropagation()} style={{
          position: 'absolute', top: '100%', left: 0, zIndex: 320, marginTop: 4, width: 300,
          background: 'var(--card-bg)', border: '1px solid var(--border-color)', borderRadius: 10, boxShadow: '0 8px 28px rgba(0,0,0,0.2)', padding: 12,
        }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
            <span style={{ fontSize: 12, fontWeight: 700, color: 'var(--text-secondary)', textTransform: 'uppercase', letterSpacing: 0.4 }}>Time log</span>
            <span style={{ fontSize: 13, fontWeight: 800, color: 'var(--text-primary)' }}>{fmtHM(total)}</span>
          </div>

          {!readOnly && (
            <div style={{ display: 'flex', gap: 6, alignItems: 'center', marginBottom: 10 }}>
              <input type="number" min="0" value={mh} onChange={e => setMh(e.target.value)} placeholder="0" title="Hours" style={{ width: 46, border: '1px solid var(--border-color)', borderRadius: 6, padding: '5px 6px', fontSize: 12, background: 'var(--input-bg,#f7f8fc)', color: 'var(--text-primary)', textAlign: 'center' }} />
              <span style={{ color: 'var(--text-muted)', fontSize: 12 }}>h</span>
              <input type="number" min="0" max="59" value={mm} onChange={e => setMm(e.target.value)} placeholder="0" title="Minutes" style={{ width: 46, border: '1px solid var(--border-color)', borderRadius: 6, padding: '5px 6px', fontSize: 12, background: 'var(--input-bg,#f7f8fc)', color: 'var(--text-primary)', textAlign: 'center' }} />
              <span style={{ color: 'var(--text-muted)', fontSize: 12 }}>m</span>
              <button onClick={addManual} disabled={busy} style={{ marginLeft: 'auto', background: '#0073ea', color: '#fff', border: 'none', borderRadius: 6, padding: '5px 12px', fontSize: 12, fontWeight: 700, cursor: 'pointer' }}>Add</button>
            </div>
          )}

          <div style={{ maxHeight: 220, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 4 }}>
            {entries === null && <div style={{ fontSize: 12, color: 'var(--text-muted)', padding: 6 }}>Loading…</div>}
            {entries && entries.length === 0 && <div style={{ fontSize: 12, color: 'var(--text-muted)', padding: 6 }}>No sessions yet. Start the timer or add time.</div>}
            {entries && entries.map(en => (
              <div key={en.id} style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '5px 6px', borderRadius: 6, background: 'var(--bg-secondary)', fontSize: 12 }}>
                <span style={{ fontWeight: 700, color: en.ended_at ? 'var(--text-primary)' : '#e2445c', minWidth: 52, fontVariantNumeric: 'tabular-nums' }}>{en.ended_at ? fmtHMS(en.duration_seconds) : '● live'}</span>
                <span style={{ flex: 1, minWidth: 0, color: 'var(--text-secondary)', fontSize: 11, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={en.user_name}>{en.user_name}</span>
                <button
                  onClick={() => toggleBillable(en)}
                  disabled={readOnly}
                  title={en.billable ? 'Billable — click to mark non-billable' : 'Non-billable — click to mark billable'}
                  style={{
                    display: 'inline-flex', alignItems: 'center', gap: 3, flexShrink: 0,
                    fontSize: 10, fontWeight: 700, cursor: readOnly ? 'default' : 'pointer',
                    borderRadius: 11, padding: '2px 9px', whiteSpace: 'nowrap',
                    border: en.billable ? '1px solid #00c875' : '1px solid var(--border-color)',
                    background: en.billable ? '#00c875' : 'transparent',
                    color: en.billable ? '#fff' : 'var(--text-muted)',
                  }}
                >{en.billable ? '₹ Billable' : 'Unbilled'}</button>
                {!readOnly && <button onClick={() => delEntry(en.id)} title="Delete session" style={{ fontSize: 14, cursor: 'pointer', border: 'none', background: 'none', color: '#c5c7d0', flexShrink: 0, lineHeight: 1 }}>×</button>}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}



function ConnectCell({ column, value, onChange, linkedItems }) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState('');
  const [results, setResults] = useState([]);
  const [loading, setLoading] = useState(false);
  const [nameCache, setNameCache] = useState({});
  const popupRef = useRef(null);
  const searchRef = useRef(null);
  const { resolvedTheme } = useThemeContext();
  const isDark = resolvedTheme === 'dark';

  const targetBoardId = column.settings?.boardId;
  const allowMultiple = column.settings?.allowMultiple !== false;
  const readOnly = !onChange;
  const ctx = useContext(LinkedItemsContext);
  const ctxLinked = ctx?.items || {};
  const ids = parseConnectIds(value);
  const nameFor = (id) => linkedItems?.[id]?.name || ctxLinked?.[id]?.name || nameCache[id] || `#${id}`;

  useEffect(() => {
    if (!open) return;
    const onDown = (e) => { if (popupRef.current && !popupRef.current.contains(e.target)) setOpen(false); };
    const onKey = (e) => { if (e.key === 'Escape') setOpen(false); };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => { document.removeEventListener('mousedown', onDown); document.removeEventListener('keydown', onKey); };
  }, [open]);

  useEffect(() => { if (open && searchRef.current) searchRef.current.focus(); }, [open]);

  useEffect(() => {
    if (!open || !targetBoardId) return;
    let cancelled = false;
    setLoading(true);
    searchConnectItems(targetBoardId, q, ids)
      .then(rows => {
        if (cancelled) return;
        setResults(rows);
        setNameCache(c => { const n = { ...c }; rows.forEach(r => { n[r.id] = r.name; }); return n; });
      })
      .catch(() => { if (!cancelled) setResults([]); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [open, q, targetBoardId]); // eslint-disable-line react-hooks/exhaustive-deps

  const commit = (next) => onChange(next.length ? JSON.stringify(next) : '');
  const add = (id) => { commit(allowMultiple ? [...ids, id] : [id]); setQ(''); if (!allowMultiple) setOpen(false); };
  const remove = (id) => commit(ids.filter(x => x !== id));

  if (!targetBoardId) {
    return <span title="This column has no connected board configured" style={{ color: '#e2445c', fontSize: 12 }}>⚠ not set up</span>;
  }

  const popupBg = isDark ? 'var(--card-bg)' : '#fff';
  const popupBorder = 'var(--border-color)';

  return (
    <div style={{ position: 'relative', minHeight: 28, display: 'flex', alignItems: 'center', width: '100%' }}>
      <div
        onClick={() => { if (!readOnly) setOpen(o => !o); }}
        style={{ display: 'flex', flexWrap: 'wrap', gap: 3, alignItems: 'center', flex: 1, cursor: readOnly ? 'default' : 'pointer', minHeight: 28, padding: '2px 0' }}
      >
        {ids.length === 0
          ? <span style={{ color: '#ccc', fontSize: 12 }}>—</span>
          : ids.map(id => (
            <span key={id} title={nameFor(id)} style={{
              display: 'inline-flex', alignItems: 'center', gap: 4,
              background: 'rgba(0,115,234,0.12)', color: '#0073ea', border: '1px solid rgba(0,115,234,0.30)',
              borderRadius: 12, padding: '1px 4px 1px 8px', fontSize: 11, fontWeight: 600,
              maxWidth: 130, overflow: 'hidden',
            }}>
              <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{nameFor(id)}</span>
              {!readOnly && (
                <span onClick={e => { e.stopPropagation(); remove(id); }} title="Remove link"
                  style={{ cursor: 'pointer', fontSize: 13, lineHeight: 1, color: '#0073ea', opacity: 0.7 }}>×</span>
              )}
            </span>
          ))
        }
        {!readOnly && (allowMultiple || ids.length === 0) && (
          <span style={{ fontSize: 14, color: '#0073ea', fontWeight: 700, padding: '0 4px', lineHeight: 1 }}>+</span>
        )}
      </div>

      {open && !readOnly && (
        <div ref={popupRef} className="cell-dropdown-popup" style={{
          position: 'absolute', top: '100%', left: 0, zIndex: 300, marginTop: 2,
          background: popupBg, border: `1px solid ${popupBorder}`, borderRadius: 10,
          boxShadow: '0 6px 24px rgba(0,0,0,0.18)', minWidth: 250, padding: '8px 0',
        }}>
          <div style={{ padding: '0 10px 8px' }}>
            <input
              ref={searchRef} value={q} onChange={e => setQ(e.target.value)}
              placeholder="Search items to link…"
              style={{ width: '100%', boxSizing: 'border-box', border: `1px solid ${popupBorder}`, borderRadius: 6, padding: '6px 10px', fontSize: 12, background: 'var(--input-bg, #f7f8fc)', color: 'var(--text-primary)', outline: 'none' }}
              onClick={e => e.stopPropagation()}
            />
          </div>
          <div style={{ maxHeight: 220, overflowY: 'auto' }}>
            {loading && <div style={{ padding: '8px 14px', fontSize: 12, color: 'var(--text-muted)' }}>Searching…</div>}
            {!loading && results.length === 0 && (
              <div style={{ padding: '8px 14px', fontSize: 12, color: 'var(--text-muted)' }}>No items found</div>
            )}
            {results.map(r => (
              <div key={r.id} onClick={() => add(r.id)}
                style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '7px 12px', cursor: 'pointer' }}
                onMouseEnter={e => e.currentTarget.style.background = isDark ? 'rgba(255,255,255,0.06)' : '#f5f6f8'}
                onMouseLeave={e => e.currentTarget.style.background = 'transparent'}>
                <span style={{ width: 8, height: 8, borderRadius: '50%', background: r.group_color || '#0073ea', flexShrink: 0 }} />
                <span style={{ flex: 1, fontSize: 13, color: 'var(--text-primary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{r.name}</span>
                {r.group_name && <span style={{ fontSize: 10, color: 'var(--text-muted)' }}>{r.group_name}</span>}
              </div>
            ))}
          </div>
          {ids.length > 0 && (
            <div style={{ borderTop: `1px solid ${popupBorder}`, marginTop: 4, paddingTop: 4 }}>
              <div onClick={() => commit([])} style={{ padding: '6px 12px', fontSize: 12, color: '#e2445c', cursor: 'pointer', fontWeight: 600 }}>✕ Clear all links</div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ── Mirror cell ─────────────────────────────────────────────────────────────
// Read-only reflection of a column on the linked items. The server pre-resolves
// the value into { type, items:[{name, v, color}] }. Each value is rendered to
// match how the source column type looks natively (avatars, dates, stars, …).
const MIRROR_TAG_PALETTE = ['#0073ea', '#00c875', '#e2445c', '#fdab3d', '#a25ddc', '#ff642e', '#037f4c', '#ff158a'];
function mirrorPersonNames(raw) {
  try { const a = JSON.parse(raw); return Array.isArray(a) ? a : [String(raw)]; }
  catch { return raw ? [String(raw)] : []; }
}
function MirrorEntry({ type, e }) {
  const wrap = (child) => <span title={`${e.name}`}>{child}</span>;
  if (['status', 'priority', 'dropdown'].includes(type) && e.color) {
    return wrap(<span style={{ background: e.color, color: '#fff', borderRadius: 4, padding: '1px 8px', fontSize: 11, fontWeight: 700, whiteSpace: 'nowrap' }}>{e.v}</span>);
  }
  if (type === 'person') {
    const names = mirrorPersonNames(e.v);
    return (
      <span style={{ display: 'inline-flex', gap: 3 }} title={`${e.name}: ${names.join(', ')}`}>
        {names.slice(0, 3).map((n, k) => (
          <span key={k} style={{ width: 20, height: 20, borderRadius: '50%', background: MIRROR_TAG_PALETTE[(n.charCodeAt(0) || 0) % MIRROR_TAG_PALETTE.length], color: '#fff', fontSize: 9, fontWeight: 700, display: 'inline-flex', alignItems: 'center', justifyContent: 'center' }}>{n.slice(0, 2).toUpperCase()}</span>
        ))}
        {names.length > 3 && <span style={{ fontSize: 10, color: 'var(--text-muted)' }}>+{names.length - 3}</span>}
      </span>
    );
  }
  if (type === 'date') {
    return wrap(<span style={{ fontSize: 11, color: 'var(--text-secondary)', background: 'var(--bg-secondary)', borderRadius: 4, padding: '1px 7px', whiteSpace: 'nowrap' }}>📅 {toISODate(e.v) || e.v}</span>);
  }
  if (type === 'timeline') {
    return wrap(<span style={{ fontSize: 11, color: '#7a4ddb', background: 'rgba(162,93,220,0.12)', borderRadius: 4, padding: '1px 7px', whiteSpace: 'nowrap' }}>{e.v}</span>);
  }
  if (type === 'checkbox') {
    return wrap(<span style={{ fontSize: 12 }}>{e.v === 'true' || e.v === '1' ? '✅' : '⬜'}</span>);
  }
  if (type === 'rating') {
    const n = Math.round(Number(e.v)) || 0;
    return wrap(<span style={{ color: '#fdab3d', fontSize: 11 }}>{'★'.repeat(n)}{'☆'.repeat(Math.max(0, 5 - n))}</span>);
  }
  return wrap(<span style={{ background: 'var(--bg-secondary)', border: '1px solid var(--border-color)', borderRadius: 4, padding: '1px 7px', fontSize: 11, color: 'var(--text-secondary)', whiteSpace: 'nowrap', maxWidth: 140, overflow: 'hidden', textOverflow: 'ellipsis', display: 'inline-block' }}>{String(e.v)}</span>);
}
function MirrorCell({ value }) {
  const ctx = useContext(LinkedItemsContext);
  const reload = ctx?.reload;
  const [openIdx, setOpenIdx] = useState(null);
  const [saving, setSaving] = useState(false);
  const wrapRef = useRef(null);

  let data = null;
  try { data = value ? JSON.parse(value) : null; } catch { data = null; }

  // Edit-through-mirror: for status-like sources we can write the chosen label
  // straight back to the linked source item, then refresh the board.
  const editable = !!reload && data && ['status', 'priority', 'dropdown'].includes(data.type) && Array.isArray(data.opts);

  useEffect(() => {
    if (openIdx === null) return;
    const onDown = (e) => { if (wrapRef.current && !wrapRef.current.contains(e.target)) setOpenIdx(null); };
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, [openIdx]);

  if (!data || !Array.isArray(data.items) || !data.items.length) return <span style={{ color: '#ccc' }}>—</span>;

  const choose = async (entry, label) => {
    setSaving(true);
    try { await upsertColumnValue({ item_id: entry.id, column_id: data.colId, value: label }); setOpenIdx(null); await reload(); }
    catch { setOpenIdx(null); }
    finally { setSaving(false); }
  };

  return (
    <div ref={wrapRef} style={{ display: 'flex', flexWrap: 'wrap', gap: 4, alignItems: 'center', padding: '2px 0' }}>
      {data.items.map((e, i) => {
        const canEdit = editable && !e.restricted && Number.isInteger(e.id);
        return (
          <span key={i} style={{ position: 'relative', display: 'inline-flex' }}>
            <span
              onClick={canEdit ? (ev) => { ev.stopPropagation(); setOpenIdx(openIdx === i ? null : i); } : undefined}
              style={{ cursor: canEdit ? 'pointer' : 'default', opacity: saving && openIdx === i ? 0.5 : 1 }}
              title={canEdit ? `${e.name} — click to change` : e.name}
            >
              <MirrorEntry type={data.type} e={e} />
            </span>
            {openIdx === i && canEdit && (
              <div className="cell-dropdown-popup" onClick={ev => ev.stopPropagation()} style={{
                position: 'absolute', top: '100%', left: 0, zIndex: 320, marginTop: 3,
                background: 'var(--card-bg)', border: '1px solid var(--border-color)', borderRadius: 8,
                boxShadow: '0 6px 24px rgba(0,0,0,0.18)', minWidth: 160, padding: 6,
              }}>
                <div style={{ fontSize: 10, color: 'var(--text-muted)', padding: '2px 6px 6px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: 180 }}>Set on “{e.name}”</div>
                {data.opts.map(o => (
                  <div key={o.label} onClick={() => choose(e, o.label)}
                    style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '5px 8px', borderRadius: 5, cursor: 'pointer' }}
                    onMouseEnter={ev => ev.currentTarget.style.background = 'var(--menu-hover, #f5f6f8)'}
                    onMouseLeave={ev => ev.currentTarget.style.background = 'transparent'}>
                    <span style={{ width: 10, height: 10, borderRadius: 3, background: o.color || '#c4c4c4', flexShrink: 0 }} />
                    <span style={{ fontSize: 12, color: 'var(--text-primary)' }}>{o.label}</span>
                  </div>
                ))}
              </div>
            )}
          </span>
        );
      })}
    </div>
  );
}

// ── Rollup cell ─────────────────────────────────────────────────────────────
// Read-only aggregated value of a numeric column across the linked items.
function RollupCell({ value, column }) {
  const fn = column?.settings?.fn || 'sum';
  if (value === '' || value == null) return <span style={{ color: '#ccc' }}>—</span>;
  return (
    <div title={`${fn} of linked items`} style={{ display: 'flex', alignItems: 'center', justifyContent: 'flex-end', gap: 6, height: '100%' }}>
      <span style={{ fontSize: 9, fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: 0.3 }}>{fn}</span>
      <span style={{ fontWeight: 800, fontSize: 13, color: 'var(--text-primary)', fontVariantNumeric: 'tabular-nums' }}>{value}</span>
    </div>
  );
}

// ── Dependency cell ──────────────────────────────────────────────────────────
// Same-board predecessor picker. Stores a JSON array of item ids this task waits
// for; editing a task's timeline auto-shifts these dependents (handled server-side).
function DependencyCell({ column, value, onChange, item }) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState('');
  const [results, setResults] = useState([]);
  const [loading, setLoading] = useState(false);
  const [nameCache, setNameCache] = useState({});
  const popupRef = useRef(null);
  const searchRef = useRef(null);
  const ctx = useContext(LinkedItemsContext);
  const ctxLinked = ctx?.items || {};
  const { resolvedTheme } = useThemeContext();
  const isDark = resolvedTheme === 'dark';

  const boardId = column.settings?.boardId;
  const readOnly = !onChange;
  const ids = parseConnectIds(value);
  const nameFor = (id) => ctxLinked?.[id]?.name || nameCache[id] || `#${id}`;
  const exclude = [item?.id, ...ids].filter(Number.isInteger);

  useEffect(() => {
    if (!open) return;
    const onDown = (e) => { if (popupRef.current && !popupRef.current.contains(e.target)) setOpen(false); };
    const onKey = (e) => { if (e.key === 'Escape') setOpen(false); };
    document.addEventListener('mousedown', onDown); document.addEventListener('keydown', onKey);
    return () => { document.removeEventListener('mousedown', onDown); document.removeEventListener('keydown', onKey); };
  }, [open]);
  useEffect(() => { if (open && searchRef.current) searchRef.current.focus(); }, [open]);
  useEffect(() => {
    if (!open || !boardId) return;
    let cancelled = false; setLoading(true);
    searchConnectItems(boardId, q, exclude)
      .then(rows => { if (cancelled) return; setResults(rows); setNameCache(c => { const n = { ...c }; rows.forEach(r => { n[r.id] = r.name; }); return n; }); })
      .catch(() => { if (!cancelled) setResults([]); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [open, q, boardId]); // eslint-disable-line react-hooks/exhaustive-deps

  const commit = (next) => onChange(next.length ? JSON.stringify(next) : '');
  const add = (id) => { commit([...ids, id]); setQ(''); };
  const remove = (id) => commit(ids.filter(x => x !== id));

  if (!boardId) return <span style={{ color: '#ccc', fontSize: 12 }}>—</span>;

  return (
    <div style={{ position: 'relative', minHeight: 28, display: 'flex', alignItems: 'center', width: '100%' }}>
      <div onClick={() => { if (!readOnly) setOpen(o => !o); }}
        style={{ display: 'flex', flexWrap: 'wrap', gap: 3, alignItems: 'center', flex: 1, cursor: readOnly ? 'default' : 'pointer', minHeight: 28, padding: '2px 0' }}>
        {ids.length === 0
          ? <span style={{ color: '#ccc', fontSize: 12 }}>—</span>
          : ids.map(id => (
            <span key={id} title={nameFor(id)} style={{
              display: 'inline-flex', alignItems: 'center', gap: 4,
              background: 'rgba(255,100,46,0.12)', color: '#d14a15', border: '1px solid rgba(255,100,46,0.30)',
              borderRadius: 12, padding: '1px 4px 1px 8px', fontSize: 11, fontWeight: 600, maxWidth: 140, overflow: 'hidden',
            }}>
              <span style={{ fontSize: 9 }}>⛓</span>
              <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{nameFor(id)}</span>
              {!readOnly && <span onClick={e => { e.stopPropagation(); remove(id); }} title="Remove" style={{ cursor: 'pointer', fontSize: 13, lineHeight: 1, opacity: 0.7 }}>×</span>}
            </span>
          ))}
        {!readOnly && <span style={{ fontSize: 14, color: '#ff642e', fontWeight: 700, padding: '0 4px', lineHeight: 1 }}>+</span>}
      </div>

      {open && !readOnly && (
        <div ref={popupRef} className="cell-dropdown-popup" style={{
          position: 'absolute', top: '100%', left: 0, zIndex: 300, marginTop: 2,
          background: isDark ? 'var(--card-bg)' : '#fff', border: '1px solid var(--border-color)', borderRadius: 10,
          boxShadow: '0 6px 24px rgba(0,0,0,0.18)', minWidth: 250, padding: '8px 0',
        }}>
          <div style={{ padding: '0 10px 8px' }}>
            <input ref={searchRef} value={q} onChange={e => setQ(e.target.value)} placeholder="Search tasks this depends on…"
              style={{ width: '100%', boxSizing: 'border-box', border: '1px solid var(--border-color)', borderRadius: 6, padding: '6px 10px', fontSize: 12, background: 'var(--input-bg, #f7f8fc)', color: 'var(--text-primary)', outline: 'none' }}
              onClick={e => e.stopPropagation()} />
          </div>
          <div style={{ maxHeight: 220, overflowY: 'auto' }}>
            {loading && <div style={{ padding: '8px 14px', fontSize: 12, color: 'var(--text-muted)' }}>Searching…</div>}
            {!loading && results.length === 0 && <div style={{ padding: '8px 14px', fontSize: 12, color: 'var(--text-muted)' }}>No tasks found</div>}
            {results.map(r => (
              <div key={r.id} onClick={() => add(r.id)}
                style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '7px 12px', cursor: 'pointer' }}
                onMouseEnter={e => e.currentTarget.style.background = isDark ? 'rgba(255,255,255,0.06)' : '#f5f6f8'}
                onMouseLeave={e => e.currentTarget.style.background = 'transparent'}>
                <span style={{ width: 8, height: 8, borderRadius: '50%', background: r.group_color || '#ff642e', flexShrink: 0 }} />
                <span style={{ flex: 1, fontSize: 13, color: 'var(--text-primary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{r.name}</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

export default function ColumnCell({ column, value, onChange, onEditSettings, item, columns, linkedItems }) {
  const { type, settings } = column;

  switch (type) {
    case 'connect_boards':
      return <ConnectCell column={column} value={value} onChange={onChange} linkedItems={linkedItems} />;
    case 'mirror':
      return <MirrorCell value={value} />;
    case 'rollup':
      return <RollupCell value={value} column={column} />;
    case 'dependency':
      return <DependencyCell column={column} value={value} onChange={onChange} item={item} />;
    case 'ai': {
      const out = aiCompute(item, columns || [], column.settings || {});
      const isChip = column.settings?.op === 'health' || column.settings?.op === 'sentiment';
      return (
        <div title={out} style={{ display: 'flex', alignItems: 'center', gap: 5, minHeight: 26, padding: '2px 2px', cursor: 'default' }}>
          {isChip
            ? <span style={{ fontSize: 12, fontWeight: 700, color: 'var(--text-primary)' }}>{out}</span>
            : <span style={{ fontSize: 12, color: out === '—' ? '#ccc' : 'var(--text-secondary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{out}</span>}
        </div>
      );
    }
    case 'status':
      return <StatusCell value={value} settings={settings} onChange={onChange} column={column} onSettingsUpdate={onEditSettings} />;
    case 'priority':
      return <StatusCell value={value} settings={settings} onChange={onChange} column={column} onSettingsUpdate={onEditSettings} defaultOptions={DEFAULT_PRIORITY_OPTIONS} iconMap={PRIORITY_ICONS} />;
    case 'dropdown':
      return <DropdownCell value={value} settings={settings} onChange={onChange} column={column} onSettingsUpdate={onEditSettings} />;
    case 'rating':
      return <RatingCell value={value} onChange={onChange} settings={settings} />;
    case 'progress':
      return <ProgressCell value={value} onChange={onChange} column={column} item={item} columns={columns || []} />;
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
      return <NumberCell value={value} onChange={onChange} settings={settings} />;
    case 'email':
      return <EmailCell value={value} onChange={onChange} />;
    case 'phone':
      return <PhoneCell value={value} onChange={onChange} />;
    case 'long_text':
      return <LongTextCell value={value} onChange={onChange} />;
    case 'time_tracking':
      return <TimeTrackingCell value={value} column={column} item={item} onChange={onChange} />;
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
