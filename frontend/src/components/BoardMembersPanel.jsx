import React, { useState, useEffect, useRef, useLayoutEffect } from 'react';
import { createPortal } from 'react-dom';
import { addBoardMember, removeBoardMember, searchUsers, setBoardMemberOwner, updateBoard } from '../api';
import { useToast } from './Toast';
import { useAuth } from '../context/AuthContext';
import EmptyState from './EmptyState';

const ROLE_COLORS = { admin: '#e2445c', manager: '#fdab3d', user: '#9b72f5' };

function Avatar({ name, url, size = 36 }) {
  const initials = (name || '?').split(' ').map(w => w[0]).join('').toUpperCase().slice(0, 2);
  if (url) return <img src={url} alt={name} style={{ width: size, height: size, borderRadius: '50%', objectFit: 'cover' }} />;
  return (
    <div style={{
      width: size, height: size, borderRadius: '50%', background: '#9b72f5',
      color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center',
      fontWeight: 700, fontSize: size * 0.38, flexShrink: 0,
    }}>{initials}</div>
  );
}

// ── User search typeahead ─────────────────────────────────────────────────────
// The suggestions list is rendered into a portal so it always floats above
// any sibling content (hint text, the member list below, etc.) — Monday-style
// clean dropdown, never pushed below or visually clipped.
function UserSearchInput({ members, onSelect }) {
  const [query, setQuery] = useState('');
  const [suggestions, setSuggestions] = useState([]);
  const [loading, setLoading] = useState(false);
  const [open, setOpen] = useState(false);
  const [activeIdx, setActiveIdx] = useState(-1);
  const [anchor, setAnchor] = useState(null); // { top, left, width } in viewport coords
  const debounceRef = useRef(null);
  const inputRef = useRef(null);
  const dropdownRef = useRef(null);

  // Search after 2 chars with 200ms debounce (snappier than the old 3-char rule).
  useEffect(() => {
    clearTimeout(debounceRef.current);
    if (query.trim().length < 2) {
      setSuggestions([]);
      setOpen(false);
      return;
    }
    debounceRef.current = setTimeout(async () => {
      setLoading(true);
      try {
        const r = await searchUsers(query.trim());
        const memberIds = new Set(members.map(m => m.id));
        setSuggestions(r.data.filter(u => !memberIds.has(u.id)));
        setOpen(true);
        setActiveIdx(-1);
      } catch {
        setSuggestions([]);
      } finally {
        setLoading(false);
      }
    }, 200);
    return () => clearTimeout(debounceRef.current);
  }, [query, members]);

  // Close on outside click — guard the portal node too so clicks on
  // suggestions don't immediately collapse the list.
  useEffect(() => {
    const handler = (e) => {
      if (inputRef.current?.contains(e.target)) return;
      if (dropdownRef.current?.contains(e.target)) return;
      setOpen(false);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  // Reposition the portal whenever the input moves (open, scroll, resize).
  useLayoutEffect(() => {
    if (!open || !inputRef.current) return;
    const recompute = () => {
      const r = inputRef.current.getBoundingClientRect();
      setAnchor({ top: r.bottom + 4, left: r.left, width: r.width });
    };
    recompute();
    window.addEventListener('scroll', recompute, true);
    window.addEventListener('resize', recompute);
    return () => {
      window.removeEventListener('scroll', recompute, true);
      window.removeEventListener('resize', recompute);
    };
  }, [open, suggestions.length]);

  const selectUser = (user) => {
    onSelect(user);
    setQuery('');
    setSuggestions([]);
    setOpen(false);
    setActiveIdx(-1);
  };

  const handleKeyDown = (e) => {
    if (!open || !suggestions.length) return;
    if (e.key === 'ArrowDown') { e.preventDefault(); setActiveIdx(i => Math.min(i + 1, suggestions.length - 1)); }
    if (e.key === 'ArrowUp')   { e.preventDefault(); setActiveIdx(i => Math.max(i - 1, 0)); }
    if (e.key === 'Enter' && activeIdx >= 0) { e.preventDefault(); selectUser(suggestions[activeIdx]); }
    if (e.key === 'Escape') setOpen(false);
  };

  const showEmpty = open && !loading && query.trim().length >= 2 && suggestions.length === 0;
  const showList  = open && suggestions.length > 0;

  return (
    <>
      <div style={{ position: 'relative' }}>
        <input
          ref={inputRef}
          type="text"
          value={query}
          onChange={e => setQuery(e.target.value)}
          onKeyDown={handleKeyDown}
          onFocus={() => suggestions.length && setOpen(true)}
          placeholder="Search name or email…"
          style={{
            width: '100%', border: '1.5px solid var(--border-color, #ddd)', borderRadius: 8,
            padding: '9px 34px 9px 34px', fontSize: 13, outline: 'none', boxSizing: 'border-box',
            background: 'var(--input-bg, #fff)', color: 'var(--text-primary, #323338)',
          }}
          onFocusCapture={e => e.target.style.borderColor = '#9b72f5'}
          onBlur={e => e.target.style.borderColor = 'var(--border-color, #ddd)'}
          autoComplete="off"
        />
        {/* Leading search icon */}
        <span style={{ position: 'absolute', left: 11, top: '50%', transform: 'translateY(-50%)', fontSize: 13, color: 'var(--text-muted, #aaa)', pointerEvents: 'none' }}>
          🔍
        </span>
        {/* Trailing spinner / clear button */}
        {loading ? (
          <span style={{ position: 'absolute', right: 11, top: '50%', transform: 'translateY(-50%)', fontSize: 12, color: 'var(--text-muted, #aaa)' }}>⏳</span>
        ) : query ? (
          <button
            type="button"
            onClick={() => { setQuery(''); setSuggestions([]); setOpen(false); inputRef.current?.focus(); }}
            title="Clear"
            style={{
              position: 'absolute', right: 8, top: '50%', transform: 'translateY(-50%)',
              background: 'none', border: 'none', cursor: 'pointer',
              color: 'var(--text-muted, #aaa)', fontSize: 14, lineHeight: 1, padding: '2px 4px',
            }}
          >×</button>
        ) : null}
      </div>

      {/* Portal-rendered dropdown — sits on top of everything cleanly */}
      {(showList || showEmpty) && anchor && createPortal(
        <div
          ref={dropdownRef}
          style={{
            position: 'fixed', top: anchor.top, left: anchor.left, width: anchor.width,
            background: 'var(--menu-bg, #fff)', color: 'var(--text-primary, #323338)',
            borderRadius: 10, boxShadow: '0 10px 32px rgba(0,0,0,0.18)',
            border: '1px solid var(--menu-border, #e6e9ef)',
            zIndex: 1000, overflow: 'hidden', maxHeight: 320, overflowY: 'auto',
          }}
        >
          {showList ? suggestions.map((u, idx) => (
            <div
              key={u.id}
              onMouseDown={(e) => { e.preventDefault(); selectUser(u); }}
              style={{
                display: 'flex', alignItems: 'center', gap: 10,
                padding: '8px 12px', cursor: 'pointer',
                background: idx === activeIdx ? 'var(--menu-hover, #f0f6ff)' : 'transparent',
                transition: 'background 0.1s',
              }}
              onMouseEnter={() => setActiveIdx(idx)}
            >
              <Avatar name={u.name} url={u.avatar_url} size={30} />
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontWeight: 600, fontSize: 13 }}>{u.name}</div>
                <div style={{ fontSize: 11, color: 'var(--text-muted, #888)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{u.email}</div>
              </div>
              <span style={{
                fontSize: 10, fontWeight: 700, padding: '2px 7px', borderRadius: 10, flexShrink: 0,
                background: `${ROLE_COLORS[u.role] || '#9b72f5'}20`,
                color: ROLE_COLORS[u.role] || '#9b72f5',
                textTransform: 'capitalize',
              }}>{u.role}</span>
            </div>
          )) : (
            <div style={{ padding: '14px', textAlign: 'center', color: 'var(--text-muted, #888)', fontSize: 13 }}>
              No matches
            </div>
          )}
        </div>,
        document.body
      )}
    </>
  );
}

// ── Main panel ────────────────────────────────────────────────────────────────
export default function BoardMembersPanel({ board, onClose, onMembersChange }) {
  const [members, setMembers] = useState(board.members || []);
  const [adding, setAdding] = useState(false);
  const [enforceVisibility, setEnforceVisibility] = useState(!!board.enforce_owner_visibility);
  const [savingToggle, setSavingToggle] = useState(false);
  const toast = useToast();
  const { user: currentUser, isManager } = useAuth();

  const applyMemberChange = (updatedMembers, ownerColumn) => {
    setMembers(updatedMembers);
    onMembersChange(updatedMembers, ownerColumn);
  };

  const handleSelect = async (user) => {
    if (members.find(m => m.id === user.id)) {
      toast(`${user.name} is already a member`, 'info');
      return;
    }
    setAdding(true);
    try {
      const r = await addBoardMember(board.id, user.email);
      const { member, updatedColumns } = r.data;
      applyMemberChange(
        [...members, { ...member, added_at: new Date().toISOString(), is_owner: false }],
        updatedColumns
      );
      toast(`${member.name} added to board`, 'success');
    } catch (err) {
      toast(err.response?.data?.error || 'Failed to add member', 'error');
    } finally {
      setAdding(false);
    }
  };

  const handleRemove = async (member) => {
    if (!confirm(`Remove ${member.name} from this board?`)) return;
    try {
      const r = await removeBoardMember(board.id, member.id);
      const { updatedColumns } = r.data;
      applyMemberChange(members.filter(m => m.id !== member.id), updatedColumns);
      toast(`${member.name} removed`, 'success');
    } catch (err) {
      toast(err.response?.data?.error || 'Failed to remove member', 'error');
    }
  };

  // Toggle a member's Board Owner flag. Board Owners (alongside system admins)
  // see every item on the board even when the strict-visibility toggle is on.
  const handleToggleOwner = async (member) => {
    const next = !member.is_owner;
    try {
      await setBoardMemberOwner(board.id, member.id, next);
      const updated = members.map(m => m.id === member.id ? { ...m, is_owner: next } : m);
      setMembers(updated);
      onMembersChange(updated, null);
      toast(
        next
          ? `${member.name} is now a Board Owner — sees all items`
          : `${member.name} is no longer a Board Owner`,
        'success'
      );
    } catch (err) {
      toast(err.response?.data?.error || 'Failed to update owner status', 'error');
    }
  };

  // Toggle the per-board "Restrict items to assignees" switch.
  const handleToggleEnforceVisibility = async () => {
    const next = !enforceVisibility;
    setSavingToggle(true);
    setEnforceVisibility(next); // optimistic
    try {
      await updateBoard(board.id, {
        name: board.name,
        description: board.description,
        visibility: board.visibility,
        item_name: board.item_name,
        enforce_owner_visibility: next,
      });
      toast(
        next
          ? 'Strict visibility ON — non-owners only see items where they are assigned'
          : 'Strict visibility OFF — managers see everything (legacy mode)',
        'success'
      );
    } catch (err) {
      setEnforceVisibility(!next); // revert
      toast(err.response?.data?.error || 'Failed to update visibility setting', 'error');
    } finally {
      setSavingToggle(false);
    }
  };

  return (
    <div className="wb-side-panel-overlay" style={{
      position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.35)', zIndex: 400,
      display: 'flex', alignItems: 'flex-start', justifyContent: 'flex-end',
    }} onClick={onClose}>
      <div className="wb-side-panel" onClick={e => e.stopPropagation()} style={{
        background: '#fff', width: 420, height: '100vh', overflowY: 'auto',
        boxShadow: '-4px 0 24px rgba(0,0,0,0.12)', display: 'flex', flexDirection: 'column',
      }}>
        {/* Header */}
        <div style={{ padding: '20px 20px 16px', borderBottom: '1px solid #f0f0f0', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <div>
            <h2 style={{ fontSize: 16, fontWeight: 700, margin: 0 }}>👥 Board Members</h2>
            <p style={{ fontSize: 12, color: '#888', margin: '2px 0 0' }}>
              {board.name} · {members.length} member{members.length !== 1 ? 's' : ''}
            </p>
          </div>
          <button onClick={onClose} style={{ fontSize: 20, color: '#888', lineHeight: 1 }}>×</button>
        </div>

        {/* Strict-visibility toggle (board-level) */}
        {isManager && (
          <div className="theme-notice" style={{
            padding: '14px 20px', borderBottom: '1px solid #f0f0f0',
            background: enforceVisibility ? '#fff7e6' : '#fafbfc',
          }}>
            <label style={{ display: 'flex', alignItems: 'flex-start', gap: 10, cursor: 'pointer' }}>
              <input
                type="checkbox"
                checked={enforceVisibility}
                disabled={savingToggle}
                onChange={handleToggleEnforceVisibility}
                style={{ marginTop: 2, accentColor: '#fdab3d', cursor: 'pointer', width: 16, height: 16 }}
              />
              <span>
                <span style={{ fontSize: 13, fontWeight: 700, color: '#323338', display: 'block' }}>
                  🔒 Strict access mode
                </span>
                <span style={{ fontSize: 11, color: '#676879', display: 'block', marginTop: 3, lineHeight: 1.5 }}>
                  Each member sees only the items where their name is listed in an Owner column.
                  Board Owners (★) keep full visibility across the board.
                </span>
              </span>
            </label>
          </div>
        )}

        {/* Search & invite — clean Monday-style: input + dropdown, no extra hint copy */}
        {isManager && (
          <div style={{ padding: '14px 20px', borderBottom: '1px solid #f0f0f0', position: 'relative' }}>
            <UserSearchInput members={members} onSelect={handleSelect} />
            {adding && (
              <div style={{ fontSize: 11, color: '#9b72f5', marginTop: 6 }}>Adding…</div>
            )}
          </div>
        )}

        {/* Member list */}
        <div style={{ flex: 1, padding: '12px 20px' }}>
          {members.length === 0 ? (
            <EmptyState
              icon="👥"
              title="Just you here so far"
              description="Add teammates by name or email so they can see and update this board's tasks."
            />
          ) : (
            members.map(m => (
              <div key={m.id} style={{
                display: 'flex', alignItems: 'center', gap: 10,
                padding: '10px 0', borderBottom: '1px solid #f5f5f5',
              }}>
                <Avatar name={m.name} url={m.avatar_url} size={36} />
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div className="board-member-name" style={{ fontWeight: 600, fontSize: 13, color: 'var(--text-primary, #323338)', display: 'flex', alignItems: 'center', gap: 6 }}>
                    {m.name}
                    {m.id === currentUser?.id && <span style={{ fontSize: 10, color: '#888' }}>(you)</span>}
                    {m.is_owner && (
                      <span className="theme-chip" style={{
                        fontSize: 9, fontWeight: 700, padding: '1px 6px', borderRadius: 8,
                        background: '#fff3d6', color: '#b87a00', textTransform: 'uppercase', letterSpacing: 0.4,
                      }}>Board Owner</span>
                    )}
                  </div>
                  <div className="board-member-email" style={{ fontSize: 11, color: 'var(--text-primary, #888)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{m.email}</div>
                </div>
                {/* Board Owner star — managers can promote/demote any member */}
                {isManager && (
                  <button
                    onClick={() => handleToggleOwner(m)}
                    style={{
                      color: m.is_owner ? '#fdab3d' : '#ddd',
                      fontSize: 18, lineHeight: 1, flexShrink: 0, padding: '2px 4px',
                      transition: 'color 0.15s, transform 0.15s',
                    }}
                    title={m.is_owner ? 'Click to remove Board Owner status' : 'Make this user a Board Owner (sees all items)'}
                    onMouseEnter={e => { e.currentTarget.style.color = '#fdab3d'; e.currentTarget.style.transform = 'scale(1.15)'; }}
                    onMouseLeave={e => { e.currentTarget.style.color = m.is_owner ? '#fdab3d' : '#ddd'; e.currentTarget.style.transform = 'scale(1)'; }}
                  >★</button>
                )}
                <span className="theme-chip" style={{
                  fontSize: 10, fontWeight: 700, padding: '2px 8px', borderRadius: 10,
                  background: `${ROLE_COLORS[m.role]}20`, color: ROLE_COLORS[m.role],
                  textTransform: 'capitalize', flexShrink: 0,
                }}>{m.role}</span>
                {isManager && m.id !== currentUser?.id && (
                  <button
                    onClick={() => handleRemove(m)}
                    style={{ color: '#ccc', fontSize: 16, lineHeight: 1, flexShrink: 0, padding: '2px 4px' }}
                    title="Remove from board"
                    onMouseEnter={e => e.currentTarget.style.color = '#e2445c'}
                    onMouseLeave={e => e.currentTarget.style.color = '#ccc'}
                  >×</button>
                )}
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );
}
