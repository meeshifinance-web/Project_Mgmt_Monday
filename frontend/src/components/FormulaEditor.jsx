import React, { useState, useRef, useEffect } from 'react';
import { evaluateFormula, FORMULA_FUNCTIONS } from '../utils/formulaEngine';

const SECTION = { fontSize: 11, fontWeight: 700, color: '#676879', textTransform: 'uppercase', letterSpacing: 0.6, marginBottom: 6 };

export default function FormulaEditor({ column, columns, previewItem, onSave, onClose }) {
  const [formula, setFormula]   = useState(column?.settings?.formula || '');
  const [fnSearch, setFnSearch] = useState('');
  const [showFns, setShowFns]   = useState(false);
  const textareaRef = useRef(null);

  // Close on Escape
  useEffect(() => {
    const h = e => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', h);
    return () => document.removeEventListener('keydown', h);
  }, [onClose]);

  // Computed preview
  const preview = (() => {
    if (!formula.trim()) return '';
    if (!previewItem) return '(no items to preview)';
    try { return evaluateFormula(formula, previewItem, columns); }
    catch (e) { return `#ERROR: ${e.message}`; }
  })();

  const isError = preview.startsWith('#ERROR') || preview.startsWith('#NAME');

  // Insert text at cursor position
  const insertAt = (text) => {
    const ta = textareaRef.current;
    if (!ta) { setFormula(f => f + text); return; }
    const start = ta.selectionStart;
    const end   = ta.selectionEnd;
    const next  = formula.slice(0, start) + text + formula.slice(end);
    setFormula(next);
    setTimeout(() => {
      ta.focus();
      ta.setSelectionRange(start + text.length, start + text.length);
    }, 0);
  };

  // Non-formula columns available for reference
  const refCols = columns.filter(c => c.type !== 'formula' && c.id !== column?.id);

  const filteredFns = FORMULA_FUNCTIONS.filter(f =>
    !fnSearch || f.name.includes(fnSearch.toUpperCase()) || f.desc.toLowerCase().includes(fnSearch.toLowerCase())
  );

  const handleSave = () => {
    onSave({ ...column.settings, formula: formula.trim() });
  };

  return (
    <>
      {/* Backdrop */}
      <div onClick={onClose} style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.4)', zIndex: 600 }} />

      {/* Modal */}
      <div onClick={e => e.stopPropagation()} style={{
        position: 'fixed', top: '50%', left: '50%', transform: 'translate(-50%,-50%)',
        width: 740, maxWidth: '96vw', maxHeight: '90vh',
        background: 'var(--bg-primary)', borderRadius: 12,
        boxShadow: '0 16px 64px rgba(0,0,0,0.28)',
        display: 'flex', flexDirection: 'column', zIndex: 601, overflow: 'hidden',
      }}>

        {/* Header */}
        <div style={{ padding: '16px 20px', borderBottom: '1px solid var(--border-color)', display: 'flex', alignItems: 'center', gap: 10, flexShrink: 0 }}>
          <span style={{ fontSize: 20 }}>🧮</span>
          <div style={{ flex: 1 }}>
            <div style={{ fontSize: 15, fontWeight: 700, color: 'var(--text-primary)' }}>Formula Editor</div>
            <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>{column?.title}</div>
          </div>
          <button onClick={onClose} style={{ fontSize: 20, color: 'var(--text-muted)', background: 'none', border: 'none', cursor: 'pointer', lineHeight: 1 }}>×</button>
        </div>

        {/* Body — two columns */}
        <div style={{ display: 'flex', flex: 1, overflow: 'hidden' }}>

          {/* Left: formula input + preview */}
          <div style={{ flex: 1, padding: 20, display: 'flex', flexDirection: 'column', gap: 14, overflowY: 'auto', borderRight: '1px solid var(--border-color)' }}>

            {/* Formula textarea */}
            <div>
              <div style={SECTION}>Formula</div>
              <textarea
                ref={textareaRef}
                value={formula}
                onChange={e => setFormula(e.target.value)}
                rows={5}
                placeholder={'Examples:\nIF({Status} = "Done", "✅ Done", "⏳ Pending")\n{Number Column} * 1.18\nCONCATENATE({Name}, " — ", {Status})'}
                style={{
                  width: '100%', boxSizing: 'border-box',
                  fontFamily: 'monospace', fontSize: 13,
                  border: '1.5px solid var(--border-color)', borderRadius: 8,
                  padding: '10px 12px', outline: 'none', resize: 'vertical',
                  background: 'var(--input-bg)', color: 'var(--text-primary)',
                  lineHeight: 1.6,
                }}
                onFocus={e => e.currentTarget.style.borderColor = '#0073ea'}
                onBlur={e => e.currentTarget.style.borderColor = 'var(--border-color)'}
              />
            </div>

            {/* Column references */}
            <div>
              <div style={SECTION}>Insert Column Reference</div>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                {refCols.length === 0 && <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>No other columns on this board yet.</span>}
                {refCols.map(c => (
                  <button
                    key={c.id}
                    onClick={() => insertAt(`{${c.title}}`)}
                    title={`Insert {${c.title}}`}
                    style={{
                      fontSize: 12, padding: '3px 10px', borderRadius: 20,
                      border: '1.5px solid #0073ea', background: '#e3f0ff', color: '#0073ea',
                      cursor: 'pointer', fontWeight: 600, whiteSpace: 'nowrap',
                    }}
                    onMouseEnter={e => e.currentTarget.style.background = '#cce3ff'}
                    onMouseLeave={e => e.currentTarget.style.background = '#e3f0ff'}
                  >
                    {`{${c.title}}`}
                  </button>
                ))}
              </div>
            </div>

            {/* Syntax quick-ref */}
            <div style={{ background: 'var(--bg-secondary)', borderRadius: 8, padding: '10px 14px', fontSize: 12, color: 'var(--text-secondary)', lineHeight: 1.8 }}>
              <strong style={{ color: 'var(--text-primary)' }}>Syntax</strong>
              <div>• Column references: <code style={{ background: 'rgba(0,115,234,0.1)', padding: '0 4px', borderRadius: 3 }}>{'{Column Name}'}</code></div>
              <div>• Text strings: <code style={{ background: 'rgba(0,115,234,0.1)', padding: '0 4px', borderRadius: 3 }}>"text"</code></div>
              <div>• Arithmetic: <code style={{ background: 'rgba(0,115,234,0.1)', padding: '0 4px', borderRadius: 3 }}>+ - * /</code>&nbsp; Text concat: <code style={{ background: 'rgba(0,115,234,0.1)', padding: '0 4px', borderRadius: 3 }}>&amp;</code></div>
              <div>• Compare: <code style={{ background: 'rgba(0,115,234,0.1)', padding: '0 4px', borderRadius: 3 }}>= != &lt; &gt; &lt;= &gt;=</code></div>
            </div>

            {/* Live preview */}
            <div>
              <div style={SECTION}>Live Preview {previewItem ? `(item: "${previewItem.name}")` : ''}</div>
              <div style={{
                padding: '10px 14px', borderRadius: 8, minHeight: 36,
                background: isError ? '#fff0f2' : 'var(--bg-secondary)',
                border: `1.5px solid ${isError ? '#e2445c' : 'var(--border-color)'}`,
                fontSize: 13, color: isError ? '#e2445c' : 'var(--text-primary)',
                fontFamily: isError ? 'monospace' : 'inherit',
                wordBreak: 'break-all',
              }}>
                {formula.trim() ? (preview || <span style={{ color: 'var(--text-muted)' }}>Empty result</span>) : <span style={{ color: 'var(--text-muted)' }}>Enter a formula above to see preview</span>}
              </div>
            </div>
          </div>

          {/* Right: function reference */}
          <div style={{ width: 280, flexShrink: 0, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
            <div style={{ padding: '12px 14px 8px', flexShrink: 0 }}>
              <div style={SECTION}>Functions ({FORMULA_FUNCTIONS.length})</div>
              <input
                value={fnSearch}
                onChange={e => setFnSearch(e.target.value)}
                placeholder="Search functions…"
                style={{
                  width: '100%', boxSizing: 'border-box', fontSize: 12,
                  border: '1.5px solid var(--border-color)', borderRadius: 6,
                  padding: '5px 8px', outline: 'none',
                  background: 'var(--input-bg)', color: 'var(--text-primary)',
                }}
                onFocus={e => e.currentTarget.style.borderColor = '#0073ea'}
                onBlur={e => e.currentTarget.style.borderColor = 'var(--border-color)'}
              />
            </div>
            <div style={{ flex: 1, overflowY: 'auto', padding: '0 8px 12px' }}>
              {filteredFns.map(fn => (
                <div
                  key={fn.name}
                  onClick={() => insertAt(`${fn.name}(`)}
                  title={fn.sig}
                  style={{
                    padding: '7px 8px', borderRadius: 6, cursor: 'pointer',
                    marginBottom: 2,
                  }}
                  onMouseEnter={e => e.currentTarget.style.background = 'var(--hover-bg)'}
                  onMouseLeave={e => e.currentTarget.style.background = 'transparent'}
                >
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 4 }}>
                    <span style={{ fontSize: 12, fontWeight: 700, color: '#0073ea', fontFamily: 'monospace' }}>{fn.name}</span>
                  </div>
                  <div style={{ fontSize: 10, color: 'var(--text-muted)', marginTop: 1 }}>{fn.desc}</div>
                  <div style={{ fontSize: 10, color: 'var(--text-secondary)', fontFamily: 'monospace', marginTop: 1, wordBreak: 'break-all' }}>{fn.sig}</div>
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* Footer */}
        <div style={{ padding: '12px 20px', borderTop: '1px solid var(--border-color)', display: 'flex', justifyContent: 'flex-end', gap: 8, flexShrink: 0 }}>
          <button onClick={onClose} style={{ padding: '7px 18px', borderRadius: 7, border: '1px solid var(--border-color)', background: 'transparent', color: 'var(--text-secondary)', fontSize: 13, cursor: 'pointer', fontWeight: 500 }}>
            Cancel
          </button>
          <button onClick={handleSave} style={{ padding: '7px 20px', borderRadius: 7, border: 'none', background: '#0073ea', color: '#fff', fontSize: 13, fontWeight: 700, cursor: 'pointer' }}>
            Save Formula
          </button>
        </div>
      </div>
    </>
  );
}
