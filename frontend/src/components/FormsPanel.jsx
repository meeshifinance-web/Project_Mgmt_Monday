import React, { useState, useEffect, useCallback, useRef } from 'react';
import { getForms, createForm, getForm, updateForm, deleteForm, saveFormFields, shareForm, getFormQr } from '../api';
import { useToast } from './Toast';
import { useThemeContext } from '../context/ThemeContext';

const SKIP_TYPES = ['formula', 'creation_log', 'time_tracking'];
const BASE_URL = window.location.origin;
const ACCENT_PRESETS = ['#9b72f5', '#0073ea', '#00c875', '#e2445c', '#fdab3d', '#a25ddc', '#0086c0', '#ff642e', '#333333'];
const CHOICE_TYPES = ['status', 'priority', 'dropdown', 'checkbox'];

const DEFAULT_STATUS_OPTIONS = ['Not Started', 'In Progress', 'Done', 'Stuck'];
const DEFAULT_PRIORITY_OPTIONS = ['Critical', 'High', 'Medium', 'Low'];

function parseSettings(raw) {
  try { return typeof raw === 'string' ? JSON.parse(raw) : (raw || {}); }
  catch { return {}; }
}

function parseLogic(raw) {
  if (!raw) return [];
  if (Array.isArray(raw)) return raw;
  try {
    const parsed = typeof raw === 'string' ? JSON.parse(raw) : raw;
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function toDateTimeLocal(value) {
  if (!value) return '';
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return '';
  const local = new Date(d.getTime() - d.getTimezoneOffset() * 60000);
  return local.toISOString().slice(0, 16);
}

function choiceOptions(field) {
  if (!field) return [];
  if (field.column_type === 'checkbox') return ['true', 'false'];
  if (field.column_type === 'priority') return DEFAULT_PRIORITY_OPTIONS;
  const s = parseSettings(field.column_settings);
  if (Array.isArray(s.options)) return s.options.map(o => typeof o === 'string' ? o : o.label).filter(Boolean);
  if (field.column_type === 'status') return DEFAULT_STATUS_OPTIONS;
  return [];
}

function copyTextToClipboard(text) {
  if (navigator.clipboard && window.isSecureContext) return navigator.clipboard.writeText(text);
  return new Promise((resolve, reject) => {
    const el = Object.assign(document.createElement('textarea'), { value: text, style: 'position:fixed;top:-9999px;opacity:0' });
    document.body.appendChild(el);
    el.focus();
    el.select();
    try { document.execCommand('copy') ? resolve() : reject(); } catch (e) { reject(e); }
    finally { document.body.removeChild(el); }
  });
}

function Toggle({ on, onChange, color = '#9b72f5' }) {
  return (
    <button
      type="button"
      onClick={onChange}
      style={{
        width: 38, height: 22, borderRadius: 999, border: 'none', padding: 3,
        background: on ? color : 'rgba(148,163,184,0.55)', cursor: 'pointer',
        display: 'flex', justifyContent: on ? 'flex-end' : 'flex-start', alignItems: 'center',
      }}
    >
      <span style={{ width: 16, height: 16, borderRadius: '50%', background: '#fff', display: 'block', boxShadow: '0 1px 4px rgba(0,0,0,0.25)' }} />
    </button>
  );
}

function Field({ label, children, hint }) {
  return (
    <div>
      <label style={{ display: 'block', fontSize: 11, fontWeight: 800, color: 'var(--text-secondary)', marginBottom: 6, textTransform: 'uppercase', letterSpacing: 0.6 }}>{label}</label>
      {children}
      {hint && <div style={{ fontSize: 11.5, color: 'var(--text-muted)', marginTop: 5, lineHeight: 1.4 }}>{hint}</div>}
    </div>
  );
}

const inp = {
  width: '100%', border: '1.5px solid var(--border-color)', borderRadius: 8, padding: '9px 12px',
  fontSize: 13, outline: 'none', boxSizing: 'border-box', background: 'var(--card-bg)', color: 'var(--text-primary)',
};

const smallBtn = (primary, color = '#9b72f5') => ({
  padding: '7px 12px', borderRadius: 7, fontSize: 12, fontWeight: 700, cursor: 'pointer',
  border: `1.5px solid ${primary ? color : 'var(--border-color)'}`,
  background: primary ? color : 'var(--bg-secondary)', color: primary ? '#fff' : 'var(--text-secondary)',
});

function SettingRow({ title, description, checked, onChange, children }) {
  return (
    <div style={{ border: '1.5px solid var(--border-color)', borderRadius: 8, padding: 12, background: 'var(--bg-secondary)' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, alignItems: 'flex-start' }}>
        <div>
          <div style={{ fontSize: 13, fontWeight: 800, color: 'var(--text-primary)' }}>{title}</div>
          {description && <div style={{ fontSize: 11.5, color: 'var(--text-secondary)', marginTop: 3, lineHeight: 1.4 }}>{description}</div>}
        </div>
        <Toggle on={checked} onChange={onChange} />
      </div>
      {checked && children && <div style={{ marginTop: 12 }}>{children}</div>}
    </div>
  );
}

function previewControl(field) {
  const type = field.column_type;
  const placeholder = field.placeholder || 'Type your answer...';
  switch (type) {
    case 'long_text':
      return <textarea disabled rows={3} placeholder={placeholder} style={{ ...previewInput, resize: 'none' }} />;
    case 'date':
      return <input disabled type="date" style={previewInput} />;
    case 'timeline':
      return (
        <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
          <input disabled type="date" style={{ ...previewInput, flex: 1 }} />
          <span style={{ color: '#888', fontSize: 13 }}>to</span>
          <input disabled type="date" style={{ ...previewInput, flex: 1 }} />
        </div>
      );
    case 'file':
      return <div style={{ ...previewInput, color: '#676879' }}>Attach files</div>;
    case 'rating':
      return <div style={{ display: 'flex', gap: 6, fontSize: 26, color: '#c4c4c4' }}>{[1, 2, 3, 4, 5].map(i => <span key={i}>o</span>)}</div>;
    case 'color_picker':
      return (
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <span style={{ width: 40, height: 32, borderRadius: 8, border: '1px solid #d0d4e4', background: '#9b72f5', display: 'block' }} />
          <span style={{ fontSize: 12, color: '#676879', fontFamily: 'monospace' }}>#9b72f5</span>
        </div>
      );
    case 'progress':
      return (
        <div>
          <input disabled type="range" min="0" max="100" defaultValue={40} style={{ width: '100%', accentColor: '#9b72f5', margin: '6px 0 4px' }} />
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <div style={{ flex: 1, background: '#e0e0e0', borderRadius: 4, height: 8, overflow: 'hidden' }}><div style={{ width: '40%', height: '100%', background: '#9b72f5' }} /></div>
            <span style={{ fontSize: 13, fontWeight: 800, color: '#9b72f5', minWidth: 34 }}>40%</span>
          </div>
        </div>
      );
    default:
      break;
  }
  if (CHOICE_TYPES.includes(type)) {
    return (
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
        {choiceOptions(field).slice(0, 4).map(o => <span key={o} style={{ border: '1px solid #d0d4e4', borderRadius: 999, padding: '5px 10px', fontSize: 12, color: '#676879' }}>{o === 'true' ? 'Yes' : o === 'false' ? 'No' : o}</span>)}
      </div>
    );
  }
  return <input disabled placeholder={placeholder} style={previewInput} />;
}

function PreviewField({ field }) {
  const label = field.label || field.column_title;
  const control = previewControl(field);
  return (
    <div style={{ marginBottom: 18 }}>
      <label style={{ display: 'block', marginBottom: 6, fontSize: 13, fontWeight: 700, color: '#323338' }}>
        {label}{field.is_required && <span style={{ color: '#e2445c', marginLeft: 3 }}>*</span>}
      </label>
      {field.help_text && <div style={{ fontSize: 12, color: '#676879', marginBottom: 6 }}>{field.help_text}</div>}
      {control}
    </div>
  );
}

const previewInput = {
  width: '100%', border: '1.5px solid #e0e0e0', borderRadius: 8, padding: '10px 12px',
  fontSize: 13, boxSizing: 'border-box', background: '#fff', color: '#323338',
};

function FormPreview({ form, fields, itemNameLabel }) {
  const color = form.cover_color || '#9b72f5';
  const visible = fields.filter(f => f.is_visible);
  return (
    <div className="simplix-form-light" style={{ background: '#f0f2f5', borderRadius: 12, overflow: 'hidden', boxShadow: '0 8px 28px rgba(0,0,0,0.12)' }}>
      <div style={{ background: color, padding: '28px 26px 24px' }}>
        <div style={{ color: '#fff', fontWeight: 800, fontSize: 22, lineHeight: 1.3 }}>{form.title || 'Untitled Form'}</div>
        {form.description && <div style={{ color: 'rgba(255,255,255,0.86)', fontSize: 13, marginTop: 7, lineHeight: 1.5 }}>{form.description}</div>}
      </div>
      {form.progress_bar_enabled && <div style={{ height: 5, background: '#dfe3ee' }}><div style={{ width: '35%', height: '100%', background: color }} /></div>}
      <div style={{ background: '#fff', margin: 16, padding: 22, borderRadius: 10 }}>
        <PreviewField field={{ label: itemNameLabel || 'Item Name', is_required: true, column_type: 'text' }} />
        {visible.map(f => <PreviewField key={f.column_id} field={f} />)}
        <button disabled style={{ width: '100%', border: 'none', borderRadius: 8, background: color, color: '#fff', padding: '12px 0', fontWeight: 800, fontSize: 14 }}>
          {form.submit_button_text || 'Submit'}
        </button>
      </div>
      {!form.hide_branding && <div style={{ textAlign: 'center', padding: '0 0 14px', fontSize: 11, color: '#999' }}>Powered by Simplix</div>}
    </div>
  );
}

const LOAD_SENTINEL = Symbol('form-unloaded');

// ── Share tab: public link, email-the-form, QR code, embed ────────────────────
function ShareSection({ formId, slug, publicUrl, embedCode }) {
  const toast = useToast();
  const [qr, setQr] = useState(null);
  const [emails, setEmails] = useState('');
  const [includeMembers, setIncludeMembers] = useState(false);
  const [sending, setSending] = useState(false);

  useEffect(() => {
    let alive = true;
    if (formId) getFormQr(formId).then(r => { if (alive) setQr(r.data.data_url); }).catch(() => {});
    return () => { alive = false; };
  }, [formId]);

  const downloadQr = () => {
    if (!qr) return;
    const a = Object.assign(document.createElement('a'), { href: qr, download: `form-${slug}-qr.png` });
    document.body.appendChild(a); a.click(); a.remove();
  };

  const handleShare = async () => {
    const list = emails.split(',').map(e => e.trim()).filter(Boolean);
    if (!list.length && !includeMembers) { toast('Add an email address or tick board members', 'error'); return; }
    setSending(true);
    try {
      const r = await shareForm(formId, { emails: list, include_members: includeMembers });
      toast(`Form sent to ${r.data.sent} recipient${r.data.sent === 1 ? '' : 's'}`, 'success');
      setEmails('');
    } catch (e) {
      toast(e.response?.data?.error || 'Failed to send', 'error');
    } finally { setSending(false); }
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <Field label="Public URL">
        <div style={{ display: 'flex', gap: 8 }}>
          <input readOnly value={publicUrl} style={{ ...inp, flex: 1, background: 'var(--bg-secondary)' }} />
          <button onClick={() => copyTextToClipboard(publicUrl).then(() => toast('Link copied', 'success'))} style={smallBtn(true)}>Copy</button>
        </div>
      </Field>

      <Field label="Share by email" hint="Emails the public link. Recipients are BCC'd, so external addresses never see each other.">
        <textarea value={emails} onChange={e => setEmails(e.target.value)} rows={2}
          placeholder="Comma-separated emails — e.g. a@example.com, b@example.com" style={{ ...inp, resize: 'vertical' }} />
        <label style={{ display: 'flex', alignItems: 'center', gap: 7, fontSize: 12, color: 'var(--text-secondary)', margin: '8px 0' }}>
          <input type="checkbox" checked={includeMembers} onChange={e => setIncludeMembers(e.target.checked)} />
          Also send to all board members
        </label>
        <button onClick={handleShare} disabled={sending} style={{ ...smallBtn(true), width: '100%', opacity: sending ? 0.7 : 1 }}>
          {sending ? 'Sending…' : 'Send form link'}
        </button>
      </Field>

      <Field label="QR code">
        {qr ? (
          <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
            <img src={qr} alt="Form QR code" width={120} height={120} style={{ borderRadius: 8, border: '1px solid var(--border-color)', background: '#fff' }} />
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              <div style={{ fontSize: 12, color: 'var(--text-secondary)', lineHeight: 1.5 }}>Point a phone camera here to open the form.</div>
              <button onClick={downloadQr} style={smallBtn(false)}>Download PNG</button>
            </div>
          </div>
        ) : <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>Generating QR…</div>}
      </Field>

      <Field label="Embed code">
        <textarea readOnly value={embedCode} rows={4} style={{ ...inp, resize: 'none', fontFamily: 'monospace', fontSize: 11, background: 'var(--bg-secondary)' }} />
        <button onClick={() => copyTextToClipboard(embedCode).then(() => toast('Embed copied', 'success'))} style={{ ...smallBtn(false), marginTop: 8, width: '100%' }}>Copy embed</button>
      </Field>

      <button onClick={() => window.open(`/form/${slug}`, '_blank')} style={smallBtn(false)}>Open preview</button>
    </div>
  );
}

function FormBuilder({ boardId, formId, groups, columns, onBack, onSaved }) {
  const toast = useToast();
  const [saving, setSaving] = useState(false);
  const [activeSection, setSection] = useState('basic');
  const [slug, setSlug] = useState('');
  const [fields, setFields] = useState([]);
  const [form, setForm] = useState({
    title: 'Untitled Form',
    description: '',
    cover_color: '#9b72f5',
    target_group_id: '',
    thank_you_message: 'Your response has been submitted.',
    thank_you_title: 'Thank you!',
    closed_message: 'This form is no longer accepting responses.',
    is_active: true,
    item_name_label: 'Item Name',
    opens_at: '',
    closes_at: '',
    response_limit: '',
    captcha_enabled: false,
    hide_branding: false,
    progress_bar_enabled: false,
    submit_button_text: 'Submit',
    redirect_url: '',
    confirmation_email_enabled: false,
    confirmation_email_column_id: '',
    confirmation_email_subject: 'We received your response',
    confirmation_email_body: 'Thanks for submitting the form. We have received your response.',
    notify_on_submission: false,
  });

  const setFormValue = (key, value) => setForm(f => ({ ...f, [key]: value }));

  const buildFieldsList = useCallback((savedFields) => {
    const usable = columns.filter(c => !SKIP_TYPES.includes(c.type));
    const savedMap = {};
    savedFields.forEach(f => { savedMap[f.column_id] = f; });
    const list = usable.map((col, idx) => {
      const saved = savedMap[col.id];
      return {
        column_id: col.id,
        column_title: col.title,
        column_type: col.type,
        column_settings: col.settings,
        label: saved?.label || col.title,
        help_text: saved?.help_text || '',
        placeholder: saved?.placeholder || '',
        conditional_logic: parseLogic(saved?.conditional_logic),
        is_required: saved?.is_required || false,
        is_visible: saved ? saved.is_visible : false,
        position: saved?.position ?? idx,
      };
    });
    list.sort((a, b) => {
      if (a.is_visible !== b.is_visible) return a.is_visible ? -1 : 1;
      return a.position - b.position;
    });
    setFields(list);
  }, [columns]);

  // Load the form + build the field list ONCE per formId. Previously this
  // effect also depended on buildFieldsList/groups.length, so any parent
  // re-render that changed the `columns` reference (e.g. the real-time board
  // poll, or switching builder tabs) re-ran it and rebuilt `fields` from the
  // saved state — silently wiping the user's in-progress field selections.
  const loadedFormRef = useRef(LOAD_SENTINEL); // distinct from any real/undefined formId
  useEffect(() => {
    if (loadedFormRef.current === formId) return; // already loaded this form
    loadedFormRef.current = formId;
    if (!formId) {
      buildFieldsList([]);
      if (groups.length > 0) setFormValue('target_group_id', String(groups[0].id));
      return;
    }
    getForm(formId).then(r => {
      const f = r.data;
      setSlug(f.slug || '');
      setForm({
        title: f.title || '',
        description: f.description || '',
        cover_color: f.cover_color || '#9b72f5',
        target_group_id: f.target_group_id ? String(f.target_group_id) : '',
        thank_you_message: f.thank_you_message || 'Your response has been submitted.',
        thank_you_title: f.thank_you_title || 'Thank you!',
        closed_message: f.closed_message || 'This form is no longer accepting responses.',
        is_active: f.is_active !== false,
        item_name_label: f.item_name_label || 'Item Name',
        opens_at: toDateTimeLocal(f.opens_at),
        closes_at: toDateTimeLocal(f.closes_at),
        response_limit: f.response_limit || '',
        captcha_enabled: !!f.captcha_enabled,
        hide_branding: !!f.hide_branding,
        progress_bar_enabled: !!f.progress_bar_enabled,
        submit_button_text: f.submit_button_text || 'Submit',
        redirect_url: f.redirect_url || '',
        confirmation_email_enabled: !!f.confirmation_email_enabled,
        confirmation_email_column_id: f.confirmation_email_column_id ? String(f.confirmation_email_column_id) : '',
        confirmation_email_subject: f.confirmation_email_subject || 'We received your response',
        confirmation_email_body: f.confirmation_email_body || 'Thanks for submitting the form. We have received your response.',
        notify_on_submission: !!f.notify_on_submission,
      });
      buildFieldsList(f.fields || []);
    }).catch(() => toast('Failed to load form', 'error'));
  }, [formId, buildFieldsList, groups.length]);

  const updateField = (id, patch) => setFields(p => p.map(f => f.column_id === id ? { ...f, ...patch } : f));
  const visibleFields = fields.filter(f => f.is_visible);
  const choiceFields = visibleFields.filter(f => CHOICE_TYPES.includes(f.column_type));
  const emailFields = visibleFields.filter(f => f.column_type === 'email');

  const payload = (activeOverride) => ({
    ...form,
    title: form.title.trim() || 'Untitled Form',
    target_group_id: form.target_group_id ? parseInt(form.target_group_id) : null,
    response_limit: form.response_limit ? parseInt(form.response_limit) : null,
    confirmation_email_column_id: form.confirmation_email_column_id ? parseInt(form.confirmation_email_column_id) : null,
    item_name_label: form.item_name_label.trim() || 'Item Name',
    is_active: activeOverride ?? form.is_active,
  });

  const handleToggleActive = async () => {
    const next = !form.is_active;
    setFormValue('is_active', next);
    if (!formId) return;
    try {
      await updateForm(formId, payload(next));
      toast(next ? 'Form activated' : 'Form deactivated', 'success');
    } catch {
      setFormValue('is_active', !next);
      toast('Failed to update form status', 'error');
    }
  };

  const handleSave = async () => {
    setSaving(true);
    try {
      let saved;
      if (formId) saved = (await updateForm(formId, payload())).data;
      else {
        saved = (await createForm(boardId, payload())).data;
        setSlug(saved.slug);
      }
      const selected = visibleFields.map((f, i) => ({
        column_id: f.column_id,
        label: f.label || f.column_title,
        help_text: f.help_text || '',
        placeholder: f.placeholder || '',
        conditional_logic: parseLogic(f.conditional_logic),
        is_required: f.is_required,
        position: i,
        is_visible: true,
      }));
      await saveFormFields(saved.id, selected);
      toast('Form saved', 'success');
      onSaved(saved);
    } catch (err) {
      toast('Failed to save form', 'error');
    } finally {
      setSaving(false);
    }
  };

  const publicUrl = slug ? `${BASE_URL}/form/${slug}` : '';
  const embedCode = slug ? `<iframe src="${BASE_URL}/form/${slug}" width="100%" height="700" frameborder="0" style="border-radius:12px;border:none"></iframe>` : '';
  const sections = [
    ['basic', 'Basic'],
    ['fields', `Fields${visibleFields.length ? ` (${visibleFields.length})` : ''}`],
    ['logic', 'Logic'],
    ['behavior', 'Settings'],
    ...(slug ? [['share', 'Share']] : []),
  ];

  return (
    <div style={{ display: 'flex', height: '100%', overflow: 'hidden', fontFamily: "'Inter', -apple-system, sans-serif" }}>
      <div className="forms-builder-editor" style={{ width: 430, flexShrink: 0, display: 'flex', flexDirection: 'column', background: 'var(--card-bg)', borderRight: '1px solid var(--border-color)', overflow: 'hidden' }}>
        <div style={{ padding: '14px 18px', borderBottom: '1px solid var(--border-color)', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10 }}>
          <button onClick={onBack} style={{ ...smallBtn(false), background: 'transparent', border: 'none', color: '#9b72f5' }}>Back</button>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <Toggle on={form.is_active} onChange={handleToggleActive} color="#00c875" />
            <span style={{ fontSize: 12, fontWeight: 800, color: form.is_active ? '#00a25f' : 'var(--text-secondary)' }}>{form.is_active ? 'Active' : 'Inactive'}</span>
            <button onClick={handleSave} disabled={saving} style={{ ...smallBtn(true), opacity: saving ? 0.7 : 1 }}>{saving ? 'Saving...' : formId ? 'Save' : 'Create'}</button>
          </div>
        </div>

        <div style={{ padding: '10px 14px', borderBottom: '1px solid var(--border-color)', display: 'flex', gap: 5, flexWrap: 'wrap' }}>
          {sections.map(([key, label]) => (
            <button key={key} onClick={() => setSection(key)} style={{
              ...smallBtn(activeSection === key),
              padding: '7px 10px',
              fontSize: 12,
            }}>{label}</button>
          ))}
        </div>

        <div style={{ flex: 1, overflowY: 'auto', padding: 18 }}>
          {activeSection === 'basic' && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
              <Field label="Form title"><input value={form.title} onChange={e => setFormValue('title', e.target.value)} style={inp} /></Field>
              <Field label="Description"><textarea value={form.description} onChange={e => setFormValue('description', e.target.value)} rows={3} style={{ ...inp, resize: 'vertical', lineHeight: 1.5 }} /></Field>
              <Field label="Item name label"><input value={form.item_name_label} onChange={e => setFormValue('item_name_label', e.target.value)} style={inp} /></Field>
              <Field label="Cover color">
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                  <input type="color" value={form.cover_color} onChange={e => setFormValue('cover_color', e.target.value)} style={{ width: 42, height: 38, border: '1px solid var(--border-color)', borderRadius: 8, padding: 3 }} />
                  {ACCENT_PRESETS.map(c => <button key={c} type="button" onClick={() => setFormValue('cover_color', c)} style={{ width: 22, height: 22, borderRadius: '50%', border: c === form.cover_color ? '3px solid var(--text-primary)' : '1px solid var(--border-color)', background: c, cursor: 'pointer' }} />)}
                </div>
              </Field>
              <Field label="Target group">
                <select value={form.target_group_id} onChange={e => setFormValue('target_group_id', e.target.value)} style={inp}>
                  <option value="">First group</option>
                  {groups.map(g => <option key={g.id} value={String(g.id)}>{g.name}</option>)}
                </select>
              </Field>
            </div>
          )}

          {activeSection === 'fields' && (
            <div>
              <div style={{ fontSize: 12, color: 'var(--text-secondary)', lineHeight: 1.5, marginBottom: 14 }}>Turn board columns into form questions, then add helper text, placeholders, and required validation.</div>
              {fields.map(f => (
                <div key={f.column_id} style={{
                  border: f.is_visible ? '1.5px solid #9b72f5' : '1.5px solid var(--border-color)',
                  borderRadius: 8, padding: 12, marginBottom: 10,
                  background: f.is_visible ? 'rgba(155,114,245,0.08)' : 'var(--bg-secondary)',
                }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                    <Toggle on={f.is_visible} onChange={() => updateField(f.column_id, { is_visible: !f.is_visible })} />
                    <div style={{ flex: 1, minWidth: 0 }}>
                      {f.is_visible ? (
                        // Editable question label when the field is included on the form
                        <input value={f.label} onChange={e => updateField(f.column_id, { label: e.target.value })} style={{ ...inp, padding: '7px 9px', fontWeight: 700 }} />
                      ) : (
                        // Toggled-off: show the column name as plain, readable text
                        // (a disabled input greyed it out so you couldn't tell what it was)
                        <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--text-primary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{f.label || f.column_title}</div>
                      )}
                      <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 4 }}>{f.column_type}</div>
                    </div>
                    {f.is_visible ? (
                      <label style={{ display: 'flex', alignItems: 'center', gap: 5, fontSize: 11, fontWeight: 800, color: f.is_required ? '#e2445c' : 'var(--text-secondary)', cursor: 'pointer' }}>
                        <input type="checkbox" checked={f.is_required} onChange={() => updateField(f.column_id, { is_required: !f.is_required })} />
                        Required
                      </label>
                    ) : (
                      <span style={{ fontSize: 11, fontWeight: 700, color: 'var(--text-muted)' }}>Off</span>
                    )}
                  </div>
                  {f.is_visible && (
                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, marginTop: 10 }}>
                      <input value={f.placeholder || ''} onChange={e => updateField(f.column_id, { placeholder: e.target.value })} placeholder="Placeholder" style={inp} />
                      <input value={f.help_text || ''} onChange={e => updateField(f.column_id, { help_text: e.target.value })} placeholder="Helper text" style={inp} />
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}

          {activeSection === 'logic' && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
              <div style={{ fontSize: 12, color: 'var(--text-secondary)', lineHeight: 1.5 }}>Show follow-up questions only when a previous choice question has a matching answer. Multiple rules use OR logic.</div>
              {visibleFields.map(target => {
                const rules = parseLogic(target.conditional_logic);
                return (
                  <div key={target.column_id} style={{ border: '1.5px solid var(--border-color)', borderRadius: 8, padding: 12, background: 'var(--bg-secondary)' }}>
                    <div style={{ fontSize: 13, fontWeight: 800, color: 'var(--text-primary)', marginBottom: 8 }}>{target.label || target.column_title}</div>
                    {rules.length === 0 ? (
                      <button
                        type="button"
                        onClick={() => {
                          const source = choiceFields.find(f => f.column_id !== target.column_id);
                          if (!source) return toast('Add a status, dropdown, priority, or checkbox field first', 'error');
                          updateField(target.column_id, { conditional_logic: [{ source_column_id: source.column_id, operator: 'equals', value: choiceOptions(source)[0] || '' }] });
                        }}
                        style={smallBtn(false)}
                      >Add logic</button>
                    ) : rules.map((rule, idx) => {
                      const source = fields.find(f => String(f.column_id) === String(rule.source_column_id));
                      const options = choiceOptions(source);
                      return (
                        <div key={idx} style={{ display: 'grid', gridTemplateColumns: '1fr 92px 1fr auto', gap: 6, alignItems: 'center', marginBottom: 7 }}>
                          <select value={rule.source_column_id || ''} onChange={e => {
                            const nextSource = fields.find(f => String(f.column_id) === e.target.value);
                            const next = rules.map((r, i) => i === idx ? { ...r, source_column_id: e.target.value, value: choiceOptions(nextSource)[0] || '' } : r);
                            updateField(target.column_id, { conditional_logic: next });
                          }} style={inp}>
                            {choiceFields.filter(f => f.column_id !== target.column_id).map(f => <option key={f.column_id} value={f.column_id}>{f.label || f.column_title}</option>)}
                          </select>
                          <select value={rule.operator || 'equals'} onChange={e => {
                            const next = rules.map((r, i) => i === idx ? { ...r, operator: e.target.value } : r);
                            updateField(target.column_id, { conditional_logic: next });
                          }} style={inp}>
                            <option value="equals">is</option>
                            <option value="not_equals">is not</option>
                            <option value="contains">contains</option>
                          </select>
                          <select value={rule.value || ''} onChange={e => {
                            const next = rules.map((r, i) => i === idx ? { ...r, value: e.target.value } : r);
                            updateField(target.column_id, { conditional_logic: next });
                          }} style={inp}>
                            {options.map(o => <option key={o} value={o}>{o === 'true' ? 'Checked' : o === 'false' ? 'Unchecked' : o}</option>)}
                          </select>
                          <button type="button" onClick={() => updateField(target.column_id, { conditional_logic: rules.filter((_, i) => i !== idx) })} style={{ ...smallBtn(false), color: '#e2445c' }}>Remove</button>
                        </div>
                      );
                    })}
                    {rules.length > 0 && (
                      <button type="button" onClick={() => {
                        const source = choiceFields.find(f => f.column_id !== target.column_id);
                        updateField(target.column_id, { conditional_logic: [...rules, { source_column_id: source?.column_id || '', operator: 'equals', value: choiceOptions(source)[0] || '' }] });
                      }} style={smallBtn(false)}>Add OR rule</button>
                    )}
                  </div>
                );
              })}
              {visibleFields.length === 0 && <div style={{ color: 'var(--text-muted)', fontSize: 13 }}>Choose fields first.</div>}
            </div>
          )}

          {activeSection === 'behavior' && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
              <Field label="Submit button text"><input value={form.submit_button_text} onChange={e => setFormValue('submit_button_text', e.target.value)} style={inp} /></Field>
              <Field label="Thank-you title"><input value={form.thank_you_title} onChange={e => setFormValue('thank_you_title', e.target.value)} style={inp} /></Field>
              <Field label="Thank-you message"><textarea value={form.thank_you_message} onChange={e => setFormValue('thank_you_message', e.target.value)} rows={3} style={{ ...inp, resize: 'vertical' }} /></Field>
              <Field label="Closed message"><textarea value={form.closed_message} onChange={e => setFormValue('closed_message', e.target.value)} rows={3} style={{ ...inp, resize: 'vertical' }} /></Field>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
                <Field label="Open date"><input type="datetime-local" value={form.opens_at} onChange={e => setFormValue('opens_at', e.target.value)} style={inp} /></Field>
                <Field label="Close date"><input type="datetime-local" value={form.closes_at} onChange={e => setFormValue('closes_at', e.target.value)} style={inp} /></Field>
              </div>
              <Field label="Response limit"><input type="number" min="1" value={form.response_limit} onChange={e => setFormValue('response_limit', e.target.value)} placeholder="Unlimited" style={inp} /></Field>
              <SettingRow title="CAPTCHA" description="Ask a simple challenge before public submission." checked={form.captcha_enabled} onChange={() => setFormValue('captcha_enabled', !form.captcha_enabled)} />
              <SettingRow title="Progress bar" description="Show a progress bar above the form body." checked={form.progress_bar_enabled} onChange={() => setFormValue('progress_bar_enabled', !form.progress_bar_enabled)} />
              <SettingRow title="Hide branding" description="Remove the Simplix footer from the public form." checked={form.hide_branding} onChange={() => setFormValue('hide_branding', !form.hide_branding)} />
              <SettingRow title="Redirect after submit" checked={!!form.redirect_url} onChange={() => setFormValue('redirect_url', form.redirect_url ? '' : 'https://')}>
                <input value={form.redirect_url} onChange={e => setFormValue('redirect_url', e.target.value)} placeholder="https://example.com/thanks" style={inp} />
              </SettingRow>
              <SettingRow title="Confirmation email" description="Send a receipt to the respondent using an email question." checked={form.confirmation_email_enabled} onChange={() => setFormValue('confirmation_email_enabled', !form.confirmation_email_enabled)}>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                  <select value={form.confirmation_email_column_id} onChange={e => setFormValue('confirmation_email_column_id', e.target.value)} style={inp}>
                    <option value="">First email field</option>
                    {emailFields.map(f => <option key={f.column_id} value={String(f.column_id)}>{f.label || f.column_title}</option>)}
                  </select>
                  <input value={form.confirmation_email_subject} onChange={e => setFormValue('confirmation_email_subject', e.target.value)} placeholder="Subject" style={inp} />
                  <textarea value={form.confirmation_email_body} onChange={e => setFormValue('confirmation_email_body', e.target.value)} rows={3} placeholder="Email body" style={{ ...inp, resize: 'vertical' }} />
                </div>
              </SettingRow>
              <SettingRow title="Notify team on new response" description="Every submission notifies all board members in-app, and emails them a link to the new item." checked={form.notify_on_submission} onChange={() => setFormValue('notify_on_submission', !form.notify_on_submission)} />
            </div>
          )}

          {activeSection === 'share' && slug && (
            <ShareSection formId={formId} slug={slug} publicUrl={publicUrl} embedCode={embedCode} />
          )}
        </div>
      </div>

      <div className="forms-live-preview-pane" style={{ flex: 1, background: 'var(--bg-secondary)', overflowY: 'auto', padding: '28px 32px' }}>
        <div style={{ maxWidth: 500, margin: '0 auto' }}>
          <div style={{ textAlign: 'center', fontSize: 11, color: 'var(--text-secondary)', fontWeight: 800, letterSpacing: 0.8, textTransform: 'uppercase', marginBottom: 14 }}>Live preview</div>
          <FormPreview form={form} fields={fields} itemNameLabel={form.item_name_label} />
        </div>
      </div>
    </div>
  );
}

function FormsList({ boardId, onOpenBuilder }) {
  const [forms, setForms] = useState([]);
  const [loading, setLoading] = useState(true);
  const toast = useToast();

  const load = useCallback(() => {
    setLoading(true);
    getForms(boardId).then(r => setForms(r.data)).catch(() => toast('Failed to load forms', 'error')).finally(() => setLoading(false));
  }, [boardId]);

  useEffect(() => { load(); }, [load]);

  const handleDelete = async id => {
    if (!confirm('Delete this form? This cannot be undone.')) return;
    try {
      await deleteForm(id);
      setForms(f => f.filter(x => x.id !== id));
      toast('Form deleted');
    } catch {
      toast('Failed to delete form', 'error');
    }
  };

  return (
    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden', fontFamily: "'Inter', -apple-system, sans-serif" }}>
      <div style={{ padding: '16px 24px', borderBottom: '1px solid var(--border-color)', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}>
        <div style={{ fontSize: 13, color: 'var(--text-secondary)' }}>Create shareable forms that add items directly to your board</div>
        <button onClick={() => onOpenBuilder(null)} style={smallBtn(true)}>Create Form</button>
      </div>
      <div style={{ flex: 1, overflowY: 'auto', padding: 24 }}>
        {loading ? (
          <div style={{ textAlign: 'center', padding: 60, color: 'var(--text-secondary)' }}>Loading forms...</div>
        ) : forms.length === 0 ? (
          <div style={{ textAlign: 'center', padding: '60px 20px', color: 'var(--text-secondary)', maxWidth: 360, margin: '0 auto' }}>
            <div style={{ fontSize: 17, fontWeight: 800, color: 'var(--text-primary)', marginBottom: 8 }}>No forms yet</div>
            <div style={{ fontSize: 13, marginBottom: 24, lineHeight: 1.6 }}>Create a form to collect submissions directly into this board.</div>
            <button onClick={() => onOpenBuilder(null)} style={smallBtn(true)}>Create your first form</button>
          </div>
        ) : (
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(300px, 1fr))', gap: 16 }}>
            {forms.map(form => {
              const url = `${BASE_URL}/form/${form.slug}`;
              return (
                <div key={form.id} style={{ background: 'var(--card-bg)', borderRadius: 8, overflow: 'hidden', border: '1px solid var(--border-color)', boxShadow: '0 2px 16px rgba(0,0,0,0.07)' }}>
                  <div style={{ height: 6, background: form.cover_color || '#9b72f5' }} />
                  <div style={{ padding: 16 }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', gap: 10, alignItems: 'flex-start' }}>
                      <div style={{ minWidth: 0 }}>
                        <div style={{ fontSize: 15, fontWeight: 800, color: 'var(--text-primary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{form.title}</div>
                        <div style={{ fontSize: 12, color: 'var(--text-secondary)', marginTop: 3 }}>{form.target_group_name || 'First group'} · {form.response_count || 0} responses</div>
                      </div>
                      <span style={{ padding: '3px 9px', borderRadius: 999, fontSize: 11, fontWeight: 800, background: form.is_active ? 'rgba(0,200,117,0.12)' : 'var(--bg-secondary)', color: form.is_active ? '#00a25f' : 'var(--text-secondary)' }}>
                        {form.is_active ? 'Active' : 'Inactive'}
                      </span>
                    </div>
                    <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginTop: 14 }}>
                      <button onClick={() => onOpenBuilder(form.id)} style={smallBtn(true, form.cover_color || '#9b72f5')}>Builder</button>
                      <button onClick={() => copyTextToClipboard(url).then(() => toast('Link copied', 'success'))} style={smallBtn(false)}>Copy link</button>
                      <button onClick={() => window.open(`/form/${form.slug}`, '_blank')} style={smallBtn(false)}>Preview</button>
                      <button onClick={() => handleDelete(form.id)} style={{ ...smallBtn(false), color: '#e2445c', marginLeft: 'auto' }}>Delete</button>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}

export default function FormsPanel({ boardId, groups, columns, onClose }) {
  const [view, setView] = useState('list');
  const [editingFormId, setEditingId] = useState(null);
  const { resolvedTheme } = useThemeContext();
  const isDark = resolvedTheme === 'dark';

  const openBuilder = id => { setEditingId(id); setView('builder'); };
  const handleBack = () => { setView('list'); setEditingId(null); };
  const closeBg = isDark ? 'rgba(255,255,255,0.14)' : '#f1f5f9';
  const closeColor = isDark ? '#E6EAF6' : 'var(--text-secondary)';

  return (
    <div className="wb-side-panel-overlay" style={{ position: 'fixed', inset: 0, background: 'rgba(15,23,42,0.45)', zIndex: 400, display: 'flex', alignItems: 'stretch', justifyContent: 'flex-end' }} onClick={onClose}>
      <div onClick={e => e.stopPropagation()} className="wb-side-panel" style={{ width: view === 'builder' ? '90vw' : 720, maxWidth: '100vw', background: 'var(--bg-primary)', display: 'flex', flexDirection: 'column', boxShadow: '-8px 0 48px rgba(0,0,0,0.18)', overflow: 'hidden', fontFamily: "'Inter', sans-serif" }}>
        <div className="forms-panel-header" style={{ background: 'var(--card-bg)', borderBottom: '1px solid var(--border-color)', padding: '14px 22px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexShrink: 0 }}>
          <div>
            <h2 style={{ fontSize: 15, fontWeight: 800, margin: 0, color: 'var(--text-primary)' }}>Forms</h2>
            <p style={{ fontSize: 12, color: 'var(--text-secondary)', margin: '2px 0 0', fontWeight: 500 }}>
              {view === 'builder' ? 'Design, logic, publishing, and response settings' : 'Collect data from anyone'}
            </p>
          </div>
          <button onClick={onClose} style={{ width: 32, height: 32, borderRadius: '50%', background: closeBg, border: 'none', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 20, fontWeight: 800, color: closeColor }}>x</button>
        </div>
        <div style={{ flex: 1, display: 'flex', overflow: 'hidden' }}>
          {view === 'list' ? (
            <FormsList boardId={boardId} onOpenBuilder={openBuilder} />
          ) : (
            <FormBuilder boardId={boardId} formId={editingFormId} groups={groups} columns={columns} onBack={handleBack} onSaved={f => setEditingId(f.id)} />
          )}
        </div>
      </div>
    </div>
  );
}
