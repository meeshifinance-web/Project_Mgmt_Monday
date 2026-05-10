import React, { useState, useEffect } from 'react';
import { useAutomation } from '../../hooks/useAutomation';
import StepTemplateConfig from './StepTemplateConfig';
import AutomationRuleConfig from './AutomationRuleConfig';
import DateCascadeIndicator from './DateCascadeIndicator';

/**
 * Slide-in side panel (420px) showing date cascade config for a board.
 *
 * Props:
 *   boardId      {number}
 *   boardName    {string}
 *   boardColumns {Array<{id, title, type}>}
 *   onClose      {Function}
 */
export default function DateCascadePanel({ boardId, boardName, boardColumns, onClose }) {
  const { fetchTemplates, fetchRules, deleteRule, updateRule, fetchLogs, loading } = useAutomation(boardId);

  const [steps,       setSteps]       = useState([]);
  const [rules,       setRules]       = useState([]);
  const [logs,        setLogs]        = useState([]);
  const [logsOpen,    setLogsOpen]    = useState(false);
  const [showTemplate, setShowTemplate] = useState(false);
  const [editRule,    setEditRule]    = useState(null); // null=closed, 'new'=new, {rule}=edit
  const [confirmDel,  setConfirmDel]  = useState(null); // ruleId to confirm delete

  const reload = () => {
    fetchTemplates().then(setSteps).catch(() => {});
    fetchRules().then(setRules).catch(() => {});
  };

  useEffect(() => { reload(); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const loadLogs = () => {
    if (!logsOpen) {
      fetchLogs().then(setLogs).catch(() => {});
    }
    setLogsOpen(v => !v);
  };

  const handleToggleRule = async (rule) => {
    try {
      const updated = await updateRule(rule.id, { is_active: !rule.is_active });
      setRules(prev => prev.map(r => r.id === rule.id ? { ...r, ...updated } : r));
    } catch { }
  };

  const handleDeleteRule = async (ruleId) => {
    try {
      await deleteRule(ruleId);
      setRules(prev => prev.filter(r => r.id !== ruleId));
    } catch { }
    setConfirmDel(null);
  };

  // Find anchor column from template (first marked is_anchor)
  const anchorStep    = steps.find(s => s.is_anchor);
  const anchorColId   = anchorStep?.column_id || null;
  const totalDays     = steps.reduce((sum, s) => sum + (s.duration_days || 0), 0);
  const dateColumns   = (boardColumns || []).filter(c => c.type === 'date');

  const overlay = { position: 'fixed', inset: 0, zIndex: 2000, display: 'flex', justifyContent: 'flex-end' };
  const panel = {
    width: 420, height: '100%',
    background: 'var(--bg-primary)',
    boxShadow: '-4px 0 24px rgba(0,0,0,0.18)',
    display: 'flex', flexDirection: 'column',
    animation: 'slideInRight 0.2s ease',
  };

  return (
    <>
      <div className="wb-side-panel-overlay" style={overlay} onClick={e => { if (e.target === e.currentTarget) onClose(); }}>
        <div className="wb-side-panel" style={panel}>
          {/* Header */}
          <div style={{ padding: '18px 20px 14px', borderBottom: '1px solid var(--border-color)', display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexShrink: 0 }}>
            <div>
              <div style={{ fontWeight: 700, fontSize: 16, color: 'var(--text-primary)' }}>📅 Date Cascade</div>
              <div style={{ fontSize: 12, color: 'var(--text-secondary)', marginTop: 2 }}>{boardName}</div>
            </div>
            <button onClick={onClose} style={{ border: 'none', background: 'none', fontSize: 22, cursor: 'pointer', color: 'var(--text-secondary)' }}>×</button>
          </div>

          {/* Scrollable body */}
          <div style={{ flex: 1, overflowY: 'auto', padding: '16px 20px' }}>

            {/* ── Step Template section ────────────────────────────────────── */}
            <section style={{ marginBottom: 24 }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
                <span style={{ fontWeight: 700, fontSize: 13, color: 'var(--text-primary)' }}>Step Template</span>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  {totalDays > 0 && (
                    <span style={{ background: 'rgba(155,114,245,0.15)', color: '#9b72f5', borderRadius: 8, padding: '2px 8px', fontSize: 11, fontWeight: 700 }}>
                      {totalDays}d total
                    </span>
                  )}
                  <button
                    onClick={() => setShowTemplate(true)}
                    style={{ padding: '4px 10px', border: '1px solid #9b72f5', color: '#9b72f5', borderRadius: 6, fontSize: 12, cursor: 'pointer', background: 'none' }}
                  >
                    {steps.length ? 'Edit' : 'Configure'}
                  </button>
                </div>
              </div>

              {steps.length === 0 ? (
                <div style={{ background: 'var(--bg-secondary)', borderRadius: 8, padding: '16px', textAlign: 'center', color: 'var(--text-secondary)', fontSize: 12 }}>
                  No template configured. Click Configure to set up step dates.
                </div>
              ) : (
                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
                  <thead>
                    <tr style={{ background: 'var(--bg-secondary)' }}>
                      <th style={{ padding: '5px 8px', textAlign: 'left', color: 'var(--text-secondary)', fontWeight: 600 }}>#</th>
                      <th style={{ padding: '5px 8px', textAlign: 'left', color: 'var(--text-secondary)', fontWeight: 600 }}>Step</th>
                      <th style={{ padding: '5px 8px', textAlign: 'left', color: 'var(--text-secondary)', fontWeight: 600 }}>Column</th>
                      <th style={{ padding: '5px 8px', textAlign: 'right', color: 'var(--text-secondary)', fontWeight: 600 }}>Days</th>
                    </tr>
                  </thead>
                  <tbody>
                    {steps.map(s => (
                      <tr key={s.id} style={{ borderBottom: '1px solid var(--border-color)', background: s.is_anchor ? 'rgba(0,200,117,0.05)' : 'transparent' }}>
                        <td style={{ padding: '5px 8px', color: 'var(--text-secondary)' }}>{s.step_order}</td>
                        <td style={{ padding: '5px 8px', color: 'var(--text-primary)', display: 'flex', alignItems: 'center', gap: 4 }}>
                          {s.is_anchor && <span title="Anchor step" style={{ color: '#00c875', fontSize: 10 }}>⚓</span>}
                          {s.step_name}
                        </td>
                        <td style={{ padding: '5px 8px', color: 'var(--text-secondary)' }}>{s.column_title || `col #${s.column_id}`}</td>
                        <td style={{ padding: '5px 8px', textAlign: 'right', color: 'var(--text-primary)' }}>{s.duration_days}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </section>

            {/* ── Automation Rules section ─────────────────────────────────── */}
            <section style={{ marginBottom: 24 }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
                <span style={{ fontWeight: 700, fontSize: 13, color: 'var(--text-primary)' }}>Cascade Rules</span>
                <button
                  onClick={() => setEditRule('new')}
                  disabled={steps.length === 0}
                  style={{ padding: '4px 10px', border: '1px solid #00c875', color: '#00c875', borderRadius: 6, fontSize: 12, cursor: steps.length ? 'pointer' : 'not-allowed', background: 'none', opacity: steps.length ? 1 : 0.5 }}
                  title={steps.length === 0 ? 'Configure a step template first' : ''}
                >
                  + Add Rule
                </button>
              </div>

              {rules.length === 0 ? (
                <div style={{ background: 'var(--bg-secondary)', borderRadius: 8, padding: '16px', textAlign: 'center', color: 'var(--text-secondary)', fontSize: 12 }}>
                  {steps.length === 0
                    ? 'Set up a step template first, then add cascade rules.'
                    : 'No rules yet. Add a rule to auto-fill dates.'}
                </div>
              ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                  {rules.map(rule => (
                    <div key={rule.id} style={{ border: '1px solid var(--border-color)', borderRadius: 8, padding: '10px 12px', background: rule.is_active ? 'var(--bg-primary)' : 'var(--bg-secondary)' }}>
                      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                        <span style={{ fontWeight: 600, fontSize: 13, color: rule.is_active ? 'var(--text-primary)' : 'var(--text-muted)' }}>{rule.rule_name}</span>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                          {/* Active toggle */}
                          <input type="checkbox" checked={!!rule.is_active} onChange={() => handleToggleRule(rule)}
                            style={{ cursor: 'pointer', accentColor: '#00c875', width: 15, height: 15 }} title={rule.is_active ? 'Deactivate' : 'Activate'} />
                          {/* Edit */}
                          <button onClick={() => setEditRule(rule)} style={{ border: 'none', background: 'none', fontSize: 13, cursor: 'pointer', color: 'var(--text-secondary)', padding: '2px 4px' }} title="Edit">✏️</button>
                          {/* Delete */}
                          {confirmDel === rule.id ? (
                            <>
                              <button onClick={() => handleDeleteRule(rule.id)} style={{ border: 'none', background: '#e2445c', color: '#fff', borderRadius: 4, fontSize: 11, cursor: 'pointer', padding: '2px 7px' }}>Delete</button>
                              <button onClick={() => setConfirmDel(null)} style={{ border: '1px solid var(--border-color)', background: 'none', borderRadius: 4, fontSize: 11, cursor: 'pointer', padding: '2px 7px' }}>Cancel</button>
                            </>
                          ) : (
                            <button onClick={() => setConfirmDel(rule.id)} style={{ border: 'none', background: 'none', fontSize: 13, cursor: 'pointer', color: 'var(--text-muted)', padding: '2px 4px' }} title="Delete"
                              onMouseEnter={e => e.currentTarget.style.color = '#e2445c'}
                              onMouseLeave={e => e.currentTarget.style.color = 'var(--text-muted)'}
                            >🗑</button>
                          )}
                        </div>
                      </div>
                      <div style={{ fontSize: 11, color: 'var(--text-secondary)', marginTop: 4 }}>
                        {rule.trigger_type === 'date_entry'
                          ? `When "${rule.trigger_column_title || `col #${rule.trigger_column_id}`}" is entered`
                          : `When status changes to "${rule.trigger_status_to}"`
                        }
                        {' → '}{rule.direction} from "{rule.anchor_column_title || `col #${rule.anchor_column_id}`}"
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </section>

            {/* ── Recent Activity (collapsible) ────────────────────────────── */}
            <section>
              <button
                onClick={loadLogs}
                style={{ display: 'flex', alignItems: 'center', gap: 6, background: 'none', border: 'none', cursor: 'pointer', padding: 0, color: 'var(--text-primary)', fontWeight: 700, fontSize: 13, marginBottom: logsOpen ? 10 : 0 }}
              >
                <span style={{ transition: 'transform 0.15s', display: 'inline-block', transform: logsOpen ? 'rotate(90deg)' : 'rotate(0deg)' }}>▶</span>
                Recent Cascade Activity
              </button>

              {logsOpen && (
                <div>
                  {loading && <div style={{ color: 'var(--text-secondary)', fontSize: 12 }}>Loading…</div>}
                  {!loading && logs.length === 0 && (
                    <div style={{ color: 'var(--text-secondary)', fontSize: 12, padding: '8px 0' }}>No cascade events yet.</div>
                  )}
                  {logs.map(log => (
                    <div key={log.id} style={{ borderBottom: '1px solid var(--border-color)', padding: '8px 0', fontSize: 12 }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                        <DateCascadeIndicator isAutoCascaded />
                        <span style={{ color: 'var(--text-primary)', fontWeight: 500 }}>{log.item_name || `Item #${log.item_id}`}</span>
                      </div>
                      <div style={{ color: 'var(--text-secondary)', marginTop: 2 }}>
                        Anchor: {log.anchor_column_title || `col #${log.anchor_column_id}`} = {log.anchor_date}
                        &nbsp;·&nbsp;{Object.keys(log.dates_calculated || {}).length} dates set
                        &nbsp;·&nbsp;{new Date(log.created_at).toLocaleString()}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </section>
          </div>
        </div>
      </div>

      {/* Step Template Config modal */}
      {showTemplate && (
        <StepTemplateConfig
          boardId={boardId}
          boardName={boardName}
          boardColumns={boardColumns}
          onSave={saved => { setSteps(saved); setShowTemplate(false); }}
          onClose={() => setShowTemplate(false)}
        />
      )}

      {/* Automation Rule Config modal */}
      {editRule && (
        <AutomationRuleConfig
          boardId={boardId}
          boardColumns={boardColumns}
          anchorColumnId={anchorColId}
          rule={editRule === 'new' ? null : editRule}
          onSave={saved => {
            setRules(prev =>
              prev.some(r => r.id === saved.id)
                ? prev.map(r => r.id === saved.id ? saved : r)
                : [...prev, saved]
            );
            setEditRule(null);
          }}
          onClose={() => setEditRule(null)}
        />
      )}
    </>
  );
}
