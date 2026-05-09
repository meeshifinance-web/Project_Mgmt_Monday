import React, { useState, useEffect, useRef, useCallback } from 'react';
import ColumnCell from './ColumnCell';
import { getComments, createComment, deleteComment, getItemActivityLogs, getBoardMembers, getItemEmails } from '../api';
import { useAuth } from '../context/AuthContext';

// ── Helpers ───────────────────────────────────────────────────────────────────
function timeAgo(dateStr) {
  const diff = (Date.now() - new Date(dateStr)) / 1000;
  if (diff < 60) return 'just now';
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
  if (diff < 172800) return 'yesterday';
  if (diff < 604800) return `${Math.floor(diff / 86400)}d ago`;
  return new Date(dateStr).toLocaleDateString();
}

function nameInitials(name = '') {
  return name.split(' ').map(p => p[0] || '').join('').slice(0, 2).toUpperCase() || '?';
}

function nameColor(name = '') {
  const COLORS = ['#9b72f5','#00c875','#fdab3d','#e2445c','#a25ddc','#037f4c','#ff5ac4','#784bd1'];
  let h = 0;
  for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) & 0xffffffff;
  return COLORS[Math.abs(h) % COLORS.length];
}

function Avatar({ name, size = 32 }) {
  return (
    <div style={{
      width: size, height: size, borderRadius: '50%', background: nameColor(name),
      color: '#fff', fontWeight: 700, fontSize: size * 0.38,
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      flexShrink: 0, userSelect: 'none',
    }}>
      {nameInitials(name)}
    </div>
  );
}

// Render comment body with @mention highlights
function CommentBody({ text }) {
  const parts = text.split(/(@\S+)/g);
  return (
    <span>
      {parts.map((part, i) =>
        /^@/.test(part)
          ? <mark key={i} style={{ background: '#e8f4ff', color: '#9b72f5', borderRadius: 3, padding: '1px 3px', fontWeight: 600, fontStyle: 'normal' }}>{part}</mark>
          : part
      )}
    </span>
  );
}

// ── Inline editable item name ─────────────────────────────────────────────────
function EditableName({ value, onSave }) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(value);
  const ref = useRef(null);

  useEffect(() => { setDraft(value); }, [value]);
  useEffect(() => { if (editing) ref.current?.select(); }, [editing]);

  const commit = () => {
    setEditing(false);
    if (draft.trim() && draft.trim() !== value) onSave(draft.trim());
    else setDraft(value);
  };

  if (editing) {
    return (
      <input ref={ref} value={draft}
        onChange={e => setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={e => { if (e.key === 'Enter') commit(); if (e.key === 'Escape') { setEditing(false); setDraft(value); } }}
        style={{ fontSize: 20, fontWeight: 700, color: '#323338', border: 'none', borderBottom: '2px solid #9b72f5', outline: 'none', background: 'transparent', width: '100%', padding: '2px 0' }}
      />
    );
  }
  return (
    <div onClick={() => setEditing(true)} title="Click to rename"
      style={{ fontSize: 20, fontWeight: 700, color: '#323338', cursor: 'text', padding: '2px 0', lineHeight: 1.3 }}>
      {value}
    </div>
  );
}

// ── @mention-aware textarea composer ─────────────────────────────────────────
function Composer({ members, onPost, placeholder = 'Write an update… (Ctrl+Enter to post)', compact = false, autoFocus = false }) {
  const { user } = useAuth();
  const [body, setBody] = useState('');
  const [posting, setPosting] = useState(false);
  const [mentionQuery, setMentionQuery] = useState(null); // { query, atIndex }
  const [mentionedUserIds, setMentionedUserIds] = useState([]);
  const [dropdownIdx, setDropdownIdx] = useState(0);
  const textareaRef = useRef(null);

  const filteredMembers = mentionQuery != null
    ? members.filter(m => m.name.toLowerCase().includes(mentionQuery.query.toLowerCase())).slice(0, 8)
    : [];

  useEffect(() => { setDropdownIdx(0); }, [filteredMembers.length]);
  useEffect(() => { if (autoFocus) textareaRef.current?.focus(); }, [autoFocus]);

  const detectMention = (val, cursor) => {
    const before = val.slice(0, cursor);
    const atIdx = before.lastIndexOf('@');
    if (atIdx === -1) { setMentionQuery(null); return; }
    const partial = before.slice(atIdx + 1);
    // Only show dropdown if no newlines in partial
    if (/\n/.test(partial)) { setMentionQuery(null); return; }
    setMentionQuery({ query: partial, atIndex: atIdx });
  };

  const handleChange = e => {
    const val = e.target.value;
    setBody(val);
    detectMention(val, e.target.selectionStart);
  };

  const selectMention = member => {
    const cursor = textareaRef.current.selectionStart;
    const { atIndex } = mentionQuery;
    // Insert @FirstName (no spaces to keep regex simple)
    const tag = `@${member.name.replace(/\s+/g, '_')} `;
    const newBody = body.slice(0, atIndex) + tag + body.slice(cursor);
    setBody(newBody);
    setMentionedUserIds(prev => [...new Set([...prev, member.user_id || member.id])]);
    setMentionQuery(null);
    setTimeout(() => {
      const pos = atIndex + tag.length;
      textareaRef.current.setSelectionRange(pos, pos);
      textareaRef.current.focus();
    }, 0);
  };

  const handleKeyDown = e => {
    if (filteredMembers.length > 0 && mentionQuery != null) {
      if (e.key === 'ArrowDown') { e.preventDefault(); setDropdownIdx(i => (i + 1) % filteredMembers.length); return; }
      if (e.key === 'ArrowUp')   { e.preventDefault(); setDropdownIdx(i => (i - 1 + filteredMembers.length) % filteredMembers.length); return; }
      if (e.key === 'Enter' || e.key === 'Tab') { e.preventDefault(); selectMention(filteredMembers[dropdownIdx]); return; }
      if (e.key === 'Escape') { setMentionQuery(null); return; }
    }
    if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) handlePost();
  };

  const handlePost = async () => {
    if (!body.trim() || posting) return;
    setPosting(true);
    try {
      await onPost(body.trim(), mentionedUserIds);
      setBody('');
      setMentionedUserIds([]);
      setMentionQuery(null);
    } finally {
      setPosting(false);
    }
  };

  return (
    <div style={{ display: 'flex', gap: compact ? 8 : 10, alignItems: 'flex-start' }}>
      {!compact && <Avatar name={user?.name || ''} size={32} />}
      <div style={{ flex: 1, position: 'relative' }}>
        <textarea
          ref={textareaRef}
          value={body}
          onChange={handleChange}
          onKeyDown={handleKeyDown}
          placeholder={placeholder}
          rows={compact ? 2 : 3}
          style={{
            width: '100%', resize: 'vertical', border: '1.5px solid #e6e9ef',
            borderRadius: 8, padding: '8px 12px', fontSize: 13, outline: 'none',
            fontFamily: 'inherit', color: '#323338', boxSizing: 'border-box',
            transition: 'border-color 0.15s',
          }}
          onFocus={e => e.target.style.borderColor = '#9b72f5'}
          onBlur={e => e.target.style.borderColor = '#e6e9ef'}
        />

        {/* @mention autocomplete dropdown */}
        {mentionQuery != null && filteredMembers.length > 0 && (
          <div style={{
            position: 'absolute', left: 0, top: '100%', zIndex: 600,
            background: '#fff', border: '1px solid #e6e9ef', borderRadius: 8,
            boxShadow: '0 4px 16px rgba(0,0,0,0.12)', minWidth: 220,
          }}>
            <div style={{ padding: '6px 10px 4px', fontSize: 11, color: '#aaa', fontWeight: 600, textTransform: 'uppercase', letterSpacing: 0.5 }}>
              Mention a person
            </div>
            {filteredMembers.map((m, idx) => (
              <div
                key={m.user_id || m.id}
                onMouseDown={e => { e.preventDefault(); selectMention(m); }}
                style={{
                  display: 'flex', alignItems: 'center', gap: 8, padding: '7px 12px',
                  background: idx === dropdownIdx ? '#f0f6ff' : 'transparent',
                  cursor: 'pointer', transition: 'background 0.1s',
                }}
                onMouseEnter={() => setDropdownIdx(idx)}
              >
                <Avatar name={m.name} size={26} />
                <div>
                  <div style={{ fontSize: 13, fontWeight: 600, color: '#323338' }}>{m.name}</div>
                  {m.role && <div style={{ fontSize: 11, color: '#aaa' }}>{m.role}</div>}
                </div>
              </div>
            ))}
          </div>
        )}

        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: 6 }}>
          <span style={{ fontSize: 11, color: '#aaa' }}>@ to mention · Ctrl+Enter to post</span>
          <button
            onClick={handlePost}
            disabled={!body.trim() || posting}
            style={{
              background: body.trim() ? '#9b72f5' : '#c5c7d0',
              color: '#fff', borderRadius: 6, padding: '6px 16px',
              fontSize: 13, fontWeight: 600,
              cursor: body.trim() ? 'pointer' : 'default',
              transition: 'background 0.15s',
            }}
          >
            {posting ? 'Posting…' : 'Post'}
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Activity entry ────────────────────────────────────────────────────────────
const ACTIVITY_ICONS = {
  item_created: { icon: '✚', color: '#00c875' },
  item_renamed: { icon: '✎', color: '#9b72f5' },
  value_changed: { icon: '↻', color: '#fdab3d' },
};

function ActivityDesc({ log }) {
  switch (log.action) {
    case 'item_created': return <>Item was <b>created</b></>;
    case 'item_renamed': return <>Renamed from <b>{log.old_value}</b> to <b>{log.new_value}</b></>;
    case 'value_changed':
      if (!log.old_value && log.new_value) return <><b>{log.field}</b> set to <b>{log.new_value}</b></>;
      if (log.old_value && !log.new_value) return <><b>{log.field}</b> cleared</>;
      return <><b>{log.field}</b>: <b>{log.old_value || '—'}</b> → <b>{log.new_value || '—'}</b></>;
    default: return <>{log.action.replace(/_/g, ' ')}</>;
  }
}

function ActivityEntry({ log }) {
  const meta = ACTIVITY_ICONS[log.action] || { icon: '•', color: '#aaa' };
  return (
    <div style={{ display: 'flex', gap: 10, padding: '9px 24px', borderBottom: '1px solid #f8f8f8', alignItems: 'flex-start' }}>
      <div style={{
        width: 32, height: 32, borderRadius: '50%', flexShrink: 0,
        background: `${meta.color}18`, color: meta.color,
        display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 14, fontWeight: 700,
      }}>{meta.icon}</div>
      <div style={{ flex: 1, minWidth: 0, paddingTop: 6 }}>
        <div style={{ fontSize: 13, color: '#676879', lineHeight: 1.4 }}><ActivityDesc log={log} /></div>
        <div style={{ fontSize: 11, color: '#aaa', marginTop: 2 }}>{log.user_name || 'System'} · {timeAgo(log.created_at)}</div>
      </div>
    </div>
  );
}

// ── Threaded comment entry ────────────────────────────────────────────────────
function CommentEntry({ comment, replies = [], members, currentUserId, currentUserRole, onDelete, onReply, item, boardId }) {
  const [hovered, setHovered] = useState(false);
  const [showReply, setShowReply] = useState(false);
  const canDelete = comment.user_id === currentUserId || currentUserRole === 'admin';

  return (
    <div style={{ borderBottom: '1px solid #f5f6f8' }}>
      {/* Main comment */}
      <div
        onMouseEnter={() => setHovered(true)}
        onMouseLeave={() => setHovered(false)}
        style={{ display: 'flex', gap: 10, padding: '12px 24px', alignItems: 'flex-start' }}
      >
        <Avatar name={comment.user_name} size={34} />
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, justifyContent: 'space-between' }}>
            <div>
              <span style={{ fontSize: 13, fontWeight: 700, color: '#323338' }}>{comment.user_name}</span>
              <span style={{ fontSize: 11, color: '#aaa', marginLeft: 8 }}>{timeAgo(comment.created_at)}</span>
            </div>
            <div style={{ display: 'flex', gap: 6, visibility: hovered ? 'visible' : 'hidden' }}>
              <button
                onClick={() => setShowReply(s => !s)}
                style={{ fontSize: 11, color: '#676879', padding: '2px 8px', border: '1px solid #e6e9ef', borderRadius: 4 }}
              >↩ Reply</button>
              {canDelete && (
                <button
                  onClick={() => onDelete(comment.id)}
                  style={{ fontSize: 11, color: '#e2445c', padding: '2px 8px', border: '1px solid #e2445c', borderRadius: 4 }}
                >Delete</button>
              )}
            </div>
          </div>
          <div style={{ fontSize: 13, color: '#323338', marginTop: 4, lineHeight: 1.6, whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>
            <CommentBody text={comment.body} />
          </div>
        </div>
      </div>

      {/* Threaded replies */}
      {replies.length > 0 && (
        <div style={{ marginLeft: 58, borderLeft: '2px solid #e6e9ef', marginBottom: 6 }}>
          {replies.map(reply => (
            <ReplyEntry
              key={reply.id}
              reply={reply}
              currentUserId={currentUserId}
              currentUserRole={currentUserRole}
              onDelete={onDelete}
            />
          ))}
        </div>
      )}

      {/* Reply composer */}
      {showReply && (
        <div style={{ marginLeft: 58, padding: '0 24px 12px 0', borderLeft: '2px solid #9b72f533' }}>
          <div style={{ paddingLeft: 12 }}>
            <Composer
              members={members}
              compact
              autoFocus
              placeholder="Write a reply… (Ctrl+Enter)"
              onPost={async (body, mentions) => {
                await onReply(body, mentions, comment.id);
                setShowReply(false);
              }}
            />
          </div>
        </div>
      )}
    </div>
  );
}

function ReplyEntry({ reply, currentUserId, currentUserRole, onDelete }) {
  const [hovered, setHovered] = useState(false);
  const canDelete = reply.user_id === currentUserId || currentUserRole === 'admin';
  return (
    <div
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      style={{ display: 'flex', gap: 8, padding: '8px 12px', alignItems: 'flex-start' }}
    >
      <Avatar name={reply.user_name} size={26} />
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ display: 'flex', alignItems: 'baseline', gap: 6, justifyContent: 'space-between' }}>
          <div>
            <span style={{ fontSize: 12, fontWeight: 700, color: '#323338' }}>{reply.user_name}</span>
            <span style={{ fontSize: 11, color: '#aaa', marginLeft: 6 }}>{timeAgo(reply.created_at)}</span>
          </div>
          {canDelete && hovered && (
            <button
              onClick={() => onDelete(reply.id)}
              style={{ fontSize: 11, color: '#e2445c', padding: '1px 6px', border: '1px solid #e2445c', borderRadius: 4, visibility: 'visible' }}
            >Delete</button>
          )}
        </div>
        <div style={{ fontSize: 12, color: '#323338', marginTop: 2, lineHeight: 1.5, whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>
          <CommentBody text={reply.body} />
        </div>
      </div>
    </div>
  );
}

function stripHtml(html) {
  if (!html) return '';
  return String(html)
    .replace(/<style[\s\S]*?<\/style>/gi, '')
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/<\/(p|div|h[1-6]|li|tr)>/gi, '\n')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\r\n?/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

// ── Email entry (incoming / outgoing) ─────────────────────────────────────────
function EmailEntry({ email }) {
  const [expanded, setExpanded] = useState(false);
  const isIncoming = email.direction === 'incoming';

  // Fallback: older rows stored only body_html (Graph returns HTML by default).
  // Strip tags so the Updates tab still renders something readable.
  const rawBody = email.body_text && email.body_text.trim()
    ? email.body_text
    : stripHtml(email.body_html || '');
  const bodyLines  = rawBody.split('\n').filter(l => l.trim());
  const previewLines = bodyLines.slice(0, 3);
  const hasMore    = bodyLines.length > 3;

  return (
    <div style={{
      borderBottom: '1px solid #f0f2f5',
      padding: '14px 24px',
    }}>
      <div style={{ display: 'flex', gap: 12, alignItems: 'flex-start' }}>

        {/* Direction icon bubble */}
        <div style={{
          width: 36, height: 36, borderRadius: '50%', flexShrink: 0,
          background: isIncoming ? '#e3f0ff' : '#e8f7ee',
          color:      isIncoming ? '#9b72f5' : '#037f4c',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          fontSize: 16,
        }}>
          {isIncoming ? '📨' : '📤'}
        </div>

        <div style={{ flex: 1, minWidth: 0 }}>
          {/* Header row */}
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, marginBottom: 4 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
              <span style={{
                fontSize: 10, fontWeight: 700, borderRadius: 4, padding: '2px 7px',
                background: isIncoming ? '#e3f0ff' : '#e8f7ee',
                color:      isIncoming ? '#9b72f5' : '#037f4c',
                letterSpacing: 0.5, textTransform: 'uppercase',
              }}>
                {isIncoming ? 'Inbox' : 'Sent'}
              </span>
              <span style={{ fontSize: 13, fontWeight: 700, color: '#323338', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: 320 }}>
                {email.subject || '(No subject)'}
              </span>
            </div>
            <span style={{ fontSize: 11, color: '#aaa', flexShrink: 0 }}>{timeAgo(email.created_at)}</span>
          </div>

          {/* From / To row */}
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4, marginBottom: 8, fontSize: 12, color: '#676879' }}>
            {isIncoming ? (
              <>
                <span style={{ color: '#aaa' }}>From:</span>
                <span style={{ background: '#f0f2f5', borderRadius: 4, padding: '1px 7px', fontWeight: 600 }}>
                  {email.from_name ? `${email.from_name} <${email.from_address}>` : (email.from_address || '—')}
                </span>
              </>
            ) : (
              <>
                <span style={{ color: '#aaa' }}>To:</span>
                <span style={{ background: '#f0f2f5', borderRadius: 4, padding: '1px 7px', fontWeight: 600 }}>
                  {email.to_address || '—'}
                </span>
              </>
            )}
            {isIncoming && email.to_address && (
              <>
                <span style={{ color: '#aaa', marginLeft: 4 }}>To:</span>
                <span style={{ background: '#f0f2f5', borderRadius: 4, padding: '1px 7px' }}>
                  {email.to_address}
                </span>
              </>
            )}
          </div>

          {/* Body */}
          {bodyLines.length > 0 && (
            <div style={{
              background: '#f7f8fc', border: '1px solid #e6e9ef', borderRadius: 8,
              padding: '10px 14px', fontSize: 13, color: '#323338',
              lineHeight: 1.6, whiteSpace: 'pre-wrap', wordBreak: 'break-word',
            }}>
              {expanded ? bodyLines.join('\n') : previewLines.join('\n')}
              {hasMore && (
                <button
                  onClick={() => setExpanded(s => !s)}
                  style={{
                    display: 'block', marginTop: 6,
                    fontSize: 12, color: '#9b72f5', fontWeight: 600, cursor: 'pointer',
                  }}
                >
                  {expanded ? '▲ Show less' : `▼ Show more (${bodyLines.length - 3} more line${bodyLines.length - 3 > 1 ? 's' : ''})`}
                </button>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// ── Column type icons ─────────────────────────────────────────────────────────
function colTypeIcon(type) {
  const MAP = {
    status: '🟢', priority: '🔴', text: '📝', number: '🔢', date: '📅',
    person: '👤', checkbox: '✅', dropdown: '🗃️', rating: '⭐', progress: '📊',
    tags: '🏷️', timeline: '📆', link: '🔗', color: '🎨', formula: '🧮',
    creation_log: '🕐', email: '✉️', phone: '📞', location: '📍',
  };
  return MAP[type] || '📋';
}

// ── Main panel ────────────────────────────────────────────────────────────────
export default function ItemDetailPanel({ item, group, columns, boardId, onClose, onItemUpdate, onValueChange, canEdit, isManager, defaultTab = 'updates' }) {
  const { user } = useAuth();
  const [tab, setTab] = useState(defaultTab);
  // Re-sync if panel is opened via notification (defaultTab changes)
  useEffect(() => { setTab(defaultTab); }, [defaultTab]);
  const [comments, setComments] = useState([]);
  const [activity, setActivity] = useState([]);
  const [emails,   setEmails]   = useState([]);
  const [members,  setMembers]  = useState([]);
  const [loadingUpdates, setLoadingUpdates] = useState(false);

  // Load board members once for @mention
  useEffect(() => {
    getBoardMembers(boardId)
      .then(r => setMembers(r.data || []))
      .catch(() => {});
  }, [boardId]);

  // Load comments + activity + emails when switching to updates/activity tab or item changes
  useEffect(() => {
    if (tab !== 'updates' && tab !== 'activity') return;
    setLoadingUpdates(true);
    Promise.all([
      getComments(item.id).then(r => r.data),
      getItemActivityLogs(item.id).then(r => r.data),
      getItemEmails(item.id).then(r => r.data).catch(() => []),
    ])
      .then(([c, a, e]) => { setComments(c); setActivity(a); setEmails(e); })
      .catch(() => {})
      .finally(() => setLoadingUpdates(false));
  }, [tab, item.id]);

  const handlePost = useCallback(async (body, mentions, parentId = null) => {
    const r = await createComment({ item_id: item.id, board_id: boardId, body, parent_id: parentId, mentions });
    setComments(prev => [...prev, r.data]);
  }, [item.id, boardId]);

  const handleDelete = useCallback(async (id) => {
    await deleteComment(id);
    // Remove comment and any of its replies
    setComments(prev => prev.filter(c => c.id !== id && c.parent_id !== id));
  }, []);

  // Build threaded structure
  const rootComments = comments.filter(c => !c.parent_id);
  const repliesMap = {};
  comments.filter(c => c.parent_id).forEach(r => {
    if (!repliesMap[r.parent_id]) repliesMap[r.parent_id] = [];
    repliesMap[r.parent_id].push(r);
  });

  // Updates tab — human conversation (comments + emails)
  const updatesTimeline = [
    ...rootComments.map(c => ({ ...c, _type: 'comment' })),
    ...emails.map(e =>      ({ ...e, _type: 'email' })),
  ].sort((a, b) => new Date(b.created_at) - new Date(a.created_at));

  // Activity Log tab — system-generated events only
  const activityTimeline = [...activity]
    .sort((a, b) => new Date(b.created_at) - new Date(a.created_at));

  const updatesCount  = rootComments.length + emails.length;
  const activityCount = activity.length;

  const fieldColumns = columns.filter(c => c.type !== 'creation_log');

  return (
    <div
      className="wb-side-panel-overlay"
      style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.35)', zIndex: 500, display: 'flex', alignItems: 'flex-start', justifyContent: 'flex-end' }}
      onClick={onClose}
    >
      <div
        onClick={e => e.stopPropagation()}
        className="wb-side-panel"
        style={{
          background: '#fff', width: 600, height: '100vh',
          display: 'flex', flexDirection: 'column',
          boxShadow: '-6px 0 32px rgba(0,0,0,0.15)',
          animation: 'slideInRight 0.2s ease',
        }}
      >
        {/* ── Header ── */}
        <div style={{ borderLeft: `5px solid ${group.color}`, padding: '20px 24px 0', borderBottom: '1px solid #e6e9ef', flexShrink: 0 }}>
          <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 12 }}>
            <div style={{ flex: 1, minWidth: 0 }}>
              {canEdit
                ? <EditableName value={item.name} onSave={name => onItemUpdate(item.id, name)} />
                : <div style={{ fontSize: 20, fontWeight: 700, color: '#323338' }}>{item.name}</div>
              }
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 8, flexWrap: 'wrap' }}>
                <span style={{ background: `${group.color}22`, color: group.color, borderRadius: 12, padding: '2px 10px', fontSize: 12, fontWeight: 700 }}>
                  {group.name}
                </span>
                {item.created_by_user_name && (
                  <span style={{ fontSize: 12, color: '#aaa' }}>Created by {item.created_by_user_name}</span>
                )}
              </div>
            </div>
            <button
              onClick={onClose}
              style={{ fontSize: 22, color: '#aaa', lineHeight: 1, flexShrink: 0, marginTop: 2, padding: '0 4px' }}
              onMouseEnter={e => e.currentTarget.style.color = '#323338'}
              onMouseLeave={e => e.currentTarget.style.color = '#aaa'}
            >×</button>
          </div>

          {/* Tabs */}
          <div style={{ display: 'flex', gap: 0, marginTop: 16 }}>
            {[
              ['fields',   'Fields'],
              ['updates',  `Updates${updatesCount ? ` (${updatesCount})` : ''}`],
              ['activity', `Activity Log${activityCount ? ` (${activityCount})` : ''}`],
            ].map(([key, label]) => (
              <button key={key} onClick={() => setTab(key)} style={{
                padding: '7px 20px', fontSize: 13, fontWeight: 600,
                color: tab === key ? '#9b72f5' : '#676879',
                borderBottom: tab === key ? '2px solid #9b72f5' : '2px solid transparent',
                transition: 'color 0.15s',
              }}>{label}</button>
            ))}
          </div>
        </div>

        {/* ── Fields tab ── */}
        {tab === 'fields' && (
          <div style={{ flex: 1, overflowY: 'auto', padding: '8px 0' }}>
            {fieldColumns.length === 0
              ? <div style={{ textAlign: 'center', padding: 48, color: '#aaa' }}>No columns yet</div>
              : fieldColumns.map(col => (
                <div key={col.id} style={{ display: 'flex', alignItems: 'center', padding: '6px 24px', borderBottom: '1px solid var(--border-color)', minHeight: 44, gap: 12 }}>
                  <div style={{ width: 160, flexShrink: 0, fontSize: 13, color: 'var(--text-secondary)', fontWeight: 500, display: 'flex', alignItems: 'center', gap: 6 }}>
                    <span style={{ fontSize: 14 }}>{colTypeIcon(col.type)}</span>
                    {col.title}
                  </div>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <ColumnCell
                      column={col}
                      value={item.values?.[col.id] || ''}
                      onChange={!canEdit || (col.type === 'person' && !isManager) ? undefined : val => onValueChange(col.id, val)}
                      item={item}
                    />
                  </div>
                </div>
              ))
            }
          </div>
        )}

        {/* ── Updates tab ── */}
        {tab === 'updates' && (
          <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
            {/* Comment composer */}
            {canEdit && (
              <div style={{ padding: '16px 24px', borderBottom: '1px solid #e6e9ef', flexShrink: 0 }}>
                <Composer members={members} onPost={(body, mentions) => handlePost(body, mentions, null)} />
              </div>
            )}

            {/* Timeline — comments + emails only */}
            <div style={{ flex: 1, overflowY: 'auto', padding: '8px 0' }}>
              {loadingUpdates ? (
                <div style={{ textAlign: 'center', padding: 40, color: '#aaa' }}>Loading…</div>
              ) : updatesTimeline.length === 0 ? (
                <div style={{ textAlign: 'center', padding: 60, color: '#aaa' }}>
                  <div style={{ fontSize: 40, marginBottom: 10 }}>💬</div>
                  <div style={{ fontSize: 14 }}>No updates yet</div>
                  <div style={{ fontSize: 12, marginTop: 4 }}>Write a comment · type @ to mention someone · emails appear here automatically</div>
                </div>
              ) : (
                updatesTimeline.map(entry => {
                  if (entry._type === 'comment') {
                    return (
                      <CommentEntry
                        key={`c-${entry.id}`}
                        comment={entry}
                        replies={repliesMap[entry.id] || []}
                        members={members}
                        currentUserId={user?.id}
                        currentUserRole={user?.role}
                        onDelete={handleDelete}
                        onReply={handlePost}
                        item={item}
                        boardId={boardId}
                      />
                    );
                  }
                  return <EmailEntry key={`e-${entry.id}`} email={entry} />;
                })
              )}
            </div>
          </div>
        )}

        {/* ── Activity Log tab ── */}
        {tab === 'activity' && (
          <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
            <div style={{ flex: 1, overflowY: 'auto', padding: '8px 0' }}>
              {loadingUpdates ? (
                <div style={{ textAlign: 'center', padding: 40, color: '#aaa' }}>Loading…</div>
              ) : activityTimeline.length === 0 ? (
                <div style={{ textAlign: 'center', padding: 60, color: '#aaa' }}>
                  <div style={{ fontSize: 40, marginBottom: 10 }}>📋</div>
                  <div style={{ fontSize: 14 }}>No activity yet</div>
                  <div style={{ fontSize: 12, marginTop: 4 }}>Field changes, status updates, and moves will appear here</div>
                </div>
              ) : (
                activityTimeline.map(entry => (
                  <ActivityEntry key={`a-${entry.id}`} log={entry} />
                ))
              )}
            </div>
          </div>
        )}
      </div>

      <style>{`@keyframes slideInRight { from { transform: translateX(40px); opacity: 0; } to { transform: translateX(0); opacity: 1; } }`}</style>
    </div>
  );
}
