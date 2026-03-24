import React, { useState, useEffect, useCallback } from 'react';
import { getForms, createForm, getForm, updateForm, deleteForm, saveFormFields } from '../api';
import { useToast } from './Toast';

// Types that should be hidden from forms
const SKIP_TYPES = ['formula', 'creation_log', 'time_tracking'];

const BASE_URL = window.location.origin;

// Works in both HTTP (localhost) and HTTPS environments
function copyTextToClipboard(text) {
  if (navigator.clipboard && window.isSecureContext) {
    return navigator.clipboard.writeText(text);
  }
  // Fallback: create a temporary textarea, select, and execCommand
  return new Promise((resolve, reject) => {
    const el = document.createElement('textarea');
    el.value = text;
    el.style.cssText = 'position:fixed;top:-9999px;left:-9999px;opacity:0';
    document.body.appendChild(el);
    el.focus();
    el.select();
    try {
      const ok = document.execCommand('copy');
      document.body.removeChild(el);
      ok ? resolve() : reject(new Error('execCommand failed'));
    } catch (err) {
      document.body.removeChild(el);
      reject(err);
    }
  });
}

// ── Live preview of a single field ───────────────────────────────────────────
function PreviewField({ field, color }) {
  const label = field.label || field.column_title;
  const required = field.is_required;
  const type = field.column_type;
  const settings = (() => {
    try { return typeof field.column_settings === 'string' ? JSON.parse(field.column_settings) : (field.column_settings || {}); }
    catch { return {}; }
  })();

  const inputStyle = {
    width: '100%', border: '1.5px solid #e0e0e0', borderRadius: 8,
    padding: '10px 12px', fontSize: 14, outline: 'none', boxSizing: 'border-box',
    background: '#fff', color: '#323338',
  };

  const labelEl = (
    <label style={{ display: 'block', marginBottom: 6, fontSize: 14, fontWeight: 600, color: '#323338' }}>
      {label}
      {required && <span style={{ color: '#e2445c', marginLeft: 3 }}>*</span>}
    </label>
  );

  let input;
  switch (type) {
    case 'long_text':
      input = <textarea rows={3} disabled placeholder="Long text…" style={{ ...inputStyle, resize: 'vertical', opacity: 0.6 }} />;
      break;
    case 'number': case 'progress':
      input = <input type="number" disabled placeholder="0" style={{ ...inputStyle, opacity: 0.6 }} />;
      break;
    case 'email':
      input = <input type="email" disabled placeholder="email@example.com" style={{ ...inputStyle, opacity: 0.6 }} />;
      break;
    case 'phone':
      input = <input type="tel" disabled placeholder="+91 98765 43210" style={{ ...inputStyle, opacity: 0.6 }} />;
      break;
    case 'date':
      input = <input type="date" disabled style={{ ...inputStyle, opacity: 0.6 }} />;
      break;
    case 'link':
      input = <input type="url" disabled placeholder="https://" style={{ ...inputStyle, opacity: 0.6 }} />;
      break;
    case 'checkbox':
      input = (
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <div style={{ width: 22, height: 22, borderRadius: 5, border: '2px solid #c4c4c4', background: '#fff' }} />
          <span style={{ fontSize: 13, color: '#888' }}>Unchecked</span>
        </div>
      );
      break;
    case 'rating':
      input = (
        <div style={{ display: 'flex', gap: 6 }}>
          {[1,2,3,4,5].map(i => (
            <span key={i} style={{ fontSize: 24, color: '#c4c4c4' }}>☆</span>
          ))}
        </div>
      );
      break;
    case 'status':
    case 'priority':
    case 'dropdown': {
      const opts = settings.options || (type === 'priority' ? ['Critical','High','Medium','Low'] : type === 'status' ? ['Not Started','In Progress','Done','Stuck'] : []);
      if (type === 'dropdown') {
        input = (
          <select disabled style={{ ...inputStyle, opacity: 0.6 }}>
            <option>— Select —</option>
            {opts.map(o => <option key={typeof o === 'string' ? o : o.label}>{typeof o === 'string' ? o : o.label}</option>)}
          </select>
        );
      } else {
        input = (
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
            {opts.slice(0, 4).map(o => {
              const lbl = typeof o === 'string' ? o : o.label;
              const clr = typeof o === 'object' ? o.color : '#e0e0e0';
              return (
                <div key={lbl} style={{ padding: '5px 12px', borderRadius: 20, background: '#f5f5f5', border: `1.5px solid ${clr || '#e0e0e0'}`, fontSize: 12, color: '#555', cursor: 'default' }}>
                  {lbl}
                </div>
              );
            })}
          </div>
        );
      }
      break;
    }
    case 'timeline':
      input = (
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          <input type="date" disabled style={{ ...inputStyle, flex: 1, opacity: 0.6 }} />
          <span style={{ color: '#888', fontSize: 13 }}>→</span>
          <input type="date" disabled style={{ ...inputStyle, flex: 1, opacity: 0.6 }} />
        </div>
      );
      break;
    default:
      input = <input type="text" disabled placeholder="Type your answer…" style={{ ...inputStyle, opacity: 0.6 }} />;
  }

  return (
    <div style={{ marginBottom: 20 }}>
      {labelEl}
      {input}
    </div>
  );
}

// ── Right-side live preview ───────────────────────────────────────────────────
function FormPreview({ form, fields }) {
  const color = form.cover_color || '#0073ea';
  const visibleFields = fields.filter(f => f.is_visible);

  return (
    <div style={{
      background: '#f0f2f5', borderRadius: 12, overflow: 'hidden',
      boxShadow: '0 2px 16px rgba(0,0,0,0.1)', maxWidth: 480, margin: '0 auto',
      fontFamily: "'DM Sans', Figtree, sans-serif",
    }}>
      {/* Cover banner */}
      <div style={{ background: color, padding: '32px 28px 20px', position: 'relative' }}>
        <div style={{ fontSize: 22, fontWeight: 800, color: '#fff', lineHeight: 1.3 }}>
          {form.title || 'Untitled Form'}
        </div>
        {form.description && (
          <div style={{ fontSize: 13, color: 'rgba(255,255,255,0.82)', marginTop: 6 }}>
            {form.description}
          </div>
        )}
      </div>

      {/* Form body */}
      <div style={{ background: '#fff', padding: '24px 28px' }}>
        {/* Item name field always first */}
        <div style={{ marginBottom: 20 }}>
          <label style={{ display: 'block', marginBottom: 6, fontSize: 14, fontWeight: 600, color: '#323338' }}>
            Item Name <span style={{ color: '#e2445c' }}>*</span>
          </label>
          <input type="text" disabled placeholder="Enter a name…" style={{
            width: '100%', border: '1.5px solid #e0e0e0', borderRadius: 8,
            padding: '10px 12px', fontSize: 14, outline: 'none', boxSizing: 'border-box',
            background: '#fff', opacity: 0.6,
          }} />
        </div>

        {visibleFields.map(f => (
          <PreviewField key={f.id || f.column_id} field={f} color={color} />
        ))}

        {visibleFields.length === 0 && (
          <div style={{ color: '#aaa', fontSize: 13, padding: '12px 0', textAlign: 'center' }}>
            Add fields from the left panel
          </div>
        )}

        <button disabled style={{
          width: '100%', padding: '12px 0', background: color, color: '#fff',
          borderRadius: 8, fontWeight: 700, fontSize: 15, marginTop: 8, cursor: 'default', opacity: 0.9,
        }}>Submit</button>

        <div style={{ textAlign: 'center', marginTop: 10, fontSize: 11, color: '#aaa' }}>
          Preview only — submissions go to your board
        </div>
      </div>
    </div>
  );
}

// ── Form builder view ─────────────────────────────────────────────────────────
function FormBuilder({ boardId, formId, groups, columns, onBack, onSaved }) {
  const toast = useToast();
  const [saving, setSaving] = useState(false);

  // Form settings
  const [title, setTitle]         = useState('Untitled Form');
  const [description, setDesc]    = useState('');
  const [coverColor, setColor]    = useState('#0073ea');
  const [targetGroup, setGroup]   = useState('');
  const [thankYou, setThankYou]   = useState('Thank you! Your response has been submitted.');
  const [isActive, setActive]     = useState(true);
  const [slug, setSlug]           = useState('');

  // Fields list: { column_id, column_title, column_type, column_settings, label, is_required, is_visible, position }
  const [fields, setFields] = useState([]);

  const [activeSection, setActiveSection] = useState('basic'); // basic | fields | share

  // Load form data if editing
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
      buildFieldsList(f.fields || []);
    }).catch(() => toast('Failed to load form', 'error'));
  }, [formId]);

  // Build fields list from all board columns merged with saved form_fields
  const buildFieldsList = useCallback((savedFields) => {
    const usableColumns = columns.filter(c => !SKIP_TYPES.includes(c.type));
    const savedMap = {};
    savedFields.forEach(f => { savedMap[f.column_id] = f; });

    const list = usableColumns.map((col, idx) => {
      const saved = savedMap[col.id];
      return {
        column_id: col.id,
        column_title: col.title,
        column_type: col.type,
        column_settings: col.settings,
        label: saved?.label || col.title,
        is_required: saved?.is_required || false,
        is_visible: saved ? saved.is_visible : false,
        position: saved?.position ?? idx,
      };
    });
    // Sort: visible first (by position), then invisible
    list.sort((a, b) => {
      if (a.is_visible !== b.is_visible) return a.is_visible ? -1 : 1;
      return a.position - b.position;
    });
    setFields(list);
  }, [columns]);

  // Initialize for new form
  useEffect(() => {
    if (!formId) {
      buildFieldsList([]);
      if (groups.length > 0) setGroup(String(groups[0].id));
    }
  }, [formId, groups, buildFieldsList]);

  const toggleField = (colId) => {
    setFields(prev => prev.map(f =>
      f.column_id === colId ? { ...f, is_visible: !f.is_visible } : f
    ));
  };

  const toggleRequired = (colId) => {
    setFields(prev => prev.map(f =>
      f.column_id === colId ? { ...f, is_required: !f.is_required } : f
    ));
  };

  const updateLabel = (colId, label) => {
    setFields(prev => prev.map(f =>
      f.column_id === colId ? { ...f, label } : f
    ));
  };

  const handleSave = async () => {
    setSaving(true);
    try {
      const formData = {
        title: title.trim() || 'Untitled Form',
        description,
        cover_color: coverColor,
        target_group_id: targetGroup ? parseInt(targetGroup) : null,
        thank_you_message: thankYou,
        is_active: isActive,
      };

      let savedForm;
      if (formId) {
        const r = await updateForm(formId, formData);
        savedForm = r.data;
      } else {
        const r = await createForm(boardId, formData);
        savedForm = r.data;
        setSlug(savedForm.slug);
      }

      // Save fields
      const visibleFields = fields
        .filter(f => f.is_visible)
        .map((f, i) => ({
          column_id: f.column_id,
          label: f.label || f.column_title,
          is_required: f.is_required,
          position: i,
          is_visible: true,
        }));

      await saveFormFields(savedForm.id, visibleFields);
      toast('Form saved', 'success');
      onSaved(savedForm);
    } catch (err) {
      toast('Failed to save form', 'error');
    } finally {
      setSaving(false);
    }
  };

  const publicUrl = slug ? `${BASE_URL}/form/${slug}` : '';
  const embedCode = slug
    ? `<iframe src="${BASE_URL}/form/${slug}" width="100%" height="600" frameborder="0" style="border-radius:8px"></iframe>`
    : '';

  const copyToClipboard = (text, label) => {
    copyTextToClipboard(text).then(() => toast(`${label} copied!`, 'success')).catch(() => toast('Copy failed', 'error'));
  };

  const previewFields = fields.filter(f => f.is_visible);

  const sectionBtn = (key, label) => (
    <button
      onClick={() => setActiveSection(key)}
      style={{
        padding: '6px 14px', borderRadius: 6, fontSize: 13, fontWeight: activeSection === key ? 700 : 500,
        border: `1.5px solid ${activeSection === key ? '#0073ea' : '#e0e0e0'}`,
        background: activeSection === key ? '#e8f0fe' : '#fff',
        color: activeSection === key ? '#0073ea' : '#555',
        cursor: 'pointer',
      }}
    >{label}</button>
  );

  return (
    <div style={{ display: 'flex', height: '100%', overflow: 'hidden' }}>

      {/* ── Left panel ── */}
      <div style={{ width: 380, flexShrink: 0, display: 'flex', flexDirection: 'column', borderRight: '1px solid #e6e9ef', background: '#fff', overflow: 'hidden' }}>
        {/* Header */}
        <div style={{ padding: '14px 18px', borderBottom: '1px solid #f0f0f0', display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexShrink: 0 }}>
          <button onClick={onBack} style={{ fontSize: 13, color: '#0073ea', fontWeight: 600, display: 'flex', alignItems: 'center', gap: 4 }}>
            ← Back
          </button>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            {/* Active toggle */}
            <label style={{ display: 'flex', alignItems: 'center', gap: 6, cursor: 'pointer', fontSize: 12, fontWeight: 600, color: isActive ? '#037f4c' : '#aaa' }}>
              <div
                onClick={() => setActive(a => !a)}
                style={{
                  width: 36, height: 20, borderRadius: 10, background: isActive ? '#00c875' : '#ddd',
                  position: 'relative', cursor: 'pointer', transition: 'background 0.2s', flexShrink: 0,
                }}
              >
                <div style={{
                  position: 'absolute', top: 2, left: isActive ? 18 : 2, width: 16, height: 16,
                  borderRadius: '50%', background: '#fff', transition: 'left 0.2s',
                  boxShadow: '0 1px 3px rgba(0,0,0,0.2)',
                }} />
              </div>
              {isActive ? 'Active' : 'Inactive'}
            </label>
            <button
              onClick={handleSave}
              disabled={saving}
              style={{ padding: '7px 18px', background: '#0073ea', color: '#fff', borderRadius: 7, fontWeight: 700, fontSize: 13, cursor: saving ? 'wait' : 'pointer', opacity: saving ? 0.7 : 1 }}
            >
              {saving ? 'Saving…' : formId ? 'Save Changes' : 'Create Form'}
            </button>
          </div>
        </div>

        {/* Section tabs */}
        <div style={{ padding: '10px 18px', borderBottom: '1px solid #f0f0f0', display: 'flex', gap: 6, flexShrink: 0 }}>
          {sectionBtn('basic', '⚙ Basic Info')}
          {sectionBtn('fields', '📋 Fields')}
          {slug && sectionBtn('share', '🔗 Share')}
        </div>

        <div style={{ flex: 1, overflowY: 'auto', padding: '16px 18px' }}>

          {/* ── Section A: Basic Info ── */}
          {activeSection === 'basic' && (
            <div>
              <div style={{ marginBottom: 14 }}>
                <label style={lbl}>Form Title</label>
                <input value={title} onChange={e => setTitle(e.target.value)} placeholder="e.g. Customer Request Form"
                  style={inp} onFocus={e => e.target.style.borderColor = '#0073ea'} onBlur={e => e.target.style.borderColor = '#e0e0e0'} />
              </div>
              <div style={{ marginBottom: 14 }}>
                <label style={lbl}>Description</label>
                <textarea value={description} onChange={e => setDesc(e.target.value)} placeholder="Brief description of this form…" rows={3}
                  style={{ ...inp, resize: 'vertical' }}
                  onFocus={e => e.target.style.borderColor = '#0073ea'} onBlur={e => e.target.style.borderColor = '#e0e0e0'} />
              </div>
              <div style={{ marginBottom: 14 }}>
                <label style={lbl}>Cover Accent Color</label>
                <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                  <input type="color" value={coverColor} onChange={e => setColor(e.target.value)}
                    style={{ width: 48, height: 36, border: '1.5px solid #e0e0e0', borderRadius: 6, cursor: 'pointer', padding: 2 }} />
                  <span style={{ fontSize: 12, color: '#555', fontFamily: 'monospace' }}>{coverColor}</span>
                  <div style={{ display: 'flex', gap: 5 }}>
                    {['#0073ea','#00c875','#e2445c','#fdab3d','#a25ddc','#037f4c','#ff5ac4'].map(c => (
                      <div key={c} onClick={() => setColor(c)} style={{ width: 20, height: 20, borderRadius: '50%', background: c, cursor: 'pointer', border: c === coverColor ? '3px solid #323338' : '2px solid transparent' }} />
                    ))}
                  </div>
                </div>
              </div>
              <div style={{ marginBottom: 14 }}>
                <label style={lbl}>Target Group (where items go)</label>
                <select value={targetGroup} onChange={e => setGroup(e.target.value)} style={{ ...inp, cursor: 'pointer' }}>
                  <option value="">— First group (default) —</option>
                  {groups.map(g => <option key={g.id} value={String(g.id)}>{g.name}</option>)}
                </select>
              </div>
              <div style={{ marginBottom: 14 }}>
                <label style={lbl}>Thank-you Message</label>
                <textarea value={thankYou} onChange={e => setThankYou(e.target.value)} rows={3}
                  style={{ ...inp, resize: 'vertical' }}
                  onFocus={e => e.target.style.borderColor = '#0073ea'} onBlur={e => e.target.style.borderColor = '#e0e0e0'} />
              </div>
            </div>
          )}

          {/* ── Section B: Fields ── */}
          {activeSection === 'fields' && (
            <div>
              <p style={{ fontSize: 12, color: '#888', marginBottom: 12 }}>
                Check the columns you want to include in this form. "Item Name" is always included.
              </p>

              {/* Item name — always on, always required */}
              <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '8px 10px', borderRadius: 8, background: '#e8f0fe', marginBottom: 8, border: '1.5px solid #b3d1ff' }}>
                <span style={{ fontSize: 16 }}>☑</span>
                <span style={{ flex: 1, fontSize: 13, fontWeight: 600, color: '#0073ea' }}>Item Name</span>
                <span style={{ fontSize: 11, color: '#e2445c', fontWeight: 700 }}>Required</span>
              </div>

              {fields.map(f => (
                <div key={f.column_id} style={{
                  display: 'flex', alignItems: 'center', gap: 8, padding: '8px 10px',
                  borderRadius: 8, marginBottom: 6,
                  background: f.is_visible ? '#fff' : '#fafafa',
                  border: `1.5px solid ${f.is_visible ? '#e0e0e0' : '#f0f0f0'}`,
                  opacity: f.is_visible ? 1 : 0.6,
                }}>
                  <input
                    type="checkbox"
                    checked={f.is_visible}
                    onChange={() => toggleField(f.column_id)}
                    style={{ cursor: 'pointer', accentColor: '#0073ea', width: 16, height: 16, flexShrink: 0 }}
                  />
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <input
                      value={f.label}
                      onChange={e => updateLabel(f.column_id, e.target.value)}
                      disabled={!f.is_visible}
                      style={{
                        border: 'none', background: 'transparent', fontSize: 13, fontWeight: 500,
                        color: f.is_visible ? '#323338' : '#aaa', width: '100%',
                        outline: 'none', padding: 0,
                      }}
                      onFocus={e => { e.target.style.borderBottom = '1px solid #0073ea'; }}
                      onBlur={e => { e.target.style.borderBottom = 'none'; }}
                    />
                    <div style={{ fontSize: 11, color: '#aaa', marginTop: 1 }}>{f.column_type}</div>
                  </div>
                  {f.is_visible && (
                    <label style={{ display: 'flex', alignItems: 'center', gap: 4, cursor: 'pointer', fontSize: 11, flexShrink: 0 }}>
                      <input
                        type="checkbox"
                        checked={f.is_required}
                        onChange={() => toggleRequired(f.column_id)}
                        style={{ cursor: 'pointer', accentColor: '#e2445c' }}
                      />
                      <span style={{ color: f.is_required ? '#e2445c' : '#aaa', fontWeight: 600 }}>Required</span>
                    </label>
                  )}
                </div>
              ))}
            </div>
          )}

          {/* ── Section C: Share ── */}
          {activeSection === 'share' && slug && (
            <div>
              <div style={{ marginBottom: 20 }}>
                <label style={lbl}>Public Form URL</label>
                <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                  <input readOnly value={publicUrl} style={{ ...inp, flex: 1, background: '#f5f5f5', fontSize: 12, cursor: 'text' }} />
                  <button onClick={() => copyToClipboard(publicUrl, 'Link')} style={copyBtn}>Copy Link</button>
                </div>
              </div>

              <div style={{ marginBottom: 16 }}>
                <label style={lbl}>Embed Code</label>
                <textarea readOnly value={embedCode} rows={4}
                  style={{ ...inp, background: '#f5f5f5', fontSize: 11, fontFamily: 'monospace', resize: 'none', cursor: 'text' }} />
                <button onClick={() => copyToClipboard(embedCode, 'Embed code')} style={{ ...copyBtn, marginTop: 8 }}>Copy Embed Code</button>
              </div>

              <div style={{ background: '#fffbe6', border: '1px solid #ffe58f', borderRadius: 8, padding: '10px 12px', fontSize: 11, color: '#7a5a00' }}>
                💡 Replace <code>localhost:5173</code> with your production domain when deploying.
              </div>
            </div>
          )}
        </div>
      </div>

      {/* ── Right panel: live preview ── */}
      <div style={{ flex: 1, background: '#f0f2f5', overflowY: 'auto', padding: '24px' }}>
        <div style={{ maxWidth: 480, margin: '0 auto' }}>
          <div style={{ textAlign: 'center', fontSize: 12, color: '#aaa', marginBottom: 12, fontWeight: 600, letterSpacing: 0.5, textTransform: 'uppercase' }}>
            Live Preview
          </div>
          <FormPreview
            form={{ title, description, cover_color: coverColor, thank_you_message: thankYou }}
            fields={previewFields}
          />
        </div>
      </div>
    </div>
  );
}

// ── Forms list view ───────────────────────────────────────────────────────────
function FormsList({ boardId, onOpenBuilder }) {
  const [forms, setForms] = useState([]);
  const [loading, setLoading] = useState(true);
  const toast = useToast();

  const load = useCallback(() => {
    setLoading(true);
    getForms(boardId)
      .then(r => setForms(r.data))
      .catch(() => toast('Failed to load forms', 'error'))
      .finally(() => setLoading(false));
  }, [boardId]);

  useEffect(() => { load(); }, [load]);

  const handleDelete = async (id) => {
    if (!confirm('Delete this form? This cannot be undone.')) return;
    try {
      await deleteForm(id);
      setForms(f => f.filter(x => x.id !== id));
      toast('Form deleted');
    } catch { toast('Failed to delete form', 'error'); }
  };

  const handleCreate = () => {
    onOpenBuilder(null); // null = new form
  };

  const copyLink = (slug) => {
    const url = `${BASE_URL}/form/${slug}`;
    copyTextToClipboard(url).then(() => toast('Link copied!', 'success')).catch(() => toast('Copy failed', 'error'));
  };

  const copyEmbed = (slug) => {
    const code = `<iframe src="${BASE_URL}/form/${slug}" width="100%" height="600" frameborder="0" style="border-radius:8px"></iframe>`;
    copyTextToClipboard(code).then(() => toast('Embed code copied!', 'success')).catch(() => toast('Copy failed', 'error'));
  };

  return (
    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
      {/* List header */}
      <div style={{ padding: '16px 24px', borderBottom: '1px solid #f0f0f0', display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexShrink: 0 }}>
        <div>
          <div style={{ fontSize: 14, color: '#888' }}>Create shareable forms that add items directly to your board</div>
        </div>
        <button
          onClick={handleCreate}
          style={{ padding: '8px 18px', background: '#0073ea', color: '#fff', borderRadius: 8, fontWeight: 700, fontSize: 13, cursor: 'pointer' }}
        >+ Create Form</button>
      </div>

      <div style={{ flex: 1, overflowY: 'auto', padding: '20px 24px' }}>
        {loading ? (
          <div style={{ textAlign: 'center', padding: 60, color: '#aaa' }}>
            <div style={{ fontSize: 32, marginBottom: 8 }}>⏳</div>Loading…
          </div>
        ) : forms.length === 0 ? (
          <div style={{ textAlign: 'center', padding: '60px 20px', color: '#aaa' }}>
            <div style={{ fontSize: 52, marginBottom: 12 }}>📋</div>
            <div style={{ fontSize: 15, fontWeight: 600, marginBottom: 6 }}>No forms yet</div>
            <div style={{ fontSize: 13, marginBottom: 20 }}>Create a form to collect submissions directly into this board</div>
            <button onClick={handleCreate}
              style={{ padding: '10px 24px', background: '#0073ea', color: '#fff', borderRadius: 8, fontWeight: 700, fontSize: 14, cursor: 'pointer' }}>
              + Create Your First Form
            </button>
          </div>
        ) : (
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(300px, 1fr))', gap: 16 }}>
            {forms.map(form => (
              <div key={form.id} style={{
                background: '#fff', borderRadius: 12, overflow: 'hidden',
                boxShadow: '0 2px 12px rgba(0,0,0,0.07)', border: '1px solid #e6e9ef',
              }}>
                {/* Color banner */}
                <div style={{ height: 8, background: form.cover_color || '#0073ea' }} />
                <div style={{ padding: '14px 16px' }}>
                  <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: 6 }}>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontSize: 14, fontWeight: 700, color: '#323338', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        {form.title}
                      </div>
                      <div style={{ fontSize: 12, color: '#888', marginTop: 2 }}>
                        → {form.target_group_name || 'First group'}
                      </div>
                    </div>
                    <span style={{
                      padding: '2px 10px', borderRadius: 12, fontSize: 11, fontWeight: 700, flexShrink: 0, marginLeft: 8,
                      background: form.is_active ? '#e8f7ee' : '#f5f5f5',
                      color: form.is_active ? '#037f4c' : '#aaa',
                      border: `1px solid ${form.is_active ? '#b7e4ca' : '#e0e0e0'}`,
                    }}>
                      {form.is_active ? '● Active' : '○ Inactive'}
                    </span>
                  </div>

                  <div style={{ display: 'flex', gap: 6, marginTop: 12, flexWrap: 'wrap' }}>
                    <button onClick={() => onOpenBuilder(form.id)}
                      style={{ padding: '5px 12px', background: '#0073ea', color: '#fff', borderRadius: 6, fontSize: 12, fontWeight: 600, cursor: 'pointer' }}>
                      Open Builder
                    </button>
                    <button onClick={() => copyLink(form.slug)}
                      style={{ padding: '5px 12px', border: '1px solid #e0e0e0', borderRadius: 6, fontSize: 12, color: '#555', cursor: 'pointer' }}>
                      🔗 Copy Link
                    </button>
                    <button onClick={() => copyEmbed(form.slug)}
                      style={{ padding: '5px 12px', border: '1px solid #e0e0e0', borderRadius: 6, fontSize: 12, color: '#555', cursor: 'pointer' }}>
                      &lt;/&gt; Embed
                    </button>
                    <button onClick={() => window.open(`/form/${form.slug}`, '_blank')}
                      style={{ padding: '5px 12px', border: '1px solid #e0e0e0', borderRadius: 6, fontSize: 12, color: '#555', cursor: 'pointer' }}>
                      👁 Preview
                    </button>
                    <button onClick={() => handleDelete(form.id)}
                      style={{ padding: '5px 12px', border: '1px solid #ffd6db', borderRadius: 6, fontSize: 12, color: '#e2445c', cursor: 'pointer', marginLeft: 'auto' }}>
                      Delete
                    </button>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

// ── Shared styles ─────────────────────────────────────────────────────────────
const lbl = { fontSize: 11, fontWeight: 700, color: '#888', display: 'block', marginBottom: 5, textTransform: 'uppercase', letterSpacing: 0.5 };
const inp = { width: '100%', border: '1.5px solid #e0e0e0', borderRadius: 7, padding: '8px 10px', fontSize: 13, outline: 'none', boxSizing: 'border-box', background: '#fff' };
const copyBtn = { padding: '7px 14px', background: '#f0f6ff', color: '#0073ea', border: '1.5px solid #b3d1ff', borderRadius: 6, fontSize: 12, fontWeight: 700, cursor: 'pointer', whiteSpace: 'nowrap' };

// ── Main panel ────────────────────────────────────────────────────────────────
export default function FormsPanel({ boardId, groups, columns, onClose }) {
  const [view, setView] = useState('list'); // 'list' | 'builder'
  const [editingFormId, setEditingFormId] = useState(null);
  const [savedFormId, setSavedFormId] = useState(null);

  const openBuilder = (formId) => {
    setEditingFormId(formId);
    setSavedFormId(formId);
    setView('builder');
  };

  const handleSaved = (savedForm) => {
    setSavedFormId(savedForm.id);
    setEditingFormId(savedForm.id);
  };

  const handleBack = () => {
    setView('list');
    setEditingFormId(null);
    setSavedFormId(null);
  };

  return (
    <div style={{
      position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.4)', zIndex: 400,
      display: 'flex', alignItems: 'stretch', justifyContent: 'flex-end',
    }} onClick={onClose}>
      <div
        onClick={e => e.stopPropagation()}
        style={{
          width: view === 'builder' ? '90vw' : 720,
          maxWidth: '100vw',
          background: '#f8f9fb',
          display: 'flex',
          flexDirection: 'column',
          boxShadow: '-4px 0 32px rgba(0,0,0,0.15)',
          overflow: 'hidden',
        }}
      >
        {/* Panel header */}
        <div style={{
          background: '#fff', borderBottom: '1px solid #e6e9ef',
          padding: '14px 20px', display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          flexShrink: 0,
        }}>
          <div>
            <h2 style={{ fontSize: 16, fontWeight: 700, margin: 0, color: '#323338' }}>📋 Forms</h2>
            <p style={{ fontSize: 12, color: '#888', margin: '2px 0 0' }}>
              {view === 'builder' ? 'Design your form and manage fields' : 'Collect data from anyone — no account needed'}
            </p>
          </div>
          <button onClick={onClose} style={{ fontSize: 22, color: '#888', lineHeight: 1, cursor: 'pointer' }}>×</button>
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
