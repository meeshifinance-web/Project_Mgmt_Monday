import React, { useState, useEffect, useRef } from 'react';
import { getApiKeys, generateApiKey, revokeApiKey, renameApiKey } from '../api';

// ── Helpers ───────────────────────────────────────────────────────────────────

function timeAgo(ts) {
  if (!ts) return 'Never';
  const diff = Date.now() - new Date(ts).getTime();
  const m = Math.floor(diff / 60000);
  if (m < 1)  return 'Just now';
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.floor(h / 24);
  return `${d}d ago`;
}

const SCOPE_STYLE = {
  read:  { bg: '#e8f4ff', color: '#9b72f5' },
  write: { bg: '#fff8e6', color: '#fdab3d' },
  full:  { bg: '#e8fff4', color: '#00c875' },
};

function ScopeBadge({ scope }) {
  const s = SCOPE_STYLE[scope] || SCOPE_STYLE.read;
  return (
    <span style={{
      fontSize: 11, fontWeight: 700, padding: '2px 8px', borderRadius: 20,
      background: s.bg, color: s.color, whiteSpace: 'nowrap', letterSpacing: 0.3,
    }}>
      {scope}
    </span>
  );
}

// ── Generate modal ────────────────────────────────────────────────────────────

function GenerateModal({ boards, onClose, onGenerated }) {
  const [form, setForm] = useState({ name: '', scope: 'read', allBoards: true, board_ids: [] });
  const [loading, setLoading] = useState(false);
  const [error, setError]     = useState('');

  const overlayRef = useRef(null);
  useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!form.name.trim()) { setError('Key name is required'); return; }
    setLoading(true);
    setError('');
    try {
      const payload = {
        name:      form.name.trim(),
        scope:     form.scope,
        board_ids: form.allBoards ? [] : form.board_ids,
      };
      const result = await generateApiKey(payload);
      onGenerated(result);
    } catch (err) {
      setError(err.response?.data?.error || 'Failed to generate key');
      setLoading(false);
    }
  };

  const toggleBoard = (id) => {
    setForm(f => ({
      ...f,
      board_ids: f.board_ids.includes(id)
        ? f.board_ids.filter(b => b !== id)
        : [...f.board_ids, id],
    }));
  };

  const radioRow = (value, label, desc) => (
    <label
      key={value}
      style={{ display: 'flex', alignItems: 'flex-start', gap: 10, padding: '8px 0', cursor: 'pointer' }}
      onClick={() => setForm(f => ({ ...f, scope: value }))}
    >
      <div style={{
        width: 16, height: 16, borderRadius: '50%', flexShrink: 0, marginTop: 2,
        border: `2px solid ${form.scope === value ? '#9b72f5' : '#c5c7d4'}`,
        background: form.scope === value ? '#9b72f5' : 'transparent',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
      }}>
        {form.scope === value && <div style={{ width: 6, height: 6, borderRadius: '50%', background: '#fff' }} />}
      </div>
      <div>
        <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--text-primary)' }}>{label}</div>
        <div style={{ fontSize: 11, color: 'var(--text-secondary)', marginTop: 1 }}>{desc}</div>
      </div>
    </label>
  );

  const inp = {
    width: '100%', padding: '8px 12px', borderRadius: 6, fontSize: 13,
    border: '1.5px solid var(--border-color)', background: 'var(--input-bg)',
    color: 'var(--text-primary)', outline: 'none', boxSizing: 'border-box',
  };

  return (
    <div
      ref={overlayRef}
      onClick={e => { if (e.target === overlayRef.current) onClose(); }}
      style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)', zIndex: 2000, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16 }}
    >
      <div style={{ background: 'var(--bg-primary)', borderRadius: 12, width: '100%', maxWidth: 480, maxHeight: '90vh', overflow: 'auto', boxShadow: '0 8px 40px rgba(0,0,0,0.28)' }}>
        {/* Header */}
        <div style={{ padding: '20px 24px 14px', borderBottom: '1px solid var(--border-color)', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <div style={{ fontWeight: 700, fontSize: 17, color: 'var(--text-primary)' }}>Generate New API Key</div>
          <button onClick={onClose} style={{ fontSize: 20, color: 'var(--text-secondary)', lineHeight: 1 }}>×</button>
        </div>

        <form onSubmit={handleSubmit}>
          <div style={{ padding: '20px 24px', display: 'flex', flexDirection: 'column', gap: 20 }}>

            {/* Key name */}
            <div>
              <label style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-secondary)', display: 'block', marginBottom: 6 }}>
                Key Name <span style={{ color: '#e2445c' }}>*</span>
              </label>
              <input
                autoFocus
                placeholder="e.g. Power BI Integration"
                value={form.name}
                onChange={e => setForm(f => ({ ...f, name: e.target.value }))}
                style={inp}
                onFocus={e => e.currentTarget.style.borderColor = '#9b72f5'}
                onBlur={e => e.currentTarget.style.borderColor = 'var(--border-color)'}
              />
            </div>

            {/* Scope */}
            <div>
              <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-secondary)', marginBottom: 4 }}>Permission Scope</div>
              {radioRow('read',  'Read only',       'View boards, items, and column values')}
              {radioRow('write', 'Read + Write',     'Create and update items and values')}
              {radioRow('full',  'Full access',      'Read, write, and delete everything')}
            </div>

            {/* Board access */}
            <div>
              <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-secondary)', marginBottom: 8 }}>Board Access</div>

              <label style={{ display: 'flex', alignItems: 'flex-start', gap: 8, cursor: 'pointer', marginBottom: 8 }}
                onClick={() => setForm(f => ({ ...f, allBoards: true, board_ids: [] }))}>
                <div style={{
                  width: 16, height: 16, borderRadius: '50%', flexShrink: 0, marginTop: 1,
                  border: `2px solid ${form.allBoards ? '#9b72f5' : '#c5c7d4'}`,
                  background: form.allBoards ? '#9b72f5' : 'transparent',
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                }}>
                  {form.allBoards && <div style={{ width: 6, height: 6, borderRadius: '50%', background: '#fff' }} />}
                </div>
                <div>
                  <div style={{ fontSize: 13, color: 'var(--text-primary)' }}>All boards I can access</div>
                  <div style={{ fontSize: 11, color: 'var(--text-secondary)', marginTop: 1 }}>Your current and future board memberships (plus org-wide boards)</div>
                </div>
              </label>

              <label style={{ display: 'flex', alignItems: 'flex-start', gap: 8, cursor: 'pointer' }}
                onClick={() => setForm(f => ({ ...f, allBoards: false }))}>
                <div style={{
                  width: 16, height: 16, borderRadius: '50%', flexShrink: 0, marginTop: 1,
                  border: `2px solid ${!form.allBoards ? '#9b72f5' : '#c5c7d4'}`,
                  background: !form.allBoards ? '#9b72f5' : 'transparent',
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                }}>
                  {!form.allBoards && <div style={{ width: 6, height: 6, borderRadius: '50%', background: '#fff' }} />}
                </div>
                <div>
                  <div style={{ fontSize: 13, color: 'var(--text-primary)' }}>Specific boards only</div>
                  <div style={{ fontSize: 11, color: 'var(--text-secondary)', marginTop: 1 }}>Limit this key to a subset of the boards you can access</div>
                </div>
              </label>

              {!form.allBoards && (
                <div style={{ marginTop: 10, border: '1px solid var(--border-color)', borderRadius: 8, maxHeight: 180, overflowY: 'auto' }}>
                  {boards.length === 0 && (
                    <div style={{ padding: '12px 14px', fontSize: 12, color: 'var(--text-secondary)' }}>No boards available</div>
                  )}
                  {boards.map(b => (
                    <label
                      key={b.id}
                      onClick={() => toggleBoard(b.id)}
                      style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '8px 14px', cursor: 'pointer', borderBottom: '1px solid var(--border-color)' }}
                      onMouseEnter={e => e.currentTarget.style.background = 'var(--hover-bg)'}
                      onMouseLeave={e => e.currentTarget.style.background = 'transparent'}
                    >
                      <div style={{
                        width: 16, height: 16, borderRadius: 4, flexShrink: 0,
                        border: `2px solid ${form.board_ids.includes(b.id) ? '#9b72f5' : '#c5c7d4'}`,
                        background: form.board_ids.includes(b.id) ? '#9b72f5' : 'transparent',
                        display: 'flex', alignItems: 'center', justifyContent: 'center',
                      }}>
                        {form.board_ids.includes(b.id) && <span style={{ color: '#fff', fontSize: 10, fontWeight: 700 }}>✓</span>}
                      </div>
                      <span style={{ fontSize: 13, color: 'var(--text-primary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{b.name}</span>
                    </label>
                  ))}
                </div>
              )}
            </div>

            {error && (
              <div style={{ fontSize: 12, color: '#e2445c', background: '#fff5f7', padding: '8px 12px', borderRadius: 6, border: '1px solid #f5c0ca' }}>
                {error}
              </div>
            )}
          </div>

          <div style={{ padding: '12px 24px 20px', display: 'flex', justifyContent: 'flex-end', gap: 10, borderTop: '1px solid var(--border-color)' }}>
            <button type="button" onClick={onClose} disabled={loading}
              style={{ padding: '8px 18px', borderRadius: 6, fontWeight: 600, fontSize: 13, border: '1.5px solid var(--border-color)', background: 'var(--bg-primary)', color: 'var(--text-secondary)', cursor: 'pointer' }}>
              Cancel
            </button>
            <button type="submit" disabled={loading || !form.name.trim()}
              style={{ padding: '8px 18px', borderRadius: 6, fontWeight: 600, fontSize: 13, border: 'none', background: loading || !form.name.trim() ? '#a0c4f1' : '#9b72f5', color: '#fff', cursor: loading || !form.name.trim() ? 'not-allowed' : 'pointer', display: 'flex', alignItems: 'center', gap: 6 }}>
              {loading ? (
                <><span style={{ display: 'inline-block', width: 13, height: 13, border: '2px solid rgba(255,255,255,0.4)', borderTopColor: '#fff', borderRadius: '50%', animation: 'akSpin 0.6s linear infinite' }} /> Generating…</>
              ) : 'Generate Key →'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

// ── MCP (Model Context Protocol) connection helpers ───────────────────────────
// The same wb_live_ key drives both the REST API and the MCP server. The MCP
// endpoint is served at <origin>/mcp; we build a ready-to-paste client config.

function mcpEndpoint() {
  return `${window.location.origin}/mcp`;
}

function mcpConfigJson(key) {
  return JSON.stringify({
    mcpServers: {
      simplix: {
        type: 'http',
        url: mcpEndpoint(),
        headers: { Authorization: `Bearer ${key}` },
      },
    },
  }, null, 2);
}

// Dark code block with a built-in copy button (reused for MCP + reveal snippets).
function CodeBlock({ code, maxHeight }) {
  const [copied, setCopied] = useState(false);
  const copy = () => navigator.clipboard.writeText(code).then(() => {
    setCopied(true);
    setTimeout(() => setCopied(false), 1800);
  });
  return (
    <div style={{ position: 'relative', background: '#1e1e2e', borderRadius: 8, overflow: 'hidden' }}>
      <pre style={{ margin: 0, padding: '14px 16px', fontSize: 11.5, fontFamily: 'monospace', color: '#cdd6f4', overflowX: 'auto', lineHeight: 1.7, maxHeight: maxHeight || 'none' }}>
        {code}
      </pre>
      <button
        onClick={copy}
        style={{
          position: 'absolute', top: 8, right: 10, fontSize: 11, padding: '3px 10px',
          borderRadius: 5, background: copied ? '#00c875' : 'rgba(255,255,255,0.15)',
          color: '#fff', border: 'none', cursor: 'pointer', transition: 'background 0.2s',
        }}
      >
        {copied ? '✓ Copied' : 'Copy'}
      </button>
    </div>
  );
}

// Hero card — the primary, one-step way to connect an AI assistant (no key).
function ConnectCard() {
  const [copied, setCopied] = useState(false);
  const url = mcpEndpoint();
  const copy = () => navigator.clipboard.writeText(url).then(() => {
    setCopied(true);
    setTimeout(() => setCopied(false), 1600);
  });
  return (
    <div style={{
      borderRadius: 14, padding: '20px 22px', marginBottom: 26,
      background: 'linear-gradient(135deg, rgba(155,114,245,0.13), rgba(155,114,245,0.03))',
      border: '1px solid rgba(155,114,245,0.28)',
    }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 6 }}>
        <span style={{ fontSize: 20 }}>🤖</span>
        <div style={{ fontWeight: 700, fontSize: 16, color: 'var(--text-primary)' }}>Connect an AI assistant</div>
      </div>
      <div style={{ fontSize: 12.5, color: 'var(--text-secondary)', lineHeight: 1.6, marginBottom: 14, maxWidth: 560 }}>
        Use Simplix from Claude, ChatGPT, Cursor and more. Add this URL in your assistant's connectors, then sign in — no key to copy.
      </div>
      <div style={{ display: 'flex', gap: 8, alignItems: 'stretch' }}>
        <div style={{
          flex: 1, display: 'flex', alignItems: 'center', minWidth: 0,
          background: 'var(--bg-primary)', border: '1px solid var(--border-color)', borderRadius: 9,
          padding: '10px 14px', fontFamily: 'monospace', fontSize: 13, color: 'var(--text-primary)',
          overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
        }}>{url}</div>
        <button onClick={copy} style={{
          flexShrink: 0, padding: '0 18px', borderRadius: 9, fontWeight: 700, fontSize: 13,
          border: 'none', background: copied ? '#00c875' : '#9b72f5', color: '#fff', cursor: 'pointer', transition: 'background .2s',
        }}>{copied ? '✓ Copied' : 'Copy URL'}</button>
      </div>
    </div>
  );
}

// Collapsible developer section — API-key config + REST, hidden by default.
function AdvancedKeyDocs() {
  const [open, setOpen] = useState(false);
  return (
    <div style={{ marginTop: 26, borderTop: '1px solid var(--border-color)', paddingTop: 16 }}>
      <button
        onClick={() => setOpen(v => !v)}
        style={{ display: 'flex', alignItems: 'center', gap: 8, background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-secondary)', fontSize: 12.5, fontWeight: 600, padding: 0 }}
      >
        <span style={{ fontSize: 10 }}>{open ? '▾' : '▸'}</span>
        For developers — connect with an API key
      </button>
      {open && (
        <div style={{ marginTop: 12 }}>
          <div style={{ fontSize: 12, color: 'var(--text-secondary)', lineHeight: 1.6, marginBottom: 8 }}>
            For config-file clients or scripts: generate a key above, then use it as a bearer token (MCP config):
          </div>
          <CodeBlock code={mcpConfigJson('YOUR_KEY')} />
          <div style={{ fontSize: 12, color: 'var(--text-secondary)', lineHeight: 1.6, margin: '14px 0 8px' }}>
            Or call the REST API directly:
          </div>
          <CodeBlock code={`curl ${window.location.origin}/api/boards \\\n  -H "X-API-Key: YOUR_KEY"`} />
        </div>
      )}
    </div>
  );
}

// ── Key reveal modal (shown ONCE after generation) ────────────────────────────

function KeyRevealModal({ keyData, boards, onClose }) {
  const [copied, setCopied]       = useState(false);
  const [canClose, setCanClose]   = useState(false);
  const timerRef = useRef(null);

  useEffect(() => {
    timerRef.current = setTimeout(() => setCanClose(true), 5000);
    return () => clearTimeout(timerRef.current);
  }, []);

  const copy = () => {
    navigator.clipboard.writeText(keyData.raw_key).then(() => {
      setCopied(true);
      setCanClose(true);
    });
  };

  const boardLabel = () => {
    if (!keyData.board_ids?.length) return 'All boards';
    const count = keyData.board_ids.length;
    const names = boards.filter(b => keyData.board_ids.includes(b.id)).map(b => b.name);
    return names.length ? names.join(', ') : `${count} board${count !== 1 ? 's' : ''}`;
  };

  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.6)', zIndex: 2100, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16 }}>
      <div style={{ background: 'var(--bg-primary)', borderRadius: 12, width: '100%', maxWidth: 520, maxHeight: '90vh', overflow: 'auto', boxShadow: '0 8px 40px rgba(0,0,0,0.32)' }}>

        {/* Header */}
        <div style={{ padding: '20px 24px 14px', borderBottom: '1px solid var(--border-color)' }}>
          <div style={{ fontWeight: 700, fontSize: 17, color: 'var(--text-primary)' }}>API Key Generated!</div>
        </div>

        <div style={{ padding: '20px 24px', display: 'flex', flexDirection: 'column', gap: 16 }}>
          {/* Warning */}
          <div style={{ background: '#fff8e6', border: '1px solid #e6a817', borderRadius: 8, padding: '12px 14px', display: 'flex', gap: 10 }}>
            <span style={{ fontSize: 16, flexShrink: 0 }}>⚠️</span>
            <div style={{ fontSize: 13, color: '#7a5200', fontWeight: 600 }}>
              Copy this key now — it will never be shown again!
            </div>
          </div>

          {/* Key display */}
          <div>
            <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--text-secondary)', marginBottom: 6, textTransform: 'uppercase', letterSpacing: 0.5 }}>Your API Key</div>
            <div style={{ display: 'flex', gap: 8, alignItems: 'stretch' }}>
              <div style={{
                flex: 1, background: '#f7f8f9', border: '1.5px solid var(--border-color)', borderRadius: 8,
                padding: '10px 14px', fontFamily: 'monospace', fontSize: 12,
                color: 'var(--text-primary)', wordBreak: 'break-all', lineHeight: 1.6,
              }}>
                {keyData.raw_key}
              </div>
              <button
                onClick={copy}
                style={{
                  flexShrink: 0, padding: '0 16px', borderRadius: 8, fontWeight: 600, fontSize: 12,
                  border: 'none', background: copied ? '#00c875' : '#9b72f5', color: '#fff',
                  cursor: 'pointer', transition: 'background 0.2s', whiteSpace: 'nowrap',
                }}
              >
                {copied ? '✓ Copied!' : '📋 Copy'}
              </button>
            </div>
          </div>

          {/* Key details */}
          <div style={{ background: 'var(--bg-secondary)', borderRadius: 8, padding: '12px 14px', display: 'flex', flexDirection: 'column', gap: 8 }}>
            {[
              ['Name',   keyData.name],
              ['Scope',  <ScopeBadge scope={keyData.scope} />],
              ['Boards', boardLabel()],
            ].map(([label, val]) => (
              <div key={label} style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                <span style={{ fontSize: 12, color: 'var(--text-secondary)', width: 52, flexShrink: 0 }}>{label}</span>
                <span style={{ fontSize: 13, color: 'var(--text-primary)', fontWeight: 500 }}>{val}</span>
              </div>
            ))}
          </div>

          {/* MCP connection snippet — ready to paste into an AI client */}
          <div>
            <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--text-secondary)', marginBottom: 6, textTransform: 'uppercase', letterSpacing: 0.5, display: 'flex', alignItems: 'center', gap: 6 }}>
              🤖 Use with an AI assistant
            </div>
            <div style={{ fontSize: 12, color: 'var(--text-secondary)', marginBottom: 8, lineHeight: 1.5 }}>
              Paste this into a config-file client (Claude Desktop, Cursor) to use this key:
            </div>
            <CodeBlock code={mcpConfigJson(keyData.raw_key)} />
          </div>
        </div>

        <div style={{ padding: '12px 24px 20px', borderTop: '1px solid var(--border-color)', display: 'flex', justifyContent: 'flex-end' }}>
          <button
            onClick={onClose}
            disabled={!canClose}
            style={{
              padding: '9px 22px', borderRadius: 6, fontWeight: 600, fontSize: 13,
              border: 'none',
              background: canClose ? '#9b72f5' : '#a0c4f1',
              color: '#fff', cursor: canClose ? 'pointer' : 'not-allowed',
              transition: 'background 0.3s',
            }}
          >
            {canClose ? "I've saved my key — Close" : 'Please copy the key first…'}
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Rename inline input ───────────────────────────────────────────────────────

function RenameInput({ initialValue, onSave, onCancel }) {
  const [val, setVal] = useState(initialValue);
  const ref = useRef(null);
  useEffect(() => { ref.current?.focus(); ref.current?.select(); }, []);

  const commit = () => {
    const t = val.trim();
    if (t && t !== initialValue) onSave(t);
    else onCancel();
  };

  return (
    <input
      ref={ref}
      value={val}
      onChange={e => setVal(e.target.value)}
      onBlur={commit}
      onKeyDown={e => { if (e.key === 'Enter') commit(); if (e.key === 'Escape') onCancel(); }}
      style={{
        fontSize: 13, fontWeight: 500, color: 'var(--text-primary)',
        border: '1.5px solid #9b72f5', borderRadius: 5, padding: '2px 8px',
        outline: 'none', background: 'var(--input-bg)',
      }}
    />
  );
}

// ── Main panel ────────────────────────────────────────────────────────────────

export default function ApiKeysPanel({ boards = [], onClose }) {
  const [keys, setKeys]               = useState([]);
  const [loading, setLoading]         = useState(true);
  const [showGenerate, setShowGenerate] = useState(false);
  const [newKeyResult, setNewKeyResult] = useState(null);
  const [renamingId, setRenamingId]   = useState(null);
  const [revoking, setRevoking]       = useState(null);

  useEffect(() => {
    getApiKeys()
      .then(setKeys)
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  const handleGenerated = (result) => {
    setShowGenerate(false);
    setNewKeyResult(result);
    // Add key to list (without raw_key)
    setKeys(prev => [{ ...result, raw_key: undefined }, ...prev]);
  };

  const handleRevoke = async (id) => {
    if (!window.confirm('Revoke this API key? Any integration using it will stop working immediately.')) return;
    setRevoking(id);
    try {
      await revokeApiKey(id);
      setKeys(prev => prev.filter(k => k.id !== id));
    } catch {
      alert('Failed to revoke key');
    } finally {
      setRevoking(null);
    }
  };

  const handleRename = async (id, name) => {
    try {
      const updated = await renameApiKey(id, name);
      setKeys(prev => prev.map(k => k.id === id ? { ...k, name: updated.name } : k));
    } catch {
      alert('Failed to rename key');
    } finally {
      setRenamingId(null);
    }
  };

  const boardsLabel = (k) => !k.board_ids?.length
    ? 'All boards'
    : `${k.board_ids.length} board${k.board_ids.length !== 1 ? 's' : ''}`;

  return (
    <>
      <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.45)', zIndex: 1100 }} onClick={onClose} />
      <div
        className="wb-side-panel"
        style={{
          position: 'fixed', top: 0, right: 0, bottom: 0,
          width: '100%', maxWidth: 860,
          background: 'var(--bg-primary)',
          zIndex: 1200,
          display: 'flex', flexDirection: 'column',
          boxShadow: '-4px 0 32px rgba(0,0,0,0.22)',
          overflowY: 'auto',
        }}
      >
        {/* Header */}
        <div style={{ padding: '20px 28px 16px', borderBottom: '1px solid var(--border-color)', display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', flexShrink: 0 }}>
          <div>
            <div style={{ fontWeight: 800, fontSize: 20, color: 'var(--text-primary)', display: 'flex', alignItems: 'center', gap: 8 }}>
              🔑 API Keys
            </div>
            <div style={{ fontSize: 13, color: 'var(--text-secondary)', marginTop: 4, maxWidth: 520 }}>
              Connect an AI assistant, or generate keys for scripts and integrations.
            </div>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexShrink: 0, marginLeft: 16 }}>
            <button
              onClick={() => setShowGenerate(true)}
              style={{ padding: '8px 18px', borderRadius: 6, fontWeight: 700, fontSize: 13, border: 'none', background: '#9b72f5', color: '#fff', cursor: 'pointer' }}
            >
              + Generate New Key
            </button>
            <button onClick={onClose} style={{ width: 32, height: 32, borderRadius: '50%', background: 'var(--hover-bg)', color: 'var(--text-secondary)', fontSize: 20, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>×</button>
          </div>
        </div>

        {/* Body */}
        <div style={{ flex: 1, padding: '24px 28px', overflowY: 'auto' }}>

          {/* Hero — connect an AI assistant */}
          <ConnectCard />

          {/* Keys section */}
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
            <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--text-primary)' }}>
              Your API keys{keys.length ? ` (${keys.length})` : ''}
            </div>
          </div>

          {loading ? (
            <div style={{ textAlign: 'center', padding: 40, color: 'var(--text-secondary)' }}>Loading…</div>
          ) : keys.length === 0 ? (
            <div style={{
              textAlign: 'center', padding: '32px 24px', color: 'var(--text-secondary)',
              border: '1px dashed var(--border-color)', borderRadius: 12,
            }}>
              <div style={{ fontSize: 28, marginBottom: 8 }}>🔑</div>
              <div style={{ fontSize: 13, marginBottom: 16 }}>No API keys yet — you only need one for scripts or config-file clients.</div>
              <button
                onClick={() => setShowGenerate(true)}
                style={{ padding: '9px 20px', borderRadius: 8, fontWeight: 700, fontSize: 13, border: 'none', background: '#9b72f5', color: '#fff', cursor: 'pointer' }}
              >
                Generate a key
              </button>
            </div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              {keys.map((k) => (
                <div
                  key={k.id}
                  className="ak-key-card"
                  style={{
                    display: 'flex', alignItems: 'center', gap: 12,
                    padding: '13px 16px', borderRadius: 11,
                    border: '1px solid var(--border-color)', background: 'var(--bg-primary)',
                    transition: 'border-color .15s, box-shadow .15s',
                  }}
                >
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 3 }}>
                      {renamingId === k.id ? (
                        <RenameInput
                          initialValue={k.name}
                          onSave={(name) => handleRename(k.id, name)}
                          onCancel={() => setRenamingId(null)}
                        />
                      ) : (
                        <span style={{ fontWeight: 600, fontSize: 14, color: 'var(--text-primary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{k.name}</span>
                      )}
                      <ScopeBadge scope={k.scope} />
                    </div>
                    <div style={{ fontSize: 12, color: 'var(--text-secondary)', display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                      <span style={{ fontFamily: 'monospace' }}>{k.key_prefix}…</span>
                      <span style={{ opacity: 0.5 }}>·</span>
                      <span>{boardsLabel(k)}</span>
                      <span style={{ opacity: 0.5 }}>·</span>
                      <span>{k.last_used_at ? `used ${timeAgo(k.last_used_at)}` : 'never used'}</span>
                    </div>
                  </div>
                  <div className="ak-key-actions" style={{ display: 'flex', alignItems: 'center', gap: 4, flexShrink: 0 }}>
                    <button
                      onClick={() => setRenamingId(k.id)}
                      title="Rename"
                      style={{ fontSize: 14, color: 'var(--text-secondary)', padding: '5px 7px', borderRadius: 6, cursor: 'pointer', background: 'none', border: 'none' }}
                      onMouseEnter={e => e.currentTarget.style.background = 'var(--hover-bg)'}
                      onMouseLeave={e => e.currentTarget.style.background = 'transparent'}
                    >✏️</button>
                    <button
                      onClick={() => handleRevoke(k.id)}
                      disabled={revoking === k.id}
                      title="Revoke"
                      style={{ fontSize: 14, color: '#e2445c', padding: '5px 7px', borderRadius: 6, cursor: 'pointer', background: 'none', border: 'none' }}
                      onMouseEnter={e => e.currentTarget.style.background = '#fff5f7'}
                      onMouseLeave={e => e.currentTarget.style.background = 'transparent'}
                    >{revoking === k.id ? '…' : '🗑'}</button>
                  </div>
                </div>
              ))}
            </div>
          )}

          {/* Developer / API-key docs — collapsed */}
          <AdvancedKeyDocs />
        </div>
      </div>

      {/* Generate modal */}
      {showGenerate && (
        <GenerateModal
          boards={boards}
          onClose={() => setShowGenerate(false)}
          onGenerated={handleGenerated}
        />
      )}

      {/* Key reveal modal — shown once after generation */}
      {newKeyResult && (
        <KeyRevealModal
          keyData={newKeyResult}
          boards={boards}
          onClose={() => setNewKeyResult(null)}
        />
      )}

      <style>{`
        @keyframes akSpin { to { transform: rotate(360deg); } }
        .ak-key-card:hover { border-color: rgba(155,114,245,0.5); box-shadow: 0 2px 10px rgba(155,114,245,0.08); }
      `}</style>
    </>
  );
}
