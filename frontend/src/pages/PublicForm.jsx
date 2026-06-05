import React, { useState, useEffect, useRef, useCallback } from 'react';
import { useParams } from 'react-router-dom';
import { getPublicForm, submitPublicForm, uploadPublicFormFile } from '../api';

const DEFAULT_STATUS_OPTIONS = ['Not Started', 'In Progress', 'Done', 'Stuck'];
const DEFAULT_PRIORITY_OPTIONS = ['Critical', 'High', 'Medium', 'Low'];
const STATUS_COLORS = { 'Not Started': '#c4c4c4', 'In Progress': '#fdab3d', Done: '#00c875', Stuck: '#e2445c' };
const PRIORITY_COLORS = { Critical: '#e2445c', High: '#ff642e', Medium: '#fdab3d', Low: '#00c875' };
const FILE_SIZE_LIMIT = 20 * 1024 * 1024;

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

function optionsFor(field) {
  const settings = parseSettings(field.column_settings);
  if (field.column_type === 'priority') return DEFAULT_PRIORITY_OPTIONS.map(label => ({ label, color: PRIORITY_COLORS[label] }));
  if (field.column_type === 'checkbox') return [{ label: 'Yes', value: 'true' }, { label: 'No', value: 'false' }];
  if (Array.isArray(settings.options)) return settings.options.map(o => typeof o === 'string' ? { label: o, color: STATUS_COLORS[o] || '#c4c4c4' } : o);
  if (field.column_type === 'status') return DEFAULT_STATUS_OPTIONS.map(label => ({ label, color: STATUS_COLORS[label] }));
  return [];
}

function conditionMatches(rule, values) {
  const actual = String(values[String(rule.source_column_id)] || '').trim();
  const wanted = Array.isArray(rule.values) ? rule.values.map(String) : [String(rule.value || '')];
  if (rule.operator === 'not_equals') return !wanted.includes(actual);
  if (rule.operator === 'contains') return wanted.some(v => actual.toLowerCase().includes(v.toLowerCase()));
  if (rule.operator === 'is_empty') return actual === '';
  if (rule.operator === 'is_not_empty') return actual !== '';
  return wanted.includes(actual);
}

function fieldIsVisible(field, values) {
  const rules = parseLogic(field.conditional_logic);
  if (!rules.length) return true;
  return rules.some(rule => conditionMatches(rule, values));
}

function FieldInput({ field, value, onChange, error, accentColor, slug }) {
  const type = field.column_type;
  const settings = parseSettings(field.column_settings);
  const [uploading, setUploading] = useState(false);

  const baseInput = {
    width: '100%', border: `1.5px solid ${error ? '#e2445c' : '#d0d4e4'}`, borderRadius: 8,
    padding: '11px 14px', fontSize: 15, outline: 'none', boxSizing: 'border-box',
    background: '#fff', color: '#323338', fontFamily: 'inherit',
  };
  const focus = e => { e.target.style.borderColor = accentColor; };
  const blur = e => { e.target.style.borderColor = error ? '#e2445c' : '#d0d4e4'; };
  const placeholder = field.placeholder || 'Type your answer...';

  if (type === 'long_text') {
    return <textarea rows={4} value={value} onChange={e => onChange(e.target.value)} placeholder={placeholder} style={{ ...baseInput, resize: 'vertical' }} onFocus={focus} onBlur={blur} />;
  }
  if (type === 'number') {
    return <input type="number" value={value} onChange={e => onChange(e.target.value)} placeholder={field.placeholder || '0'} style={baseInput} onFocus={focus} onBlur={blur} />;
  }
  if (type === 'email') {
    return <input type="email" value={value} onChange={e => onChange(e.target.value)} placeholder={field.placeholder || 'you@example.com'} style={baseInput} onFocus={focus} onBlur={blur} />;
  }
  if (type === 'phone') {
    return <input type="tel" value={value} onChange={e => onChange(e.target.value)} placeholder={field.placeholder || '+91 98765 43210'} style={baseInput} onFocus={focus} onBlur={blur} />;
  }
  if (type === 'date') {
    return <input type="date" value={value} onChange={e => onChange(e.target.value)} style={baseInput} onFocus={focus} onBlur={blur} />;
  }
  if (type === 'link') {
    return <input type="url" value={value} onChange={e => onChange(e.target.value)} placeholder={field.placeholder || 'https://'} style={baseInput} onFocus={focus} onBlur={blur} />;
  }
  if (type === 'progress') {
    const pct = parseInt(value, 10) || 0;
    return (
      <div>
        <input type="range" min="0" max="100" value={pct} onChange={e => onChange(e.target.value)} style={{ width: '100%', accentColor, margin: '8px 0 4px' }} />
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <div style={{ flex: 1, background: '#e0e0e0', borderRadius: 4, height: 8, overflow: 'hidden' }}><div style={{ width: `${pct}%`, height: '100%', background: accentColor }} /></div>
          <span style={{ fontSize: 14, fontWeight: 800, color: accentColor, minWidth: 36 }}>{pct}%</span>
        </div>
      </div>
    );
  }
  if (type === 'checkbox') {
    return (
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
        {optionsFor(field).map(opt => (
          <button key={opt.value} type="button" onClick={() => onChange(value === opt.value ? '' : opt.value)} style={chip(value === opt.value, accentColor)}>
            {opt.label}
          </button>
        ))}
      </div>
    );
  }
  if (type === 'rating') {
    // Half-star support: click the LEFT half of a star for ½, the right half for
    // a full star; click the current value again to clear. Mirrors the board cell.
    const num = Math.max(0, Math.min(5, parseFloat(value) || 0));
    const pickRating = (i, e) => {
      const r = e.currentTarget.getBoundingClientRect();
      const v = (e.clientX - r.left) < r.width / 2 ? i - 0.5 : i;
      onChange(v === num ? '' : String(v));
    };
    return (
      <div style={{ display: 'flex', gap: 8 }} title={num ? `${num} / 5` : 'Click to rate'}>
        {[1, 2, 3, 4, 5].map(i => {
          const fill = num >= i ? 'full' : (num >= i - 0.5 ? 'half' : 'empty');
          return (
            <span key={i} role="button" onClick={e => pickRating(i, e)}
              style={{ fontSize: 32, cursor: 'pointer', position: 'relative', display: 'inline-block', width: '1em', lineHeight: 1, color: fill === 'empty' ? '#c4c4c4' : '#fdab3d' }}>
              {fill === 'half' ? (
                <>
                  <span style={{ color: '#c4c4c4' }}>☆</span>
                  <span style={{ position: 'absolute', left: 0, top: 0, width: '50%', overflow: 'hidden', color: '#fdab3d' }}>★</span>
                </>
              ) : (fill === 'full' ? '★' : '☆')}
            </span>
          );
        })}
      </div>
    );
  }
  if (type === 'status' || type === 'priority') {
    return (
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
        {optionsFor(field).map(opt => (
          <button key={opt.label} type="button" onClick={() => onChange(value === opt.label ? '' : opt.label)} style={{
            padding: '7px 16px', borderRadius: 20, fontSize: 13, fontWeight: 700, cursor: 'pointer',
            background: value === opt.label ? (opt.color || accentColor) : '#f5f6fa',
            color: value === opt.label ? '#fff' : '#555',
            border: `2px solid ${value === opt.label ? (opt.color || accentColor) : '#dfe3ee'}`,
          }}>{opt.label}</button>
        ))}
      </div>
    );
  }
  if (type === 'dropdown') {
    const opts = settings.options || [];
    return (
      <select value={value} onChange={e => onChange(e.target.value)} style={{ ...baseInput, cursor: 'pointer' }} onFocus={focus} onBlur={blur}>
        <option value="">Select an option</option>
        {opts.map(o => {
          const v = typeof o === 'string' ? o : o.label;
          return <option key={v} value={v}>{v}</option>;
        })}
      </select>
    );
  }
  if (type === 'timeline') {
    const [start = '', end = ''] = String(value || '').split('|');
    return (
      <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
        <input type="date" value={start} onChange={e => onChange(`${e.target.value}|${end}`)} style={{ ...baseInput, flex: 1 }} onFocus={focus} onBlur={blur} />
        <span style={{ color: '#888', fontSize: 14 }}>to</span>
        <input type="date" value={end} onChange={e => onChange(`${start}|${e.target.value}`)} style={{ ...baseInput, flex: 1 }} onFocus={focus} onBlur={blur} />
      </div>
    );
  }
  if (type === 'tags') {
    return <input type="text" value={value} onChange={e => onChange(e.target.value)} placeholder={field.placeholder || 'Tag1, Tag2, Tag3'} style={baseInput} onFocus={focus} onBlur={blur} />;
  }
  if (type === 'color_picker') {
    return (
      <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
        <input type="color" value={value || '#9b72f5'} onChange={e => onChange(e.target.value)} style={{ width: 52, height: 42, border: baseInput.border, borderRadius: 8, cursor: 'pointer', padding: 3 }} />
        <span style={{ fontSize: 13, color: '#555', fontFamily: 'monospace' }}>{value || '#9b72f5'}</span>
      </div>
    );
  }
  if (type === 'file') {
    let files = [];
    try { files = value ? JSON.parse(value) : []; } catch { files = []; }
    if (!Array.isArray(files)) files = [];
    const handleFiles = async e => {
      const selected = Array.from(e.target.files || []);
      e.target.value = '';
      const allowed = selected.filter(f => f.size <= FILE_SIZE_LIMIT);
      if (allowed.length !== selected.length) alert('One or more files exceeded the 20 MB limit.');
      if (!allowed.length) return;
      setUploading(true);
      try {
        const uploaded = [];
        for (const file of allowed) {
          const result = await uploadPublicFormFile(slug, file);
          if (result.error) throw new Error(result.error);
          uploaded.push(result);
        }
        onChange(JSON.stringify([...files, ...uploaded]));
      } catch (err) {
        alert(err.message || 'Upload failed');
      } finally {
        setUploading(false);
      }
    };
    return (
      <div style={{ border: `1.5px dashed ${error ? '#e2445c' : '#d0d4e4'}`, borderRadius: 8, padding: 12 }}>
        <input type="file" multiple onChange={handleFiles} disabled={uploading} />
        {uploading && <div style={{ marginTop: 8, fontSize: 12, color: accentColor, fontWeight: 700 }}>Uploading...</div>}
        {files.length > 0 && (
          <div style={{ marginTop: 10, display: 'flex', flexDirection: 'column', gap: 6 }}>
            {files.map((f, i) => (
              <div key={`${f.name}-${i}`} style={{ display: 'flex', justifyContent: 'space-between', gap: 8, fontSize: 13, color: '#323338', background: '#f5f6fa', borderRadius: 6, padding: '6px 8px' }}>
                <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{f.originalName}</span>
                <button type="button" onClick={() => onChange(JSON.stringify(files.filter((_, idx) => idx !== i)))} style={{ border: 'none', background: 'transparent', color: '#e2445c', cursor: 'pointer' }}>Remove</button>
              </div>
            ))}
          </div>
        )}
      </div>
    );
  }
  return <input type="text" value={value} onChange={e => onChange(e.target.value)} placeholder={placeholder} style={baseInput} onFocus={focus} onBlur={blur} />;
}

function chip(active, accentColor) {
  return {
    padding: '7px 16px', borderRadius: 20, fontSize: 13, fontWeight: 700, cursor: 'pointer',
    background: active ? accentColor : '#f5f6fa',
    color: active ? '#fff' : '#555',
    border: `2px solid ${active ? accentColor : '#dfe3ee'}`,
  };
}

// A single misbehaving field must never blank the whole public form (this page
// is externally shared and has no app-level error boundary above it). Catch
// render errors and show a readable fallback instead of an empty white page.
class FormErrorBoundary extends React.Component {
  constructor(props) { super(props); this.state = { error: null }; }
  static getDerivedStateFromError(error) { return { error }; }
  componentDidCatch(error, info) { console.error('PublicForm render error:', error, info); }
  render() {
    if (this.state.error) {
      return (
        <Shell>
          <Message title="Something went wrong" body="This form hit an unexpected error. Please refresh the page and try again." />
        </Shell>
      );
    }
    return this.props.children;
  }
}

function PublicFormBody() {
  const { slug } = useParams();
  const [form, setForm] = useState(null);
  const [status, setStatus] = useState('loading');
  const [values, setValues] = useState({});
  const [errors, setErrors] = useState({});
  const [submitting, setSubmitting] = useState(false);
  const [netError, setNetError] = useState('');
  const [captchaAnswer, setCaptchaAnswer] = useState('');
  const firstErrorRef = useRef(null);

  const load = useCallback(() => {
    setStatus('loading');
    getPublicForm(slug)
      .then(data => {
        if (data.error) { setStatus('notfound'); return; }
        setForm(data);
        const init = { _name: '' };
        (data.fields || []).forEach(f => { init[String(f.column_id)] = ''; });
        setValues(init);
        setStatus(data.is_active ? 'ready' : 'inactive');
      })
      .catch(() => setStatus('notfound'));
  }, [slug]);

  useEffect(() => { load(); }, [load]);

  const handleChange = (key, val) => {
    setValues(v => ({ ...v, [String(key)]: val }));
    if (errors[key]) setErrors(e => { const n = { ...e }; delete n[key]; return n; });
  };

  const visibleFields = (form?.fields || []).filter(f => fieldIsVisible(f, values));
  const accentColor = form?.cover_color || '#9b72f5';

  const validate = () => {
    const errs = {};
    if (!values._name?.trim()) errs._name = `${form.item_name_label || 'Item Name'} is required`;
    visibleFields.forEach(f => {
      if (f.is_required && (!values[String(f.column_id)] || String(values[String(f.column_id)]).trim() === '')) {
        errs[String(f.column_id)] = `${f.label || f.column_title} is required`;
      }
    });
    if (form.captcha_enabled && !captchaAnswer.trim()) errs._captcha = 'CAPTCHA is required';
    return errs;
  };

  const handleSubmit = async e => {
    e.preventDefault();
    setNetError('');
    const errs = validate();
    if (Object.keys(errs).length) {
      setErrors(errs);
      setTimeout(() => firstErrorRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' }), 50);
      return;
    }
    setSubmitting(true);
    try {
      const result = await submitPublicForm(slug, {
        fields: values,
        captcha_token: form.captcha?.token,
        captcha_answer: captchaAnswer,
      });
      if (result.error) throw new Error(result.error);
      setStatus('submitted');
      if (result.redirect_url) setTimeout(() => { window.location.href = result.redirect_url; }, 650);
    } catch (err) {
      setNetError(err.message || 'Submission failed. Please try again.');
    } finally {
      setSubmitting(false);
    }
  };

  const handleReset = () => {
    const init = { _name: '' };
    (form.fields || []).forEach(f => { init[String(f.column_id)] = ''; });
    setValues(init);
    setErrors({});
    setNetError('');
    setCaptchaAnswer('');
    setStatus('ready');
    if (form.captcha_enabled) load();
  };

  if (status === 'loading') return <Shell><div style={centerText}>Loading form...</div></Shell>;
  if (status === 'notfound') return <Shell><Message title="Form Not Found" body="This form link may be invalid or has been removed." /></Shell>;
  if (status === 'inactive') {
    return (
      <Shell>
        <Message title="This form is no longer available" body={form?.closed_message || 'The form owner has closed this form.'} color={accentColor} />
      </Shell>
    );
  }
  if (status === 'submitted') {
    return (
      <Shell hideBranding={form.hide_branding}>
        <div style={{ ...card, overflow: 'hidden' }}>
          <div style={{ background: accentColor, height: 8 }} />
          <div style={{ textAlign: 'center', padding: '48px 32px' }}>
            <div style={{ fontSize: 42, color: accentColor, fontWeight: 900, marginBottom: 18 }}>OK</div>
            <div style={{ fontSize: 22, fontWeight: 800, color: '#323338', marginBottom: 10, lineHeight: 1.4 }}>{form.thank_you_title || 'Thank you!'}</div>
            <div style={{ fontSize: 15, color: '#676879', lineHeight: 1.6 }}>{form.thank_you_message || 'Your response has been submitted.'}</div>
            {!form.redirect_url && <button onClick={handleReset} style={{ ...submitBtn(accentColor), width: 'auto', padding: '10px 28px', marginTop: 24 }}>Submit another response</button>}
          </div>
        </div>
      </Shell>
    );
  }

  const totalQuestions = visibleFields.length + 1 + (form.captcha_enabled ? 1 : 0);
  const answered = [
    values._name,
    ...visibleFields.map(f => values[String(f.column_id)]),
    ...(form.captcha_enabled ? [captchaAnswer] : []),
  ].filter(v => String(v || '').trim() !== '').length;
  const pct = Math.max(5, Math.round((answered / Math.max(totalQuestions, 1)) * 100));
  const firstErrorKey = Object.keys(errors)[0];

  return (
    <Shell hideBranding={form.hide_branding}>
      <div style={{ ...card, overflow: 'hidden', marginBottom: 32 }}>
        <div style={{ background: accentColor, padding: '36px 32px 28px' }}>
          <div style={{ fontSize: 26, fontWeight: 800, color: '#fff', lineHeight: 1.3 }}>{form.title}</div>
          {form.description && <div style={{ fontSize: 15, color: 'rgba(255,255,255,0.85)', marginTop: 8, lineHeight: 1.5 }}>{form.description}</div>}
        </div>
        {form.progress_bar_enabled && <div style={{ height: 5, background: '#dfe3ee' }}><div style={{ width: `${pct}%`, height: '100%', background: accentColor, transition: 'width 0.2s' }} /></div>}
        <form onSubmit={handleSubmit} style={{ padding: '28px 32px' }} noValidate>
          <div ref={firstErrorKey === '_name' ? firstErrorRef : null} style={{ marginBottom: 24 }}>
            <label style={fieldLabel}>{form.item_name_label || 'Item Name'} <span style={{ color: '#e2445c' }}>*</span></label>
            <input type="text" value={values._name || ''} onChange={e => handleChange('_name', e.target.value)} placeholder="Enter a name for this submission" style={{ ...textInput, borderColor: errors._name ? '#e2445c' : '#d0d4e4' }} onFocus={e => e.target.style.borderColor = accentColor} onBlur={e => e.target.style.borderColor = errors._name ? '#e2445c' : '#d0d4e4'} />
            {errors._name && <div style={errMsg}>{errors._name}</div>}
          </div>

          {visibleFields.map(field => (
            <div key={field.column_id} ref={firstErrorKey === String(field.column_id) ? firstErrorRef : null} style={{ marginBottom: 24 }}>
              <label style={fieldLabel}>{field.label || field.column_title}{field.is_required && <span style={{ color: '#e2445c', marginLeft: 3 }}>*</span>}</label>
              {field.help_text && <div style={{ fontSize: 13, color: '#676879', marginBottom: 8, lineHeight: 1.45 }}>{field.help_text}</div>}
              <FieldInput field={field} value={values[String(field.column_id)] || ''} onChange={val => handleChange(field.column_id, val)} error={!!errors[String(field.column_id)]} accentColor={accentColor} slug={slug} />
              {errors[String(field.column_id)] && <div style={errMsg}>{errors[String(field.column_id)]}</div>}
            </div>
          ))}

          {form.captcha_enabled && (
            <div ref={firstErrorKey === '_captcha' ? firstErrorRef : null} style={{ marginBottom: 24 }}>
              <label style={fieldLabel}>{form.captcha?.question || 'CAPTCHA'} <span style={{ color: '#e2445c' }}>*</span></label>
              <input value={captchaAnswer} onChange={e => { setCaptchaAnswer(e.target.value); setErrors(er => { const n = { ...er }; delete n._captcha; return n; }); }} style={{ ...textInput, borderColor: errors._captcha ? '#e2445c' : '#d0d4e4' }} />
              {errors._captcha && <div style={errMsg}>{errors._captcha}</div>}
            </div>
          )}

          {netError && <div style={{ background: '#fff5f7', border: '1px solid #ffd6db', borderRadius: 8, padding: '10px 14px', marginBottom: 16, fontSize: 13, color: '#e2445c' }}>{netError}</div>}

          <button type="submit" disabled={submitting} style={{ ...submitBtn(accentColor), background: submitting ? '#aaa' : accentColor }}>
            {submitting ? 'Submitting...' : (form.submit_button_text || 'Submit')}
          </button>
        </form>
      </div>
    </Shell>
  );
}

export default function PublicForm() {
  return (
    <FormErrorBoundary>
      <PublicFormBody />
    </FormErrorBoundary>
  );
}

function Shell({ children, hideBranding }) {
  return (
    <div className="simplix-form-light" style={pageWrap}>
      <style>{`@import url('https://fonts.googleapis.com/css2?family=DM+Sans:wght@400;500;600;700;800&display=swap'); * { box-sizing: border-box; } body { margin: 0; background: #f0f2f5; }`}</style>
      {children}
      {!hideBranding && <div style={{ textAlign: 'center', fontSize: 12, color: '#aaa', paddingBottom: 24 }}>Powered by <span style={{ fontWeight: 700, color: '#888' }}>Simplix</span></div>}
    </div>
  );
}

function Message({ title, body, color = '#9b72f5' }) {
  return (
    <div style={{ ...card, overflow: 'hidden' }}>
      <div style={{ background: color, height: 8 }} />
      <div style={{ textAlign: 'center', padding: '44px 24px' }}>
        <div style={{ fontSize: 20, fontWeight: 800, color: '#323338', marginBottom: 8 }}>{title}</div>
        <div style={{ fontSize: 15, color: '#676879', lineHeight: 1.55 }}>{body}</div>
      </div>
    </div>
  );
}

const pageWrap = {
  minHeight: '100vh',
  background: '#f0f2f5',
  display: 'flex',
  flexDirection: 'column',
  alignItems: 'center',
  justifyContent: 'center',
  padding: '24px 16px',
  fontFamily: "'DM Sans', Figtree, -apple-system, sans-serif",
};
const card = {
  background: '#fff',
  borderRadius: 12,
  boxShadow: '0 4px 32px rgba(0,0,0,0.1)',
  width: '100%',
  maxWidth: 680,
};
const centerText = { ...card, padding: 40, textAlign: 'center', color: '#676879' };
const fieldLabel = { display: 'block', marginBottom: 7, fontSize: 15, fontWeight: 700, color: '#323338' };
const errMsg = { marginTop: 5, fontSize: 12, color: '#e2445c', fontWeight: 700 };
const textInput = {
  width: '100%',
  border: '1.5px solid #d0d4e4',
  borderRadius: 8,
  padding: '11px 14px',
  fontSize: 15,
  outline: 'none',
  boxSizing: 'border-box',
  fontFamily: 'inherit',
};
const submitBtn = color => ({
  width: '100%',
  padding: '14px 0',
  background: color,
  color: '#fff',
  borderRadius: 8,
  border: 'none',
  fontWeight: 800,
  fontSize: 16,
  cursor: 'pointer',
  marginTop: 4,
});
