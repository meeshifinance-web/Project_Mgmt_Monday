import React, { useState } from 'react';
import { aiAsk, aiDigest } from '../api';
import { useToast } from './Toast';

// Ask-your-workspace + AI status digests. Deterministic, links to the items.

const SUGGESTIONS = [
  "What's blocked and who owns it?",
  'What is overdue?',
  'What is due this week?',
  'Which items are unassigned?',
];

export default function AiAssistantPanel({ boards = [], onClose, onOpenBoard }) {
  const toast = useToast();
  const [tab, setTab] = useState('ask');

  // Ask
  const [q, setQ] = useState('');
  const [busy, setBusy] = useState(false);
  const [res, setRes] = useState(null);

  // Digest
  const [scope, setScope] = useState('me'); // 'me' | board id
  const [digest, setDigest] = useState(null);
  const [dBusy, setDBusy] = useState(false);

  const ask = async (question) => {
    const text = (question ?? q).trim();
    if (!text) return;
    setQ(text); setBusy(true); setRes(null);
    try { setRes(await aiAsk(text)); } catch { toast('Ask failed', 'error'); } finally { setBusy(false); }
  };
  const runDigest = async () => {
    setDBusy(true); setDigest(null);
    try { setDigest(await aiDigest(scope === 'me' ? { scope: 'me' } : { board_id: scope })); }
    catch { toast('Digest failed', 'error'); } finally { setDBusy(false); }
  };

  const tabBtn = (k, label) => (
    <button onClick={() => setTab(k)} style={{ flex: 1, padding: '10px 0', fontSize: 13, fontWeight: tab === k ? 700 : 500, color: tab === k ? '#9b72f5' : 'var(--text-secondary)', background: 'none', border: 'none', borderBottom: `2.5px solid ${tab === k ? '#9b72f5' : 'transparent'}`, cursor: 'pointer' }}>{label}</button>
  );
  const sel = { padding: '8px 10px', borderRadius: 7, border: '1px solid var(--border-color,#e6e9ef)', background: 'var(--input-bg,var(--bg-secondary))', color: 'var(--text-primary)', fontSize: 13 };

  return (
    <div onMouseDown={e => { if (e.target === e.currentTarget) onClose(); }} style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.4)', zIndex: 600, display: 'flex', justifyContent: 'flex-end' }}>
      <div style={{ width: 460, maxWidth: '100vw', height: '100vh', background: 'var(--card-bg,#fff)', display: 'flex', flexDirection: 'column', boxShadow: '-4px 0 24px rgba(0,0,0,0.18)' }}>
        <div style={{ padding: '16px 20px', borderBottom: '1px solid var(--border-color)', display: 'flex', alignItems: 'center', gap: 10 }}>
          <div style={{ flex: 1, fontSize: 16, fontWeight: 800, color: 'var(--text-primary)' }}>✨ AI Assistant</div>
          <button onClick={onClose} style={{ fontSize: 22, color: 'var(--text-muted)', background: 'none', border: 'none', cursor: 'pointer' }}>×</button>
        </div>
        <div style={{ display: 'flex', borderBottom: '1px solid var(--border-color)' }}>
          {tabBtn('ask', '🔎 Ask')}
          {tabBtn('digest', '📋 Digest')}
        </div>

        {tab === 'ask' ? (
          <div style={{ flex: 1, overflowY: 'auto', padding: 18 }}>
            <div style={{ display: 'flex', gap: 6, marginBottom: 12 }}>
              <input value={q} onChange={e => setQ(e.target.value)} onKeyDown={e => { if (e.key === 'Enter') ask(); }}
                placeholder="Ask about your workspace…" style={{ ...sel, flex: 1 }} />
              <button onClick={() => ask()} disabled={busy} style={{ padding: '0 16px', borderRadius: 7, border: 'none', background: 'linear-gradient(90deg,#9b72f5,#b86cff)', color: '#fff', fontWeight: 700, fontSize: 13, cursor: 'pointer' }}>{busy ? '…' : 'Ask'}</button>
            </div>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginBottom: 16 }}>
              {SUGGESTIONS.map(s => <button key={s} onClick={() => ask(s)} style={{ fontSize: 11, padding: '4px 10px', borderRadius: 12, border: '1px solid var(--border-color)', background: 'transparent', color: 'var(--text-secondary)', cursor: 'pointer' }}>{s}</button>)}
            </div>
            {res && (
              <>
                <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--text-primary)', marginBottom: 10 }}>{res.answer}</div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                  {res.items.map(it => (
                    <button key={it.id} onClick={() => { onOpenBoard?.(it.board_id); onClose(); }}
                      style={{ textAlign: 'left', display: 'flex', alignItems: 'center', gap: 8, padding: '9px 11px', borderRadius: 8, border: '1px solid var(--border-color)', background: 'var(--bg-secondary,#f7f8fc)', cursor: 'pointer' }}>
                      <span style={{ flex: 1, minWidth: 0 }}>
                        <span style={{ fontSize: 13, color: 'var(--text-primary)', display: 'block', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{it.name}</span>
                        <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>{it.board_name}{it.owners?.length ? ' · ' + it.owners.join(', ') : ''}{it.due ? ' · due ' + it.due : ''}</span>
                      </span>
                      {it.status && <span style={{ fontSize: 10, fontWeight: 700, color: '#fff', background: '#0073ea', borderRadius: 5, padding: '2px 7px', whiteSpace: 'nowrap' }}>{it.status}</span>}
                    </button>
                  ))}
                  {res.items.length === 0 && <div style={{ color: 'var(--text-muted)', fontSize: 13, padding: 10 }}>Nothing matched.</div>}
                </div>
              </>
            )}
          </div>
        ) : (
          <div style={{ flex: 1, overflowY: 'auto', padding: 18 }}>
            <div style={{ display: 'flex', gap: 6, marginBottom: 14 }}>
              <select value={scope} onChange={e => setScope(e.target.value)} style={{ ...sel, flex: 1 }}>
                <option value="me">My work (all boards)</option>
                {boards.map(b => <option key={b.id} value={b.id}>{b.name}</option>)}
              </select>
              <button onClick={runDigest} disabled={dBusy} style={{ padding: '0 16px', borderRadius: 7, border: 'none', background: 'linear-gradient(90deg,#9b72f5,#b86cff)', color: '#fff', fontWeight: 700, fontSize: 13, cursor: 'pointer' }}>{dBusy ? '…' : 'Generate'}</button>
            </div>
            {digest && (
              <div style={{ background: 'var(--bg-secondary,#f7f8fc)', border: '1px solid var(--border-color)', borderRadius: 10, padding: 16, whiteSpace: 'pre-wrap', fontSize: 13, lineHeight: 1.7, color: 'var(--text-primary)', fontFamily: 'inherit' }}>
                {digest.text}
                <button onClick={() => { navigator.clipboard?.writeText(digest.text); toast('Copied', 'success'); }} style={{ display: 'block', marginTop: 14, padding: '6px 12px', fontSize: 12, borderRadius: 6, border: '1px solid var(--border-color)', background: 'transparent', color: 'var(--text-secondary)', cursor: 'pointer' }}>Copy to clipboard</button>
              </div>
            )}
            {!digest && !dBusy && <div style={{ color: 'var(--text-muted)', fontSize: 13 }}>Generate a standup summary for your work or a specific board.</div>}
          </div>
        )}
      </div>
    </div>
  );
}
