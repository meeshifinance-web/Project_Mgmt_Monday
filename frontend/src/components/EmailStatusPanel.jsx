import React, { useState, useEffect } from 'react';
import { getEmailStatus, triggerEmailPoll } from '../api';

export default function EmailStatusPanel({ onClose }) {
  const [status, setStatus]       = useState(null);
  const [loading, setLoading]     = useState(true);
  const [triggering, setTriggering] = useState(false);
  const [triggerMsg, setTriggerMsg] = useState('');

  const load = async () => {
    setLoading(true);
    try {
      const r = await getEmailStatus();
      setStatus(r.data);
    } catch (_) {}
    setLoading(false);
  };

  useEffect(() => { load(); }, []);

  const handleTrigger = async () => {
    setTriggering(true);
    setTriggerMsg('');
    try {
      const r = await triggerEmailPoll();
      setStatus(r.data);
      setTriggerMsg('✅ Poll complete — check the board for new items');
    } catch (err) {
      const msg = err.response?.data?.error || err.message;
      setTriggerMsg(`❌ ${msg}`);
      // Refresh status anyway
      load();
    } finally {
      setTriggering(false);
    }
  };

  const fmt = (iso) => iso
    ? new Date(iso).toLocaleString('en-IN', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' })
    : '—';

  return (
    <>
      {/* Backdrop */}
      <div
        onClick={onClose}
        style={{ position: 'fixed', inset: 0, zIndex: 499 }}
      />

      {/* Panel */}
      <div style={{
        position: 'absolute', top: '100%', right: 0, marginTop: 6, zIndex: 500,
        background: '#fff', borderRadius: 10, boxShadow: '0 6px 28px rgba(0,0,0,0.14)',
        border: '1px solid #e6e9ef', width: 320,
        fontFamily: 'Figtree, Roboto, -apple-system, sans-serif',
      }}>

        {/* Header */}
        <div style={{ padding: '14px 16px 10px', borderBottom: '1px solid #f0f0f0', display: 'flex', alignItems: 'center', gap: 8 }}>
          <span style={{ fontSize: 16 }}>📧</span>
          <div style={{ flex: 1, fontWeight: 700, fontSize: 14, color: '#323338' }}>Email → Item Integration</div>
          <button onClick={onClose} style={{ fontSize: 18, color: '#aaa', cursor: 'pointer', lineHeight: 1 }}>×</button>
        </div>

        <div style={{ padding: '12px 16px' }}>
          {loading ? (
            <div style={{ textAlign: 'center', padding: '20px 0', color: '#888', fontSize: 13 }}>Loading…</div>
          ) : !status?.enabled ? (
            <div style={{ padding: '10px 0' }}>
              <div style={{ background: '#fff5f7', border: '1px solid #ffd0d8', borderRadius: 8, padding: '10px 12px', fontSize: 12, color: '#c0392b' }}>
                ⚠️ Poller not configured. Set <code>EMAIL_IMAP_USER</code> and <code>EMAIL_IMAP_PASS</code> in <code>.env</code> and restart the backend.
              </div>
            </div>
          ) : (
            <>
              {/* Status rows */}
              <div style={{ fontSize: 12, display: 'grid', gridTemplateColumns: '100px 1fr', gap: '6px 8px', marginBottom: 12 }}>
                <span style={{ color: '#888' }}>Status</span>
                <span>
                  <span style={{
                    background: status.running ? '#e8f7ee' : '#fff5f7',
                    color: status.running ? '#037f4c' : '#e2445c',
                    borderRadius: 10, padding: '1px 8px', fontWeight: 700, fontSize: 11,
                  }}>
                    {status.running ? '● Running' : '○ Stopped'}
                  </span>
                </span>

                <span style={{ color: '#888' }}>Mode</span>
                <span style={{ fontWeight: 600, color: '#323338' }}>
                  {status.mode === 'graph' ? '🏢 Microsoft 365' : '📨 Gmail IMAP'}
                </span>

                <span style={{ color: '#888' }}>Mailbox</span>
                <span style={{ color: '#323338', wordBreak: 'break-all' }}>{status.mailbox}</span>

                <span style={{ color: '#888' }}>Interval</span>
                <span style={{ color: '#323338' }}>Every {status.intervalMin} min</span>

                <span style={{ color: '#888' }}>Last poll</span>
                <span style={{ color: '#323338' }}>{fmt(status.lastPollAt)}</span>

                {status.lastPollMsg && status.lastPollMsg !== 'ok' && (
                  <>
                    <span style={{ color: '#888' }}>Last error</span>
                    <span style={{ color: '#e2445c', fontSize: 11 }}>{status.lastPollMsg}</span>
                  </>
                )}

                <span style={{ color: '#888' }}>Default board</span>
                <span style={{ color: '#323338' }}>ID {status.defaultBoardId}</span>

                <span style={{ color: '#888' }}>Default group</span>
                <span style={{ color: '#323338' }}>ID {status.defaultGroupId}</span>
              </div>

              {/* Send instruction */}
              <div style={{ background: '#f0f6ff', borderRadius: 8, padding: '9px 12px', fontSize: 12, color: '#0050b3', marginBottom: 12, lineHeight: 1.6 }}>
                <strong>To create an item:</strong><br />
                Send any email to <strong>{status.mailbox}</strong><br />
                Subject line → becomes the item name<br />
                <span style={{ color: '#666' }}>Use <code>[Group Name]</code> prefix in subject to pick a group</span>
              </div>

              {/* Trigger message */}
              {triggerMsg && (
                <div style={{
                  marginBottom: 10, padding: '8px 10px', borderRadius: 6, fontSize: 12,
                  background: triggerMsg.startsWith('✅') ? '#e8f7ee' : '#fff5f7',
                  color: triggerMsg.startsWith('✅') ? '#037f4c' : '#c0392b',
                }}>
                  {triggerMsg}
                </div>
              )}

              {/* Check Now button */}
              <button
                onClick={handleTrigger}
                disabled={triggering}
                style={{
                  width: '100%', padding: '8px 0',
                  background: triggering ? '#c5c7d0' : '#9b72f5',
                  color: '#fff', borderRadius: 7, fontSize: 13,
                  fontWeight: 700, cursor: triggering ? 'not-allowed' : 'pointer',
                }}
              >
                {triggering ? 'Checking mailbox…' : '🔄 Check Mailbox Now'}
              </button>
            </>
          )}
        </div>
      </div>
    </>
  );
}
