import React, { useState, useEffect } from 'react';
import { getActivityLogs } from '../api';

const ACTION_ICONS = {
  item_created: { icon: '✚', color: '#00c875' },
  item_renamed: { icon: '✎', color: '#0073ea' },
  item_deleted: { icon: '✕', color: '#e2445c' },
  value_changed: { icon: '↻', color: '#fdab3d' },
  group_created: { icon: '▤', color: '#a25ddc' },
  group_deleted: { icon: '▤', color: '#e2445c' },
};

function timeAgo(dateStr) {
  const diff = (Date.now() - new Date(dateStr)) / 1000;
  if (diff < 60) return 'just now';
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
  if (diff < 604800) return `${Math.floor(diff / 86400)}d ago`;
  return new Date(dateStr).toLocaleDateString();
}

function formatAction(log) {
  switch (log.action) {
    case 'item_created': return <><b>{log.item_name}</b> was created</>;
    case 'item_renamed': return <>Item renamed from <b>{log.old_value}</b> to <b>{log.new_value}</b></>;
    case 'item_deleted': return <><b>{log.item_name}</b> was deleted</>;
    case 'value_changed':
      if (!log.old_value && log.new_value) return <><b>{log.item_name}</b> — {log.field} set to <b>{log.new_value}</b></>;
      if (log.old_value && !log.new_value) return <><b>{log.item_name}</b> — {log.field} cleared</>;
      return <><b>{log.item_name}</b> — {log.field} changed from <b>{log.old_value || '—'}</b> to <b>{log.new_value || '—'}</b></>;
    case 'group_created': return <>Group <b>{log.field}</b> was created</>;
    case 'group_deleted': return <>Group <b>{log.field}</b> was deleted</>;
    default: return <>{log.action}</>;
  }
}

function groupByDate(logs) {
  const groups = {};
  for (const log of logs) {
    const d = new Date(log.created_at);
    const key = d.toDateString();
    if (!groups[key]) groups[key] = [];
    groups[key].push(log);
  }
  return groups;
}

function dateLabel(dateStr) {
  const d = new Date(dateStr);
  const today = new Date();
  const yesterday = new Date(today);
  yesterday.setDate(today.getDate() - 1);
  if (d.toDateString() === today.toDateString()) return 'Today';
  if (d.toDateString() === yesterday.toDateString()) return 'Yesterday';
  return d.toLocaleDateString(undefined, { weekday: 'long', month: 'short', day: 'numeric' });
}

export default function ActivityLogPanel({ boardId, onClose }) {
  const [logs, setLogs] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    getActivityLogs(boardId)
      .then(r => setLogs(r.data))
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [boardId]);

  const grouped = groupByDate(logs);

  return (
    <div style={{
      position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.35)', zIndex: 400,
      display: 'flex', alignItems: 'flex-start', justifyContent: 'flex-end',
    }} onClick={onClose}>
      <div onClick={e => e.stopPropagation()} style={{
        background: '#fff', width: 420, height: '100vh', display: 'flex', flexDirection: 'column',
        boxShadow: '-4px 0 24px rgba(0,0,0,0.12)',
      }}>
        {/* Header */}
        <div style={{ padding: '20px', borderBottom: '1px solid #f0f0f0', display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexShrink: 0 }}>
          <div>
            <h2 style={{ fontSize: 16, fontWeight: 700, margin: 0 }}>📋 Activity Log</h2>
            <p style={{ fontSize: 12, color: '#888', margin: '2px 0 0' }}>{logs.length} recent activities</p>
          </div>
          <button onClick={onClose} style={{ fontSize: 20, color: '#888' }}>×</button>
        </div>

        {/* Log entries */}
        <div style={{ flex: 1, overflowY: 'auto', padding: '0 0 20px' }}>
          {loading ? (
            <div style={{ textAlign: 'center', padding: 40, color: '#aaa' }}>Loading…</div>
          ) : logs.length === 0 ? (
            <div style={{ textAlign: 'center', padding: 60, color: '#aaa' }}>
              <div style={{ fontSize: 36, marginBottom: 10 }}>📭</div>
              <div>No activity yet</div>
            </div>
          ) : (
            Object.entries(grouped).map(([dateStr, dayLogs]) => (
              <div key={dateStr}>
                {/* Date divider */}
                <div style={{ padding: '14px 20px 6px', fontSize: 11, fontWeight: 700, color: '#aaa', textTransform: 'uppercase', letterSpacing: '0.5px' }}>
                  {dateLabel(dateStr)}
                </div>
                {dayLogs.map(log => {
                  const meta = ACTION_ICONS[log.action] || { icon: '•', color: '#888' };
                  return (
                    <div key={log.id} style={{ display: 'flex', gap: 12, padding: '10px 20px', borderBottom: '1px solid #f8f8f8' }}>
                      {/* Icon */}
                      <div style={{
                        width: 32, height: 32, borderRadius: '50%', flexShrink: 0,
                        background: `${meta.color}18`, color: meta.color,
                        display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 14, fontWeight: 700,
                      }}>{meta.icon}</div>
                      {/* Content */}
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ fontSize: 13, color: '#323338', lineHeight: 1.4 }}>
                          {formatAction(log)}
                        </div>
                        <div style={{ fontSize: 11, color: '#aaa', marginTop: 3 }}>
                          {log.user_name || 'System'} · {timeAgo(log.created_at)}
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );
}
