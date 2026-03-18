import React, { useState, useEffect, useRef } from 'react';
import { useParams } from 'react-router-dom';
import { getPublicForm, submitPublicForm } from '../api';

// ── Field input components ────────────────────────────────────────────────────

const DEFAULT_STATUS_OPTIONS  = ['Not Started', 'In Progress', 'Done', 'Stuck'];
const DEFAULT_PRIORITY_OPTIONS = ['Critical', 'High', 'Medium', 'Low'];
const STATUS_COLORS  = { 'Not Started':'#c4c4c4','In Progress':'#fdab3d','Done':'#00c875','Stuck':'#e2445c' };
const PRIORITY_COLORS = { Critical:'#e2445c', High:'#ff642e', Medium:'#fdab3d', Low:'#00c875' };
const PRIORITY_ICONS  = { Critical:'🔴', High:'🟠', Medium:'🟡', Low:'🟢' };

function parseSettings(raw) {
  try { return typeof raw === 'string' ? JSON.parse(raw) : (raw || {}); }
  catch { return {}; }
}

function FieldInput({ field, value, onChange, error, accentColor }) {
  const type = field.column_type;
  const settings = parseSettings(field.column_settings);

  const baseInput = {
    width: '100%', border: `1.5px solid ${error ? '#e2445c' : '#e0e0e0'}`, borderRadius: 8,
    padding: '11px 14px', fontSize: 15, outline: 'none', boxSizing: 'border-box',
    background: '#fff', color: '#323338', fontFamily: 'inherit',
    transition: 'border-color 0.15s',
  };

  const handleFocus = e => { e.target.style.borderColor = accentColor; };
  const handleBlur  = e => { e.target.style.borderColor = error ? '#e2445c' : '#e0e0e0'; };

  switch (type) {
    case 'long_text':
      return (
        <textarea
          rows={4} value={value} onChange={e => onChange(e.target.value)}
          placeholder="Type your answer…"
          style={{ ...baseInput, resize: 'vertical' }}
          onFocus={handleFocus} onBlur={handleBlur}
        />
      );

    case 'number':
      return (
        <input type="number" value={value} onChange={e => onChange(e.target.value)}
          placeholder="0" style={baseInput} onFocus={handleFocus} onBlur={handleBlur} />
      );

    case 'email':
      return (
        <input type="email" value={value} onChange={e => onChange(e.target.value)}
          placeholder="you@example.com" style={baseInput} onFocus={handleFocus} onBlur={handleBlur} />
      );

    case 'phone':
      return (
        <input type="tel" value={value} onChange={e => onChange(e.target.value)}
          placeholder="+91 98765 43210" style={baseInput} onFocus={handleFocus} onBlur={handleBlur} />
      );

    case 'date':
      return (
        <input type="date" value={value} onChange={e => onChange(e.target.value)}
          style={baseInput} onFocus={handleFocus} onBlur={handleBlur} />
      );

    case 'link':
      return (
        <input type="url" value={value} onChange={e => onChange(e.target.value)}
          placeholder="https://" style={baseInput} onFocus={handleFocus} onBlur={handleBlur} />
      );

    case 'progress': {
      const pct = parseInt(value) || 0;
      return (
        <div>
          <input type="range" min="0" max="100" value={pct} onChange={e => onChange(e.target.value)}
            style={{ width: '100%', accentColor, margin: '8px 0 4px' }} />
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <div style={{ flex: 1, background: '#e0e0e0', borderRadius: 4, height: 8, overflow: 'hidden' }}>
              <div style={{ width: `${pct}%`, height: '100%', background: accentColor, borderRadius: 4, transition: 'width 0.1s' }} />
            </div>
            <span style={{ fontSize: 14, fontWeight: 700, color: accentColor, minWidth: 36 }}>{pct}%</span>
          </div>
        </div>
      );
    }

    case 'checkbox':
      return (
        <div
          onClick={() => onChange(value === 'true' ? 'false' : 'true')}
          style={{ display: 'flex', alignItems: 'center', gap: 12, cursor: 'pointer', padding: '4px 0' }}
        >
          <div style={{
            width: 24, height: 24, borderRadius: 6,
            border: `2px solid ${value === 'true' ? accentColor : (error ? '#e2445c' : '#c4c4c4')}`,
            background: value === 'true' ? accentColor : '#fff',
            display: 'flex', alignItems: 'center', justifyContent: 'center', transition: 'all 0.15s', flexShrink: 0,
          }}>
            {value === 'true' && <span style={{ color: '#fff', fontSize: 14, fontWeight: 700 }}>✓</span>}
          </div>
          <span style={{ fontSize: 15, color: '#323338' }}>
            {value === 'true' ? 'Yes' : 'No'}
          </span>
        </div>
      );

    case 'rating': {
      const num = parseInt(value) || 0;
      return (
        <div style={{ display: 'flex', gap: 8 }}>
          {[1,2,3,4,5].map(i => (
            <span
              key={i}
              onClick={() => onChange(i === num ? '' : String(i))}
              style={{ fontSize: 32, cursor: 'pointer', color: i <= num ? '#fdab3d' : '#c4c4c4', transition: 'color 0.1s' }}
            >
              {i <= num ? '★' : '☆'}
            </span>
          ))}
        </div>
      );
    }

    case 'status': {
      const opts = settings.options
        ? settings.options.map(o => typeof o === 'string' ? { label: o, color: STATUS_COLORS[o] || '#c4c4c4' } : o)
        : DEFAULT_STATUS_OPTIONS.map(l => ({ label: l, color: STATUS_COLORS[l] }));
      return (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
          {opts.map(opt => (
            <button
              key={opt.label}
              type="button"
              onClick={() => onChange(value === opt.label ? '' : opt.label)}
              style={{
                padding: '7px 16px', borderRadius: 20, fontSize: 13, fontWeight: 600, cursor: 'pointer',
                background: value === opt.label ? opt.color : '#f5f5f5',
                color: value === opt.label ? '#fff' : '#555',
                border: `2px solid ${value === opt.label ? opt.color : '#e0e0e0'}`,
                transition: 'all 0.15s',
              }}
            >{opt.label}</button>
          ))}
        </div>
      );
    }

    case 'priority': {
      return (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
          {DEFAULT_PRIORITY_OPTIONS.map(lbl => (
            <button
              key={lbl}
              type="button"
              onClick={() => onChange(value === lbl ? '' : lbl)}
              style={{
                padding: '7px 16px', borderRadius: 20, fontSize: 13, fontWeight: 600, cursor: 'pointer',
                background: value === lbl ? PRIORITY_COLORS[lbl] : '#f5f5f5',
                color: value === lbl ? '#fff' : '#555',
                border: `2px solid ${value === lbl ? PRIORITY_COLORS[lbl] : '#e0e0e0'}`,
                transition: 'all 0.15s',
              }}
            >{PRIORITY_ICONS[lbl]} {lbl}</button>
          ))}
        </div>
      );
    }

    case 'dropdown': {
      const opts = settings.options || [];
      return (
        <select
          value={value} onChange={e => onChange(e.target.value)}
          style={{ ...baseInput, cursor: 'pointer', appearance: 'auto' }}
          onFocus={handleFocus} onBlur={handleBlur}
        >
          <option value="">— Select an option —</option>
          {opts.map(o => {
            const v = typeof o === 'string' ? o : o.label;
            return <option key={v} value={v}>{v}</option>;
          })}
        </select>
      );
    }

    case 'timeline': {
      const parts = (value || '').split('|');
      const start = parts[0] || '';
      const end   = parts[1] || '';
      return (
        <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
          <input type="date" value={start}
            onChange={e => onChange(`${e.target.value}|${end}`)}
            style={{ ...baseInput, flex: 1 }} onFocus={handleFocus} onBlur={handleBlur} />
          <span style={{ color: '#888', fontSize: 14, flexShrink: 0 }}>→</span>
          <input type="date" value={end}
            onChange={e => onChange(`${start}|${e.target.value}`)}
            style={{ ...baseInput, flex: 1 }} onFocus={handleFocus} onBlur={handleBlur} />
        </div>
      );
    }

    case 'tags':
      return (
        <input type="text" value={value} onChange={e => onChange(e.target.value)}
          placeholder="Tag1, Tag2, Tag3 (comma-separated)"
          style={baseInput} onFocus={handleFocus} onBlur={handleBlur} />
      );

    case 'location': case 'person':
      return (
        <input type="text" value={value} onChange={e => onChange(e.target.value)}
          placeholder="Type here…" style={baseInput} onFocus={handleFocus} onBlur={handleBlur} />
      );

    case 'color_picker':
      return (
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <input type="color" value={value || '#0073ea'} onChange={e => onChange(e.target.value)}
            style={{ width: 52, height: 42, border: baseInput.border, borderRadius: 8, cursor: 'pointer', padding: 3 }} />
          <span style={{ fontSize: 13, color: '#555', fontFamily: 'monospace' }}>{value || '#0073ea'}</span>
        </div>
      );

    default: // text, file, etc.
      return (
        <input type="text" value={value} onChange={e => onChange(e.target.value)}
          placeholder="Type your answer…" style={baseInput} onFocus={handleFocus} onBlur={handleBlur} />
      );
  }
}

// ── Main public form page ─────────────────────────────────────────────────────
export default function PublicForm() {
  const { slug } = useParams();
  const [form, setForm]         = useState(null);
  const [status, setStatus]     = useState('loading'); // loading | ready | inactive | notfound | submitted | error
  const [values, setValues]     = useState({});    // { _name: '', [colId]: '' }
  const [errors, setErrors]     = useState({});
  const [submitting, setSubmitting] = useState(false);
  const [netError, setNetError] = useState('');
  const firstErrorRef = useRef(null);

  useEffect(() => {
    getPublicForm(slug)
      .then(data => {
        if (data.error) { setStatus('notfound'); return; }
        setForm(data);
        // Init values
        const init = { _name: '' };
        (data.fields || []).forEach(f => { init[f.column_id] = ''; });
        setValues(init);
        setStatus(data.is_active ? 'ready' : 'inactive');
      })
      .catch(() => setStatus('notfound'));
  }, [slug]);

  const handleChange = (key, val) => {
    setValues(v => ({ ...v, [key]: val }));
    if (errors[key]) setErrors(e => { const n = { ...e }; delete n[key]; return n; });
  };

  const validate = () => {
    const errs = {};
    if (!values['_name']?.trim()) errs['_name'] = 'Item name is required';
    (form.fields || []).forEach(f => {
      if (f.is_required && (!values[f.column_id] || String(values[f.column_id]).trim() === '')) {
        errs[f.column_id] = `${f.label || f.column_title} is required`;
      }
    });
    return errs;
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setNetError('');
    const errs = validate();
    if (Object.keys(errs).length > 0) {
      setErrors(errs);
      // Scroll to first error
      setTimeout(() => {
        if (firstErrorRef.current) {
          firstErrorRef.current.scrollIntoView({ behavior: 'smooth', block: 'center' });
        }
      }, 50);
      return;
    }

    setSubmitting(true);
    try {
      const result = await submitPublicForm(slug, { fields: values });
      if (result.error) throw new Error(result.error);
      setStatus('submitted');
    } catch (err) {
      setNetError(err.message || 'Submission failed. Please try again.');
    } finally {
      setSubmitting(false);
    }
  };

  const handleReset = () => {
    const init = { _name: '' };
    (form.fields || []).forEach(f => { init[f.column_id] = ''; });
    setValues(init);
    setErrors({});
    setNetError('');
    setStatus('ready');
  };

  const accentColor = form?.cover_color || '#0073ea';

  // ── Loading ──
  if (status === 'loading') {
    return (
      <div style={pageWrap}>
        <div style={{ textAlign: 'center', color: '#888' }}>
          <div style={{ fontSize: 40, marginBottom: 10 }}>⏳</div>
          <div>Loading form…</div>
        </div>
      </div>
    );
  }

  // ── Not found ──
  if (status === 'notfound') {
    return (
      <div style={pageWrap}>
        <div style={card}>
          <div style={{ textAlign: 'center', padding: '40px 20px' }}>
            <div style={{ fontSize: 52, marginBottom: 12 }}>🔍</div>
            <div style={{ fontSize: 20, fontWeight: 700, color: '#323338', marginBottom: 8 }}>Form Not Found</div>
            <div style={{ fontSize: 15, color: '#888' }}>This form link may be invalid or has been removed.</div>
          </div>
        </div>
      </div>
    );
  }

  // ── Inactive ──
  if (status === 'inactive') {
    return (
      <div style={pageWrap}>
        <div style={{ ...card, overflow: 'hidden' }}>
          <div style={{ background: accentColor, height: 8 }} />
          <div style={{ textAlign: 'center', padding: '40px 20px' }}>
            <div style={{ fontSize: 52, marginBottom: 12 }}>🔒</div>
            <div style={{ fontSize: 20, fontWeight: 700, color: '#323338', marginBottom: 8 }}>
              This form is no longer available
            </div>
            <div style={{ fontSize: 15, color: '#888' }}>
              The form owner has closed this form. Please contact them for more information.
            </div>
          </div>
        </div>
      </div>
    );
  }

  // ── Submitted ──
  if (status === 'submitted') {
    return (
      <div style={pageWrap}>
        <div style={{ ...card, overflow: 'hidden' }}>
          <div style={{ background: accentColor, height: 8 }} />
          <div style={{ textAlign: 'center', padding: '48px 32px' }}>
            <div style={{
              fontSize: 64, marginBottom: 20,
              animation: 'scaleIn 0.4s ease-out',
            }}>✅</div>
            <div style={{ fontSize: 22, fontWeight: 800, color: '#323338', marginBottom: 10, lineHeight: 1.4 }}>
              {form.thank_you_message || 'Thank you! Your response has been submitted.'}
            </div>
            <button
              onClick={handleReset}
              style={{
                marginTop: 24, padding: '10px 28px',
                background: accentColor, color: '#fff', borderRadius: 8,
                fontWeight: 700, fontSize: 14, cursor: 'pointer',
              }}
            >
              Submit another response
            </button>
          </div>
        </div>
        <style>{`@keyframes scaleIn { from { transform: scale(0.3); opacity: 0 } to { transform: scale(1); opacity: 1 } }`}</style>
      </div>
    );
  }

  // ── Ready: render form ──
  const firstErrorKey = Object.keys(errors)[0];

  return (
    <div style={pageWrap}>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=DM+Sans:wght@400;500;600;700;800&display=swap');
        * { box-sizing: border-box; }
        body { margin: 0; background: #f0f2f5; }
      `}</style>

      <div style={{ ...card, overflow: 'hidden', marginBottom: 32 }}>
        {/* Cover banner */}
        <div style={{ background: accentColor, padding: '36px 32px 28px' }}>
          <div style={{ fontSize: 26, fontWeight: 800, color: '#fff', lineHeight: 1.3 }}>
            {form.title}
          </div>
          {form.description && (
            <div style={{ fontSize: 15, color: 'rgba(255,255,255,0.85)', marginTop: 8, lineHeight: 1.5 }}>
              {form.description}
            </div>
          )}
        </div>

        {/* Form body */}
        <form onSubmit={handleSubmit} style={{ padding: '28px 32px' }} noValidate>

          {/* Item name — always first */}
          <div
            ref={firstErrorKey === '_name' ? firstErrorRef : null}
            style={{ marginBottom: 24 }}
          >
            <label style={fieldLabel}>
              Item Name <span style={{ color: '#e2445c' }}>*</span>
            </label>
            <input
              type="text"
              value={values['_name'] || ''}
              onChange={e => handleChange('_name', e.target.value)}
              placeholder="Enter a name for this submission…"
              style={{
                width: '100%', border: `1.5px solid ${errors['_name'] ? '#e2445c' : '#e0e0e0'}`,
                borderRadius: 8, padding: '11px 14px', fontSize: 15, outline: 'none',
                boxSizing: 'border-box', fontFamily: 'inherit', transition: 'border-color 0.15s',
              }}
              onFocus={e => e.target.style.borderColor = accentColor}
              onBlur={e => e.target.style.borderColor = errors['_name'] ? '#e2445c' : '#e0e0e0'}
            />
            {errors['_name'] && <div style={errMsg}>{errors['_name']}</div>}
          </div>

          {/* Dynamic fields */}
          {(form.fields || []).map(field => (
            <div
              key={field.column_id}
              ref={firstErrorKey === String(field.column_id) ? firstErrorRef : null}
              style={{ marginBottom: 24 }}
            >
              <label style={fieldLabel}>
                {field.label || field.column_title}
                {field.is_required && <span style={{ color: '#e2445c', marginLeft: 3 }}>*</span>}
              </label>
              <FieldInput
                field={field}
                value={values[field.column_id] || ''}
                onChange={val => handleChange(field.column_id, val)}
                error={!!errors[field.column_id]}
                accentColor={accentColor}
              />
              {errors[field.column_id] && <div style={errMsg}>{errors[field.column_id]}</div>}
            </div>
          ))}

          {/* Network error */}
          {netError && (
            <div style={{
              background: '#fff5f7', border: '1px solid #ffd6db', borderRadius: 8,
              padding: '10px 14px', marginBottom: 16, fontSize: 13, color: '#e2445c',
            }}>
              ⚠️ {netError}
            </div>
          )}

          <button
            type="submit"
            disabled={submitting}
            style={{
              width: '100%', padding: '14px 0',
              background: submitting ? '#aaa' : accentColor,
              color: '#fff', borderRadius: 8, fontWeight: 700, fontSize: 16,
              cursor: submitting ? 'wait' : 'pointer',
              transition: 'background 0.2s', marginTop: 4,
            }}
          >
            {submitting ? 'Submitting…' : 'Submit'}
          </button>
        </form>
      </div>

      <div style={{ textAlign: 'center', fontSize: 12, color: '#aaa', paddingBottom: 24 }}>
        Powered by D'Decor Workboard
      </div>
    </div>
  );
}

// ── Styles ────────────────────────────────────────────────────────────────────
const pageWrap = {
  minHeight: '100vh', background: '#f0f2f5',
  display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
  padding: '24px 16px',
  fontFamily: "'DM Sans', Figtree, -apple-system, sans-serif",
};
const card = {
  background: '#fff', borderRadius: 16, boxShadow: '0 4px 32px rgba(0,0,0,0.1)',
  width: '100%', maxWidth: 680,
};
const fieldLabel = { display: 'block', marginBottom: 7, fontSize: 15, fontWeight: 600, color: '#323338' };
const errMsg = { marginTop: 5, fontSize: 12, color: '#e2445c', fontWeight: 500 };
