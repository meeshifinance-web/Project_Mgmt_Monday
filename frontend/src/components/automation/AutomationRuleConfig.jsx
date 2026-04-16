import React, { useState, useEffect } from 'react';
import { useAutomation } from '../../hooks/useAutomation';

/**
 * Form for creating or editing a single date cascade automation rule.
 *
 * Props:
 *   boardId      {number}
 *   boardColumns {Array<{id, title, type}>}
 *   anchorColumnId {number|null} — pre-fill from template anchor step
 *   rule         {object|null}   — if editing an existing rule
 *   onSave       {Function}      — called with saved rule
 *   onClose      {Function}
 */
export default function AutomationRuleConfig({ boardId, boardColumns, anchorColumnId, rule, onSave, onClose }) {
  const { createRule, updateRule, loading, error } = useAutomation(boardId);
  const dateColumns   = (boardColumns || []).filter(c => c.type === 'date');
  const statusColumns = (boardColumns || []).filter(c => c.type === 'status' || c.type === 'dropdown');

  // Derive status options for the currently-selected trigger column
  const getStatusOptions = (colId) => {
    if (!colId) return [];
    const col = (boardColumns || []).find(c => String(c.id) === String(colId));
    if (!col?.settings?.options) return [];
    return col.settings.options.map(o => (typeof o === 'string' ? { label: o } : o));
  };

  const [form, setForm] = useState({
    rule_name:           rule?.rule_name           || '',
    trigger_type:        rule?.trigger_type         || 'date_entry',
    trigger_column_id:   rule?.trigger_column_id    || '',
    trigger_status_from: rule?.trigger_status_from  || '',
    trigger_status_to:   rule?.trigger_status_to    || '',
    anchor_column_id:    rule?.anchor_column_id     || anchorColumnId || '',
    direction:           rule?.direction            || 'forward',
    is_active:           rule?.is_active !== false,
  });
  const [saving, setSaving] = useState(false);

  const set = (k, v) => setForm(f => ({ ...f, [k]: v }));

  const handleSave = async () => {
    if (!form.rule_name.trim()) { alert('Rule name is required.'); return; }
    if (!form.anchor_column_id) { alert('Anchor column is required.'); return; }
    if (form.trigger_type === 'date_entry' && !form.trigger_column_id) {
      alert('Select the date column that triggers the cascade.'); return;
    }
    if (form.trigger_type === 'status_change' && !form.trigger_status_to.trim()) {
      alert('Status "to" value is required.'); return;
    }
    setSaving(true);
    try {
      const payload = {
        ...form,
        trigger_column_id:  form.trigger_column_id  ? parseInt(form.trigger_column_id)  : null,
        anchor_column_id:   parseInt(form.anchor_column_id),
      };
      const saved = rule?.id
        ? await updateRule(rule.id, payload)
        : await createRule(payload);
      onSave?.(saved);
      onClose();
    } catch {
      // error shown from hook
    } finally {
      setSaving(false);
    }
  };

  const labelStyle = { fontSize: 12, fontWeight: 600, color: '#676879', marginBottom: 4, display: 'block' };
  const inputStyle = { width: '100%', padding: '7px 10px', border: '1px solid var(--border-color)', borderRadius: 6, fontSize: 13, color: 'var(--text-primary)', background: 'var(--bg-primary)', boxSizing: 'border-box' };

  return (
    <div style={{
      position: 'fixed', inset: 0, zIndex: 3100,
      background: 'rgba(0,0,0,0.45)', display: 'flex', alignItems: 'center', justifyContent: 'center',
    }}
      onClick={e => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div style={{
        background: 'var(--bg-primary)', borderRadius: 12,
        width: 480, boxShadow: '0 8px 32px rgba(0,0,0,0.25)',
        display: 'flex', flexDirection: 'column',
      }}>
        {/* Header */}
        <div style={{ padding: '18px 24px 14px', borderBottom: '1px solid var(--border-color)', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <span style={{ fontWeight: 700, fontSize: 15, color: 'var(--text-primary)' }}>
            {rule ? 'Edit Cascade Rule' : 'New Cascade Rule'}
          </span>
          <button onClick={onClose} style={{ border: 'none', background: 'none', fontSize: 20, cursor: 'pointer', color: '#676879' }}>×</button>
        </div>

        {/* Body */}
        <div style={{ padding: '20px 24px', display: 'flex', flexDirection: 'column', gap: 16 }}>
          {error && <div style={{ background: '#fff0f0', color: '#e2445c', borderRadius: 6, padding: '8px 12px', fontSize: 12 }}>{error}</div>}

          {/* Rule name */}
          <div>
            <label style={labelStyle}>RULE NAME</label>
            <input value={form.rule_name} onChange={e => set('rule_name', e.target.value)} placeholder="e.g. Cascade from Approval Date" style={inputStyle} />
          </div>

          {/* Trigger type */}
          <div>
            <label style={labelStyle}>TRIGGER</label>
            <div style={{ display: 'flex', gap: 12 }}>
              {[
                { value: 'date_entry',    label: '📅 Date entered' },
                { value: 'status_change', label: '🔄 Status changed' },
              ].map(opt => (
                <label key={opt.value} style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 13, cursor: 'pointer', color: 'var(--text-primary)' }}>
                  <input type="radio" name="trigger_type" value={opt.value}
                    checked={form.trigger_type === opt.value}
                    onChange={() => set('trigger_type', opt.value)}
                    style={{ accentColor: '#0073ea' }}
                  />
                  {opt.label}
                </label>
              ))}
            </div>
          </div>

          {/* Trigger details */}
          {form.trigger_type === 'date_entry' && (
            <div>
              <label style={labelStyle}>TRIGGER DATE COLUMN</label>
              <select value={form.trigger_column_id} onChange={e => set('trigger_column_id', e.target.value)} style={inputStyle}>
                <option value="">— select date column —</option>
                {dateColumns.map(c => <option key={c.id} value={c.id}>{c.title}</option>)}
              </select>
            </div>
          )}

          {form.trigger_type === 'status_change' && (
            <>
              <div>
                <label style={labelStyle}>TRIGGER STATUS COLUMN <span style={{ fontWeight: 400 }}>(optional — blank = any status column)</span></label>
                <select value={form.trigger_column_id} onChange={e => set('trigger_column_id', e.target.value)} style={inputStyle}>
                  <option value="">— any status column —</option>
                  {statusColumns.map(c => <option key={c.id} value={c.id}>{c.title}</option>)}
                </select>
              </div>
              {(() => {
                const opts = getStatusOptions(form.trigger_column_id);
                return (
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
                    <div>
                      <label style={labelStyle}>STATUS FROM <span style={{ fontWeight: 400 }}>(blank = any)</span></label>
                      {opts.length > 0 ? (
                        <select value={form.trigger_status_from} onChange={e => set('trigger_status_from', e.target.value)} style={inputStyle}>
                          <option value="">— any status —</option>
                          {opts.map(o => <option key={o.label} value={o.label}>{o.label}</option>)}
                        </select>
                      ) : (
                        <input value={form.trigger_status_from} onChange={e => set('trigger_status_from', e.target.value)} placeholder="e.g. Working on it" style={inputStyle} />
                      )}
                    </div>
                    <div>
                      <label style={labelStyle}>STATUS TO *</label>
                      {opts.length > 0 ? (
                        <select value={form.trigger_status_to} onChange={e => set('trigger_status_to', e.target.value)} style={inputStyle}>
                          <option value="">— select status —</option>
                          {opts.map(o => <option key={o.label} value={o.label}>{o.label}</option>)}
                        </select>
                      ) : (
                        <input value={form.trigger_status_to} onChange={e => set('trigger_status_to', e.target.value)} placeholder="e.g. Approved" style={inputStyle} />
                      )}
                    </div>
                  </div>
                );
              })()}
              <div style={{ fontSize: 11, color: '#676879', background: 'var(--bg-secondary)', borderRadius: 4, padding: '6px 10px' }}>
                Anchor date will be taken from the anchor column's current value, or today if empty.
              </div>
            </>
          )}

          {/* Anchor column */}
          <div>
            <label style={labelStyle}>ANCHOR DATE COLUMN</label>
            <select value={form.anchor_column_id} onChange={e => set('anchor_column_id', e.target.value)} style={inputStyle}>
              <option value="">— select anchor column —</option>
              {dateColumns.map(c => <option key={c.id} value={c.id}>{c.title}</option>)}
            </select>
          </div>

          {/* Direction */}
          <div>
            <label style={labelStyle}>CASCADE DIRECTION</label>
            <div style={{ display: 'flex', gap: 16 }}>
              {[
                { value: 'forward',  label: '→ Forward',  hint: 'fills steps after the anchor' },
                { value: 'backward', label: '← Backward', hint: 'fills steps before the anchor' },
              ].map(opt => (
                <label key={opt.value} style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 13, cursor: 'pointer', color: 'var(--text-primary)' }}>
                  <input type="radio" name="direction" value={opt.value}
                    checked={form.direction === opt.value}
                    onChange={() => set('direction', opt.value)}
                    style={{ accentColor: '#0073ea' }}
                  />
                  <span>{opt.label} <span style={{ fontSize: 11, color: '#676879' }}>({opt.hint})</span></span>
                </label>
              ))}
            </div>
            <div style={{ marginTop: 6, fontSize: 11, color: '#676879', background: 'var(--bg-secondary)', borderRadius: 4, padding: '5px 8px' }}>
              Forward: anchor should not be the last step. Backward: anchor should not be the first step.
            </div>
          </div>

          {/* Active toggle */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <input
              type="checkbox" id="is_active"
              checked={!!form.is_active}
              onChange={e => set('is_active', e.target.checked)}
              style={{ width: 16, height: 16, cursor: 'pointer', accentColor: '#0073ea' }}
            />
            <label htmlFor="is_active" style={{ fontSize: 13, cursor: 'pointer', color: 'var(--text-primary)' }}>Rule is active</label>
          </div>
        </div>

        {/* Footer */}
        <div style={{ padding: '12px 24px', borderTop: '1px solid var(--border-color)', display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
          <button onClick={onClose} style={{ padding: '7px 16px', border: '1px solid var(--border-color)', borderRadius: 6, fontSize: 13, cursor: 'pointer', color: '#676879', background: 'var(--bg-primary)' }}>
            Cancel
          </button>
          <button onClick={handleSave} disabled={saving || loading} style={{ padding: '7px 18px', background: '#0073ea', color: '#fff', border: 'none', borderRadius: 6, fontSize: 13, fontWeight: 600, cursor: 'pointer', opacity: (saving || loading) ? 0.7 : 1 }}>
            {saving ? 'Saving…' : rule ? 'Update Rule' : 'Create Rule'}
          </button>
        </div>
      </div>
    </div>
  );
}
