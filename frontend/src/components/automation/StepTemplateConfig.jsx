import React, { useState, useEffect, useRef } from 'react';
import { useAutomation } from '../../hooks/useAutomation';

/**
 * Modal for configuring the step-date template for a board.
 *
 * Props:
 *   boardId        {number}
 *   boardName      {string}
 *   boardColumns   {Array<{id, title, type}>}
 *   onSave         {Function}  — called with saved steps
 *   onClose        {Function}
 */
export default function StepTemplateConfig({ boardId, boardName, boardColumns, onSave, onClose }) {
  const dateColumns = (boardColumns || []).filter(c => c.type === 'date');
  const { fetchTemplates, saveTemplates, loading, error } = useAutomation(boardId);

  const [steps, setSteps] = useState([]);
  const [saving, setSaving] = useState(false);
  const dragIdx = useRef(null);

  useEffect(() => {
    fetchTemplates().then(data => {
      if (data && data.length) {
        setSteps(data.map((s, i) => ({
          id: s.id,
          step_order: s.step_order,
          step_name: s.step_name,
          duration_days: s.duration_days,
          column_id: s.column_id,
          is_anchor: s.is_anchor,
        })));
      }
    }).catch(() => {});
  }, []);   // eslint-disable-line react-hooks/exhaustive-deps

  const totalDays = steps.reduce((sum, s) => sum + (parseInt(s.duration_days) || 0), 0);

  const addStep = () => {
    setSteps(prev => {
      const newStep = {
        step_order: prev.length + 1,
        step_name: `Step ${prev.length + 1}`,
        duration_days: 1,
        column_id: '',
        is_anchor: false,
      };
      const next = [...prev, newStep];
      // Anchor = middle step so both directions have steps to fill
      if (!next.some(s => s.is_anchor)) {
        next[0].is_anchor = true;
      } else {
        // Re-anchor to middle whenever a step is added
        const midIdx = Math.floor((next.length - 1) / 2);
        return next.map((s, i) => ({ ...s, is_anchor: i === midIdx }));
      }
      return next;
    });
  };

  const removeStep = (idx) => {
    setSteps(prev => {
      const next = prev.filter((_, i) => i !== idx).map((s, i) => ({ ...s, step_order: i + 1 }));
      // Ensure exactly one anchor
      if (!next.some(s => s.is_anchor) && next.length > 0) next[0].is_anchor = true;
      return next;
    });
  };

  const updateStep = (idx, field, val) => {
    setSteps(prev => {
      let next = prev.map((s, i) => i === idx ? { ...s, [field]: val } : s);
      if (field === 'is_anchor' && val) {
        next = next.map((s, i) => ({ ...s, is_anchor: i === idx }));
      }
      return next;
    });
  };

  // ── Drag-to-reorder (simple mouse-event based) ────────────────────────────
  const handleDragStart = (e, idx) => { dragIdx.current = idx; e.dataTransfer.effectAllowed = 'move'; };
  const handleDragOver  = (e, idx) => {
    e.preventDefault();
    if (dragIdx.current === null || dragIdx.current === idx) return;
    setSteps(prev => {
      const next = [...prev];
      const [moved] = next.splice(dragIdx.current, 1);
      next.splice(idx, 0, moved);
      dragIdx.current = idx;
      return next.map((s, i) => ({ ...s, step_order: i + 1 }));
    });
  };
  const handleDragEnd = () => { dragIdx.current = null; };

  const handleSave = async () => {
    if (steps.some(s => !s.column_id)) {
      alert('Each step must be mapped to a date column.');
      return;
    }
    setSaving(true);
    try {
      const saved = await saveTemplates(steps);
      onSave?.(saved);
      onClose();
    } catch {
      // error shown from hook
    } finally {
      setSaving(false);
    }
  };

  return (
    <div style={{
      position: 'fixed', inset: 0, zIndex: 3000,
      background: 'rgba(0,0,0,0.45)', display: 'flex', alignItems: 'center', justifyContent: 'center',
    }}
      onClick={e => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div style={{
        background: 'var(--bg-primary)', borderRadius: 12,
        width: 640, maxHeight: '85vh', display: 'flex', flexDirection: 'column',
        boxShadow: '0 8px 32px rgba(0,0,0,0.25)',
      }}>
        {/* Header */}
        <div style={{ padding: '18px 24px 14px', borderBottom: '1px solid var(--border-color)', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <div>
            <div style={{ fontWeight: 700, fontSize: 16, color: 'var(--text-primary)' }}>
              📅 Step Date Template
            </div>
            <div style={{ fontSize: 12, color: 'var(--text-secondary)', marginTop: 2 }}>{boardName}</div>
          </div>
          <button onClick={onClose} style={{ border: 'none', background: 'none', fontSize: 20, cursor: 'pointer', color: 'var(--text-secondary)' }}>×</button>
        </div>

        {/* Steps list */}
        <div style={{ flex: 1, overflowY: 'auto', padding: '16px 24px' }}>
          {error && <div style={{ background: 'rgba(226,68,92,0.12)', color: '#e2445c', borderRadius: 6, padding: '8px 12px', fontSize: 12, marginBottom: 12 }}>{error}</div>}

          {steps.length === 0 && (
            <div style={{ color: 'var(--text-secondary)', fontSize: 13, textAlign: 'center', padding: '24px 0' }}>
              No steps yet. Click "Add Step" to configure.
            </div>
          )}

          {/* Column headers */}
          {steps.length > 0 && (
            <div style={{ display: 'grid', gridTemplateColumns: '28px 1fr 160px 80px 70px 28px', gap: 8, alignItems: 'center', padding: '0 0 6px', borderBottom: '1px solid var(--border-color)', marginBottom: 8 }}>
              <span />
              <span style={{ fontSize: 11, color: 'var(--text-secondary)', fontWeight: 600 }}>STEP NAME</span>
              <span style={{ fontSize: 11, color: 'var(--text-secondary)', fontWeight: 600 }}>DATE COLUMN</span>
              <span style={{ fontSize: 11, color: 'var(--text-secondary)', fontWeight: 600 }} title="Days until the NEXT step starts">DAYS→NEXT</span>
              <span style={{ fontSize: 11, color: 'var(--text-secondary)', fontWeight: 600 }}>ANCHOR</span>
              <span />
            </div>
          )}

          {steps.map((step, idx) => (
            <div
              key={idx}
              draggable
              onDragStart={e => handleDragStart(e, idx)}
              onDragOver={e => handleDragOver(e, idx)}
              onDragEnd={handleDragEnd}
              style={{
                display: 'grid', gridTemplateColumns: '28px 1fr 160px 80px 70px 28px',
                gap: 8, alignItems: 'center', marginBottom: 6,
                padding: '6px 4px', borderRadius: 6,
                background: step.is_anchor ? 'rgba(0,200,117,0.07)' : 'transparent',
                border: step.is_anchor ? '1px solid rgba(0,200,117,0.3)' : '1px solid transparent',
              }}
            >
              {/* Drag handle */}
              <span style={{ color: 'var(--text-muted)', cursor: 'grab', userSelect: 'none', textAlign: 'center', fontSize: 14 }}>⠿</span>

              {/* Step name */}
              <input
                value={step.step_name}
                onChange={e => updateStep(idx, 'step_name', e.target.value)}
                style={{ padding: '5px 8px', border: '1px solid var(--border-color)', borderRadius: 4, fontSize: 12, color: 'var(--text-primary)', background: 'var(--bg-primary)' }}
              />

              {/* Column mapping */}
              <select
                value={step.column_id || ''}
                onChange={e => updateStep(idx, 'column_id', parseInt(e.target.value) || '')}
                style={{ padding: '5px 8px', border: '1px solid var(--border-color)', borderRadius: 4, fontSize: 12, color: 'var(--text-primary)', background: 'var(--bg-primary)' }}
              >
                <option value="">— select column —</option>
                {dateColumns.map(c => (
                  <option key={c.id} value={c.id}>{c.title}</option>
                ))}
              </select>

              {/* Duration */}
              <div style={{ display: 'flex', alignItems: 'center', gap: 3 }}>
                <input
                  type="number" min={0}
                  value={step.duration_days}
                  onChange={e => updateStep(idx, 'duration_days', Math.max(0, parseInt(e.target.value) || 0))}
                  style={{ width: '100%', padding: '5px 6px', border: '1px solid var(--border-color)', borderRadius: 4, fontSize: 12, color: 'var(--text-primary)', background: 'var(--bg-primary)' }}
                />
              </div>

              {/* Anchor radio */}
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                <input
                  type="radio" name="anchor"
                  checked={!!step.is_anchor}
                  onChange={() => updateStep(idx, 'is_anchor', true)}
                  title="Set as anchor step"
                  style={{ cursor: 'pointer', accentColor: '#00c875' }}
                />
              </div>

              {/* Delete */}
              <button
                onClick={() => removeStep(idx)}
                style={{ border: 'none', background: 'none', color: 'var(--text-muted)', fontSize: 16, cursor: 'pointer', lineHeight: 1 }}
                onMouseEnter={e => e.currentTarget.style.color = '#e2445c'}
                onMouseLeave={e => e.currentTarget.style.color = 'var(--text-muted)'}
              >×</button>
            </div>
          ))}

          {steps.length >= 2 && (() => {
            const anchorIdx = steps.findIndex(s => s.is_anchor);
            const before = anchorIdx;
            const after  = steps.length - 1 - anchorIdx;
            return (
              <div style={{ marginTop: 10, marginBottom: 4, padding: '7px 10px', background: 'var(--bg-secondary)', borderRadius: 6, fontSize: 11, color: 'var(--text-secondary)', display: 'flex', alignItems: 'center', gap: 6 }}>
                <span>⚓ Anchor = your known date.</span>
                <span style={{ color: '#9b72f5' }}>← Backward fills {before} step{before !== 1 ? 's' : ''} before it</span>
                <span>·</span>
                <span style={{ color: '#00c875' }}>→ Forward fills {after} step{after !== 1 ? 's' : ''} after it</span>
                {before === 0 && <span style={{ color: '#fdab3d', fontWeight: 600 }}>⚠ Move ⚓ down for backward to work.</span>}
                {after === 0 && <span style={{ color: '#fdab3d', fontWeight: 600 }}>⚠ Move ⚓ up for forward to work.</span>}
              </div>
            );
          })()}

          <button
            onClick={addStep}
            style={{
              marginTop: 8, padding: '6px 14px', background: 'none',
              border: '1.5px dashed var(--border-color)', borderRadius: 6,
              color: 'var(--text-secondary)', fontSize: 13, cursor: 'pointer', width: '100%',
            }}
            onMouseEnter={e => { e.currentTarget.style.borderColor = '#9b72f5'; e.currentTarget.style.color = '#9b72f5'; }}
            onMouseLeave={e => { e.currentTarget.style.borderColor = 'var(--text-muted)'; e.currentTarget.style.color = 'var(--text-secondary)'; }}
          >
            + Add Step
          </button>
        </div>

        {/* Footer */}
        <div style={{ padding: '12px 24px', borderTop: '1px solid var(--border-color)', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <div style={{ fontSize: 12, color: 'var(--text-secondary)' }}>
            Total project duration:&nbsp;
            <span style={{ fontWeight: 700, color: 'var(--text-primary)' }}>{totalDays} days</span>
          </div>
          <div style={{ display: 'flex', gap: 8 }}>
            <button onClick={onClose} style={{ padding: '7px 16px', border: '1px solid var(--border-color)', borderRadius: 6, fontSize: 13, cursor: 'pointer', color: 'var(--text-secondary)', background: 'var(--bg-primary)' }}>
              Cancel
            </button>
            <button
              onClick={handleSave}
              disabled={saving || loading}
              style={{ padding: '7px 18px', background: '#9b72f5', color: '#fff', border: 'none', borderRadius: 6, fontSize: 13, fontWeight: 600, cursor: 'pointer', opacity: (saving || loading) ? 0.7 : 1 }}
            >
              {saving ? 'Saving…' : 'Save Template'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
