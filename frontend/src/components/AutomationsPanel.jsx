import React, { useState, useEffect, useRef } from 'react';
import { getAutomations, createAutomation, updateAutomation, deleteAutomation, getBoardMembers, aiAutomation } from '../api';
import { useToast } from './Toast';
import { useThemeContext } from '../context/ThemeContext';
import { useAutomation } from '../hooks/useAutomation';
import StepTemplateConfig from './automation/StepTemplateConfig';
import AutomationRuleConfig from './automation/AutomationRuleConfig';
import DateCascadeIndicator from './automation/DateCascadeIndicator';
import EmptyState from './EmptyState';
import { toISODateTime } from '../utils/dateFormat';

// ── Trigger definitions ───────────────────────────────────────────────────────
const TRIGGERS = [
  { value: 'status_change',  label: 'When status changes to…' },
  { value: 'item_created',   label: 'When a new item is created' },
  { value: 'date_arrives',   label: 'When a date column arrives' },
];

// Actions available per trigger
const ACTIONS_FOR = {
  status_change: [
    { value: 'move_to_group', label: 'Move item to group' },
    { value: 'set_status',    label: 'Set another status to…' },
    { value: 'assign_person', label: '👤 Assign to person / owner' },
    { value: 'set_due_date',  label: '📅 Set due date to a weekday' },
    { value: 'notify',        label: 'Show notification' },
    { value: 'send_email',    label: '✉️ Send email' },
  ],
  item_created: [
    { value: 'set_status',    label: 'Set status to…' },
    { value: 'assign_person', label: '👤 Assign to person / owner' },
    { value: 'set_due_date',  label: '📅 Set due date to a weekday' },
    { value: 'notify',        label: 'Show notification' },
    { value: 'send_email',    label: '✉️ Send email' },
  ],
  date_arrives: [
    { value: 'set_status',   label: 'Set status to…' },
    { value: 'set_due_date', label: '📅 Set due date to a weekday' },
    { value: 'notify',       label: 'Show notification' },
    { value: 'send_email',   label: '✉️ Send email' },
  ],
};

const sel   = { width: '100%', border: '1.5px solid var(--border-color, #ddd)', borderRadius: 8, padding: '9px 12px', fontSize: 14, background: 'var(--input-bg, #fff)', color: 'var(--text-primary, #323338)' };
const inp   = { width: '100%', border: '1.5px solid var(--border-color, #ddd)', borderRadius: 8, padding: '9px 12px', fontSize: 14, boxSizing: 'border-box', background: 'var(--input-bg, #fff)', color: 'var(--text-primary, #323338)' };
const label = { fontSize: 12, fontWeight: 700, color: 'var(--text-secondary, #888)', display: 'block', marginBottom: 6, textTransform: 'uppercase', letterSpacing: 0.5 };

// ── Variable token chip ───────────────────────────────────────────────────────
function TokenChip({ token, onInsert }) {
  return (
    <button
      type="button"
      onClick={() => onInsert(token)}
      title={`Insert ${token}`}
      style={{
        padding: '3px 8px', fontSize: 11, borderRadius: 4, cursor: 'pointer',
        background: 'rgba(155,114,245,0.15)', color: '#9b72f5', border: '1px solid #b3d4ff',
        fontWeight: 600, whiteSpace: 'nowrap',
      }}
    >
      {token}
    </button>
  );
}

// ── Variable token bar for subject / body ─────────────────────────────────────
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

// ── Condition operators ────────────────────────────────────────────────────────
const CONDITION_OPERATORS = [
  { value: 'is',           label: 'is' },
  { value: 'is_not',       label: 'is not' },
  { value: 'contains',     label: 'contains' },
  { value: 'not_contains', label: "doesn't contain" },
  { value: 'is_empty',     label: 'is empty' },
  { value: 'is_not_empty', label: 'is not empty' },
  { value: 'gt',           label: 'greater than' },
  { value: 'lt',           label: 'less than' },
];
const NO_VALUE_OPS = new Set(['is_empty', 'is_not_empty']);
const PRIORITY_LABELS = ['Critical', 'High', 'Medium', 'Low'];
// Board default for status columns with no custom labels — must match
// ColumnCell.jsx so the automation form shows the same values as the board.
const DEFAULT_STATUS_LABELS = ['Not Started', 'In Progress', 'Done', 'Stuck'];

// ── Monday-style inline "fill in the blank" tokens ─────────────────────────────
const TONES = {
  trigger: { rgb: '155,114,245', solid: '#7c4dd0', solidDark: '#c4a7ff' },
  cond:    { rgb: '253,171,61',  solid: '#b3690a', solidDark: '#ffc566' },
  action:  { rgb: '0,200,117',   solid: '#037f4c', solidDark: '#5fe0a8' },
};

// Connecting word — the static parts of the sentence between the blanks.
function W({ children }) {
  return <span style={{ fontSize: 15, fontWeight: 600, color: 'var(--text-secondary, #555)' }}>{children}</span>;
}

// An inline dropdown styled as a colored token. Reads as part of the sentence.
function Blank({ value, onChange, options, placeholder = 'something', tone = 'trigger', isDark, minWidth = 92, title }) {
  const t = TONES[tone] || TONES.trigger;
  const filled = value !== '' && value != null;
  const solid = isDark ? t.solidDark : t.solid;
  return (
    <span style={{ position: 'relative', display: 'inline-flex', verticalAlign: 'middle' }} title={title}>
      <select
        value={filled ? String(value) : ''}
        onChange={e => onChange(e.target.value)}
        style={{
          appearance: 'none', WebkitAppearance: 'none', MozAppearance: 'none',
          minWidth, maxWidth: 260, padding: '4px 24px 4px 11px',
          borderRadius: 8, border: `1.5px solid rgba(${t.rgb}, ${filled ? 0.55 : 0.4})`,
          borderBottom: `2.5px solid rgba(${t.rgb}, ${filled ? 0.85 : 0.45})`,
          background: filled ? `rgba(${t.rgb}, ${isDark ? 0.24 : 0.13})` : (isDark ? 'rgba(255,255,255,0.05)' : '#fff'),
          color: filled ? solid : 'var(--text-muted, #9aa0ab)',
          fontSize: 15, fontWeight: 700, cursor: 'pointer', lineHeight: 1.3,
          fontStyle: filled ? 'normal' : 'italic',
        }}
      >
        <option value="" disabled hidden>{placeholder}</option>
        {options.map(o => <option key={o.value} value={o.value} style={{ fontStyle: 'normal' }}>{o.label}</option>)}
      </select>
      <span style={{ position: 'absolute', right: 9, top: '50%', transform: 'translateY(-50%)', pointerEvents: 'none', fontSize: 9, color: filled ? solid : '#9aa0ab' }}>▾</span>
    </span>
  );
}

// Free-text inline token (notify message, custom value).
function TextBlank({ value, onChange, placeholder = 'type here', tone = 'action', isDark, width = 180 }) {
  const t = TONES[tone] || TONES.action;
  const filled = !!(value && String(value).length);
  const solid = isDark ? t.solidDark : t.solid;
  return (
    <input
      value={value || ''} onChange={e => onChange(e.target.value)} placeholder={placeholder}
      style={{
        width, padding: '4px 11px', borderRadius: 8, verticalAlign: 'middle',
        border: `1.5px solid rgba(${t.rgb}, ${filled ? 0.55 : 0.4})`,
        borderBottom: `2.5px solid rgba(${t.rgb}, ${filled ? 0.85 : 0.45})`,
        background: filled ? `rgba(${t.rgb}, ${isDark ? 0.18 : 0.11})` : (isDark ? 'rgba(255,255,255,0.05)' : '#fff'),
        color: filled ? solid : undefined, fontSize: 15, fontWeight: 700, boxSizing: 'border-box',
      }}
    />
  );
}

const toOpts = (labels) => labels.map(l => ({ value: l, label: l }));

// Build member options, disambiguating duplicate display names by appending the
// email — this is what prevents the "two people called Anupam" mix-up.
function memberOpts(members) {
  const nameCounts = {};
  members.forEach(m => { nameCounts[m.name] = (nameCounts[m.name] || 0) + 1; });
  return members.map(m => ({
    value: String(m.id),
    label: nameCounts[m.name] > 1 && m.email ? `${m.name} · ${m.email}` : m.name,
  }));
}

// Recipe templates shown in the gallery (the entry point).
const TEMPLATES = [
  { id: 'notify_status',    icon: '🔔', title: 'Notify when a status changes', sentence: 'When a status changes to something, notify the team', trigger_type: 'status_change', action: 'notify' },
  { id: 'move_status',      icon: '➡️', title: 'Move item when status changes', sentence: 'When a status changes to something, move the item to a group', trigger_type: 'status_change', action: 'move_to_group' },
  { id: 'assign_status',    icon: '👤', title: 'Assign a person on status',     sentence: 'When a status changes to something, assign a person', trigger_type: 'status_change', action: 'assign_person' },
  { id: 'email_status',     icon: '✉️', title: 'Send an email on status',       sentence: 'When a status changes to something, send an email', trigger_type: 'status_change', action: 'send_email' },
  { id: 'setstatus_status', icon: '🔁', title: 'Set another status',            sentence: 'When a status changes, set another status to something', trigger_type: 'status_change', action: 'set_status' },
  { id: 'duedate_status',   icon: '📅', title: 'Set a due date on status',      sentence: 'When a status changes, set a due date', trigger_type: 'status_change', action: 'set_due_date' },
  { id: 'assign_create',    icon: '🆕', title: 'Assign when item is created',   sentence: 'When an item is created, assign a person', trigger_type: 'item_created', action: 'assign_person' },
  { id: 'status_create',    icon: '🟢', title: 'Set status on new item',        sentence: 'When an item is created, set a status to something', trigger_type: 'item_created', action: 'set_status' },
  { id: 'notify_date',      icon: '⏰', title: 'Notify when a date arrives',    sentence: 'When a date arrives, notify the team', trigger_type: 'date_arrives', action: 'notify' },
];

function templateRecipe(t) {
  return { name: '', trigger_type: t.trigger_type, trigger_config: {}, conditions: [], actions: [{ type: t.action, config: {} }] };
}

function parseArr(v) {
  if (Array.isArray(v)) return v;
  if (typeof v === 'string') { try { const p = JSON.parse(v); return Array.isArray(p) ? p : []; } catch { return []; } }
  return [];
}

// Column settings can arrive as a parsed object OR a JSON string depending on
// the load path — normalise both so option lookups never silently come back empty.
function colSettings(col) {
  const s = col?.settings;
  if (!s) return {};
  if (typeof s === 'string') { try { return JSON.parse(s) || {}; } catch { return {}; } }
  return s;
}

// Choice labels for a column (trigger value, set_status value, condition value).
// Handles options stored as plain strings OR { label } objects.
function colOptionLabels(col) {
  if (!col) return [];
  if (col.type === 'priority') return PRIORITY_LABELS;
  if (col.type === 'checkbox') return ['true', 'false'];
  const s = colSettings(col);
  const labels = Array.isArray(s.options) ? s.options.map(o => typeof o === 'string' ? o : (o?.label || o?.name)).filter(Boolean) : [];
  if (labels.length) return labels;
  // Match the board: status columns with no custom labels fall back to defaults.
  if (col.type === 'status') return DEFAULT_STATUS_LABELS;
  return [];
}

// Normalise a stored automation into a list of {type, config} actions.
function autoActions(auto) {
  const a = parseArr(auto.actions);
  if (a.length) return a.map(x => ({ type: x.type, config: x.config || {} }));
  if (auto.action_type) return [{ type: auto.action_type, config: auto.action_config || {} }];
  return [];
}

// ── Automation summary line ───────────────────────────────────────────────────
function actionText(type, acfg, columns, groups) {
  const allActions = Object.values(ACTIONS_FOR).flat();
  acfg = acfg || {};
  if (type === 'move_to_group') {
    const g = groups.find(g => String(g.id) === String(acfg.target_group_id));
    return `Move to "${g?.name || 'group'}"`;
  }
  if (type === 'set_status') {
    const col = columns.find(c => String(c.id) === String(acfg.column_id));
    return `Set "${col?.title || 'Status'}" → "${acfg.value || '?'}"`;
  }
  if (type === 'assign_person') {
    const col = columns.find(c => String(c.id) === String(acfg.column_id));
    return `Assign "${acfg.user_name || '?'}" → ${col?.title || 'person column'}`;
  }
  if (type === 'set_due_date') {
    const col = columns.find(c => String(c.id) === String(acfg.column_id));
    const dayNames = ['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday'];
    const dayLabel = dayNames[Number(acfg.weekday)] ?? '?';
    const wa = Number(acfg.weeks_ahead) || 1;
    const weekLabel = wa === 1 ? 'next' : wa === 2 ? 'in 2 weeks' : `in ${wa} weeks`;
    return `Set "${col?.title || 'date'}" → ${dayLabel} ${weekLabel}`;
  }
  if (type === 'notify') return `Notify: "${acfg.message || '…'}"`;
  if (type === 'send_email') {
    const toType = acfg.to_type || 'specific';
    if (toType === 'board_members') return 'Email → All board members';
    if (toType === 'item_owner') {
      const col = columns.find(c => String(c.id) === String(acfg.to_column_id));
      return `Email → Item owner (${col?.title || 'person column'})`;
    }
    if (toType === 'email_column') {
      const col = columns.find(c => String(c.id) === String(acfg.to_column_id));
      return `Email → ${col?.title || 'email column'}`;
    }
    return `Email → ${acfg.to || '…'}`;
  }
  if (type === 'create_item_in_group') {
    const g = groups.find(g => String(g.id) === String(acfg.group_id));
    const captured = [];
    if (acfg.from_email_column_id) captured.push('sender email');
    if (acfg.from_name_column_id) captured.push('sender name');
    const cap = captured.length ? ` · captures ${captured.join(' + ')}` : '';
    return `Create item in "${g?.name || 'first group'}"${cap}`;
  }
  return allActions.find(a => a.value === type)?.label || type;
}

function conditionText(cond, columns) {
  const col = columns.find(c => String(c.id) === String(cond.column_id));
  const opLabel = CONDITION_OPERATORS.find(o => o.value === cond.operator)?.label || cond.operator;
  const val = NO_VALUE_OPS.has(cond.operator) ? '' : ` "${cond.value ?? ''}"`;
  return `${col?.title || 'column'} ${opLabel}${val}`;
}

function Summary({ auto, columns, groups }) {
  const trig = TRIGGERS.find(t => t.value === auto.trigger_type);
  const cfg  = auto.trigger_config || {};
  const conditions = parseArr(auto.conditions);
  const actions = autoActions(auto);

  let trigText = trig?.label || auto.trigger_type;
  if (auto.trigger_type === 'status_change') {
    const col = columns.find(c => String(c.id) === String(cfg.column_id));
    trigText = `${col?.title || 'Status'} → "${cfg.to_value || '?'}"`;
  }
  if (auto.trigger_type === 'date_arrives') {
    const col = columns.find(c => String(c.id) === String(cfg.column_id));
    if (cfg.mode === 'after') {
      const minPast = parseInt(cfg.min_days_past, 10);
      trigText = Number.isFinite(minPast) && minPast > 0
        ? `${col?.title || 'Date'} is ${minPast}+ days past`
        : `${col?.title || 'Date'} has passed`;
    } else {
      const offset = parseInt(cfg.offset_days, 10) || 0;
      const when = offset === 0 ? 'arrives today' : `${offset} day${offset > 1 ? 's' : ''} before`;
      trigText = `${col?.title || 'Date'} ${when}`;
    }
  }
  if (auto.trigger_type === 'email_received') {
    const field = cfg.match_field === 'body' ? 'body' : cfg.match_field === 'either' ? 'subject/body' : 'subject';
    trigText = `Email ${field} contains "${cfg.keyword || '?'}"`;
  }

  return (
    <div style={{ fontSize: 13, color: 'var(--text-secondary)', marginTop: 8, display: 'flex', gap: 7, flexWrap: 'wrap', alignItems: 'center' }}>
      <span style={{ background: 'rgba(155,114,245,0.16)', color: '#9b72f5', borderRadius: 7, padding: '4px 11px', fontWeight: 700 }}>
        WHEN {trigText}
      </span>
      {conditions.map((c, i) => (
        <span key={`c${i}`} style={{ background: 'rgba(253,171,61,0.20)', color: '#b3690a', borderRadius: 7, padding: '4px 11px', fontWeight: 700 }}>
          IF {conditionText(c, columns)}
        </span>
      ))}
      {actions.map((a, i) => (
        <span key={`a${i}`} style={{ background: 'rgba(0,200,117,0.16)', color: '#037f4c', borderRadius: 7, padding: '4px 11px', fontWeight: 700 }}>
          {i === 0 ? 'THEN' : 'AND'} {actionText(a.type, a.config, columns, groups)}
        </span>
      ))}
    </div>
  );
}

// ── A single "only if" condition row ────────────────────────────────────────────
function ConditionRow({ condition, columns, onChange, onRemove }) {
  const col = columns.find(c => String(c.id) === String(condition.column_id));
  const optionLabels = colOptionLabels(col);
  const needsValue = !NO_VALUE_OPS.has(condition.operator);
  return (
    <div style={{ display: 'flex', gap: 6, alignItems: 'center', marginBottom: 6 }}>
      <select value={condition.column_id || ''} onChange={e => onChange({ ...condition, column_id: e.target.value, value: '' })} style={{ ...sel, flex: 1.3 }}>
        <option value="">Select column…</option>
        {columns.map(c => <option key={c.id} value={c.id}>{c.title}</option>)}
      </select>
      <select value={condition.operator || 'is'} onChange={e => onChange({ ...condition, operator: e.target.value })} style={{ ...sel, flex: 1 }}>
        {CONDITION_OPERATORS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
      </select>
      {needsValue && (
        optionLabels.length
          ? (
            <select value={condition.value || ''} onChange={e => onChange({ ...condition, value: e.target.value })} style={{ ...sel, flex: 1.2 }}>
              <option value="">value…</option>
              {optionLabels.map(l => <option key={l} value={l}>{l}</option>)}
            </select>
          ) : (
            <input value={condition.value || ''} onChange={e => onChange({ ...condition, value: e.target.value })} placeholder="value" style={{ ...inp, flex: 1.2 }} />
          )
      )}
      <button type="button" onClick={onRemove} title="Remove condition"
        style={{ border: 'none', background: 'none', color: '#e2445c', cursor: 'pointer', fontSize: 17, lineHeight: 1, padding: '0 4px', flexShrink: 0 }}>×</button>
    </div>
  );
}

// ── Per-action configuration fields (reused for every action block) ─────────────
function ActionConfigFields({ type, cfg, setCfg, columns, groups, members }) {
  const statusCols = columns.filter(c => c.type === 'status');
  const actStatusCol = statusCols.find(c => String(c.id) === String(cfg.column_id));
  const actStatusLabels = colOptionLabels(actStatusCol);
  const personCols = columns.filter(c => c.type === 'person');
  const emailCols = columns.filter(c => c.type === 'email');
  const textCols = columns.filter(c => c.type === 'text' || c.type === 'long_text');

  const subjectRef = useRef(null);
  const bodyRef = useRef(null);
  const lastFocusedRef = useRef(null);
  const handleInsertToken = (token) => {
    const field = lastFocusedRef.current;
    const el = field === 'subject' ? subjectRef.current : field === 'body' ? bodyRef.current : null;
    if (!el) return;
    const start = el.selectionStart ?? el.value.length;
    const end = el.selectionEnd ?? el.value.length;
    const cur = (field === 'subject' ? cfg.subject : cfg.body) || '';
    const newVal = cur.slice(0, start) + token + cur.slice(end);
    setCfg(field === 'subject' ? { subject: newVal } : { body: newVal });
    setTimeout(() => { el.focus(); el.setSelectionRange(start + token.length, start + token.length); }, 0);
  };

  if (type === 'move_to_group') {
    return (
      <div>
        <p style={label}>Target group</p>
        <select value={cfg.target_group_id || ''} onChange={e => setCfg({ target_group_id: e.target.value })} style={sel}>
          <option value="">Select group…</option>
          {groups.map(g => <option key={g.id} value={g.id}>{g.name}</option>)}
        </select>
      </div>
    );
  }

  if (type === 'set_status') {
    return (
      <div style={{ display: 'flex', gap: 8 }}>
        <div style={{ flex: 1 }}>
          <p style={label}>Status column</p>
          <select value={cfg.column_id || ''} onChange={e => setCfg({ column_id: e.target.value, value: '' })} style={sel}>
            <option value="">Select column…</option>
            {statusCols.map(c => <option key={c.id} value={c.id}>{c.title}</option>)}
          </select>
        </div>
        <div style={{ flex: 1 }}>
          <p style={label}>Set to</p>
          {actStatusCol && actStatusLabels.length === 0 ? (
            <input value={cfg.value || ''} onChange={e => setCfg({ value: e.target.value })}
              placeholder="Type a value…" style={inp} />
          ) : (
            <select value={cfg.value || ''} onChange={e => setCfg({ value: e.target.value })} style={sel} disabled={!actStatusCol}>
              <option value="">Select value…</option>
              {actStatusLabels.map(l => <option key={l} value={l}>{l}</option>)}
            </select>
          )}
        </div>
      </div>
    );
  }

  if (type === 'assign_person') {
    return (
      <div style={{ display: 'flex', gap: 8 }}>
        <div style={{ flex: 1 }}>
          <p style={label}>Person / Owner column</p>
          {personCols.length === 0 ? (
            <div style={{ fontSize: 11, color: '#e2445c', padding: '6px 10px', background: '#fff0f2', borderRadius: 6 }}>
              No person columns found. Add a People/Owner column first.
            </div>
          ) : (
            <select value={cfg.column_id || ''} onChange={e => setCfg({ column_id: e.target.value })} style={sel}>
              <option value="">Select person column…</option>
              {personCols.map(c => <option key={c.id} value={c.id}>{c.title}</option>)}
            </select>
          )}
        </div>
        <div style={{ flex: 1 }}>
          <p style={label}>Assign to</p>
          {members.length === 0 ? (
            <div style={{ fontSize: 11, color: 'var(--text-secondary)', padding: '6px 10px', background: '#f5f5f5', borderRadius: 6 }}>No board members found.</div>
          ) : (
            <select value={cfg.user_id != null ? String(cfg.user_id) : ''}
              onChange={e => { const m = members.find(x => String(x.id) === e.target.value); setCfg({ user_id: m ? m.id : null, user_name: m ? m.name : '' }); }}
              style={sel}>
              <option value="">Select member…</option>
              {members.map(m => <option key={m.id} value={String(m.id)}>{m.name}</option>)}
            </select>
          )}
        </div>
      </div>
    );
  }

  if (type === 'set_due_date') {
    const dateCols = columns.filter(c => c.type === 'date');
    return (
      <div>
        {dateCols.length === 0 ? (
          <div style={{ fontSize: 11, color: '#e2445c', padding: '6px 10px', background: '#fff0f2', borderRadius: 6 }}>
            No date columns found. Add a Date column first.
          </div>
        ) : (
          <div style={{ display: 'flex', gap: 8 }}>
            <div style={{ flex: 1.2 }}>
              <p style={label}>Date column</p>
              <select value={cfg.column_id || ''} onChange={e => setCfg({ column_id: e.target.value })} style={sel}>
                <option value="">Select date column…</option>
                {dateCols.map(c => <option key={c.id} value={c.id}>{c.title}</option>)}
              </select>
            </div>
            <div style={{ flex: 1 }}>
              <p style={label}>Day of week</p>
              <select value={cfg.weekday ?? ''} onChange={e => setCfg({ weekday: e.target.value })} style={sel}>
                <option value="">Select day…</option>
                <option value="1">Monday</option>
                <option value="2">Tuesday</option>
                <option value="3">Wednesday</option>
                <option value="4">Thursday</option>
                <option value="5">Friday</option>
                <option value="6">Saturday</option>
                <option value="0">Sunday</option>
              </select>
            </div>
            <div style={{ flex: 1 }}>
              <p style={label}>Of which week?</p>
              <select value={cfg.weeks_ahead || 1} onChange={e => setCfg({ weeks_ahead: parseInt(e.target.value) })} style={sel}>
                <option value="1">Next</option>
                <option value="2">2 weeks ahead</option>
                <option value="3">3 weeks ahead</option>
                <option value="4">4 weeks ahead</option>
              </select>
            </div>
          </div>
        )}
      </div>
    );
  }

  if (type === 'notify') {
    return (
      <div>
        <p style={label}>Message</p>
        <input value={cfg.message || ''} onChange={e => setCfg({ message: e.target.value })}
          placeholder="e.g. Item is now Done!" style={inp} />
      </div>
    );
  }

  if (type === 'send_email') {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        <div>
          <p style={label}>Send to</p>
          <select value={cfg.to_type || 'specific'} onChange={e => setCfg({ to_type: e.target.value, to: '', to_column_id: '' })} style={sel}>
            <option value="specific">Specific email address</option>
            <option value="item_owner">Item owner(s)</option>
            <option value="email_column">Email column value</option>
            <option value="board_members">All board members</option>
          </select>
        </div>
        {(!cfg.to_type || cfg.to_type === 'specific') && (
          <div>
            <p style={label}>Email address</p>
            <input value={cfg.to || ''} onChange={e => setCfg({ to: e.target.value })}
              placeholder="someone@example.com (comma-separate for multiple)" style={inp} type="email" />
          </div>
        )}
        {cfg.to_type === 'item_owner' && (
          <div>
            <p style={label}>Person column</p>
            {personCols.length === 0 ? (
              <div style={{ fontSize: 11, color: '#e2445c', padding: '6px 10px', background: '#fff0f2', borderRadius: 6 }}>
                No person columns found. Add a People/Owner column first.
              </div>
            ) : (
              <select value={cfg.to_column_id || ''} onChange={e => setCfg({ to_column_id: e.target.value })} style={sel}>
                <option value="">Select person column…</option>
                {personCols.map(c => <option key={c.id} value={c.id}>{c.title}</option>)}
              </select>
            )}
          </div>
        )}
        {cfg.to_type === 'email_column' && (
          <div>
            <p style={label}>Email column</p>
            <select value={cfg.to_column_id || ''} onChange={e => setCfg({ to_column_id: e.target.value })} style={sel}>
              <option value="">Select column…</option>
              {columns.filter(c => c.type === 'email' || c.type === 'text').map(c => <option key={c.id} value={c.id}>{c.title}</option>)}
            </select>
          </div>
        )}
        {cfg.to_type === 'board_members' && (
          <div style={{ background: 'rgba(0,200,117,0.15)', border: '1px solid #b7e4cd', borderRadius: 6, padding: '8px 10px', fontSize: 11, color: '#037f4c' }}>
            ✓ Email will be sent to all members of this board.
          </div>
        )}
        <div style={{ background: '#f0f4ff', borderRadius: 6, padding: '8px 10px' }}>
          <VariableTokenBar columns={columns} onInsert={handleInsertToken} />
          <p style={{ fontSize: 10, color: 'var(--text-secondary)', margin: '4px 0 0' }}>Click Subject or Body first, then click a token to insert it at the cursor.</p>
        </div>
        <div>
          <p style={label}>Subject</p>
          <input ref={subjectRef} value={cfg.subject || ''} onChange={e => setCfg({ subject: e.target.value })}
            onFocus={() => { lastFocusedRef.current = 'subject'; }}
            placeholder="e.g. Item {Item Name} is now {Status}" style={inp} />
        </div>
        <div>
          <p style={label}>Body</p>
          <textarea ref={bodyRef} value={cfg.body || ''} onChange={e => setCfg({ body: e.target.value })}
            onFocus={() => { lastFocusedRef.current = 'body'; }}
            rows={4}
            placeholder={`Hi,\n\nItem "{Item Name}" has been updated.\nStatus: {Status}\nOwner: {Owner}\nDue Date: {Due Date}\n\nBoard: {Board Name}`}
            style={{ ...inp, resize: 'vertical' }} />
        </div>
      </div>
    );
  }

  return null;
}

// ── One action block (type picker + its config) ─────────────────────────────────
function ActionBlock({ action, index, total, availableActions, columns, groups, members, onChange, onRemove }) {
  const setCfg = (patch) => onChange({ ...action, config: { ...(action.config || {}), ...patch } });
  return (
    <div style={{ border: '1px solid var(--border-color, #d0d0d0)', borderRadius: 8, padding: 10, marginBottom: 8, background: 'var(--card-bg, #fff)' }}>
      <div style={{ display: 'flex', gap: 6, alignItems: 'center', marginBottom: 8 }}>
        <span style={{ fontSize: 11, fontWeight: 700, color: 'var(--text-secondary)', whiteSpace: 'nowrap' }}>{index === 0 ? 'Do this' : '+ then'}</span>
        <select value={action.type} onChange={e => onChange({ type: e.target.value, config: {} })} style={{ ...sel, flex: 1 }}>
          {availableActions.map(a => <option key={a.value} value={a.value}>{a.label}</option>)}
        </select>
        {total > 1 && (
          <button type="button" onClick={onRemove} title="Remove action"
            style={{ border: 'none', background: 'none', color: '#e2445c', cursor: 'pointer', fontSize: 17, lineHeight: 1, padding: '0 4px', flexShrink: 0 }}>×</button>
        )}
      </div>
      <ActionConfigFields type={action.type} cfg={action.config || {}} setCfg={setCfg} columns={columns} groups={groups} members={members} />
    </div>
  );
}

// ── Automation form ───────────────────────────────────────────────────────────
function AutomationForm({ boardId, columns, groups, members, onSave, onCancel, initial, isEdit }) {
  const { resolvedTheme } = useThemeContext();
  const isDark = resolvedTheme === 'dark';
  const toast = useToast();
  const [name,          setName]          = useState(initial?.name || '');
  const [triggerType,   setTriggerType]   = useState(initial?.trigger_type || 'status_change');
  const [triggerConfig, setTriggerConfig] = useState(initial?.trigger_config || {});
  const [conditions,    setConditions]    = useState(() => parseArr(initial?.conditions));
  const [actions,       setActions]       = useState(() => {
    const a = autoActions(initial || {});
    if (a.length) return a;
    const first = (ACTIONS_FOR[initial?.trigger_type || 'status_change'] || [])[0]?.value || 'notify';
    return [{ type: first, config: {} }];
  });

  const statusCols = columns.filter(c => c.type === 'status');
  const dateCols   = columns.filter(c => c.type === 'date');

  const setTC = (patch) => setTriggerConfig(c => ({ ...c, ...patch }));

  const trigStatusCol     = statusCols.find(c => String(c.id) === String(triggerConfig.column_id));
  const trigStatusLabels  = colOptionLabels(trigStatusCol);
  const availableActions  = ACTIONS_FOR[triggerType] || [];

  const handleTriggerChange = (val) => {
    setTriggerType(val);
    setTriggerConfig({});
    // Reset actions to a single default valid for the new trigger. Conditions
    // are column-based and stay valid across triggers, so they carry over.
    const firstAction = (ACTIONS_FOR[val] || [])[0]?.value || 'notify';
    setActions([{ type: firstAction, config: {} }]);
  };

  // ── Condition list helpers ──
  const addCondition    = () => setConditions(cs => [...cs, { column_id: '', operator: 'is', value: '' }]);
  const updateCondition = (i, next) => setConditions(cs => cs.map((c, idx) => idx === i ? next : c));
  const removeCondition = (i) => setConditions(cs => cs.filter((_, idx) => idx !== i));

  // ── Action list helpers ──
  const addAction = () => {
    const used = new Set(actions.map(a => a.type));
    const next = availableActions.find(a => !used.has(a.value)) || availableActions[0];
    setActions(as => [...as, { type: next?.value || 'notify', config: {} }]);
  };
  const updateAction = (i, next) => setActions(as => as.map((a, idx) => idx === i ? next : a));
  const removeAction = (i) => setActions(as => as.filter((_, idx) => idx !== i));

  const buildAutoName = () => {
    const t = TRIGGERS.find(t => t.value === triggerType);
    const a = availableActions.find(a => a.value === actions[0]?.type);
    const more = actions.length > 1 ? ` (+${actions.length - 1})` : '';
    return `${t?.label} → ${a?.label || actions[0]?.type}${more}`;
  };

  const handleSubmit = (e) => {
    e.preventDefault();
    if (triggerType === 'status_change' && (!triggerConfig.column_id || !triggerConfig.to_value)) {
      toast('Pick a status column and the value it changes to', 'error'); return;
    }
    if (triggerType === 'date_arrives' && !triggerConfig.column_id) {
      toast('Pick a date column', 'error'); return;
    }
    const cleanConditions = conditions.filter(c => c.column_id && c.operator);
    const cleanActions = actions.filter(a => a && a.type);
    if (!cleanActions.length) { toast('Add at least one action', 'error'); return; }
    onSave({
      name: name.trim() || buildAutoName(),
      trigger_type: triggerType,
      trigger_config: triggerConfig,
      conditions: cleanConditions,
      actions: cleanActions,
      // Legacy mirror so older readers / the client toast keep working.
      action_type: cleanActions[0].type,
      action_config: cleanActions[0].config || {},
    });
  };

  // ── Option lists for the inline sentence tokens ──
  const groupOpts     = groups.map(g => ({ value: String(g.id), label: g.name }));
  const statusColOpts = statusCols.map(c => ({ value: String(c.id), label: c.title }));
  const dateColOpts   = dateCols.map(c => ({ value: String(c.id), label: c.title }));
  const personCols    = columns.filter(c => c.type === 'person');
  const personColOpts = personCols.map(c => ({ value: String(c.id), label: c.title }));
  const allColOpts    = columns.map(c => ({ value: String(c.id), label: c.title }));
  const memOpts       = memberOpts(members);
  const opOpts        = CONDITION_OPERATORS.map(o => ({ value: o.value, label: o.label }));
  const verbOpts      = availableActions.map(a => ({ value: a.value, label: a.label }));
  const triggerTypeOpts = [
    { value: 'status_change', label: 'a status changes' },
    { value: 'item_created',  label: 'an item is created' },
    { value: 'date_arrives',  label: 'a date arrives' },
  ];

  const WEEKDAYS = [
    { value: '1', label: 'Monday' }, { value: '2', label: 'Tuesday' }, { value: '3', label: 'Wednesday' },
    { value: '4', label: 'Thursday' }, { value: '5', label: 'Friday' }, { value: '6', label: 'Saturday' }, { value: '0', label: 'Sunday' },
  ];
  const WEEKS = [{ value: '1', label: 'next week' }, { value: '2', label: 'in 2 weeks' }, { value: '3', label: 'in 3 weeks' }, { value: '4', label: 'in 4 weeks' }];
  const DATE_TIMINGS = [
    { value: 'on',    label: 'on the date',         apply: { mode: 'on', offset_days: 0 } },
    { value: 'd1',    label: '1 day before',        apply: { mode: 'on', offset_days: 1 } },
    { value: 'd2',    label: '2 days before',       apply: { mode: 'on', offset_days: 2 } },
    { value: 'd3',    label: '3 days before',       apply: { mode: 'on', offset_days: 3 } },
    { value: 'w1',    label: '1 week before',       apply: { mode: 'on', offset_days: 7 } },
    { value: 'after', label: 'after it has passed', apply: { mode: 'after', min_days_past: 0 } },
  ];
  const timingValue = triggerConfig.mode === 'after'
    ? 'after'
    : ({ 0: 'on', 1: 'd1', 2: 'd2', 3: 'd3', 7: 'w1' }[parseInt(triggerConfig.offset_days, 10) || 0] || 'on');
  const applyTiming = (v) => {
    const tm = DATE_TIMINGS.find(t => t.value === v) || DATE_TIMINGS[0];
    setTriggerConfig(c => ({ column_id: c.column_id, ...tm.apply }));
  };

  // Values offered for a condition: real member names for person columns (so you
  // pick the exact account), otherwise the column's preset labels.
  const condValueOpts = (col) => {
    if (!col) return [];
    if (col.type === 'person') {
      const seen = new Set(); const out = [];
      members.forEach(m => { if (!seen.has(m.name)) { seen.add(m.name); out.push({ value: m.name, label: m.name }); } });
      return out;
    }
    return toOpts(colOptionLabels(col));
  };

  const removeChip = (onClick) => (
    <button type="button" onClick={onClick} title="Remove"
      style={{ border: 'none', background: 'none', color: '#e2445c', cursor: 'pointer', fontSize: 16, lineHeight: 1, padding: '0 2px', verticalAlign: 'middle' }}>×</button>
  );
  const linkBtn = (rgb) => ({
    border: `1.5px dashed rgba(${rgb},0.6)`, background: `rgba(${rgb},0.08)`, color: `rgb(${rgb})`,
    borderRadius: 8, fontSize: 13, fontWeight: 700, cursor: 'pointer', padding: '6px 13px',
  });

  return (
    <div className="automation-form-card" style={{ background: isDark ? 'var(--bg-primary, #1e1e28)' : '#ffffff', border: `1.5px solid ${isDark ? 'var(--border-color, #3a3a48)' : '#e8e8ee'}`, borderRadius: 14, padding: 22, marginBottom: 14, boxShadow: isDark ? 'none' : '0 1px 3px rgba(0,0,0,0.05)' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 4 }}>
        <span style={{ fontSize: 20 }}>⚡</span>
        <p style={{ fontSize: 16, fontWeight: 800, color: 'var(--text-primary, #323338)', margin: 0 }}>
          {isEdit ? 'Edit automation' : 'New automation'}
        </p>
      </div>
      <p style={{ fontSize: 13, color: 'var(--text-secondary)', margin: '0 0 16px' }}>
        Read it like a sentence — just fill in the highlighted blanks.
      </p>

      {/* The recipe sentence */}
      <div style={{
        display: 'flex', flexWrap: 'wrap', alignItems: 'center', columnGap: 8, rowGap: 12,
        lineHeight: 2, background: 'var(--card-bg, #fff)', border: '1px solid var(--border-color, #e6e6e6)',
        borderRadius: 12, padding: '18px',
      }}>
        {/* WHEN — trigger */}
        <W>When</W>
        <Blank tone="trigger" isDark minWidth={150} options={triggerTypeOpts} value={triggerType}
          onChange={handleTriggerChange} />

        {triggerType === 'status_change' && (
          <>
            <W>in</W>
            <Blank tone="trigger" isDark options={statusColOpts} value={triggerConfig.column_id} placeholder="a status column"
              onChange={v => setTC({ column_id: v, to_value: '' })} />
            <W>to</W>
            {trigStatusCol && trigStatusLabels.length === 0
              ? <TextBlank tone="trigger" isDark value={triggerConfig.to_value} placeholder="a value" onChange={v => setTC({ to_value: v })} />
              : <Blank tone="trigger" isDark options={toOpts(trigStatusLabels)} value={triggerConfig.to_value} placeholder="a value"
                  onChange={v => setTC({ to_value: v })} />}
          </>
        )}
        {triggerType === 'date_arrives' && (
          <>
            <W>in</W>
            <Blank tone="trigger" isDark options={dateColOpts} value={triggerConfig.column_id} placeholder="a date column"
              onChange={v => setTC({ column_id: v })} />
            <Blank tone="trigger" isDark minWidth={130} options={DATE_TIMINGS.map(t => ({ value: t.value, label: t.label }))}
              value={timingValue} onChange={applyTiming} />
          </>
        )}

        {/* ONLY IF — conditions */}
        {conditions.length > 0 && <W>only if</W>}
        {conditions.map((c, i) => {
          const col = columns.find(x => String(x.id) === String(c.column_id));
          const vOpts = condValueOpts(col);
          const needsValue = !NO_VALUE_OPS.has(c.operator);
          return (
            <React.Fragment key={i}>
              {i > 0 && <W>and</W>}
              <Blank tone="cond" isDark options={allColOpts} value={c.column_id} placeholder="a column"
                onChange={v => updateCondition(i, { ...c, column_id: v, value: '' })} />
              <Blank tone="cond" isDark minWidth={78} options={opOpts} value={c.operator}
                onChange={v => updateCondition(i, { ...c, operator: v })} />
              {needsValue && (vOpts.length
                ? <Blank tone="cond" isDark options={vOpts} value={c.value} placeholder="a value"
                    onChange={v => updateCondition(i, { ...c, value: v })} />
                : <TextBlank tone="cond" isDark value={c.value} placeholder="a value"
                    onChange={v => updateCondition(i, { ...c, value: v })} />)}
              {removeChip(() => removeCondition(i))}
            </React.Fragment>
          );
        })}

        {/* THEN — actions */}
        {actions.map((a, i) => {
          const cfg = a.config || {};
          const set = patch => updateAction(i, { ...a, config: { ...cfg, ...patch } });
          const scol = statusCols.find(c => String(c.id) === String(cfg.column_id));
          const slabels = colOptionLabels(scol);
          return (
            <React.Fragment key={`a${i}`}>
              <W>{i === 0 ? ', then' : 'and then'}</W>
              <Blank tone="action" isDark minWidth={150} options={verbOpts} value={a.type}
                onChange={v => updateAction(i, { type: v, config: {} })} />
              {a.type === 'move_to_group' && (
                <Blank tone="action" isDark options={groupOpts} value={cfg.target_group_id} placeholder="a group"
                  onChange={v => set({ target_group_id: v })} />
              )}
              {a.type === 'set_status' && (
                <>
                  <Blank tone="action" isDark options={statusColOpts} value={cfg.column_id} placeholder="a status column"
                    onChange={v => set({ column_id: v, value: '' })} />
                  <W>to</W>
                  {cfg.column_id && (slabels.length === 0
                    ? <TextBlank tone="action" isDark value={cfg.value} placeholder="a value" onChange={v => set({ value: v })} />
                    : <Blank tone="action" isDark options={toOpts(slabels)} value={cfg.value} placeholder="a value"
                        onChange={v => set({ value: v })} />)}
                </>
              )}
              {a.type === 'assign_person' && (
                <>
                  <Blank tone="action" isDark options={memOpts} value={cfg.user_id != null ? String(cfg.user_id) : ''} placeholder="a person"
                    onChange={v => { const m = members.find(x => String(x.id) === v); set({ user_id: m ? m.id : null, user_name: m ? m.name : '' }); }} />
                  <W>in</W>
                  <Blank tone="action" isDark options={personColOpts} value={cfg.column_id} placeholder="owner column"
                    onChange={v => set({ column_id: v })} />
                </>
              )}
              {a.type === 'set_due_date' && (
                <>
                  <Blank tone="action" isDark options={dateColOpts} value={cfg.column_id} placeholder="a date column"
                    onChange={v => set({ column_id: v })} />
                  <W>to</W>
                  <Blank tone="action" isDark options={WEEKDAYS} value={cfg.weekday ?? ''} placeholder="a weekday"
                    onChange={v => set({ weekday: v })} />
                  <Blank tone="action" isDark minWidth={110} options={WEEKS} value={String(cfg.weeks_ahead || 1)}
                    onChange={v => set({ weeks_ahead: parseInt(v, 10) })} />
                </>
              )}
              {a.type === 'notify' && (
                <>
                  <W>with message</W>
                  <TextBlank tone="action" isDark width={220} value={cfg.message} placeholder="e.g. Item is now Done!"
                    onChange={v => set({ message: v })} />
                </>
              )}
              {actions.length > 1 && removeChip(() => removeAction(i))}
            </React.Fragment>
          );
        })}
      </div>

      {/* Inline add links */}
      <div style={{ display: 'flex', gap: 10, marginTop: 12, flexWrap: 'wrap' }}>
        <button type="button" onClick={addCondition} style={linkBtn('253,171,61')}>+ add condition</button>
        <button type="button" onClick={addAction} style={linkBtn('0,200,117')}>+ add action</button>
      </div>

      {triggerType === 'status_change' && trigStatusCol && trigStatusLabels.length === 0 && (
        <p style={{ fontSize: 11.5, color: '#b3690a', margin: '10px 2px 0', lineHeight: 1.5 }}>
          ⚠️ This status column has no preset labels. Type the exact value, or add labels in the column's settings.
        </p>
      )}

      {/* Heavier config: email details rendered under the sentence */}
      {actions.map((a, i) => a.type === 'send_email' ? (
        <div key={`em${i}`} style={{ marginTop: 14, border: '1px solid rgba(0,200,117,0.4)', borderRadius: 10, padding: 14, background: 'rgba(0,200,117,0.05)' }}>
          <p style={{ fontSize: 12, fontWeight: 800, color: isDark ? '#5fe0a8' : '#037f4c', margin: '0 0 10px', textTransform: 'uppercase', letterSpacing: 0.4 }}>
            ✉️ Email details {actions.length > 1 ? `(action ${i + 1})` : ''}
          </p>
          <ActionConfigFields type="send_email" cfg={a.config || {}} columns={columns} groups={groups} members={members}
            setCfg={patch => updateAction(i, { ...a, config: { ...(a.config || {}), ...patch } })} />
        </div>
      ) : null)}

      {/* Name + buttons */}
      <div style={{ marginTop: 16, marginBottom: 12 }}>
        <p style={label}>Name (optional)</p>
        <input value={name} onChange={e => setName(e.target.value)} placeholder={buildAutoName()} style={inp} />
      </div>
      <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
        <button type="button" onClick={onCancel} style={{ padding: '9px 18px', border: '1px solid var(--border-color)', borderRadius: 8, fontSize: 14, cursor: 'pointer', color: 'var(--text-secondary)', background: 'var(--bg-primary)', fontWeight: 600 }}>Cancel</button>
        <button type="button" onClick={handleSubmit} style={{ padding: '9px 22px', background: 'linear-gradient(135deg,#9b72f5,#7f55d6)', color: '#fff', borderRadius: 8, fontWeight: 800, fontSize: 14, cursor: 'pointer', border: 'none', boxShadow: '0 6px 16px rgba(127,85,214,0.3)' }}>
          {isEdit ? 'Save changes' : 'Create automation'}
        </button>
      </div>
    </div>
  );
}

// ── Date Cascade Tab ──────────────────────────────────────────────────────────
function DateCascadeTab({ boardId, boardName, columns }) {
  const {
    fetchTemplates, fetchRules, deleteRule, updateRule, fetchLogs,
  } = useAutomation(boardId);

  const [steps,        setSteps]        = useState([]);
  const [rules,        setRules]        = useState([]);
  const [logs,         setLogs]         = useState([]);
  const [logsOpen,     setLogsOpen]     = useState(false);
  const [showTemplate, setShowTemplate] = useState(false);
  const [editRule,     setEditRule]     = useState(null); // null | 'new' | rule object
  const [confirmDel,   setConfirmDel]   = useState(null);

  const reload = () => {
    fetchTemplates().then(setSteps).catch(() => {});
    fetchRules().then(setRules).catch(() => {});
  };

  useEffect(() => { reload(); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const handleLoadLogs = () => {
    if (!logsOpen) fetchLogs().then(setLogs).catch(() => {});
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

  const anchorStep  = steps.find(s => s.is_anchor);
  const anchorColId = anchorStep?.column_id || null;
  const totalDays   = steps.reduce((sum, s) => sum + (s.duration_days || 0), 0);

  const sectionHead = { fontSize: 11, fontWeight: 700, color: 'var(--text-secondary)', textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 8, display: 'flex', alignItems: 'center', justifyContent: 'space-between' };

  return (
    <div style={{ paddingBottom: 24 }}>

      {/* ── Step Template ─────────────────────────────────────────────── */}
      <div style={{ background: 'var(--bg-secondary)', border: '1.5px solid var(--border-color)', borderRadius: 10, padding: 16, marginBottom: 16 }}>
        <div style={sectionHead}>
          <span>📅 Step Template</span>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            {totalDays > 0 && (
              <span style={{ background: 'rgba(155,114,245,0.15)', color: '#9b72f5', borderRadius: 8, padding: '2px 8px', fontSize: 11, fontWeight: 700, textTransform: 'none', letterSpacing: 0 }}>
                {totalDays}d total
              </span>
            )}
            <button
              onClick={() => setShowTemplate(true)}
              style={{ padding: '4px 12px', border: '1px solid #9b72f5', color: '#9b72f5', borderRadius: 6, fontSize: 12, cursor: 'pointer', background: 'var(--bg-primary)', fontWeight: 600 }}
            >
              {steps.length ? 'Edit' : 'Configure'}
            </button>
          </div>
        </div>

        {steps.length === 0 ? (
          <div style={{ fontSize: 12, color: 'var(--text-secondary)', textAlign: 'center', padding: '12px 0' }}>
            No steps configured. Click <strong>Configure</strong> to define the project step sequence.
          </div>
        ) : (
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
            <thead>
              <tr style={{ borderBottom: '1px solid var(--border-color)' }}>
                <th style={{ padding: '4px 6px', textAlign: 'left', color: 'var(--text-secondary)', fontWeight: 600, width: 28 }}>#</th>
                <th style={{ padding: '4px 6px', textAlign: 'left', color: 'var(--text-secondary)', fontWeight: 600 }}>Step</th>
                <th style={{ padding: '4px 6px', textAlign: 'left', color: 'var(--text-secondary)', fontWeight: 600 }}>Column</th>
                <th style={{ padding: '4px 6px', textAlign: 'right', color: 'var(--text-secondary)', fontWeight: 600, width: 40 }}>Days</th>
              </tr>
            </thead>
            <tbody>
              {steps.map(s => (
                <tr key={s.id} style={{ borderBottom: '1px solid var(--border-color)', background: s.is_anchor ? 'rgba(0,200,117,0.06)' : 'transparent' }}>
                  <td style={{ padding: '5px 6px', color: 'var(--text-muted)', fontWeight: 600 }}>{s.step_order}</td>
                  <td style={{ padding: '5px 6px', color: 'var(--text-primary)', display: 'flex', alignItems: 'center', gap: 4 }}>
                    {s.is_anchor && <span title="Anchor step" style={{ color: '#00c875', fontSize: 11 }}>⚓</span>}
                    {s.step_name}
                  </td>
                  <td style={{ padding: '5px 6px', color: 'var(--text-secondary)' }}>{s.column_title || `col #${s.column_id}`}</td>
                  <td style={{ padding: '5px 6px', textAlign: 'right', color: 'var(--text-primary)', fontWeight: 600 }}>{s.duration_days}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {/* ── Cascade Rules ─────────────────────────────────────────────── */}
      <div style={{ background: 'var(--bg-secondary)', border: '1.5px solid var(--border-color)', borderRadius: 10, padding: 16, marginBottom: 16 }}>
        <div style={sectionHead}>
          <span>⚡ Cascade Rules</span>
          <button
            onClick={() => setEditRule('new')}
            disabled={steps.length === 0}
            title={steps.length === 0 ? 'Configure a step template first' : ''}
            style={{
              padding: '4px 12px', border: '1px solid #00c875', color: '#00c875',
              borderRadius: 6, fontSize: 12, cursor: steps.length ? 'pointer' : 'not-allowed',
              background: 'var(--bg-primary)', fontWeight: 600, opacity: steps.length ? 1 : 0.45,
              textTransform: 'none', letterSpacing: 0,
            }}
          >
            + Add Rule
          </button>
        </div>

        {rules.length === 0 ? (
          <div style={{ fontSize: 12, color: 'var(--text-secondary)', textAlign: 'center', padding: '12px 0' }}>
            {steps.length === 0
              ? 'Set up a step template first, then add cascade rules.'
              : 'No rules yet. Click "+ Add Rule" to auto-fill dates on a trigger.'}
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {rules.map(rule => (
              <div key={rule.id} style={{
                border: '1.5px solid var(--border-color)',
                borderRadius: 8, padding: '10px 12px',
                background: rule.is_active ? 'var(--bg-primary)' : 'var(--bg-secondary)',
              }}>
                <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 8 }}>
                  <div style={{ flex: 1 }}>
                    <div style={{ fontWeight: 700, fontSize: 13, color: rule.is_active ? 'var(--text-primary)' : 'var(--text-muted)' }}>{rule.rule_name}</div>
                    <div style={{ fontSize: 11, color: 'var(--text-secondary)', marginTop: 3, display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                      <span style={{ background: 'rgba(155,114,245,0.15)', color: '#9b72f5', borderRadius: 4, padding: '2px 7px', fontWeight: 600 }}>
                        WHEN {rule.trigger_type === 'date_entry'
                          ? `"${rule.trigger_column_title || `col #${rule.trigger_column_id}`}" entered`
                          : `Status → "${rule.trigger_status_to}"`}
                      </span>
                      <span style={{ background: 'rgba(0,200,117,0.15)', color: '#037f4c', borderRadius: 4, padding: '2px 7px', fontWeight: 600 }}>
                        CASCADE {rule.direction} from "{rule.anchor_column_title || `col #${rule.anchor_column_id}`}"
                      </span>
                    </div>
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexShrink: 0 }}>
                    <label style={{ display: 'flex', alignItems: 'center', gap: 4, cursor: 'pointer', fontSize: 12 }}>
                      <input type="checkbox" checked={!!rule.is_active} onChange={() => handleToggleRule(rule)}
                        style={{ accentColor: '#00c875', cursor: 'pointer' }} />
                      <span style={{ color: rule.is_active ? '#037f4c' : 'var(--text-muted)', fontWeight: 600 }}>
                        {rule.is_active ? 'On' : 'Off'}
                      </span>
                    </label>
                    <button onClick={() => setEditRule(rule)} style={{ color: '#9b72f5', fontSize: 12, fontWeight: 600, border: 'none', background: 'none', cursor: 'pointer' }}>Edit</button>
                    {confirmDel === rule.id ? (
                      <>
                        <button onClick={() => handleDeleteRule(rule.id)} style={{ background: '#e2445c', color: '#fff', border: 'none', borderRadius: 4, fontSize: 11, cursor: 'pointer', padding: '3px 8px', fontWeight: 600 }}>Delete</button>
                        <button onClick={() => setConfirmDel(null)} style={{ border: '1px solid var(--border-color)', background: 'none', borderRadius: 4, fontSize: 11, cursor: 'pointer', padding: '3px 8px' }}>Cancel</button>
                      </>
                    ) : (
                      <button onClick={() => setConfirmDel(rule.id)} style={{ color: '#e2445c', fontSize: 12, fontWeight: 600, border: 'none', background: 'none', cursor: 'pointer' }}>Delete</button>
                    )}
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* ── Recent Activity (collapsible) ─────────────────────────────── */}
      <div style={{ background: 'var(--bg-secondary)', border: '1.5px solid var(--border-color)', borderRadius: 10, padding: 16 }}>
        <button
          onClick={handleLoadLogs}
          style={{
            display: 'flex', alignItems: 'center', gap: 6,
            background: 'none', border: 'none', cursor: 'pointer', padding: 0,
            color: 'var(--text-secondary)', fontWeight: 700, fontSize: 11, textTransform: 'uppercase', letterSpacing: 0.5, width: '100%', textAlign: 'left',
          }}
        >
          <span style={{ transition: 'transform 0.15s', display: 'inline-block', transform: logsOpen ? 'rotate(90deg)' : 'rotate(0deg)', fontSize: 9 }}>▶</span>
          Recent Cascade Activity
        </button>

        {logsOpen && (
          <div style={{ marginTop: 10 }}>
            {logs.length === 0 ? (
              <div style={{ fontSize: 12, color: 'var(--text-secondary)', textAlign: 'center', padding: '8px 0' }}>No cascade events recorded yet.</div>
            ) : (
              logs.map(log => (
                <div key={log.id} style={{ borderBottom: '1px solid var(--border-color)', padding: '8px 0', fontSize: 12 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                    <DateCascadeIndicator isAutoCascaded />
                    <span style={{ color: 'var(--text-primary)', fontWeight: 600 }}>{log.item_name || `Item #${log.item_id}`}</span>
                  </div>
                  <div style={{ color: 'var(--text-secondary)', marginTop: 2 }}>
                    Anchor: {log.anchor_column_title || `col #${log.anchor_column_id}`} = {log.anchor_date}
                    &nbsp;·&nbsp;{Object.keys(log.dates_calculated || {}).length} dates set
                    &nbsp;·&nbsp;{toISODateTime(log.created_at)}
                  </div>
                </div>
              ))
            )}
          </div>
        )}
      </div>

      {/* Step Template Config modal */}
      {showTemplate && (
        <StepTemplateConfig
          boardId={boardId}
          boardName={boardName}
          boardColumns={columns}
          onSave={saved => { setSteps(saved); setShowTemplate(false); }}
          onClose={() => setShowTemplate(false)}
        />
      )}

      {/* Automation Rule Config modal */}
      {editRule && (
        <AutomationRuleConfig
          boardId={boardId}
          boardColumns={columns}
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
    </div>
  );
}

// ── Main panel ────────────────────────────────────────────────────────────────
export default function AutomationsPanel({
  boardId, boardName, columns, groups,
  boardEmailFrom, onBoardEmailFromChange,
  onClose, onCountChange,
}) {
  const [automations, setAutomations] = useState([]);
  const [view,        setView]        = useState('list'); // 'list' | 'gallery' | 'builder'
  const [builderInit, setBuilderInit] = useState(null);
  const [editingId,   setEditingId]   = useState(null);
  const [members,     setMembers]     = useState([]);
  const [activeTab,   setActiveTab]   = useState('rules');
  const [aiPrompt,    setAiPrompt]    = useState('');
  const [aiBusy,      setAiBusy]      = useState(false);
  const [aiPreview,   setAiPreview]   = useState(null); // { recipe, explanation }
  const [aiErr,       setAiErr]       = useState(null);
  const toast = useToast();
  const { resolvedTheme } = useThemeContext();
  const isDark = resolvedTheme === 'dark';

  const updateList = (list) => {
    setAutomations(list);
    onCountChange?.(list.filter(a => a.enabled).length);
  };

  useEffect(() => {
    getAutomations(boardId).then(r => updateList(r.data)).catch(() => {});
    getBoardMembers(boardId).then(r => setMembers(r.data || [])).catch(() => {});
  }, [boardId]); // eslint-disable-line react-hooks/exhaustive-deps

  const handleCreate = async (data) => {
    try {
      const r = await createAutomation({ ...data, board_id: boardId });
      updateList([r.data, ...automations]);
      setView('list');
      toast('Automation created', 'success');
    } catch { toast('Failed to create automation', 'error'); }
  };

  const generateRule = async () => {
    if (!aiPrompt.trim()) return;
    setAiBusy(true); setAiErr(null); setAiPreview(null);
    try {
      const r = await aiAutomation(boardId, aiPrompt.trim());
      setAiPreview({ recipe: r.recipe, explanation: r.explanation });
    } catch (e) { setAiErr(e.response?.data?.error || 'Could not interpret that rule.'); }
    finally { setAiBusy(false); }
  };
  const confirmRule = async () => {
    if (!aiPreview) return;
    await handleCreate(aiPreview.recipe);
    setAiPreview(null); setAiPrompt('');
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

  const sendEmailRules = automations.filter(a => a.action_type  === 'send_email');

  // Theme-aware header palette — soft lavender in light, deep indigo in dark.
  const hdr = isDark ? {
    band: 'linear-gradient(120deg, #2c2a55 0%, #322c5e 55%, #3a2c52 100%)',
    border: 'rgba(155,114,245,0.28)',
    title: '#ffffff', subtitle: 'rgba(255,255,255,0.72)',
    closeBg: 'rgba(255,255,255,0.12)', closeColor: '#cbbff5',
    track: 'rgba(255,255,255,0.08)',
    tabActiveBg: 'rgba(155,114,245,0.95)', tabActiveColor: '#ffffff',
    tabInactiveColor: '#c9bff0',
    tabShadow: '0 4px 14px rgba(0,0,0,0.35)',
  } : {
    band: '#ffffff',
    border: '#ececf0',
    title: '#1f2330', subtitle: '#6b7280',
    closeBg: '#f3f4f6', closeColor: '#6b7280',
    track: '#f4f4f7',
    tabActiveBg: '#ffffff', tabActiveColor: '#7f55d6',
    tabInactiveColor: '#6b7280',
    tabShadow: '0 2px 8px rgba(0,0,0,0.10)',
  };

  // Tab bar styles — segmented control. Active = solid pill; inactive =
  // clearly-readable text on the track (works in both themes).
  const tabStyle = (active) => ({
    flex: 1, padding: '12px 8px', fontSize: 15, fontWeight: 800, borderRadius: 11,
    color: active ? hdr.tabActiveColor : hdr.tabInactiveColor,
    background: active ? hdr.tabActiveBg : 'transparent',
    boxShadow: active ? hdr.tabShadow : 'none',
    border: 'none', cursor: 'pointer', transition: 'color 0.15s, background 0.15s',
    display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8,
  });

  return (
    <div className="wb-modal-overlay" style={{
      position: 'fixed', inset: 0, background: 'rgba(20,12,45,0.45)', zIndex: 400,
      backdropFilter: 'blur(4px)', WebkitBackdropFilter: 'blur(4px)',
      display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24,
    }} onClick={onClose}>
      <div className="automations-panel" onClick={e => e.stopPropagation()} style={{
        background: 'var(--card-bg, #fff)', width: 1144, maxWidth: '96vw', maxHeight: '94vh',
        borderRadius: 20, overflow: 'hidden',
        boxShadow: '0 24px 80px rgba(40,20,90,0.32)', display: 'flex', flexDirection: 'column',
        animation: 'autoPanelPop 0.3s cubic-bezier(.2,.7,.3,1) both',
      }}>
        <style>{`@keyframes autoPanelPop { from { opacity: 0; transform: scale(.96) translateY(10px); } to { opacity: 1; transform: none; } }
          .auto-tpl-card { transition: border-color .15s, box-shadow .15s, transform .15s; }
          .auto-tpl-card:hover { border-color: #9b72f5 !important; box-shadow: 0 8px 20px rgba(127,85,214,0.18); transform: translateY(-2px); }`}</style>

        {/* Header — theme-aware band */}
        <div style={{ flexShrink: 0, background: hdr.band, borderBottom: `1px solid ${hdr.border}`, padding: '22px 28px' }}>
          <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 12 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
              <div style={{ width: 48, height: 48, borderRadius: 14, background: 'linear-gradient(135deg, #9b72f5, #7f55d6)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 26, flexShrink: 0, boxShadow: '0 6px 16px rgba(127,85,214,0.30)' }}>⚡</div>
              <div>
                <h2 style={{ fontSize: 22, fontWeight: 800, margin: 0, color: hdr.title }}>Automations</h2>
                <p style={{ fontSize: 13.5, color: hdr.subtitle, margin: '3px 0 0' }}>Rules and date cascade for this board</p>
              </div>
            </div>
            <button onClick={onClose} title="Close" style={{
              width: 36, height: 36, borderRadius: 10, fontSize: 22, lineHeight: 1, color: hdr.closeColor,
              border: 'none', background: hdr.closeBg, cursor: 'pointer', flexShrink: 0,
            }}>×</button>
          </div>

          {/* Tab bar */}
          <div style={{ display: 'flex', gap: 8, marginTop: 18, background: hdr.track, borderRadius: 14, padding: 5 }}>
            <button style={tabStyle(activeTab === 'rules')} onClick={() => setActiveTab('rules')}>
              ⚡ Rules
              {automations.filter(a => a.enabled).length > 0 && (
                <span style={{ background: '#9b72f5', color: '#fff', borderRadius: 9, padding: '1px 9px', fontSize: 12.5, fontWeight: 800 }}>
                  {automations.filter(a => a.enabled).length}
                </span>
              )}
            </button>
            <button style={tabStyle(activeTab === 'cascade')} onClick={() => setActiveTab('cascade')}>
              📅 Date Cascade
            </button>
          </div>
        </div>

        {/* Body */}
        <div style={{ flex: 1, padding: '24px 28px', overflowY: 'auto' }}>

          {/* ── Rules tab ─────────────────────────────────────────────── */}
          {activeTab === 'rules' && (
            <>
              {/* ── LIST VIEW ─────────────────────────────────────────── */}
              {view === 'list' && (
                <>
                  <button
                    onClick={() => { setBuilderInit(null); setEditingId(null); setView('gallery'); }}
                    style={{ width: '100%', padding: '14px', background: 'linear-gradient(135deg, #9b72f5, #7f55d6)', color: '#fff', borderRadius: 12, fontWeight: 800, marginBottom: 18, fontSize: 15.5, cursor: 'pointer', border: 'none', boxShadow: '0 8px 22px rgba(127,85,214,0.34)' }}
                  >
                    + Add automation
                  </button>

                  {sendEmailRules.length > 0 && (
                    <div style={{ background: 'rgba(0,200,117,0.15)', border: '1px solid #b7e4cd', borderRadius: 8, padding: '9px 13px', marginBottom: 12, fontSize: 12.5, color: '#037f4c' }}>
                      ✉️ <strong>{sendEmailRules.length} send-email automation{sendEmailRules.length > 1 ? 's' : ''}</strong> active.
                    </div>
                  )}

                  {automations.length === 0 ? (
                    <EmptyState
                      icon="⚡"
                      title="Automate the boring parts"
                      description="Auto-assign owners, set due dates, send emails, and more — all triggered by status changes, item creation, or dates."
                      primaryAction={{ label: '+ Create your first automation', onClick: () => { setBuilderInit(null); setView('gallery'); } }}
                    />
                  ) : (
                    automations.map(auto => (
                      editingId === auto.id ? (
                        <AutomationForm
                          key={auto.id} isEdit boardId={boardId} columns={columns} groups={groups} members={members} initial={auto}
                          onSave={(data) => handleUpdate(auto.id, data)}
                          onCancel={() => setEditingId(null)}
                        />
                      ) : (
                        <div key={auto.id} style={{
                          border: `1.5px solid ${auto.enabled ? 'rgba(155,114,245,0.28)' : 'var(--border-color, #f0f0f0)'}`,
                          borderRadius: 14, padding: '16px 18px', marginBottom: 12,
                          background: auto.enabled ? 'var(--bg-primary, #fff)' : 'rgba(255,255,255,0.04)',
                          boxShadow: auto.enabled ? '0 4px 18px rgba(80,50,150,0.07)' : 'none',
                          opacity: auto.enabled ? 1 : 0.72,
                        }}>
                          <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 12 }}>
                            <div style={{ flex: 1, minWidth: 0 }}>
                              <div style={{ fontWeight: 800, fontSize: 15, color: auto.enabled ? 'var(--text-primary, #323338)' : 'var(--text-muted, #aaa)' }}>{auto.name}</div>
                              <Summary auto={auto} columns={columns} groups={groups} />
                            </div>
                            <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexShrink: 0 }}>
                              <label style={{ display: 'flex', alignItems: 'center', gap: 6, cursor: 'pointer', fontSize: 13,
                                background: auto.enabled ? 'rgba(0,200,117,0.12)' : 'var(--bg-secondary, #f0f0f0)', borderRadius: 8, padding: '5px 10px' }}>
                                <input type="checkbox" checked={auto.enabled} onChange={() => handleToggle(auto)} style={{ accentColor: '#00c875', cursor: 'pointer', width: 15, height: 15 }} />
                                <span style={{ color: auto.enabled ? '#037f4c' : '#aaa', fontWeight: 700 }}>{auto.enabled ? 'On' : 'Off'}</span>
                              </label>
                              <button onClick={() => { setEditingId(auto.id); }} style={{ color: '#9b72f5', fontSize: 13, fontWeight: 700, border: 'none', background: 'none', cursor: 'pointer' }}>Edit</button>
                              <button onClick={() => handleDelete(auto.id)} style={{ color: '#e2445c', fontSize: 13, fontWeight: 700, border: 'none', background: 'none', cursor: 'pointer' }}>Delete</button>
                            </div>
                          </div>
                        </div>
                      )
                    ))
                  )}
                </>
              )}

              {/* ── GALLERY VIEW ──────────────────────────────────────── */}
              {view === 'gallery' && (
                <>
                  <button onClick={() => setView('list')}
                    style={{ background: 'none', border: 'none', color: '#9b72f5', fontWeight: 700, fontSize: 13.5, cursor: 'pointer', padding: '4px 0', marginBottom: 14 }}>
                    ← Back
                  </button>

                  {/* ✨ AI: describe a rule in plain English */}
                  <div style={{ border: '1.5px solid rgba(155,114,245,0.4)', borderRadius: 14, padding: 16, marginBottom: 20, background: 'rgba(155,114,245,0.06)' }}>
                    <div style={{ fontSize: 14, fontWeight: 800, color: '#9b72f5', marginBottom: 10 }}>✨ Describe it in plain English</div>
                    <div style={{ display: 'flex', gap: 6 }}>
                      <input
                        value={aiPrompt}
                        onChange={e => setAiPrompt(e.target.value)}
                        onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); generateRule(); } }}
                        placeholder='e.g. "when status changes to Done, notify the owner"'
                        style={{ flex: 1, boxSizing: 'border-box', border: '1px solid var(--border-color)', borderRadius: 7, padding: '10px 12px', outline: 'none', fontSize: 14, background: 'var(--input-bg, #fff)', color: 'var(--text-primary)' }}
                      />
                      <button onClick={generateRule} disabled={aiBusy}
                        style={{ padding: '0 18px', borderRadius: 7, border: 'none', background: 'linear-gradient(90deg,#9b72f5,#b86cff)', color: '#fff', fontWeight: 700, fontSize: 14, cursor: aiBusy ? 'default' : 'pointer', whiteSpace: 'nowrap' }}>
                        {aiBusy ? '…' : 'Generate'}
                      </button>
                    </div>
                    {aiErr && <div style={{ fontSize: 11.5, color: '#e2445c', marginTop: 6 }}>⚠ {aiErr}</div>}
                    {aiPreview && (
                      <div style={{ marginTop: 10, background: 'var(--bg-secondary, #f5f6f8)', borderRadius: 8, padding: '10px 12px' }}>
                        <div style={{ fontSize: 13, color: 'var(--text-primary)', lineHeight: 1.5 }}>✓ {aiPreview.explanation}</div>
                        <div style={{ display: 'flex', gap: 6, marginTop: 9 }}>
                          <button onClick={confirmRule} style={{ padding: '7px 16px', borderRadius: 6, border: 'none', background: '#00c875', color: '#fff', fontWeight: 700, fontSize: 12.5, cursor: 'pointer' }}>Create this rule</button>
                          <button onClick={() => setAiPreview(null)} style={{ padding: '7px 14px', borderRadius: 6, border: '1px solid var(--border-color)', background: 'transparent', color: 'var(--text-secondary)', fontSize: 12.5, cursor: 'pointer' }}>Discard</button>
                        </div>
                      </div>
                    )}
                  </div>

                  <p style={{ fontSize: 12, fontWeight: 800, color: 'var(--text-secondary)', textTransform: 'uppercase', letterSpacing: 0.5, margin: '0 0 12px' }}>Pick a template</p>
                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(238px, 1fr))', gap: 12 }}>
                    {TEMPLATES.map(t => (
                      <button key={t.id} className="auto-tpl-card"
                        onClick={() => { setBuilderInit(templateRecipe(t)); setView('builder'); }}
                        style={{ textAlign: 'left', cursor: 'pointer', border: '1.5px solid var(--border-color,#e6e6e6)', borderRadius: 12, padding: '15px 15px', background: 'var(--card-bg,#fff)', display: 'flex', flexDirection: 'column' }}>
                        <div style={{ fontSize: 22 }}>{t.icon}</div>
                        <div style={{ fontWeight: 800, fontSize: 14, color: 'var(--text-primary)', marginTop: 8 }}>{t.title}</div>
                        <div style={{ fontSize: 12.5, color: 'var(--text-secondary)', marginTop: 5, lineHeight: 1.5 }}>{t.sentence}</div>
                      </button>
                    ))}
                    <button className="auto-tpl-card"
                      onClick={() => { setBuilderInit(null); setView('builder'); }}
                      style={{ textAlign: 'left', cursor: 'pointer', border: '1.5px dashed var(--border-color,#cfcfcf)', borderRadius: 12, padding: '15px 15px', background: 'transparent', display: 'flex', flexDirection: 'column' }}>
                      <div style={{ fontSize: 22 }}>✏️</div>
                      <div style={{ fontWeight: 800, fontSize: 14, color: 'var(--text-primary)', marginTop: 8 }}>Start from scratch</div>
                      <div style={{ fontSize: 12.5, color: 'var(--text-secondary)', marginTop: 5, lineHeight: 1.5 }}>Build a custom rule step by step</div>
                    </button>
                  </div>
                </>
              )}

              {/* ── BUILDER VIEW ──────────────────────────────────────── */}
              {view === 'builder' && (
                <>
                  <button onClick={() => setView('gallery')}
                    style={{ background: 'none', border: 'none', color: '#9b72f5', fontWeight: 700, fontSize: 13.5, cursor: 'pointer', padding: '4px 0', marginBottom: 14 }}>
                    ← Back to templates
                  </button>
                  <AutomationForm
                    boardId={boardId} columns={columns} groups={groups} members={members} initial={builderInit}
                    onSave={handleCreate} onCancel={() => setView('gallery')}
                  />
                </>
              )}
            </>
          )}

          {/* ── Date Cascade tab ──────────────────────────────────────── */}
          {activeTab === 'cascade' && (
            <DateCascadeTab boardId={boardId} boardName={boardName} columns={columns} />
          )}
        </div>
      </div>
    </div>
  );
}
