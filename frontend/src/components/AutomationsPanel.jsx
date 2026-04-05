import React, { useState, useEffect, useRef } from 'react';
import { getAutomations, createAutomation, updateAutomation, deleteAutomation, getBoardMembers } from '../api';
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
    { value: 'send_email',    label: '✉️ Send email' },
  ],
  item_created: [
    { value: 'set_status',    label: 'Set status to…' },
    { value: 'assign_person', label: '👤 Assign to person / owner' },
    { value: 'notify',        label: 'Show notification' },
    { value: 'send_email',    label: '✉️ Send email' },
  ],
  date_arrives: [
    { value: 'notify',     label: 'Show notification' },
    { value: 'send_email', label: '✉️ Send email' },
  ],
  email_received: [
    { value: 'create_item_in_group', label: 'Create item in group' },
  ],
};

const sel   = { width: '100%', border: '1px solid #ddd', borderRadius: 6, padding: '7px 10px', fontSize: 13, background: '#fff' };
const inp   = { width: '100%', border: '1px solid #ddd', borderRadius: 6, padding: '7px 10px', fontSize: 13, boxSizing: 'border-box' };
const label = { fontSize: 11, fontWeight: 700, color: '#888', display: 'block', marginBottom: 4, textTransform: 'uppercase', letterSpacing: 0.5 };

// ── Variable token chip ───────────────────────────────────────────────────────
function TokenChip({ token, onInsert }) {
  return (
    <button
      type="button"
      onClick={() => onInsert(token)}
      title={`Insert ${token}`}
      style={{
        padding: '3px 8px', fontSize: 11, borderRadius: 4, cursor: 'pointer',
        background: '#e3f0ff', color: '#0073ea', border: '1px solid #b3d4ff',
        fontWeight: 600, whiteSpace: 'nowrap',
      }}
    >
      {token}
    </button>
  );
}

// ── Variable token bar for subject / body ─────────────────────────────────────
// Inserts the token at the current cursor position of the focused input/textarea.
function VariableTokenBar({ columns, activeRef, onInsert }) {
  const builtIn = ['{Item Name}', '{Group Name}', '{Board Name}'];
  const colTokens = columns.map(c => `{${c.title}}`);
  const all = [...builtIn, ...colTokens];

  return (
    <div style={{ marginBottom: 6 }}>
      <p style={{ ...label, marginBottom: 4 }}>Insert variable token</p>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
        {all.map(t => (
          <TokenChip key={t} token={t} onInsert={onInsert} />
        ))}
      </div>
    </div>
  );
}

// ── Automation summary line ───────────────────────────────────────────────────
function Summary({ auto, columns, groups }) {
  const trig = TRIGGERS.find(t => t.value === auto.trigger_type);
  const cfg  = auto.trigger_config || {};
  const acfg = auto.action_config  || {};
  const allActions = Object.values(ACTIONS_FOR).flat();
  const act  = allActions.find(a => a.value === auto.action_type);

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
  if (auto.action_type === 'assign_person') {
    const col = columns.find(c => String(c.id) === String(acfg.column_id));
    actText = `Assign "${acfg.user_name || '?'}" → ${col?.title || 'person column'}`;
  }
  if (auto.action_type === 'notify')     actText = `Notify: "${acfg.message || '…'}"`;
  if (auto.action_type === 'send_email') {
    const toType = acfg.to_type || 'specific';
    if (toType === 'board_members') actText = 'Email → All board members';
    else if (toType === 'item_owner') {
      const col = columns.find(c => String(c.id) === String(acfg.to_column_id));
      actText = `Email → Item owner (${col?.title || 'person column'})`;
    } else if (toType === 'email_column') {
      const col = columns.find(c => String(c.id) === String(acfg.to_column_id));
      actText = `Email → ${col?.title || 'email column'}`;
    } else {
      actText = `Email → ${acfg.to || '…'}`;
    }
  }
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
function AutomationForm({ boardId, columns, groups, members, onSave, onCancel, initial }) {
  const [name,          setName]          = useState(initial?.name || '');
  const [triggerType,   setTriggerType]   = useState(initial?.trigger_type || 'status_change');
  const [triggerConfig, setTriggerConfig] = useState(initial?.trigger_config || {});
  const [actionType,    setActionType]    = useState(initial?.action_type || 'move_to_group');
  const [actionConfig,  setActionConfig]  = useState(initial?.action_config || {});

  // Track which field (subject or body) was last focused for token insertion
  const subjectRef = useRef(null);
  const bodyRef    = useRef(null);
  const lastFocusedRef = useRef(null); // 'subject' | 'body'

  const statusCols = columns.filter(c => c.type === 'status');
  const dateCols   = columns.filter(c => c.type === 'date');

  const setTC = (patch) => setTriggerConfig(c => ({ ...c, ...patch }));
  const setAC = (patch) => setActionConfig(c => ({ ...c, ...patch }));

  const trigStatusCol     = statusCols.find(c => String(c.id) === String(triggerConfig.column_id));
  const trigStatusOptions = trigStatusCol?.settings?.options || [];
  const actStatusCol      = statusCols.find(c => String(c.id) === String(actionConfig.column_id));
  const actStatusOptions  = actStatusCol?.settings?.options || [];
  const availableActions  = ACTIONS_FOR[triggerType] || [];

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

  // Insert token at the cursor position of the last-focused field (subject or body)
  const handleInsertToken = (token) => {
    const field = lastFocusedRef.current;
    if (!field) return;

    const el = field === 'subject' ? subjectRef.current : bodyRef.current;
    if (!el) return;

    const start = el.selectionStart ?? el.value.length;
    const end   = el.selectionEnd   ?? el.value.length;
    const before = el.value.slice(0, start);
    const after  = el.value.slice(end);
    const newVal = before + token + after;

    if (field === 'subject') {
      setAC({ subject: newVal });
      setTimeout(() => {
        el.focus();
        el.setSelectionRange(start + token.length, start + token.length);
      }, 0);
    } else {
      setAC({ body: newVal });
      setTimeout(() => {
        el.focus();
        el.setSelectionRange(start + token.length, start + token.length);
      }, 0);
    }
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

        {/* assign_person */}
        {actionType === 'assign_person' && (
          <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
            <div style={{ flex: 1 }}>
              <p style={label}>Person / Owner column</p>
              {columns.filter(c => c.type === 'person').length === 0 ? (
                <div style={{ fontSize: 11, color: '#e2445c', padding: '6px 10px', background: '#fff0f2', borderRadius: 6 }}>
                  No person columns found on this board. Add a People/Owner column first.
                </div>
              ) : (
                <select value={actionConfig.column_id || ''} onChange={e => setAC({ column_id: e.target.value })} style={sel}>
                  <option value="">Select person column…</option>
                  {columns.filter(c => c.type === 'person').map(c => (
                    <option key={c.id} value={c.id}>{c.title}</option>
                  ))}
                </select>
              )}
            </div>
            <div style={{ flex: 1 }}>
              <p style={label}>Assign to</p>
              {members.length === 0 ? (
                <div style={{ fontSize: 11, color: '#888', padding: '6px 10px', background: '#f5f5f5', borderRadius: 6 }}>
                  No board members found.
                </div>
              ) : (
                <select value={actionConfig.user_name || ''} onChange={e => setAC({ user_name: e.target.value })} style={sel}>
                  <option value="">Select member…</option>
                  {members.map(m => (
                    <option key={m.id} value={m.name}>{m.name}</option>
                  ))}
                </select>
              )}
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

        {/* send_email — with variable tokens */}
        {actionType === 'send_email' && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginTop: 8 }}>
            {/* Info banner */}
            <div style={{ background: '#fff8e1', border: '1px solid #ffe58f', borderRadius: 6, padding: '7px 10px', fontSize: 11, color: '#7a5a00', lineHeight: 1.5 }}>
              ✉️ Email is sent via the WorkBoard SMTP server. Use the <strong>From</strong> address set below for this board, or the system default.
              <br/>Click a token below to insert it in the Subject or Body at the cursor position.
            </div>

            {/* Recipient type selector */}
            <div>
              <p style={label}>Send to</p>
              <select
                value={actionConfig.to_type || 'specific'}
                onChange={e => setAC({ to_type: e.target.value, to: '', to_column_id: '' })}
                style={sel}
              >
                <option value="specific">Specific email address</option>
                <option value="item_owner">Item owner(s)</option>
                <option value="email_column">Email column value</option>
                <option value="board_members">All board members</option>
              </select>
            </div>

            {/* Specific email address input */}
            {(!actionConfig.to_type || actionConfig.to_type === 'specific') && (
              <div>
                <p style={label}>Email address</p>
                <input
                  value={actionConfig.to || ''}
                  onChange={e => setAC({ to: e.target.value })}
                  placeholder="someone@example.com (comma-separate for multiple)"
                  style={inp}
                  type="email"
                />
              </div>
            )}

            {/* Item owner — pick which person column */}
            {actionConfig.to_type === 'item_owner' && (
              <div>
                <p style={label}>Person column</p>
                {columns.filter(c => c.type === 'person').length === 0 ? (
                  <div style={{ fontSize: 11, color: '#e2445c', padding: '6px 10px', background: '#fff0f2', borderRadius: 6 }}>
                    No person columns found on this board. Add a People/Owner column first.
                  </div>
                ) : (
                  <select
                    value={actionConfig.to_column_id || ''}
                    onChange={e => setAC({ to_column_id: e.target.value })}
                    style={sel}
                  >
                    <option value="">Select person column…</option>
                    {columns.filter(c => c.type === 'person').map(c => (
                      <option key={c.id} value={c.id}>{c.title}</option>
                    ))}
                  </select>
                )}
                <p style={{ fontSize: 10, color: '#888', margin: '4px 0 0' }}>
                  Email will be sent to the user(s) assigned in this column.
                </p>
              </div>
            )}

            {/* Email column — pick which column holds the email address */}
            {actionConfig.to_type === 'email_column' && (
              <div>
                <p style={label}>Email column</p>
                <select
                  value={actionConfig.to_column_id || ''}
                  onChange={e => setAC({ to_column_id: e.target.value })}
                  style={sel}
                >
                  <option value="">Select column…</option>
                  {columns.filter(c => c.type === 'email' || c.type === 'text').map(c => (
                    <option key={c.id} value={c.id}>{c.title}</option>
                  ))}
                </select>
                <p style={{ fontSize: 10, color: '#888', margin: '4px 0 0' }}>
                  The value of this column (email address) will be used as the recipient.
                </p>
              </div>
            )}

            {/* Board members — no extra config */}
            {actionConfig.to_type === 'board_members' && (
              <div style={{ background: '#e8f7ee', border: '1px solid #b7e4cd', borderRadius: 6, padding: '8px 10px', fontSize: 11, color: '#037f4c' }}>
                ✓ Email will be sent to all members of this board.
              </div>
            )}

            {/* Variable tokens — click to insert at cursor */}
            <div style={{ background: '#f0f4ff', borderRadius: 6, padding: '8px 10px' }}>
              <VariableTokenBar
                columns={columns}
                onInsert={handleInsertToken}
              />
              <p style={{ fontSize: 10, color: '#888', margin: '4px 0 0' }}>
                Click Subject or Body first, then click a token to insert it at the cursor.
              </p>
            </div>

            {/* Subject */}
            <div>
              <p style={label}>Subject</p>
              <input
                ref={subjectRef}
                value={actionConfig.subject || ''}
                onChange={e => setAC({ subject: e.target.value })}
                onFocus={() => { lastFocusedRef.current = 'subject'; }}
                placeholder="e.g. Item {Item Name} is now {Status}"
                style={inp}
              />
            </div>

            {/* Body */}
            <div>
              <p style={label}>Body</p>
              <textarea
                ref={bodyRef}
                value={actionConfig.body || ''}
                onChange={e => setAC({ body: e.target.value })}
                onFocus={() => { lastFocusedRef.current = 'body'; }}
                rows={4}
                placeholder={`Hi,\n\nItem "{Item Name}" has been updated.\nStatus: {Status}\nOwner: {Owner}\nDue Date: {Due Date}\n\nBoard: {Board Name}`}
                style={{ ...inp, resize: 'vertical' }}
              />
            </div>

            {/* Live preview */}
            {(actionConfig.subject || actionConfig.body) && (
              <div style={{ background: '#f7f7f7', border: '1px solid #e0e0e0', borderRadius: 6, padding: '8px 10px', fontSize: 11, color: '#555' }}>
                <strong style={{ display: 'block', marginBottom: 4, color: '#323338' }}>Preview (tokens shown as-is — resolved at send time)</strong>
                {actionConfig.subject && <div><strong>Subject:</strong> {actionConfig.subject}</div>}
                {actionConfig.body    && <div style={{ marginTop: 4, whiteSpace: 'pre-wrap' }}><strong>Body:</strong> {actionConfig.body}</div>}
              </div>
            )}
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

// ── Board email settings section ──────────────────────────────────────────────
function BoardEmailSettings({ emailFrom, onChange }) {
  const [draft, setDraft]   = useState(emailFrom || '');
  const [saving, setSaving] = useState(false);
  const toast = useToast();

  const handleSave = async () => {
    setSaving(true);
    try {
      await onChange(draft.trim() || null);
      toast('Board sender email saved', 'success');
    } catch {
      toast('Failed to save sender email', 'error');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div style={{ background: '#f7f8fc', border: '1.5px solid #e0e0e0', borderRadius: 10, padding: 16, marginBottom: 16 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 10 }}>
        <span style={{ fontSize: 16 }}>✉️</span>
        <div>
          <div style={{ fontWeight: 700, fontSize: 13, color: '#323338' }}>Board Sender Email</div>
          <div style={{ fontSize: 11, color: '#888', marginTop: 1 }}>
            Outbound automation emails for this board will be sent from this address.
            Leave blank to use the system default.
          </div>
        </div>
      </div>
      <div style={{ display: 'flex', gap: 8 }}>
        <input
          value={draft}
          onChange={e => setDraft(e.target.value)}
          placeholder="e.g. board-alerts@ddecor.com (leave blank for system default)"
          style={{ ...inp, flex: 1 }}
          type="email"
        />
        <button
          onClick={handleSave}
          disabled={saving}
          style={{
            padding: '7px 16px', background: '#0073ea', color: '#fff',
            borderRadius: 6, fontWeight: 700, fontSize: 13, cursor: 'pointer',
            opacity: saving ? 0.6 : 1, whiteSpace: 'nowrap',
          }}
        >
          {saving ? 'Saving…' : 'Save'}
        </button>
      </div>
      {draft.trim() && (
        <div style={{ marginTop: 6, fontSize: 11, color: '#555' }}>
          Outbound emails will use: <strong>{draft.trim()}</strong>
        </div>
      )}
    </div>
  );
}

// ── Main panel ────────────────────────────────────────────────────────────────
export default function AutomationsPanel({
  boardId, columns, groups,
  boardEmailFrom, onBoardEmailFromChange,
  onClose, onCountChange,
}) {
  const [automations, setAutomations] = useState([]);
  const [showForm,    setShowForm]    = useState(false);
  const [editingId,   setEditingId]   = useState(null);
  const [members,     setMembers]     = useState([]);
  const toast = useToast();

  const updateList = (list) => {
    setAutomations(list);
    onCountChange?.(list.filter(a => a.enabled).length);
  };

  useEffect(() => {
    getAutomations(boardId).then(r => updateList(r.data)).catch(() => {});
    getBoardMembers(boardId).then(r => setMembers(r.data || [])).catch(() => {});
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

  const emailRules      = automations.filter(a => a.trigger_type === 'email_received');
  const sendEmailRules  = automations.filter(a => a.action_type  === 'send_email');

  return (
    <div style={{
      position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.35)', zIndex: 400,
      display: 'flex', alignItems: 'flex-start', justifyContent: 'flex-end',
    }} onClick={onClose}>
      <div onClick={e => e.stopPropagation()} style={{
        background: '#fff', width: 520, height: '100vh', overflowY: 'auto',
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
          {/* Per-board sender email */}
          {onBoardEmailFromChange && (
            <BoardEmailSettings
              emailFrom={boardEmailFrom}
              onChange={onBoardEmailFromChange}
            />
          )}

          <button
            onClick={() => { setShowForm(true); setEditingId(null); }}
            style={{ width: '100%', padding: 10, background: '#0073ea', color: '#fff', borderRadius: 8, fontWeight: 700, marginBottom: 16, fontSize: 14, cursor: 'pointer' }}
          >
            + Add Automation
          </button>

          {/* Email routing hint */}
          {emailRules.length > 0 && (
            <div style={{ background: '#fff8e1', border: '1px solid #ffe58f', borderRadius: 8, padding: '8px 12px', marginBottom: 10, fontSize: 11, color: '#7a5a00', lineHeight: 1.5 }}>
              📧 <strong>{emailRules.length} email routing rule{emailRules.length > 1 ? 's' : ''}</strong> active on this board.
              Rules are checked in order — first match wins.
            </div>
          )}

          {/* Outbound email hint */}
          {sendEmailRules.length > 0 && (
            <div style={{ background: '#e8f7ee', border: '1px solid #b7e4cd', borderRadius: 8, padding: '8px 12px', marginBottom: 10, fontSize: 11, color: '#037f4c', lineHeight: 1.5 }}>
              ✉️ <strong>{sendEmailRules.length} send-email automation{sendEmailRules.length > 1 ? 's' : ''}</strong> active.
              Emails are sent via the WorkBoard SMTP server — item variables are resolved at send time.
            </div>
          )}

          {showForm && (
            <AutomationForm
              boardId={boardId} columns={columns} groups={groups} members={members}
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
                key={auto.id} boardId={boardId} columns={columns} groups={groups} members={members} initial={auto}
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
