import React, { useState, useEffect, useMemo } from 'react';
import { computeWeightedProgress } from '../utils/cellFormat';

const SECTION = { fontSize: 11, fontWeight: 700, color: 'var(--text-secondary)', textTransform: 'uppercase', letterSpacing: 0.6, marginBottom: 8 };

const DEFAULT_STATUS_OPTIONS = [
  { label: 'Done', color: '#00c875' },
  { label: 'Working on it', color: '#fdab3d' },
  { label: 'Stuck', color: '#e2445c' },
  { label: '', color: '#c4c4c4' },
];

// Monday-style "Progress Tracking" (battery) column settings. Lets the user pick
// exactly which Status columns count toward the calculated progress — so a status
// column repurposed for something else (e.g. "Department") can be excluded — and
// optionally weight each one. Mirrors monday.com's progress column configuration.
export default function ProgressSettingsEditor({ column, columns, previewItem, onSave, onClose }) {
  const settings = column?.settings || {};

  // All Status columns on the board are candidates (excluding this progress column).
  const statusCols = useMemo(
    () => (columns || []).filter(c => c.type === 'status' && c.id !== column?.id),
    [columns, column]
  );

  const [source, setSource] = useState(settings.source === 'manual' ? 'manual' : 'status');

  // Selected status column ids. Undefined settings => track all (monday default).
  const [selectedIds, setSelectedIds] = useState(() => {
    if (Array.isArray(settings.statusColumnIds)) return new Set(settings.statusColumnIds);
    return new Set(statusCols.map(c => c.id)); // default: all
  });

  // Per-column weights (1 = equal). Stored as strings while editing.
  const [weights, setWeights] = useState(() => {
    const w = {};
    statusCols.forEach(c => {
      const v = settings.weights && settings.weights[c.id];
      w[c.id] = (v != null && Number.isFinite(Number(v))) ? String(v) : '1';
    });
    return w;
  });

  const [showWeights, setShowWeights] = useState(
    !!(settings.weights && Object.values(settings.weights).some(v => Number(v) !== 1))
  );

  useEffect(() => {
    const h = e => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', h);
    return () => document.removeEventListener('keydown', h);
  }, [onClose]);

  const toggle = (id) => {
    setSelectedIds(prev => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  };

  const allSelected = statusCols.length > 0 && statusCols.every(c => selectedIds.has(c.id));
  const toggleAll = () => {
    setSelectedIds(allSelected ? new Set() : new Set(statusCols.map(c => c.id)));
  };

  // Live preview against the first item on the board.
  const chosenCols = statusCols.filter(c => selectedIds.has(c.id));
  const previewPct = useMemo(() => {
    if (source === 'manual' || !previewItem || chosenCols.length === 0) return null;
    const w = {};
    if (showWeights) chosenCols.forEach(c => { w[c.id] = Number(weights[c.id]) || 1; });
    const { overall } = computeWeightedProgress(
      chosenCols, previewItem.values || {}, { weights: w }, DEFAULT_STATUS_OPTIONS
    );
    return overall;
  }, [source, previewItem, chosenCols, weights, showWeights]);

  const previewColor = previewPct == null ? '#c4c4c4'
    : previewPct >= 100 ? '#00c875' : previewPct >= 50 ? '#fdab3d' : '#9b72f5';

  const handleSave = () => {
    const next = { ...(column.settings || {}) };
    if (source === 'manual') {
      next.source = 'manual';
      delete next.statusColumnIds;
      delete next.weights;
    } else {
      next.source = 'status';
      // Persist the explicit selection so deselected columns stay excluded.
      next.statusColumnIds = statusCols.filter(c => selectedIds.has(c.id)).map(c => c.id);
      if (showWeights) {
        const w = {};
        statusCols.forEach(c => { if (selectedIds.has(c.id)) w[c.id] = Number(weights[c.id]) || 1; });
        next.weights = w;
      } else {
        delete next.weights;
      }
    }
    onSave(next);
  };

  const noStatusCols = statusCols.length === 0;
  const emptySelection = source === 'status' && chosenCols.length === 0;

  return (
    <>
      <div onClick={onClose} style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.4)', zIndex: 600 }} />

      <div onClick={e => e.stopPropagation()} style={{
        position: 'fixed', top: '50%', left: '50%', transform: 'translate(-50%,-50%)',
        width: 480, maxWidth: '96vw', maxHeight: '90vh',
        background: 'var(--bg-primary)', borderRadius: 12,
        boxShadow: '0 16px 64px rgba(0,0,0,0.28)',
        display: 'flex', flexDirection: 'column', zIndex: 601, overflow: 'hidden',
      }}>

        {/* Header */}
        <div style={{ padding: '16px 20px', borderBottom: '1px solid var(--border-color)', display: 'flex', alignItems: 'center', gap: 10, flexShrink: 0 }}>
          <span style={{ fontSize: 20 }}>📊</span>
          <div style={{ flex: 1 }}>
            <div style={{ fontSize: 15, fontWeight: 700, color: 'var(--text-primary)' }}>Progress Tracking</div>
            <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>{column?.title}</div>
          </div>
          <button onClick={onClose} style={{ fontSize: 20, color: 'var(--text-muted)', background: 'none', border: 'none', cursor: 'pointer', lineHeight: 1 }}>×</button>
        </div>

        {/* Body */}
        <div style={{ padding: 20, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 18 }}>

          {/* Mode */}
          <div>
            <div style={SECTION}>How is progress calculated?</div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {[
                { key: 'status', title: 'Based on status columns', desc: 'Average the “done %” of the status columns you choose below.' },
                { key: 'manual', title: 'Manual entry', desc: 'Type a 0–100% value on each item yourself.' },
              ].map(opt => {
                const active = source === opt.key;
                const disabled = opt.key === 'status' && noStatusCols;
                return (
                  <label key={opt.key}
                    style={{
                      display: 'flex', gap: 10, alignItems: 'flex-start', padding: '10px 12px', borderRadius: 8,
                      border: `1.5px solid ${active ? '#9b72f5' : 'var(--border-color)'}`,
                      background: active ? 'rgba(155,114,245,0.08)' : 'transparent',
                      cursor: disabled ? 'not-allowed' : 'pointer', opacity: disabled ? 0.5 : 1,
                    }}>
                    <input type="radio" name="progress-source" checked={active} disabled={disabled}
                      onChange={() => setSource(opt.key)} style={{ marginTop: 2, accentColor: '#9b72f5' }} />
                    <div>
                      <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--text-primary)' }}>{opt.title}</div>
                      <div style={{ fontSize: 11.5, color: 'var(--text-muted)', marginTop: 2 }}>{opt.desc}</div>
                    </div>
                  </label>
                );
              })}
            </div>
            {noStatusCols && (
              <div style={{ fontSize: 11.5, color: '#e2445c', marginTop: 8 }}>
                ⚠ This board has no Status columns yet, so progress falls back to manual entry.
              </div>
            )}
          </div>

          {/* Status column picker */}
          {source === 'status' && !noStatusCols && (
            <div>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
                <div style={SECTION}>Status columns to include</div>
                <button onClick={toggleAll}
                  style={{ fontSize: 11, fontWeight: 600, color: '#9b72f5', background: 'none', border: 'none', cursor: 'pointer', padding: 0 }}>
                  {allSelected ? 'Deselect all' : 'Select all'}
                </button>
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                {statusCols.map(c => {
                  const checked = selectedIds.has(c.id);
                  return (
                    <div key={c.id}
                      style={{
                        display: 'flex', alignItems: 'center', gap: 10, padding: '8px 10px', borderRadius: 7,
                        border: '1px solid var(--border-color)',
                        background: checked ? 'var(--bg-secondary)' : 'transparent',
                      }}>
                      <label style={{ display: 'flex', alignItems: 'center', gap: 10, flex: 1, cursor: 'pointer', minWidth: 0 }}>
                        <input type="checkbox" checked={checked} onChange={() => toggle(c.id)}
                          style={{ accentColor: '#9b72f5', width: 15, height: 15, flexShrink: 0 }} />
                        <span style={{ fontSize: 13, color: 'var(--text-primary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                          {c.title}
                        </span>
                      </label>
                      {showWeights && checked && (
                        <div style={{ display: 'flex', alignItems: 'center', gap: 4, flexShrink: 0 }}>
                          <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>weight</span>
                          <input type="number" min="0" step="0.5" value={weights[c.id] ?? '1'}
                            onChange={e => setWeights(w => ({ ...w, [c.id]: e.target.value }))}
                            style={{
                              width: 52, fontSize: 12, textAlign: 'center', padding: '3px 4px',
                              border: '1px solid var(--border-color)', borderRadius: 5,
                              background: 'var(--input-bg)', color: 'var(--text-primary)', outline: 'none',
                            }} />
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>

              <label style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 12, cursor: 'pointer' }}>
                <input type="checkbox" checked={showWeights} onChange={e => setShowWeights(e.target.checked)}
                  style={{ accentColor: '#9b72f5' }} />
                <span style={{ fontSize: 12.5, color: 'var(--text-secondary)' }}>Give some columns more weight than others</span>
              </label>

              {emptySelection && (
                <div style={{ fontSize: 11.5, color: '#e2445c', marginTop: 10 }}>
                  ⚠ Select at least one status column, or progress will read 0%.
                </div>
              )}

              {/* Live preview */}
              {previewItem && (
                <div style={{ marginTop: 14, padding: '12px 14px', borderRadius: 8, background: 'var(--bg-secondary)', border: '1px solid var(--border-color)' }}>
                  <div style={{ fontSize: 11, color: 'var(--text-muted)', marginBottom: 8 }}>
                    Preview · “{previewItem.name}”
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <div style={{ flex: 1, height: 10, borderRadius: 5, overflow: 'hidden', background: 'var(--border-color)' }}>
                      <div style={{ width: `${previewPct ?? 0}%`, height: '100%', background: previewColor, borderRadius: 5, transition: 'width 0.3s' }} />
                    </div>
                    <span style={{ fontSize: 12, fontWeight: 800, color: 'var(--text-secondary)', minWidth: 34, textAlign: 'right' }}>
                      {previewPct == null ? '—' : `${previewPct}%`}
                    </span>
                  </div>
                </div>
              )}
            </div>
          )}
        </div>

        {/* Footer */}
        <div style={{ padding: '12px 20px', borderTop: '1px solid var(--border-color)', display: 'flex', justifyContent: 'flex-end', gap: 8, flexShrink: 0 }}>
          <button onClick={onClose} style={{ padding: '7px 18px', borderRadius: 7, border: '1px solid var(--border-color)', background: 'transparent', color: 'var(--text-secondary)', fontSize: 13, cursor: 'pointer', fontWeight: 500 }}>
            Cancel
          </button>
          <button onClick={handleSave} style={{ padding: '7px 20px', borderRadius: 7, border: 'none', background: '#9b72f5', color: '#fff', fontSize: 13, fontWeight: 700, cursor: 'pointer' }}>
            Save
          </button>
        </div>
      </div>
    </>
  );
}
