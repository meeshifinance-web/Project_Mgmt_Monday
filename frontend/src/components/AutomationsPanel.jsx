import React, { useState, useEffect } from 'react';
import { getAutomations, createAutomation, updateAutomation, deleteAutomation } from '../api';
import { useToast } from './Toast';

// ── Trigger definitions ───────────────────────────────────────────────────────
const TRIGGERS = [
  { value: 'status_change',  label: 'When status changes to…' },
  { value: 'item_created',   label: 'When a new item is created' },
  { value: 'date_arrives',   label: 'When a date column arrives' },
  { value: 'email_received', label: '📧 When an email is received with keyword' },
];

// Actions available per trigger
const ACTIONS_FOR = {
  status_change: [
    { value: 'move_to_group', label: 'Move item to group' },
    { value: 'set_status',    label: 'Set another status to…' },
    { value: 'notify',        label: 'Show notification' },
    { value: 'send_email',    label: 'Send email (Outlook)' },
  ],
  item_created: [
    { value: 'set_status', label: 'Set status to…' },
    { value: 'notify',     label: 'Show notification' },
    { value: 'send_email', label: 'Send email (Outlook)' },
  ],
  date_arrives: [
    { value: 'notify',     label: 'Show notification' },
    { value: 'send_email', label: 'Send email (Outlook)' },
  ],
  email_received: [
    { value: 'create_item_in_group', label: 'Create item in group' },
  ],
};

const sel = { width: '100%', border: '1px solid #ddd', borderRadius: 6, padding: '7px 10px', fontSize: 13, background: '#fff' };
const inp = { width: '100%', border: '1px solid #ddd', borderRadius: 6, padding: '7px 10px', fontSize: 13, boxSizing: 'border-box' };
const label = { fontSize: 11, fontWeight: 700, color: '#888', display: 'block', marginBottom: 4, textTransform: 'uppercase', letterSpacing: 0.5 };

// ── Automation summary line ───────────────────────────────────────────────────
function Summary({ auto, columns, groups }) {
  const trig = TRIGGERS.find(t => t.value === auto.trigger_type);
  const cfg = auto.trigger_config || {};
  const acfg = auto.action_config || {};
  const allActions = Object.values(ACTIONS_FOR).flat();
  const act = allActions.find(a => a.value === auto.action_type);

  let trigText = trig?.label || auto.trigger_type;
  if (auto.trigger_type === 'status_change') {
    const col = columns.find(c => String(c.id) === String(cfg.column_id));
    trigText = `${col?.title || 'Status'} → "${cfg.to_value || '?'}"`;
  }
  if (auto.trigger_type === 'date_arrives') {
    const col = columns.find(c => String(c.id) === String(cfg.column_id));
    trigText = `${col?.title || 'Date'} arrives`;
  }
  if (auto.trigger_type === 'email_received') {
    const field = cfg.match_field === 'body' ? 'body' : cfg.match_field === 'either' ? 'subject/body' : 'subject';
    trigText = `Email ${field} contains "${cfg.keyword || '?'}"`;
  }

  let actText = act?.label || auto.action_type;
  if (auto.action_type === 'move_to_group') {
    const g = groups.find(g => String(g.id) === String(acfg.target_group_id));
    actText = `Move to "${g?.name || 'group'}"`;
  }
  if (auto.action_type === 'set_status') {
    const col = columns.find(c => String(c.id) === String(acfg.column_id));
    actText = `Set "${col?.title || 'Status'}" → "${acfg.value || '?'}"`;
  }
  if (auto.action_type === 'notify') actText = `Notify: "${acfg.message || '…'}"`;
  if (auto.action_type === 'send_email') actText = `Email: ${acfg.to || '…'}`;
  if (auto.action_type === 'create_item_in_group') {
    const g = groups.find(g => String(g.id) === String(acfg.group_id));
    actText = `Create item in "${g?.name || 'first group'}"`;
  }

  return (
    <div style={{ fontSize: 12, color: '#555', marginTop: 4, display: 'flex', gap: 6, flexWrap: 'wrap' }}>
      <span style={{ background: '#e3f0ff', color: '#0073ea', borderRadius: 4, padding: '2px 8px', fontWeight: 600 }}>
        WHEN {trigText}
      </span>
      <span style={{ background: '#e8f7ee', color: '#037f4c', borderRadius: 4, padding: '2px 8px', fontWeight: 600 }}>
        THEN {actText}
      </span>
    </div>
  );
}

// ── Automation form ───────────────────────────────────────────────────────────
function AutomationForm({ boardId, columns, groups, onSave, onCancel, initial }) {
  const [name, setName]               = useState(initial?.name || '');
  const [triggerType, setTriggerType] = useState(initial?.trigger_type || 'status_change');
  const [triggerConfig, setTriggerConfig] = useState(initial?.trigger_config || {});
  const [actionType, setActionType]   = useState(initial?.action_type || 'move_to_group');
  const [actionConfig, setActionConfig]   = useState(initial?.action_config || {});

  const statusCols = columns.filter(c => c.type === 'status');
  const dateCols   = columns.filter(c => c.type === 'date');

  const setTC = (patch) => setTriggerConfig(c => ({ ...c, ...patch }));
  const setAC = (patch) => setActionConfig(c => ({ ...c, ...patch }));

  // Selected status column for trigger
  const trigStatusCol = statusCols.find(c => String(c.id) === String(triggerConfig.column_id));
  const trigStatusOptions = trigStatusCol?.settings?.options || [];

  // Selected status column for set_status action
  const actStatusCol = statusCols.find(c => String(c.id) === String(actionConfig.column_id));
  const actStatusOptions = actStatusCol?.settings?.options || [];

  // Available actions for current trigger
  const availableActions = ACTIONS_FOR[triggerType] || [];

  const handleTriggerChange = (val) => {
    setTriggerType(val);
    setTriggerConfig({});
    const firstAction = (ACTIONS_FOR[val] || [])[0]?.value || 'notify';
    setActionType(firstAction);
    setActionConfig({});
  };

  const handleSubmit = (e) => {
    e.preventDefault();
    const autoName = name.trim() || buildAutoName();
    onSave({ name: autoName, trigger_type: triggerType, trigger_config: triggerConfig, action_type: actionType, action_config: actionConfig });
  };

  const buildAutoName = () => {
    const t = TRIGGERS.find(t => t.value === triggerType);
    const a = availableActions.find(a => a.value === actionType);
    return `${t?.label} → ${a?.label}`;
  };

  return (
    <div style={{ background: '#f7f8fc', border: '1.5px solid #d0d0d0', borderRadius: 10, padding: 18, marginBottom: 14 }}>
      <p style={{ fontSize: 13, fontWeight: 700, color: '#323338', marginBottom: 14 }}>
        {initial ? 'Edit Automation' : 'New Automation'}
      </p>

      {/* WHEN section */}
      <div style={{ background: '#e3f0ff', borderRadius: 8, padding: '12px 14px', marginBottom: 12 }}>
        <p style={label}>⚡ WHEN</p>
        <select value={triggerType} onChange={e => handleTriggerChange(e.target.value)} style={sel}>
          {TRIGGERS.map(t => <option key={t.value} value={t.value}>{t.label}</option>)}
        </select>

        {/* status_change config */}
        {triggerType === 'status_change' && (
          <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
            <div style={{ flex: 1 }}>
              <p style={{ ...label, marginTop: 0 }}>Column</p>
              <select value={triggerConfig.column_id || ''} onChange={e => setTC({ column_id: e.target.value, to_value: '' })} style={sel}>
                <option value="">Select status column…</option>
                {statusCols.map(c => <option key={c.id} value={c.id}>{c.title}</option>)}
              </select>
            </div>
            <div style={{ flex: 1 }}>
              <p style={{ ...label, marginTop: 0 }}>Changes to</p>
              <select value={triggerConfig.to_value || ''} onChange={e => setTC({ to_value: e.target.value })} style={sel} disabled={!trigStatusCol}>
                <option value="">Select value…</option>
                {trigStatusOptions.map(o => (
                  <option key={o.label} value={o.label}>{o.label}</option>
                ))}
              </select>
            </div>
          </div>
        )}

        {/* date_arrives config */}
        {triggerType === 'date_arrives' && (
          <div style={{ marginTop: 8 }}>
            <p style={label}>Date column</p>
            <select value={triggerConfig.column_id || ''} onChange={e => setTC({ column_id: e.target.value })} style={sel}>
              <option value="">Select date column…</option>
              {dateCols.map(c => <option key={c.id} value={c.id}>{c.title}</option>)}
            </select>
          </div>
        )}

        {/* email_received config */}
        {triggerType === 'email_received' && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginTop: 8 }}>
            <div style={{ background: '#fff8e1', borderRadius: 6, padding: '8px 10px', fontSize: 11, color: '#7a5a00', lineHeight: 1.5 }}>
              📬 Emails sent to the WorkBoard mailbox are matched against these rules in order.
              The first matching rule wins — the email subject becomes the item name.
            </div>
            <div>
              <p style={label}>Match in</p>
              <select value={triggerConfig.match_field || 'subject'} onChange={e => setTC({ match_field: e.target.value })} style={sel}>
                <option value="subject">Subject line only</option>
                <option value="body">Email body only</option>
                <option value="either">Subject or body</option>
              </select>
            </div>
            <div>
              <p style={label}>Contains keyword</p>
              <input
                value={triggerConfig.keyword || ''}
                onChange={e => setTC({ keyword: e.target.value })}
                placeholder="e.g. repair, urgent, purchase order…"
                style={inp}
              />
            </div>
          </div>
        )}
      </div>

      {/* THEN section */}
      <div style={{ background: '#e8f7ee', borderRadius: 8, padding: '12px 14px', marginBottom: 12 }}>
        <p style={label}>✅ THEN</p>
        <select value={actionType} onChange={e => { setActionType(e.target.value); setActionConfig({}); }} style={sel}>
          {availableActions.map(a => <option key={a.value} value={a.value}>{a.label}</option>)}
        </select>

        {/* move_to_group */}
        {actionType === 'move_to_group' && (
          <div style={{ marginTop: 8 }}>
            <p style={label}>Target group</p>
            <select value={actionConfig.target_group_id || ''} onChange={e => setAC({ target_group_id: e.target.value })} style={sel}>
              <option value="">Select group…</option>
              {groups.map(g => <option key={g.id} value={g.id}>{g.name}</option>)}
            </select>
          </div>
        )}

        {/* set_status */}
        {actionType === 'set_status' && (
          <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
            <div style={{ flex: 1 }}>
              <p style={label}>Status column</p>
              <select value={actionConfig.column_id || ''} onChange={e => setAC({ column_id: e.target.value, value: '' })} style={sel}>
                <option value="">Select column…</option>
                {statusCols.map(c => <option key={c.id} value={c.id}>{c.title}</option>)}
              </select>
            </div>
            <div style={{ flex: 1 }}>
              <p style={label}>Set to</p>
              <select value={actionConfig.value || ''} onChange={e => setAC({ value: e.target.value })} style={sel} disabled={!actStatusCol}>
                <option value="">Select value…</option>
                {actStatusOptions.map(o => <option key={o.label} value={o.label}>{o.label}</option>)}
              </select>
            </div>
          </div>
        )}

        {/* notify */}
        {actionType === 'notify' && (
          <div style={{ marginTop: 8 }}>
            <p style={label}>Message</p>
            <input value={actionConfig.message || ''} onChange={e => setAC({ message: e.target.value })}
              placeholder="e.g. Item is now Done!" style={inp} />
          </div>
        )}

        {/* send_email */}
        {actionType === 'send_email' && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginTop: 8 }}>
            <div>
              <p style={label}>To (email)</p>
              <input value={actionConfig.to || ''} onChange={e => setAC({ to: e.target.value })} placeholder="someone@ddecor.com" style={inp} />
            </div>
            <div>
              <p style={label}>Subject</p>
              <input value={actionConfig.subject || ''} onChange={e => setAC({ subject: e.target.value })} placeholder="Subject…" style={inp} />
            </div>
            <div>
              <p style={label}>Body</p>
              <textarea value={actionConfig.body || ''} onChange={e => setAC({ body: e.target.value })}
                rows={3} placeholder="Email body…"
                style={{ ...inp, resize: 'vertical' }} />
            </div>
          </div>
        )}

        {/* create_item_in_group */}
        {actionType === 'create_item_in_group' && (
          <div style={{ marginTop: 8 }}>
            <p style={label}>Target group (in this board)</p>
            <select value={actionConfig.group_id || ''} onChange={e => setAC({ group_id: e.target.value })} style={sel}>
              <option value="">First group (default)</option>
              {groups.map(g => <option key={g.id} value={g.id}>{g.name}</option>)}
            </select>
          </div>
        )}
      </div>

      {/* Name + buttons */}
      <div style={{ marginBottom: 10 }}>
        <p style={label}>Automation name (optional)</p>
        <input value={name} onChange={e => setName(e.target.value)} placeholder={buildAutoName()}
          style={inp} />
      </div>
      <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
        <button type="button" onClick={onCancel} style={{ padding: '7px 16px', border: '1px solid #ddd', borderRadius: 6, fontSize: 13, cursor: 'pointer' }}>Cancel</button>
        <button type="button" onClick={handleSubmit} style={{ padding: '7px 16px', background: '#0073ea', color: '#fff', borderRadius: 6, fontWeight: 700, fontSize: 13, cursor: 'pointer' }}>Save</button>
      </div>
    </div>
  );
}

// ── Main panel ────────────────────────────────────────────────────────────────
export default function AutomationsPanel({ boardId, columns, groups, onClose, onCountChange }) {
  const [automations, setAutomations] = useState([]);
  const [showForm, setShowForm] = useState(false);
  const [editingId, setEditingId] = useState(null);
  const toast = useToast();

  const updateList = (list) => {
    setAutomations(list);
    onCountChange?.(list.filter(a => a.enabled).length);
  };

  useEffect(() => {
    getAutomations(boardId).then(r => updateList(r.data)).catch(() => {});
  }, [boardId]);

  const handleCreate = async (data) => {
    try {
      const r = await createAutomation({ ...data, board_id: boardId });
      updateList([r.data, ...automations]);
      setShowForm(false);
      toast('Automation created', 'success');
    } catch { toast('Failed to create automation', 'error'); }
  };

  const handleUpdate = async (id, data) => {
    try {
      const r = await updateAutomation(id, data);
      updateList(automations.map(x => x.id === id ? r.data : x));
      setEditingId(null);
      toast('Automation updated', 'success');
    } catch { toast('Failed to update automation', 'error'); }
  };

  const handleToggle = async (auto) => {
    try {
      const r = await updateAutomation(auto.id, { ...auto, enabled: !auto.enabled });
      updateList(automations.map(x => x.id === auto.id ? r.data : x));
    } catch { toast('Failed to toggle', 'error'); }
  };

  const handleDelete = async (id) => {
    if (!confirm('Delete this automation?')) return;
    try {
      await deleteAutomation(id);
      updateList(automations.filter(x => x.id !== id));
      toast('Automation deleted');
    } catch { toast('Failed to delete', 'error'); }
  };

  const emailRules = automations.filter(a => a.trigger_type === 'email_received');

  return (
    <div style={{
      position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.35)', zIndex: 400,
      display: 'flex', alignItems: 'flex-start', justifyContent: 'flex-end',
    }} onClick={onClose}>
      <div onClick={e => e.stopPropagation()} style={{
        background: '#fff', width: 500, height: '100vh', overflowY: 'auto',
        boxShadow: '-4px 0 24px rgba(0,0,0,0.12)', display: 'flex', flexDirection: 'column',
      }}>
        {/* Header */}
        <div style={{ padding: '20px 20px 16px', borderBottom: '1px solid #f0f0f0', display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexShrink: 0 }}>
          <div>
            <h2 style={{ fontSize: 16, fontWeight: 700, margin: 0 }}>⚡ Automations</h2>
            <p style={{ fontSize: 12, color: '#888', margin: '2px 0 0' }}>Rules that run automatically when conditions are met</p>
          </div>
          <button onClick={onClose} style={{ fontSize: 20, color: '#888' }}>×</button>
        </div>

        <div style={{ flex: 1, padding: '16px 20px', overflowY: 'auto' }}>
          <button
            onClick={() => { setShowForm(true); setEditingId(null); }}
            style={{ width: '100%', padding: 10, background: '#0073ea', color: '#fff', borderRadius: 8, fontWeight: 700, marginBottom: 16, fontSize: 14, cursor: 'pointer' }}
          >
            + Add Automation
          </button>

          {/* Email routing hint banner when rules exist */}
          {emailRules.length > 0 && (
            <div style={{ background: '#fff8e1', border: '1px solid #ffe58f', borderRadius: 8, padding: '8px 12px', marginBottom: 14, fontSize: 11, color: '#7a5a00', lineHeight: 1.5 }}>
              📧 <strong>{emailRules.length} email routing rule{emailRules.length > 1 ? 's' : ''}</strong> active on this board.
              Rules are checked in order — first match wins.
            </div>
          )}

          {showForm && (
            <AutomationForm
              boardId={boardId} columns={columns} groups={groups}
              onSave={handleCreate} onCancel={() => setShowForm(false)}
            />
          )}

          {automations.length === 0 && !showForm && (
            <div style={{ textAlign: 'center', padding: '60px 20px', color: '#aaa' }}>
              <div style={{ fontSize: 48, marginBottom: 12 }}>⚡</div>
              <div style={{ fontSize: 14, fontWeight: 600, marginBottom: 4 }}>No automations yet</div>
              <div style={{ fontSize: 12 }}>Click "+ Add Automation" to create your first rule</div>
            </div>
          )}

          {automations.map(auto => (
            editingId === auto.id ? (
              <AutomationForm
                key={auto.id} boardId={boardId} columns={columns} groups={groups} initial={auto}
                onSave={(data) => handleUpdate(auto.id, data)}
                onCancel={() => setEditingId(null)}
              />
            ) : (
              <div key={auto.id} style={{
                border: `1.5px solid ${auto.enabled ? '#e0e0e0' : '#f0f0f0'}`,
                borderRadius: 10, padding: '12px 14px', marginBottom: 10,
                background: auto.enabled ? '#fff' : '#fafafa',
              }}>
                <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 8 }}>
                  <div style={{ flex: 1 }}>
                    <div style={{ fontWeight: 700, fontSize: 13, color: auto.enabled ? '#323338' : '#aaa' }}>{auto.name}</div>
                    <Summary auto={auto} columns={columns} groups={groups} />
                  </div>
                  <div style={{ display: 'flex', gap: 6, alignItems: 'center', flexShrink: 0 }}>
                    <label style={{ display: 'flex', alignItems: 'center', gap: 4, cursor: 'pointer', fontSize: 12 }}>
                      <input type="checkbox" checked={auto.enabled} onChange={() => handleToggle(auto)} style={{ accentColor: '#00c875', cursor: 'pointer' }} />
                      <span style={{ color: auto.enabled ? '#037f4c' : '#aaa', fontWeight: 600 }}>{auto.enabled ? 'On' : 'Off'}</span>
                    </label>
                    <button onClick={() => { setEditingId(auto.id); setShowForm(false); }} style={{ color: '#0073ea', fontSize: 12, fontWeight: 600 }}>Edit</button>
                    <button onClick={() => handleDelete(auto.id)} style={{ color: '#e2445c', fontSize: 12, fontWeight: 600 }}>Delete</button>
                  </div>
                </div>
              </div>
            )
          ))}
        </div>
      </div>
    </div>
  );
}
