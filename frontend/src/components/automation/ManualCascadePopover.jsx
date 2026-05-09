import React, { useState, useEffect, useRef } from 'react';
import { getCascadeTemplates, triggerDateCascade } from '../../api';

/**
 * Small floating popover for manually running a date cascade on one item.
 *
 * Props:
 *   boardId    {number}
 *   itemId     {number}
 *   itemName   {string}
 *   itemValues {object}   — current column values for the item, keyed by column_id
 *   onResult   {Function} — called with { datesCalculated, stepsUpdated }
 *   onClose    {Function}
 */
export default function ManualCascadePopover({ boardId, itemId, itemName, itemValues, onResult, onClose }) {
  const [steps,     setSteps]     = useState([]);
  const [anchorId,  setAnchorId]  = useState('');
  const [anchorDate,setAnchorDate]= useState('');
  const [direction, setDirection] = useState('both');
  const [force,     setForce]     = useState(true);   // default true: manual run = explicit recalculate
  const [running,   setRunning]   = useState(false);
  const [result,    setResult]    = useState(null);
  const [error,     setError]     = useState(null);
  const ref = useRef();

  useEffect(() => {
    getCascadeTemplates(boardId).then(data => {
      setSteps(data || []);
      const anchor = data?.find(s => s.is_anchor);
      if (anchor) {
        setAnchorId(String(anchor.column_id));
        setAnchorDate(itemValues?.[anchor.column_id] || '');
        // Default: forward unless anchor is the last step
        const anchorIdx = data.findIndex(s => s.is_anchor);
        setDirection(anchorIdx === data.length - 1 ? 'backward' : 'forward');
      }
    }).catch(() => {});
  }, [boardId]);  // eslint-disable-line react-hooks/exhaustive-deps

  // Update date pre-fill + smart direction when anchor selection changes
  useEffect(() => {
    if (anchorId && steps.length > 0) {
      setAnchorDate(itemValues?.[parseInt(anchorId)] || '');
      const idx = steps.findIndex(s => String(s.column_id) === String(anchorId));
      setDirection(idx === steps.length - 1 ? 'backward' : 'forward');
    }
  }, [anchorId]);  // eslint-disable-line react-hooks/exhaustive-deps

  // Close on outside click
  useEffect(() => {
    const handler = e => { if (ref.current && !ref.current.contains(e.target)) onClose(); };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [onClose]);

  const handleRun = async () => {
    if (!anchorId || !anchorDate) { setError('Select an anchor step and date.'); return; }
    setError(null);
    setRunning(true);
    try {
      const res = await triggerDateCascade({
        boardId, itemId,
        anchorColumnId: parseInt(anchorId),
        anchorDate, direction,
        forceOverwrite: force,
      });
      setResult(res);
      onResult?.(res);
    } catch (err) {
      setError(err.response?.data?.error || err.message || 'Cascade failed');
    } finally {
      setRunning(false);
    }
  };

  const inputStyle = { width: '100%', padding: '6px 8px', border: '1px solid var(--border-color)', borderRadius: 5, fontSize: 12, color: 'var(--text-primary)', background: 'var(--bg-primary)', boxSizing: 'border-box' };
  const labelStyle = { fontSize: 11, fontWeight: 600, color: '#676879', marginBottom: 3, display: 'block' };

  return (
    <div ref={ref} style={{
      position: 'fixed', zIndex: 4000,
      bottom: 80, right: 24,
      width: 300,
      background: 'var(--bg-primary)',
      borderRadius: 10, boxShadow: '0 4px 24px rgba(0,0,0,0.22)',
      border: '1px solid var(--border-color)',
    }}>
      {/* Header */}
      <div style={{ padding: '12px 14px 10px', borderBottom: '1px solid var(--border-color)', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <div>
          <div style={{ fontWeight: 700, fontSize: 13, color: 'var(--text-primary)' }}>📅 Run Date Cascade</div>
          <div style={{ fontSize: 11, color: '#676879', marginTop: 1, maxWidth: 220, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{itemName}</div>
        </div>
        <button onClick={onClose} style={{ border: 'none', background: 'none', fontSize: 18, cursor: 'pointer', color: '#676879' }}>×</button>
      </div>

      <div style={{ padding: '12px 14px', display: 'flex', flexDirection: 'column', gap: 10 }}>
        {steps.length === 0 && (
          <div style={{ color: '#676879', fontSize: 12, textAlign: 'center', padding: '8px 0' }}>
            No step template configured for this board.<br />
            Use the 📅 Date Cascade toolbar button to set one up.
          </div>
        )}

        {steps.length > 0 && (
          <>
            {error && <div style={{ background: '#fff0f0', color: '#e2445c', borderRadius: 5, padding: '6px 9px', fontSize: 11 }}>{error}</div>}

            {!result ? (
              <>
                {/* Anchor step */}
                <div>
                  <label style={labelStyle}>ANCHOR STEP</label>
                  <select value={anchorId} onChange={e => setAnchorId(e.target.value)} style={inputStyle}>
                    <option value="">— select step —</option>
                    {steps.map((s, idx) => {
                      const before = idx;
                      const after  = steps.length - 1 - idx;
                      return (
                        <option key={s.id} value={s.column_id}>
                          {s.step_order}. {s.step_name}{s.is_anchor ? ' ★' : ''} ({before}↑ {after}↓)
                        </option>
                      );
                    })}
                  </select>
                  {anchorId && (() => {
                    const idx = steps.findIndex(s => String(s.column_id) === String(anchorId));
                    const before = idx;
                    const after  = steps.length - 1 - idx;
                    if (direction === 'backward' && before === 0)
                      return <div style={{ color: '#fdab3d', fontSize: 11, marginTop: 3 }}>⚠ No steps before this anchor — backward will have nothing to fill.</div>;
                    if (direction === 'forward' && after === 0)
                      return <div style={{ color: '#fdab3d', fontSize: 11, marginTop: 3 }}>⚠ No steps after this anchor — forward will have nothing to fill.</div>;
                    return null;
                  })()}
                </div>

                {/* Anchor date */}
                <div>
                  <label style={labelStyle}>ANCHOR DATE</label>
                  <input type="date" value={anchorDate} onChange={e => setAnchorDate(e.target.value)} style={inputStyle} />
                </div>

                {/* Direction */}
                <div>
                  <label style={labelStyle}>DIRECTION</label>
                  {(() => {
                    const idx = steps.findIndex(s => String(s.column_id) === String(anchorId));
                    const before = idx >= 0 ? idx : 0;
                    const after  = idx >= 0 ? steps.length - 1 - idx : 0;
                    const opts = [
                      { v: 'forward',  icon: '→', label: `Forward — fill ${after} step${after !== 1 ? 's' : ''} after anchor`,  disabled: after === 0 },
                      { v: 'backward', icon: '←', label: `Backward — fill ${before} step${before !== 1 ? 's' : ''} before anchor`, disabled: before === 0 },
                    ];
                    return (
                      <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
                        {opts.map(o => (
                          <label key={o.v} style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, cursor: o.disabled ? 'not-allowed' : 'pointer', color: o.disabled ? '#c5c7d0' : 'var(--text-primary)' }}>
                            <input type="radio" name="cascade_dir" value={o.v}
                              checked={direction === o.v}
                              onChange={() => !o.disabled && setDirection(o.v)}
                              disabled={o.disabled}
                              style={{ accentColor: '#9b72f5' }} />
                            {o.icon} {o.label}
                          </label>
                        ))}
                      </div>
                    );
                  })()}
                </div>

                {/* Force overwrite */}
                <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, cursor: 'pointer', color: '#676879' }}>
                  <input type="checkbox" checked={force} onChange={e => setForce(e.target.checked)} style={{ accentColor: '#e2445c' }} />
                  Recalculate all (overwrite manually-set dates)
                </label>

                {/* Apply */}
                <button
                  onClick={handleRun}
                  disabled={running || !anchorId || !anchorDate}
                  style={{
                    padding: '7px 0', background: '#9b72f5', color: '#fff',
                    border: 'none', borderRadius: 6, fontSize: 13, fontWeight: 600,
                    cursor: (running || !anchorId || !anchorDate) ? 'not-allowed' : 'pointer',
                    opacity: (running || !anchorId || !anchorDate) ? 0.65 : 1,
                  }}
                >
                  {running ? 'Running…' : '⚡ Apply Cascade'}
                </button>
              </>
            ) : (
              /* Result view */
              <div>
                {result.success ? (
                  <>
                    <div style={{ color: result.stepsUpdated > 0 ? '#00c875' : '#fdab3d', fontWeight: 700, fontSize: 13, marginBottom: 6 }}>
                      {result.stepsUpdated > 0 ? `✅ ${result.stepsUpdated} date${result.stepsUpdated !== 1 ? 's' : ''} updated` : '⚠ 0 dates updated'}
                    </div>
                    {result.note && (
                      <div style={{ fontSize: 11, color: '#676879', marginBottom: 6, background: 'var(--bg-secondary)', borderRadius: 4, padding: '5px 8px' }}>
                        {result.note}
                      </div>
                    )}
                    <div style={{ maxHeight: 120, overflowY: 'auto' }}>
                      {Object.entries(result.datesCalculated).map(([colId, date]) => {
                        const step = steps.find(s => String(s.column_id) === String(colId));
                        return (
                          <div key={colId} style={{ fontSize: 11, color: '#676879', padding: '2px 0' }}>
                            {step ? `${step.step_order}. ${step.step_name}` : `Column #${colId}`}: {date}
                          </div>
                        );
                      })}
                    </div>
                  </>
                ) : (
                  <div style={{ color: '#e2445c', fontSize: 12 }}>
                    {result.reason === 'no_template' && 'No step template configured.'}
                    {result.reason === 'anchor_not_found' && 'Anchor step not found in template.'}
                    {!result.reason && 'Cascade failed.'}
                  </div>
                )}
                <button
                  onClick={onClose}
                  style={{ marginTop: 10, padding: '6px 0', width: '100%', border: '1px solid var(--border-color)', borderRadius: 6, fontSize: 12, cursor: 'pointer', color: '#676879', background: 'none' }}
                >
                  Close
                </button>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
