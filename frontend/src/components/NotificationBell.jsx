import React, { useState, useEffect, useRef, useCallback } from 'react';
import { getNotifications, markNotificationRead } from '../api';
import { useNotifications } from '../context/NotificationContext';
import EmptyState from './EmptyState';

function timeAgo(dateStr) {
  const diff = (Date.now() - new Date(dateStr)) / 1000;
  if (diff < 60) return 'just now';
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
  if (diff < 172800) return 'yesterday';
  return new Date(dateStr).toLocaleDateString();
}

// What icon/accent to show per notification type (inferred from message)
function notifMeta(msg = '') {
  if (msg.includes('mentioned')) return { icon: '@', color: '#0073ea' };
  if (msg.includes('replied'))   return { icon: '↩', color: '#a25ddc' };
  return { icon: '🔔', color: '#fdab3d' };
}

export default function NotificationBell({ onOpenItem }) {
  const { unreadCount, markAllRead, decrementUnread, refresh } = useNotifications();
  const [open, setOpen] = useState(false);
  const [notifications, setNotifications] = useState([]);
  const [loading, setLoading] = useState(false);
  const panelRef = useRef(null);

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
      if (panelRef.current && !panelRef.current.contains(e.target)) setOpen(false);
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
    <div ref={panelRef} style={{ position: 'relative', marginRight: 8 }}>
      {/* Bell button */}
      <button
        onClick={() => setOpen(o => !o)}
        title="Notifications"
        style={{
          position: 'relative', width: 36, height: 36, borderRadius: '50%',
          background: open ? '#f0f0f0' : 'transparent',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          fontSize: 18, transition: 'background 0.15s',
        }}
        onMouseEnter={e => { if (!open) e.currentTarget.style.background = '#f5f5f5'; }}
        onMouseLeave={e => { if (!open) e.currentTarget.style.background = open ? '#f0f0f0' : 'transparent'; }}
      >
        🔔
        {unreadCount > 0 && (
          <span style={{
            position: 'absolute', top: 2, right: 2,
            background: '#e2445c', color: '#fff', borderRadius: '50%',
            width: 16, height: 16, fontSize: 9, fontWeight: 700,
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            border: '2px solid #fff',
          }}>
            {unreadCount > 9 ? '9+' : unreadCount}
          </span>
        )}
      </button>

      {/* Dropdown panel */}
      {open && (
        <div style={{
          position: 'absolute', right: 0, top: 'calc(100% + 8px)',
          width: 380, maxHeight: 520,
          background: '#fff', borderRadius: 10,
          boxShadow: '0 8px 32px rgba(0,0,0,0.16)',
          zIndex: 1000, display: 'flex', flexDirection: 'column',
          border: '1px solid #e6e9ef',
        }}>
          {/* Header */}
          <div style={{
            padding: '13px 16px 10px', borderBottom: '1px solid #f0f0f0',
            display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexShrink: 0,
          }}>
            <div style={{ fontWeight: 700, fontSize: 14, color: '#323338', display: 'flex', alignItems: 'center', gap: 8 }}>
              Notifications
              {unreadCount > 0 && (
                <span style={{ background: '#e2445c', color: '#fff', borderRadius: 10, padding: '1px 7px', fontSize: 11, fontWeight: 700 }}>
                  {unreadCount}
                </span>
              )}
            </div>
            {unreadCount > 0 && (
              <button onClick={handleMarkAllRead} style={{ fontSize: 12, color: '#0073ea', fontWeight: 600 }}>
                Mark all read
              </button>
            )}
          </div>

          {/* List */}
          <div style={{ overflowY: 'auto', flex: 1 }}>
            {loading ? (
              <div style={{ textAlign: 'center', padding: 32, color: '#aaa' }}>Loading…</div>
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
                      background: n.is_read ? '#fff' : '#f0f6ff',
                      borderBottom: '1px solid #f5f5f5',
                      cursor: isClickable ? 'pointer' : 'default',
                      transition: 'background 0.12s',
                      alignItems: 'flex-start',
                    }}
                    onMouseEnter={e => { if (isClickable) e.currentTarget.style.background = n.is_read ? '#fafafa' : '#e4eeff'; }}
                    onMouseLeave={e => e.currentTarget.style.background = n.is_read ? '#fff' : '#f0f6ff'}
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
                      <div style={{ fontSize: 13, color: '#323338', lineHeight: 1.4, fontWeight: n.is_read ? 400 : 600 }}>
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
                            <span style={{ fontSize: 11, color: '#aaa' }}>›</span>
                          )}
                          {n.item_name && (
                            <span style={{
                              fontSize: 11, color: '#0073ea', background: '#e8f4ff',
                              borderRadius: 4, padding: '1px 6px', fontWeight: 600,
                            }}>
                              {n.item_name}
                            </span>
                          )}
                          {isClickable && (
                            <span style={{ fontSize: 10, color: '#aaa', marginLeft: 2 }}>· click to open ↗</span>
                          )}
                        </div>
                      )}

                      {/* Timestamp + unread dot */}
                      <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 3 }}>
                        {!n.is_read && (
                          <span style={{ width: 6, height: 6, borderRadius: '50%', background: '#0073ea', flexShrink: 0, display: 'inline-block' }} />
                        )}
                        <span style={{ fontSize: 11, color: '#aaa' }}>{timeAgo(n.created_at)}</span>
                      </div>
                    </div>
                  </div>
                );
              })
            )}
          </div>

          {notifications.length > 0 && (
            <div style={{ padding: '8px 16px', borderTop: '1px solid #f0f0f0', textAlign: 'center', flexShrink: 0 }}>
              <button onClick={() => { setOpen(false); refresh(); }} style={{ fontSize: 12, color: '#888' }}>Close</button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
