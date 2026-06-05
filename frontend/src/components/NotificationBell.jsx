import React, { useState, useEffect, useRef, useCallback } from 'react';
import { createPortal } from 'react-dom';
import { getNotifications, markNotificationRead } from '../api';
import { useNotifications } from '../context/NotificationContext';
import EmptyState from './EmptyState';
import { toISODate } from '../utils/dateFormat';

function timeAgo(dateStr) {
  const diff = (Date.now() - new Date(dateStr)) / 1000;
  if (diff < 60) return 'just now';
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
  if (diff < 172800) return 'yesterday';
  return toISODate(dateStr);
}

// What icon/accent to show per notification type (inferred from message)
function notifMeta(msg = '') {
  if (msg.includes('mentioned')) return { icon: '@', color: '#9b72f5' };
  if (msg.includes('replied'))   return { icon: '↩', color: '#a25ddc' };
  return { icon: '🔔', color: '#fdab3d' };
}

export default function NotificationBell({ onOpenItem }) {
  const { unreadCount, markAllRead, decrementUnread, refresh } = useNotifications();
  const [open, setOpen] = useState(false);
  const [notifications, setNotifications] = useState([]);
  const [loading, setLoading] = useState(false);
  const [pos, setPos] = useState({ top: 0, right: 0 });
  const panelRef = useRef(null);
  const buttonRef = useRef(null);

  // Compute the dropdown's screen position from the bell button. The panel is
  // rendered in a portal on <body> (see below) so it can't be trapped behind
  // other panels' stacking contexts; that means we position it with fixed
  // coordinates relative to the button instead of CSS `absolute`.
  const positionPanel = useCallback(() => {
    const r = buttonRef.current?.getBoundingClientRect();
    if (r) setPos({ top: r.bottom + 8, right: Math.max(8, window.innerWidth - r.right) });
  }, []);

  useEffect(() => {
    if (!open) return;
    positionPanel();
    window.addEventListener('resize', positionPanel);
    window.addEventListener('scroll', positionPanel, true);
    return () => { window.removeEventListener('resize', positionPanel); window.removeEventListener('scroll', positionPanel, true); };
  }, [open, positionPanel]);

  useEffect(() => {
    if (!open) return;
    setLoading(true);
    getNotifications()
      // Only surface unread items in the dropdown — once a user has clicked
      // (or marked all read), those rows shouldn't reappear when the bell
      // is reopened. The server still keeps the read history for any future
      // "all activity" view.
      .then(r => setNotifications((r.data || []).filter(n => !n.is_read)))
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const handler = e => {
      if (panelRef.current && panelRef.current.contains(e.target)) return;
      if (buttonRef.current && buttonRef.current.contains(e.target)) return;
      setOpen(false);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [open]);

  const handleClick = useCallback(async (notif) => {
    // Mark read on the server, then drop it from the visible list so the
    // user gets a clear "this is dealt with" signal — same model as
    // Slack/Linear/Gmail. The DB row remains for history; only the
    // dropdown view is cleared.
    if (!notif.is_read) {
      try {
        await markNotificationRead(notif.id);
        decrementUnread();
      } catch { /* silent — list still updates locally */ }
    }
    setNotifications(prev => prev.filter(n => n.id !== notif.id));
    // Navigate if we have the necessary IDs
    if (notif.board_id && notif.item_id && onOpenItem) {
      setOpen(false);
      onOpenItem({ board_id: notif.board_id, item_id: notif.item_id });
    }
  }, [decrementUnread, onOpenItem]);

  // "Mark all read" also wipes the visible list — consistent with the
  // per-notification click behavior. DB rows are preserved server-side.
  const handleMarkAllRead = useCallback(async () => {
    await markAllRead();
    setNotifications([]);
  }, [markAllRead]);

  return (
    <div style={{ position: 'relative', marginRight: 8 }}>
      {/* Bell button */}
      <button
        ref={buttonRef}
        onClick={() => setOpen(o => !o)}
        title="Notifications"
        style={{
          position: 'relative', width: 36, height: 36, borderRadius: '50%',
          background: open ? 'var(--hover-bg)' : 'transparent',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          fontSize: 18, transition: 'background 0.15s',
        }}
        onMouseEnter={e => { if (!open) e.currentTarget.style.background = 'var(--hover-bg)'; }}
        onMouseLeave={e => { if (!open) e.currentTarget.style.background = open ? 'var(--hover-bg)' : 'transparent'; }}
      >
        🔔
        {unreadCount > 0 && (
          <span style={{
            position: 'absolute', top: 0, right: 0,
            background: '#e2445c', color: '#fff', borderRadius: '50%',
            minWidth: 16, height: 16, padding: '0 3px', fontSize: 9, fontWeight: 700,
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            border: '2px solid var(--topbar-bg, #fff)', boxSizing: 'border-box',
          }}>
            {unreadCount > 9 ? '9+' : unreadCount}
          </span>
        )}
      </button>

      {/* Dropdown panel — portalled to <body> so it always sits above every
          other panel (column menus, automations, board header) regardless of
          their stacking contexts. */}
      {open && createPortal((
        <div ref={panelRef} className="wb-notif-dropdown" style={{
          position: 'fixed', right: pos.right, top: pos.top,
          width: 380, maxWidth: 'calc(100vw - 24px)', maxHeight: 520,
          background: 'var(--menu-bg, #fff)', borderRadius: 10,
          boxShadow: 'var(--menu-shadow, 0 8px 32px rgba(0,0,0,0.16))',
          zIndex: 100000, display: 'flex', flexDirection: 'column',
          border: '1px solid var(--menu-border, #e6e9ef)',
          color: 'var(--text-primary, #323338)',
        }}>
          {/* Header */}
          <div style={{
            padding: '13px 16px 10px', borderBottom: '1px solid var(--border-color, #f0f0f0)',
            display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexShrink: 0,
          }}>
            <div style={{ fontWeight: 700, fontSize: 14, color: 'var(--text-primary, #323338)', display: 'flex', alignItems: 'center', gap: 8 }}>
              Notifications
              {unreadCount > 0 && (
                <span style={{ background: '#e2445c', color: '#fff', borderRadius: 10, padding: '1px 7px', fontSize: 11, fontWeight: 700 }}>
                  {unreadCount}
                </span>
              )}
            </div>
            {unreadCount > 0 && (
              <button onClick={handleMarkAllRead} style={{ fontSize: 12, color: '#9b72f5', fontWeight: 600 }}>
                Mark all read
              </button>
            )}
          </div>

          {/* List */}
          <div style={{ overflowY: 'auto', flex: 1 }}>
            {loading ? (
              <div style={{ textAlign: 'center', padding: 32, color: 'var(--text-muted, #aaa)' }}>Loading…</div>
            ) : notifications.length === 0 ? (
              <EmptyState
                icon="🔔"
                title="You're all caught up"
                description="When someone assigns you, comments on your items, or replies to a thread, you'll see it here."
              />
            ) : (
              notifications.map(n => {
                const meta = notifMeta(n.message);
                const isClickable = !!(n.board_id && n.item_id);
                return (
                  <div
                    key={n.id}
                    onClick={() => handleClick(n)}
                    style={{
                      display: 'flex', gap: 10, padding: '11px 16px',
                      background: n.is_read ? 'transparent' : 'rgba(155,114,245,0.12)',
                      borderBottom: '1px solid var(--border-color, #f5f5f5)',
                      cursor: isClickable ? 'pointer' : 'default',
                      transition: 'background 0.12s',
                      alignItems: 'flex-start',
                    }}
                    onMouseEnter={e => { if (isClickable) e.currentTarget.style.background = n.is_read ? 'var(--hover-bg)' : 'rgba(155,114,245,0.2)'; }}
                    onMouseLeave={e => e.currentTarget.style.background = n.is_read ? 'transparent' : 'rgba(155,114,245,0.12)'}
                  >
                    {/* Type icon */}
                    <div style={{
                      width: 32, height: 32, borderRadius: '50%', flexShrink: 0,
                      background: `${meta.color}18`, color: meta.color,
                      display: 'flex', alignItems: 'center', justifyContent: 'center',
                      fontSize: 14, fontWeight: 800,
                    }}>
                      {meta.icon}
                    </div>

                    <div style={{ flex: 1, minWidth: 0 }}>
                      {/* Main message */}
                      <div style={{ fontSize: 13, color: 'var(--text-primary, #323338)', lineHeight: 1.4, fontWeight: n.is_read ? 400 : 600 }}>
                        {n.message}
                      </div>

                      {/* Board → Item breadcrumb */}
                      {(n.board_name || n.item_name) && (
                        <div style={{ display: 'flex', alignItems: 'center', gap: 4, marginTop: 4, flexWrap: 'wrap' }}>
                          {n.board_name && (
                            <span style={{
                              fontSize: 11, color: '#fff', background: '#1c1f3b',
                              borderRadius: 4, padding: '1px 6px', fontWeight: 600,
                            }}>
                              {n.board_name}
                            </span>
                          )}
                          {n.board_name && n.item_name && (
                            <span style={{ fontSize: 11, color: 'var(--text-muted, #aaa)' }}>›</span>
                          )}
                          {n.item_name && (
                            <span style={{
                              fontSize: 11, color: 'var(--primary-blue, #9b72f5)', background: 'rgba(155,114,245,0.18)',
                              borderRadius: 4, padding: '1px 6px', fontWeight: 600,
                            }}>
                              {n.item_name}
                            </span>
                          )}
                          {isClickable && (
                            <span style={{ fontSize: 10, color: 'var(--text-muted, #aaa)', marginLeft: 2 }}>· click to open ↗</span>
                          )}
                        </div>
                      )}

                      {/* Timestamp + unread dot */}
                      <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 3 }}>
                        {!n.is_read && (
                          <span style={{ width: 6, height: 6, borderRadius: '50%', background: '#9b72f5', flexShrink: 0, display: 'inline-block' }} />
                        )}
                        <span style={{ fontSize: 11, color: 'var(--text-muted, #aaa)' }}>{timeAgo(n.created_at)}</span>
                      </div>
                    </div>
                  </div>
                );
              })
            )}
          </div>

          {notifications.length > 0 && (
            <div style={{ padding: '8px 16px', borderTop: '1px solid var(--border-color, #f0f0f0)', textAlign: 'center', flexShrink: 0 }}>
              <button onClick={() => { setOpen(false); refresh(); }} style={{ fontSize: 12, color: 'var(--text-secondary, #888)' }}>Close</button>
            </div>
          )}
        </div>
      ), document.body)}
    </div>
  );
}
