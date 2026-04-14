import React, { useState, useEffect, useCallback } from 'react';
import { getForms, createForm, getForm, updateForm, deleteForm, saveFormFields } from '../api';
import { useToast } from './Toast';

// ── Constants ─────────────────────────────────────────────────────────────────
const SKIP_TYPES = ['formula', 'creation_log', 'time_tracking'];
const BASE_URL   = window.location.origin;

const ACCENT_PRESETS = [
  // Vibrant
  '#0073ea','#00c875','#e2445c','#fdab3d','#a25ddc','#037f4c','#ff5ac4','#0086c0','#ff642e','#333333',
  // Light / muted
  '#94a3b8','#a8b8c8','#b0c4b1','#c9b8d8','#f4a96a','#f9c6c6','#b2d8d8','#c8daf4','#d4c5a9','#d9d9d9',
];

const TYPE_META = {
  text:         { icon: 'Aa', color: '#6366f1' },
  long_text:    { icon: '¶',  color: '#8b5cf6' },
  number:       { icon: '#',  color: '#06b6d4' },
  email:        { icon: '@',  color: '#3b82f6' },
  phone:        { icon: '✆',  color: '#10b981' },
  date:         { icon: '📅', color: '#f59e0b' },
  status:       { icon: '◉',  color: '#0073ea' },
  priority:     { icon: '▲',  color: '#e2445c' },
  dropdown:     { icon: '▾',  color: '#7c3aed' },
  rating:       { icon: '★',  color: '#f59e0b' },
  checkbox:     { icon: '✓',  color: '#00c875' },
  progress:     { icon: '%',  color: '#0073ea' },
  link:         { icon: '🔗', color: '#3b82f6' },
  timeline:     { icon: '⟷', color: '#f59e0b' },
  tags:         { icon: '🏷', color: '#8b5cf6' },
  location:     { icon: '📍', color: '#ef4444' },
  person:       { icon: '👤', color: '#64748b' },
  color_picker: { icon: '🎨', color: '#ec4899' },
  file:         { icon: '📎', color: '#64748b' },
};

function getTypeMeta(t) { return TYPE_META[t] || { icon: '—', color: '#94a3b8' }; }

// ── Clipboard helper ──────────────────────────────────────────────────────────
function copyTextToClipboard(text) {
  if (navigator.clipboard && window.isSecureContext) return navigator.clipboard.writeText(text);
  return new Promise((resolve, reject) => {
    const el = Object.assign(document.createElement('textarea'), { value: text, style: 'position:fixed;top:-9999px;opacity:0' });
    document.body.appendChild(el); el.focus(); el.select();
    try { document.execCommand('copy') ? resolve() : reject(); } catch (e) { reject(e); } finally { document.body.removeChild(el); }
  });
}

// ── Toggle switch ─────────────────────────────────────────────────────────────
function Toggle({ on, onChange, color = '#0073ea', size = 'md' }) {
  const w = size === 'sm' ? 32 : 40, h = size === 'sm' ? 18 : 22, d = size === 'sm' ? 12 : 16;
  return (
    <div onClick={e => { e.stopPropagation(); onChange(); }}
      title={on ? 'Visible — click to hide' : 'Hidden — click to show'}
      style={{
        width: w, height: h, borderRadius: h / 2,
        background: on ? color : '#d1d5db',
        position: 'relative', cursor: 'pointer', flexShrink: 0,
        transition: 'background 0.2s, box-shadow 0.2s',
        boxShadow: on ? `0 0 0 3px ${color}28` : 'none',
      }}>
      <div style={{
        position: 'absolute', top: (h - d) / 2, left: on ? w - d - (h - d) / 2 : (h - d) / 2,
        width: d, height: d, borderRadius: '50%', background: '#fff',
        transition: 'left 0.2s', boxShadow: '0 1px 4px rgba(0,0,0,0.25)',
      }} />
    </div>
  );
}

// ── Type badge ────────────────────────────────────────────────────────────────
function TypeBadge({ type }) {
  const m = getTypeMeta(type);
  return (
    <div style={{
      width: 28, height: 28, borderRadius: 7, flexShrink: 0,
      background: `${m.color}18`, color: m.color,
      fontSize: 11, fontWeight: 800,
      display: 'flex', alignItems: 'center', justifyContent: 'center',
    }}>{m.icon}</div>
  );
}

// ── Preview: single field ─────────────────────────────────────────────────────
function PreviewField({ field, color }) {
  const label    = field.label || field.column_title;
  const required = field.is_required;
  const type     = field.column_type;
  const settings = (() => {
    try { return typeof field.column_settings === 'string' ? JSON.parse(field.column_settings) : (field.column_settings || {}); }
    catch { return {}; }
  })();

  const inputBase = {
    width: '100%', border: '1.5px solid #e2e8f0', borderRadius: 8,
    padding: '10px 13px', fontSize: 13, outline: 'none',
    boxSizing: 'border-box', background: '#f8fafc', color: '#94a3b8',
    opacity: 0.8,
  };

  let input;
  switch (type) {
    case 'long_text':
      input = <textarea rows={2} disabled placeholder="Long text…" style={{ ...inputBase, resize: 'none' }} />;
      break;
    case 'number': case 'progress':
      input = <input type="number" disabled placeholder="0" style={inputBase} />;
      break;
    case 'email':
      input = <input type="email" disabled placeholder="email@example.com" style={inputBase} />;
      break;
    case 'phone':
      input = <input type="tel" disabled placeholder="+91 98765 43210" style={inputBase} />;
      break;
    case 'date':
      input = <input type="date" disabled style={inputBase} />;
      break;
    case 'link':
      input = <input type="url" disabled placeholder="https://" style={inputBase} />;
      break;
    case 'checkbox':
      input = (
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, opacity: 0.6 }}>
          <div style={{ width: 18, height: 18, borderRadius: 5, border: '2px solid #cbd5e1', background: '#fff' }} />
          <span style={{ fontSize: 12, color: '#94a3b8' }}>Click to check</span>
        </div>
      );
      break;
    case 'rating':
      input = (
        <div style={{ display: 'flex', gap: 4, opacity: 0.6 }}>
          {[1,2,3,4,5].map(i => <span key={i} style={{ fontSize: 20, color: '#cbd5e1' }}>☆</span>)}
        </div>
      );
      break;
    case 'status': case 'priority': case 'dropdown': {
      const opts = settings.options || (type === 'priority' ? ['Critical','High','Medium','Low'] : type === 'status' ? ['Not Started','In Progress','Done','Stuck'] : []);
      if (type === 'dropdown') {
        input = <select disabled style={{ ...inputBase }}><option>— Select —</option></select>;
      } else {
        input = (
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 5, opacity: 0.75 }}>
            {opts.slice(0, 4).map(o => {
              const lbl = typeof o === 'string' ? o : o.label;
              return <div key={lbl} style={{ padding: '4px 12px', borderRadius: 99, background: '#f1f5f9', border: '1.5px solid #e2e8f0', fontSize: 11, color: '#64748b', fontWeight: 500 }}>{lbl}</div>;
            })}
          </div>
        );
      }
      break;
    }
    case 'timeline':
      input = (
        <div style={{ display: 'flex', gap: 6, alignItems: 'center', opacity: 0.7 }}>
          <input type="date" disabled style={{ ...inputBase, flex: 1 }} />
          <span style={{ color: '#cbd5e1', fontSize: 12 }}>→</span>
          <input type="date" disabled style={{ ...inputBase, flex: 1 }} />
        </div>
      );
      break;
    default:
      input = <input type="text" disabled placeholder="Type your answer…" style={inputBase} />;
  }

  return (
    <div style={{ marginBottom: 18 }}>
      <label style={{ display: 'block', marginBottom: 6, fontSize: 13, fontWeight: 600, color: '#334155' }}>
        {label}{required && <span style={{ color: '#dc2626', marginLeft: 3 }}>*</span>}
      </label>
      {input}
    </div>
  );
}

// ── Live preview panel ────────────────────────────────────────────────────────
function FormPreview({ form, fields, itemNameLabel, accentColor }) {
  const color = accentColor || form.cover_color || '#0073ea';
  const visible = fields.filter(f => f.is_visible);

  return (
    <div style={{ fontFamily: "'Inter', sans-serif" }}>
      {/* Browser chrome mockup */}
      <div style={{ background: '#e2e8f0', borderRadius: '12px 12px 0 0', padding: '10px 14px', display: 'flex', alignItems: 'center', gap: 8 }}>
        <div style={{ display: 'flex', gap: 5 }}>
          {['#f87171','#fbbf24','#34d399'].map(c => <div key={c} style={{ width: 10, height: 10, borderRadius: '50%', background: c }} />)}
        </div>
        <div style={{ flex: 1, background: '#fff', borderRadius: 6, height: 22, padding: '0 10px', display: 'flex', alignItems: 'center', fontSize: 10, color: '#94a3b8', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {BASE_URL}/form/…
        </div>
      </div>

      {/* Page chrome */}
      <div style={{ background: 'linear-gradient(150deg,#f8fafc,#eef2f7)', border: '1px solid #e2e8f0', borderTop: 'none', borderRadius: '0 0 12px 12px', overflow: 'hidden', maxHeight: 520, overflowY: 'auto' }}>
        {/* Cover */}
        <div style={{ background: `linear-gradient(135deg, ${color}, ${color}cc)`, padding: '24px 20px 32px', position: 'relative', overflow: 'hidden' }}>
          <div style={{ position: 'absolute', top: -20, right: -20, width: 100, height: 100, borderRadius: '50%', background: 'rgba(255,255,255,0.07)' }} />
          <div style={{ fontSize: 16, fontWeight: 800, color: '#fff', lineHeight: 1.3 }}>{form.title || 'Untitled Form'}</div>
          {form.description && <div style={{ fontSize: 11, color: 'rgba(255,255,255,0.8)', marginTop: 5 }}>{form.description}</div>}
        </div>

        {/* Form body */}
        <div style={{ background: '#fff', margin: '0 12px', borderRadius: '0 0 10px 10px', padding: '20px 18px', boxShadow: '0 4px 20px rgba(0,0,0,0.07)', marginBottom: 14 }}>
          {/* Item name */}
          <div style={{ marginBottom: 16 }}>
            <label style={{ display: 'block', marginBottom: 5, fontSize: 12, fontWeight: 600, color: '#334155' }}>
              {itemNameLabel || 'Item Name'} <span style={{ color: '#dc2626' }}>*</span>
            </label>
            <input type="text" disabled placeholder="Enter a name…" style={{ width: '100%', border: '1.5px solid #e2e8f0', borderRadius: 7, padding: '8px 11px', fontSize: 12, outline: 'none', boxSizing: 'border-box', background: '#f8fafc', opacity: 0.7 }} />
          </div>

          {visible.map(f => <PreviewField key={f.id || f.column_id} field={f} color={color} />)}

          {visible.length === 0 && (
            <div style={{ textAlign: 'center', padding: '16px 0', color: '#cbd5e1', fontSize: 12, fontWeight: 500 }}>
              No fields selected yet
            </div>
          )}

          <button disabled style={{ width: '100%', padding: '10px 0', background: color, color: '#fff', borderRadius: 8, fontWeight: 700, fontSize: 13, marginTop: 6, opacity: 0.9, cursor: 'default' }}>Submit response →</button>
        </div>

        <div style={{ textAlign: 'center', padding: '8px 0 14px', fontSize: 10, color: '#94a3b8' }}>Powered by Tuesday.com</div>
      </div>
    </div>
  );
}

// ── Form builder ──────────────────────────────────────────────────────────────
function FormBuilder({ boardId, formId, groups, columns, onBack, onSaved }) {
  const toast = useToast();
  const [saving, setSaving] = useState(false);

  const [title,       setTitle]       = useState('Untitled Form');
  const [description, setDesc]        = useState('');
  const [coverColor,  setColor]       = useState('#0073ea');
  const [targetGroup, setGroup]       = useState('');
  const [thankYou,    setThankYou]    = useState('Thank you! Your response has been submitted.');
  const [isActive,    setActive]      = useState(true);
  const [slug,        setSlug]        = useState('');
  const [itemNameLabel, setItemNameLabel] = useState('Item Name');
  const [fields,      setFields]      = useState([]);
  const [activeSection, setSection]   = useState('basic');

  // Load existing form
  useEffect(() => {
    if (!formId) return;
    getForm(formId).then(r => {
      const f = r.data;
      setTitle(f.title || '');
      setDesc(f.description || '');
      setColor(f.cover_color || '#0073ea');
      setGroup(f.target_group_id ? String(f.target_group_id) : '');
      setThankYou(f.thank_you_message || '');
      setActive(f.is_active !== false);
      setSlug(f.slug || '');
      setItemNameLabel(f.item_name_label || 'Item Name');
      buildFieldsList(f.fields || []);
    }).catch(() => toast('Failed to load form', 'error'));
  }, [formId]);

  const buildFieldsList = useCallback((savedFields) => {
    const usable   = columns.filter(c => !SKIP_TYPES.includes(c.type));
    const savedMap = {};
    savedFields.forEach(f => { savedMap[f.column_id] = f; });
    const list = usable.map((col, idx) => {
      const saved = savedMap[col.id];
      return {
        column_id: col.id, column_title: col.title,
        column_type: col.type, column_settings: col.settings,
        label: saved?.label || col.title,
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

  useEffect(() => {
    if (!formId) {
      buildFieldsList([]);
      if (groups.length > 0) setGroup(String(groups[0].id));
    }
  }, [formId, groups, buildFieldsList]);

  const toggleField    = id => setFields(p => p.map(f => f.column_id === id ? { ...f, is_visible: !f.is_visible } : f));
  const toggleRequired = id => setFields(p => p.map(f => f.column_id === id ? { ...f, is_required: !f.is_required } : f));
  const updateLabel    = (id, lbl) => setFields(p => p.map(f => f.column_id === id ? { ...f, label: lbl } : f));

  const handleSave = async () => {
    setSaving(true);
    try {
      const payload = {
        title: title.trim() || 'Untitled Form', description,
        cover_color: coverColor,
        target_group_id: targetGroup ? parseInt(targetGroup) : null,
        thank_you_message: thankYou, is_active: isActive,
        item_name_label: itemNameLabel.trim() || 'Item Name',
      };
      let saved;
      if (formId) { const r = await updateForm(formId, payload); saved = r.data; }
      else { const r = await createForm(boardId, payload); saved = r.data; setSlug(saved.slug); }

      const visibleFields = fields.filter(f => f.is_visible).map((f, i) => ({
        column_id: f.column_id, label: f.label || f.column_title,
        is_required: f.is_required, position: i, is_visible: true,
      }));
      await saveFormFields(saved.id, visibleFields);
      toast('Form saved', 'success');
      onSaved(saved);
    } catch { toast('Failed to save form', 'error'); }
    finally { setSaving(false); }
  };

  const publicUrl = slug ? `${BASE_URL}/form/${slug}` : '';
  const embedCode = slug ? `<iframe src="${BASE_URL}/form/${slug}" width="100%" height="700" frameborder="0" style="border-radius:12px;border:none"></iframe>` : '';
  const copyToClipboard = (text, lbl) => copyTextToClipboard(text).then(() => toast(`${lbl} copied!`, 'success')).catch(() => toast('Copy failed', 'error'));
  const previewFields = fields.filter(f => f.is_visible);

  const SECTIONS = [
    { key: 'basic', icon: '⚙', label: 'Basic Info' },
    { key: 'fields', icon: '📋', label: 'Fields' },
    ...(slug ? [{ key: 'share', icon: '🔗', label: 'Share' }] : []),
  ];

  const visibleCount = fields.filter(f => f.is_visible).length;

  return (
    <div style={{ display: 'flex', height: '100%', overflow: 'hidden', fontFamily: "'Inter', -apple-system, sans-serif" }}>

      {/* ── Left: builder panel ── */}
      <div style={{ width: 400, flexShrink: 0, display: 'flex', flexDirection: 'column', background: '#fff', borderRight: '1px solid #e2e8f0', overflow: 'hidden' }}>

        {/* Header */}
        <div style={{ padding: '14px 20px', borderBottom: '1px solid #f1f5f9', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10, flexShrink: 0 }}>
          <button onClick={onBack}
            style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 13, color: '#0073ea', fontWeight: 600, padding: '5px 0', background: 'none', border: 'none', cursor: 'pointer' }}>
            <svg width="16" height="16" viewBox="0 0 16 16" fill="none"><path d="M10 12L6 8l4-4" stroke="#0073ea" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/></svg>
            Back
          </button>

          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            {/* Active toggle */}
            <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <Toggle on={isActive} onChange={() => setActive(a => !a)} color="#00c875" size="sm" />
              <span style={{ fontSize: 12, fontWeight: 600, color: isActive ? '#059669' : '#94a3b8' }}>
                {isActive ? 'Active' : 'Inactive'}
              </span>
            </div>
            <button onClick={handleSave} disabled={saving}
              style={{
                padding: '7px 18px', background: '#0073ea', color: '#fff', borderRadius: 8,
                fontWeight: 700, fontSize: 13, cursor: saving ? 'wait' : 'pointer',
                opacity: saving ? 0.7 : 1, border: 'none',
                boxShadow: '0 2px 8px rgba(0,115,234,0.3)',
              }}>
              {saving ? 'Saving…' : formId ? 'Save Changes' : 'Create Form'}
            </button>
          </div>
        </div>

        {/* Section tabs */}
        <div style={{ padding: '10px 20px', borderBottom: '1px solid #f1f5f9', display: 'flex', gap: 4, flexShrink: 0 }}>
          {SECTIONS.map(s => (
            <button key={s.key} onClick={() => setSection(s.key)}
              style={{
                padding: '7px 14px', borderRadius: 8, fontSize: 12.5, fontWeight: activeSection === s.key ? 700 : 500,
                border: `1.5px solid ${activeSection === s.key ? '#0073ea' : '#e2e8f0'}`,
                background: activeSection === s.key ? '#eff6ff' : '#fff',
                color: activeSection === s.key ? '#0073ea' : '#64748b',
                cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 5,
                transition: 'all 0.15s',
              }}>
              <span>{s.icon}</span> {s.label}
              {s.key === 'fields' && visibleCount > 0 && (
                <span style={{ background: '#0073ea', color: '#fff', borderRadius: 99, padding: '0px 6px', fontSize: 10, fontWeight: 800, marginLeft: 2 }}>{visibleCount}</span>
              )}
            </button>
          ))}
        </div>

        {/* Section body */}
        <div style={{ flex: 1, overflowY: 'auto', padding: '20px' }}>

          {/* ── Basic Info ── */}
          {activeSection === 'basic' && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>
              <Field label="Form Title">
                <input value={title} onChange={e => setTitle(e.target.value)} placeholder="e.g. IT Onboarding Form"
                  style={inp} onFocus={foc} onBlur={blr} />
              </Field>

              <Field label="Description">
                <textarea value={description} onChange={e => setDesc(e.target.value)} rows={3}
                  placeholder="Brief description shown to respondents…"
                  style={{ ...inp, resize: 'vertical', lineHeight: 1.5 }} onFocus={foc} onBlur={blr} />
              </Field>

              <Field label="Cover Color">
                <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
                  <input type="color" value={coverColor} onChange={e => setColor(e.target.value)}
                    style={{ width: 44, height: 44, borderRadius: 8, border: '2px solid #e2e8f0', cursor: 'pointer', padding: 3, boxSizing: 'border-box' }} />
                  <span style={{ fontSize: 12, color: '#64748b', fontFamily: 'monospace', fontWeight: 600 }}>{coverColor}</span>
                  <div style={{ display: 'flex', gap: 5, flexWrap: 'wrap' }}>
                    {ACCENT_PRESETS.map(c => (
                      <div key={c} onClick={() => setColor(c)}
                        style={{
                          width: 22, height: 22, borderRadius: '50%', background: c, cursor: 'pointer',
                          border: c === coverColor ? '3px solid #0f172a' : '1.5px solid #d1d5db',
                          boxShadow: c === coverColor ? '0 0 0 1px #fff inset' : 'none',
                          transition: 'transform 0.15s',
                        }}
                        onMouseEnter={e => e.target.style.transform = 'scale(1.2)'}
                        onMouseLeave={e => e.target.style.transform = 'scale(1)'}
                      />
                    ))}
                  </div>
                </div>
              </Field>

              <Field label="Target Group">
                <select value={targetGroup} onChange={e => setGroup(e.target.value)} style={{ ...inp, cursor: 'pointer' }} onFocus={foc} onBlur={blr}>
                  <option value="">— First group (default) —</option>
                  {groups.map(g => <option key={g.id} value={String(g.id)}>{g.name}</option>)}
                </select>
              </Field>

              <Field label="Thank-you Message">
                <textarea value={thankYou} onChange={e => setThankYou(e.target.value)} rows={3}
                  style={{ ...inp, resize: 'vertical', lineHeight: 1.5 }} onFocus={foc} onBlur={blr} />
              </Field>
            </div>
          )}

          {/* ── Fields ── */}
          {activeSection === 'fields' && (
            <div>
              <p style={{ fontSize: 12, color: '#94a3b8', marginBottom: 14, lineHeight: 1.5 }}>
                Toggle fields on/off and rename them for your respondents. <strong style={{ color: '#64748b' }}>Item Name</strong> is always included.
              </p>

              {/* Item Name — always on */}
              <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '10px 12px', borderRadius: 10, background: '#eff6ff', marginBottom: 10, border: '1.5px solid #bfdbfe' }}>
                <Toggle on size="sm" onChange={() => {}} color="#0073ea" />
                <div style={{ width: 28, height: 28, borderRadius: 7, background: '#dbeafe', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 12, color: '#3b82f6', fontWeight: 800, flexShrink: 0 }}>Aa</div>
                <input
                  value={itemNameLabel}
                  onChange={e => setItemNameLabel(e.target.value)}
                  style={{ flex: 1, border: '1.5px solid #bfdbfe', borderRadius: 6, padding: '4px 8px', fontSize: 13, fontWeight: 600, color: '#1d4ed8', background: '#fff', outline: 'none', minWidth: 0 }}
                  onFocus={e => e.target.style.borderColor = '#0073ea'}
                  onBlur={e => e.target.style.borderColor = '#bfdbfe'}
                />
                <span style={{ fontSize: 10, color: '#dc2626', fontWeight: 700, letterSpacing: 0.3, flexShrink: 0 }}>REQUIRED</span>
              </div>

              {/* Field list */}
              {fields.map(f => (
                <div key={f.column_id} style={{
                  display: 'flex', alignItems: 'center', gap: 10, padding: '9px 12px',
                  borderRadius: 10, marginBottom: 7,
                  background: f.is_visible ? '#fff' : '#fafafa',
                  border: `1.5px solid ${f.is_visible ? '#e2e8f0' : '#f1f5f9'}`,
                  transition: 'all 0.15s',
                  opacity: f.is_visible ? 1 : 0.55,
                }}>
                  <Toggle on={f.is_visible} onChange={() => toggleField(f.column_id)} color="#0073ea" size="sm" />
                  <TypeBadge type={f.column_type} />
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <input
                      value={f.label}
                      onChange={e => updateLabel(f.column_id, e.target.value)}
                      disabled={!f.is_visible}
                      style={{
                        border: 'none', background: 'transparent', fontSize: 13, fontWeight: 600,
                        color: f.is_visible ? '#0f172a' : '#94a3b8', width: '100%',
                        outline: 'none', padding: '1px 0',
                      }}
                      onFocus={e => { e.target.style.borderBottom = '1.5px solid #0073ea'; }}
                      onBlur={e => { e.target.style.borderBottom = 'none'; }}
                    />
                    <div style={{ fontSize: 10, color: '#cbd5e1', marginTop: 1, fontWeight: 500, letterSpacing: 0.3 }}>{f.column_type}</div>
                  </div>
                  {f.is_visible && (
                    <label style={{ display: 'flex', alignItems: 'center', gap: 5, cursor: 'pointer', flexShrink: 0 }}>
                      <input type="checkbox" checked={f.is_required} onChange={() => toggleRequired(f.column_id)}
                        style={{ cursor: 'pointer', accentColor: '#dc2626', width: 13, height: 13 }} />
                      <span style={{ fontSize: 10, color: f.is_required ? '#dc2626' : '#cbd5e1', fontWeight: 700, letterSpacing: 0.3 }}>REQ</span>
                    </label>
                  )}
                </div>
              ))}

              {fields.length === 0 && (
                <div style={{ textAlign: 'center', padding: '40px 20px', color: '#cbd5e1', fontSize: 13 }}>
                  No columns found on this board.
                </div>
              )}
            </div>
          )}

          {/* ── Share ── */}
          {activeSection === 'share' && slug && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
              {/* Status badge */}
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '10px 14px', borderRadius: 10, background: isActive ? '#f0fdf4' : '#f8fafc', border: `1.5px solid ${isActive ? '#bbf7d0' : '#e2e8f0'}` }}>
                <div style={{ width: 8, height: 8, borderRadius: '50%', background: isActive ? '#22c55e' : '#94a3b8', animation: isActive ? 'pulse 2s infinite' : 'none' }} />
                <span style={{ fontSize: 13, fontWeight: 600, color: isActive ? '#15803d' : '#64748b' }}>
                  {isActive ? 'Form is active and accepting responses' : 'Form is inactive — toggle Active to enable'}
                </span>
              </div>

              <Field label="Public URL">
                <div style={{ display: 'flex', gap: 8 }}>
                  <input readOnly value={publicUrl} style={{ ...inp, flex: 1, background: '#f8fafc', fontSize: 12, color: '#64748b', cursor: 'text' }} />
                  <button onClick={() => copyToClipboard(publicUrl, 'URL')} style={shareBtn('#0073ea')}>Copy</button>
                  <button onClick={() => window.open(`/form/${slug}`, '_blank')} style={shareBtn('#64748b')} title="Open in new tab">↗</button>
                </div>
              </Field>

              <Field label="Embed Code">
                <textarea readOnly value={embedCode} rows={4}
                  style={{ ...inp, background: '#f8fafc', fontSize: 11, fontFamily: 'monospace', resize: 'none', color: '#64748b', cursor: 'text', lineHeight: 1.6 }} />
                <button onClick={() => copyToClipboard(embedCode, 'Embed code')} style={{ ...shareBtn('#64748b'), marginTop: 8, width: '100%', justifyContent: 'center' }}>Copy Embed Code</button>
              </Field>

              {window.location.hostname === 'localhost' && (
                <div style={{ background: '#fffbeb', border: '1px solid #fde68a', borderRadius: 10, padding: '12px 14px', fontSize: 12, color: '#92400e', lineHeight: 1.55, display: 'flex', gap: 8 }}>
                  <span style={{ flexShrink: 0 }}>💡</span>
                  <span>Replace <code style={{ background: '#fef3c7', padding: '1px 4px', borderRadius: 4 }}>localhost</code> with your production domain when deploying.</span>
                </div>
              )}
            </div>
          )}
        </div>
      </div>

      {/* ── Right: live preview ── */}
      <div style={{ flex: 1, background: '#f1f5f9', overflowY: 'auto', padding: '28px 32px' }}>
        <div style={{ maxWidth: 480, margin: '0 auto' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 16, justifyContent: 'center' }}>
            <div style={{ flex: 1, height: 1, background: '#e2e8f0' }} />
            <span style={{ fontSize: 11, color: '#94a3b8', fontWeight: 700, letterSpacing: 0.8, textTransform: 'uppercase' }}>Live Preview</span>
            <div style={{ flex: 1, height: 1, background: '#e2e8f0' }} />
          </div>
          <FormPreview
            form={{ title, description, cover_color: coverColor, thank_you_message: thankYou }}
            fields={previewFields}
            itemNameLabel={itemNameLabel}
            accentColor={coverColor}
          />
        </div>
      </div>
    </div>
  );
}

// ── Shared input helpers ──────────────────────────────────────────────────────
const inp = {
  width: '100%', border: '1.5px solid #e2e8f0', borderRadius: 8, padding: '9px 12px',
  fontSize: 13, outline: 'none', boxSizing: 'border-box', background: '#fff', color: '#0f172a',
  transition: 'border-color 0.15s, box-shadow 0.15s',
};
const foc = e => { e.target.style.borderColor = '#0073ea'; e.target.style.boxShadow = '0 0 0 3px rgba(0,115,234,0.12)'; };
const blr = e => { e.target.style.borderColor = '#e2e8f0'; e.target.style.boxShadow = 'none'; };

const shareBtn = (color) => ({
  padding: '8px 14px', background: color === '#0073ea' ? '#eff6ff' : '#f8fafc',
  color, border: `1.5px solid ${color === '#0073ea' ? '#bfdbfe' : '#e2e8f0'}`,
  borderRadius: 8, fontSize: 12.5, fontWeight: 700, cursor: 'pointer',
  whiteSpace: 'nowrap', display: 'flex', alignItems: 'center', gap: 4, flexShrink: 0,
});

function Field({ label, children }) {
  return (
    <div>
      <label style={{ display: 'block', fontSize: 11, fontWeight: 700, color: '#64748b', marginBottom: 6, textTransform: 'uppercase', letterSpacing: 0.6 }}>{label}</label>
      {children}
    </div>
  );
}

// ── Forms list ────────────────────────────────────────────────────────────────
function FormsList({ boardId, onOpenBuilder }) {
  const [forms, setForms]   = useState([]);
  const [loading, setLoading] = useState(true);
  const toast = useToast();

  const load = useCallback(() => {
    setLoading(true);
    getForms(boardId).then(r => setForms(r.data)).catch(() => toast('Failed to load forms', 'error')).finally(() => setLoading(false));
  }, [boardId]);

  useEffect(() => { load(); }, [load]);

  const handleDelete = async id => {
    if (!confirm('Delete this form? This cannot be undone.')) return;
    try { await deleteForm(id); setForms(f => f.filter(x => x.id !== id)); toast('Form deleted'); }
    catch { toast('Failed to delete form', 'error'); }
  };

  const copyLink  = slug => { const url = `${BASE_URL}/form/${slug}`; copyTextToClipboard(url).then(() => toast('Link copied!', 'success')).catch(() => toast('Copy failed', 'error')); };
  const copyEmbed = slug => { const code = `<iframe src="${BASE_URL}/form/${slug}" width="100%" height="700" frameborder="0" style="border-radius:12px;border:none"></iframe>`; copyTextToClipboard(code).then(() => toast('Embed copied!', 'success')).catch(() => toast('Copy failed', 'error')); };

  return (
    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden', fontFamily: "'Inter', -apple-system, sans-serif" }}>
      {/* Header */}
      <div style={{ padding: '16px 24px', borderBottom: '1px solid #f1f5f9', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, flexShrink: 0 }}>
        <div style={{ fontSize: 13, color: '#64748b' }}>
          Create shareable forms that add items directly to your board
        </div>
        <button onClick={() => onOpenBuilder(null)}
          style={{ padding: '8px 18px', background: '#0073ea', color: '#fff', borderRadius: 8, fontWeight: 700, fontSize: 13, cursor: 'pointer', border: 'none', boxShadow: '0 2px 8px rgba(0,115,234,0.3)', whiteSpace: 'nowrap', display: 'flex', alignItems: 'center', gap: 6 }}>
          <span style={{ fontSize: 18, lineHeight: 1 }}>+</span> Create Form
        </button>
      </div>

      <div style={{ flex: 1, overflowY: 'auto', padding: '24px' }}>
        {loading ? (
          <div style={{ textAlign: 'center', padding: 60, color: '#94a3b8' }}>
            <div style={{ width: 36, height: 36, borderRadius: '50%', border: '3px solid #e2e8f0', borderTopColor: '#0073ea', animation: 'spin 0.7s linear infinite', margin: '0 auto 12px' }} />
            Loading forms…
          </div>
        ) : forms.length === 0 ? (
          <div style={{ textAlign: 'center', padding: '60px 20px', color: '#94a3b8', maxWidth: 360, margin: '0 auto' }}>
            <div style={{ fontSize: 56, marginBottom: 16 }}>📋</div>
            <div style={{ fontSize: 17, fontWeight: 700, color: '#334155', marginBottom: 8 }}>No forms yet</div>
            <div style={{ fontSize: 13, marginBottom: 28, lineHeight: 1.6 }}>Create a form to collect submissions directly into this board — no account needed for respondents.</div>
            <button onClick={() => onOpenBuilder(null)}
              style={{ padding: '11px 28px', background: '#0073ea', color: '#fff', borderRadius: 10, fontWeight: 700, fontSize: 14, cursor: 'pointer', border: 'none', boxShadow: '0 4px 14px rgba(0,115,234,0.35)' }}>
              + Create Your First Form
            </button>
          </div>
        ) : (
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(300px, 1fr))', gap: 16 }}>
            {forms.map(form => (
              <FormCard key={form.id} form={form}
                onEdit={() => onOpenBuilder(form.id)}
                onCopyLink={() => copyLink(form.slug)}
                onCopyEmbed={() => copyEmbed(form.slug)}
                onPreview={() => window.open(`/form/${form.slug}`, '_blank')}
                onDelete={() => handleDelete(form.id)}
              />
            ))}
          </div>
        )}
      </div>
      <style>{`@keyframes spin { to { transform: rotate(360deg); } } @keyframes pulse { 0%,100%{opacity:1} 50%{opacity:0.5} }`}</style>
    </div>
  );
}

function FormCard({ form, onEdit, onCopyLink, onCopyEmbed, onPreview, onDelete }) {
  const color = form.cover_color || '#0073ea';
  return (
    <div style={{ background: '#fff', borderRadius: 14, overflow: 'hidden', boxShadow: '0 2px 16px rgba(0,0,0,0.07)', border: '1px solid #e2e8f0', transition: 'transform 0.2s, box-shadow 0.2s' }}
      onMouseEnter={e => { e.currentTarget.style.transform = 'translateY(-2px)'; e.currentTarget.style.boxShadow = '0 8px 28px rgba(0,0,0,0.11)'; }}
      onMouseLeave={e => { e.currentTarget.style.transform = 'none'; e.currentTarget.style.boxShadow = '0 2px 16px rgba(0,0,0,0.07)'; }}
    >
      {/* Color bar */}
      <div style={{ height: 6, background: `linear-gradient(90deg, ${color}, ${color}99)` }} />
      <div style={{ padding: '14px 16px' }}>
        <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 8, marginBottom: 8 }}>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: 14.5, fontWeight: 700, color: '#0f172a', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', marginBottom: 3 }}>
              {form.title}
            </div>
            <div style={{ fontSize: 11.5, color: '#94a3b8', display: 'flex', alignItems: 'center', gap: 4 }}>
              <span>→</span> {form.target_group_name || 'First group'}
            </div>
          </div>
          <span style={{
            padding: '3px 10px', borderRadius: 99, fontSize: 10.5, fontWeight: 700, flexShrink: 0,
            background: form.is_active ? '#f0fdf4' : '#f8fafc',
            color: form.is_active ? '#15803d' : '#94a3b8',
            border: `1px solid ${form.is_active ? '#bbf7d0' : '#e2e8f0'}`,
          }}>
            {form.is_active ? '● Active' : '○ Inactive'}
          </span>
        </div>

        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginTop: 12 }}>
          <button onClick={onEdit} style={cardBtn(color, true)}>Open Builder</button>
          <button onClick={onCopyLink} style={cardBtn()}>🔗 Copy Link</button>
          <button onClick={onCopyEmbed} style={cardBtn()}>&lt;/&gt; Embed</button>
          <button onClick={onPreview} style={cardBtn()}>↗ Preview</button>
          <button onClick={onDelete} style={{ ...cardBtn(), color: '#dc2626', borderColor: '#fecaca', marginLeft: 'auto' }}>Delete</button>
        </div>
      </div>
    </div>
  );
}

function cardBtn(color, primary) {
  return {
    padding: '5px 12px', borderRadius: 7, fontSize: 12, fontWeight: 600, cursor: 'pointer',
    background: primary ? color : '#f8fafc',
    color: primary ? '#fff' : '#64748b',
    border: `1.5px solid ${primary ? color : '#e2e8f0'}`,
    transition: 'all 0.15s',
  };
}

// ── Main panel wrapper ────────────────────────────────────────────────────────
export default function FormsPanel({ boardId, groups, columns, onClose }) {
  const [view, setView]               = useState('list');
  const [editingFormId, setEditingId] = useState(null);
  const [savedFormId, setSavedId]     = useState(null);

  const openBuilder = id => { setEditingId(id); setSavedId(id); setView('builder'); };
  const handleSaved = f  => { setSavedId(f.id); setEditingId(f.id); };
  const handleBack  = () => { setView('list'); setEditingId(null); setSavedId(null); };

  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(15,23,42,0.45)', zIndex: 400, display: 'flex', alignItems: 'stretch', justifyContent: 'flex-end' }}
      onClick={onClose}>
      <div onClick={e => e.stopPropagation()}
        style={{ width: view === 'builder' ? '90vw' : 720, maxWidth: '100vw', background: '#f8fafc', display: 'flex', flexDirection: 'column', boxShadow: '-8px 0 48px rgba(0,0,0,0.18)', overflow: 'hidden', fontFamily: "'Inter', sans-serif" }}>

        {/* Panel header */}
        <div style={{ background: '#fff', borderBottom: '1px solid #e2e8f0', padding: '14px 22px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexShrink: 0 }}>
          <div>
            <h2 style={{ fontSize: 15, fontWeight: 800, margin: 0, color: '#0f172a', display: 'flex', alignItems: 'center', gap: 7, letterSpacing: -0.2 }}>
              <span style={{ fontSize: 18 }}>📋</span> Forms
            </h2>
            <p style={{ fontSize: 12, color: '#94a3b8', margin: '2px 0 0', fontWeight: 500 }}>
              {view === 'builder' ? 'Design your form and manage fields' : 'Collect data from anyone — no account needed'}
            </p>
          </div>
          <button onClick={onClose}
            style={{ width: 32, height: 32, borderRadius: '50%', background: '#f1f5f9', border: 'none', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 18, color: '#64748b', transition: 'background 0.15s' }}
            onMouseEnter={e => e.target.style.background = '#e2e8f0'}
            onMouseLeave={e => e.target.style.background = '#f1f5f9'}>
            ×
          </button>
        </div>

        {/* Content */}
        <div style={{ flex: 1, display: 'flex', overflow: 'hidden' }}>
          {view === 'list' ? (
            <FormsList boardId={boardId} onOpenBuilder={openBuilder} />
          ) : (
            <FormBuilder
              boardId={boardId}
              formId={editingFormId || savedFormId}
              groups={groups}
              columns={columns}
              onBack={handleBack}
              onSaved={handleSaved}
            />
          )}
        </div>
      </div>
    </div>
  );
}
