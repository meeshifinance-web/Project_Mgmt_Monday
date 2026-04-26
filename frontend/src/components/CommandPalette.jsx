/**
 * CommandPalette.jsx
 *
 * The Cmd-K palette — a single overlay that lets users search boards,
 * search items across all accessible boards, and execute quick actions
 * without ever leaving the keyboard.
 *
 * Triggered globally by Cmd-K / Ctrl-K (wired in App.jsx).
 *
 * Sections (in this order, each only renders when it has content):
 *   - Recent           visible only when query is empty
 *   - Quick actions    matched against query, always visible
 *   - Boards           server-side substring match on board names
 *   - Items            server-side substring match across accessible boards
 *
 * Keyboard:
 *   ↑ / ↓     move selection
 *   Enter     execute selected
 *   Esc       close palette
 *   any text  filter
 */

import React, { useState, useEffect, useRef, useMemo, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import api from '../api';
import { useThemeContext } from '../context/ThemeContext';
import { useAuth } from '../context/AuthContext';

const RECENT_KEY = 'wb_cmdk_recent';
const RECENT_MAX = 6;

// ── Recent-items localStorage helpers ────────────────────────────────────────
function loadRecent() {
  try {
    const raw = localStorage.getItem(RECENT_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch { return []; }
}
function pushRecent(entry) {
  try {
    const list = loadRecent().filter(e => !(e.kind === entry.kind && e.id === entry.id));
    list.unshift(entry);
    localStorage.setItem(RECENT_KEY, JSON.stringify(list.slice(0, RECENT_MAX)));
  } catch { /* localStorage full or disabled — ignore */ }
}

// ── Action library — static "things you can do" ──────────────────────────────
function buildActions({ navigate, toggleTheme, isDark, signOut }) {
  return [
    { kind: 'action', id: 'go-home',     label: 'Go to Home',                  icon: '🏠', keywords: 'home dashboard',         run: () => navigate('/') },
    { kind: 'action', id: 'go-mywork',   label: 'Open My Work',                icon: '📋', keywords: 'mywork tasks assigned',    run: () => navigate('/?panel=mywork') },
    { kind: 'action', id: 'go-trash',    label: 'Open Trash',                  icon: '🗑️',  keywords: 'trash deleted recycle',    run: () => navigate('/?panel=trash') },
    { kind: 'action', id: 'go-profile',  label: 'Open my profile',             icon: '👤', keywords: 'profile account settings', run: () => navigate('/profile') },
    {
      kind: 'action', id: 'theme-toggle',
      label: isDark ? 'Switch to light theme' : 'Switch to dark theme',
      icon: isDark ? '☀️' : '🌗',
      keywords: 'theme dark light mode',
      run: () => toggleTheme(),
    },
    { kind: 'action', id: 'sign-out',    label: 'Sign out',                    icon: '🚪', keywords: 'logout sign out',          run: () => signOut() },
  ];
}

// ── Single result row ────────────────────────────────────────────────────────
function ResultRow({ result, isActive, onActivate, onClick }) {
  const ref = useRef(null);
  useEffect(() => {
    if (isActive) ref.current?.scrollIntoView({ block: 'nearest' });
  }, [isActive]);

  let icon = result.icon;
  let label = result.label;
  let subtitle = result.subtitle;
  if (result.kind === 'board') { icon = '📋'; label = result.name; subtitle = result.folder_name ? `Folder: ${result.folder_name}` : 'Board'; }
  if (result.kind === 'item')  { icon = '▶'; label = result.name; subtitle = `${result.board_name} · ${result.group_name}`; }

  return (
    <div
      ref={ref}
      onClick={onClick}
      onMouseEnter={onActivate}
      style={{
        display: 'flex', alignItems: 'center', gap: 12,
        padding: '9px 16px', cursor: 'pointer',
        // Use a translucent brand-blue overlay so the row reads as "active" in
        // both themes — solid colors only look right in one theme or the other.
        background: isActive ? 'rgba(0, 115, 234, 0.14)' : 'transparent',
        borderLeft: `3px solid ${isActive ? '#0073ea' : 'transparent'}`,
        color: 'var(--text-primary)',
      }}
    >
      <span style={{ fontSize: 16, width: 22, textAlign: 'center', flexShrink: 0 }}>{icon}</span>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--text-primary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {label}
        </div>
        {subtitle && (
          <div style={{ fontSize: 11, color: 'var(--text-secondary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {subtitle}
          </div>
        )}
      </div>
      {isActive && (
        <span style={{ fontSize: 10, color: 'var(--text-secondary)', flexShrink: 0, fontFamily: 'monospace' }}>↵</span>
      )}
    </div>
  );
}

function SectionHeader({ children }) {
  return (
    <div style={{
      padding: '8px 16px 4px',
      fontSize: 10, fontWeight: 700, color: 'var(--text-secondary)',
      textTransform: 'uppercase', letterSpacing: 0.8,
    }}>
      {children}
    </div>
  );
}

// ── Main palette ─────────────────────────────────────────────────────────────
export default function CommandPalette({ open, onClose }) {
  const navigate = useNavigate();
  const { resolvedTheme, setTheme } = useThemeContext();
  const { user, logout } = useAuth();
  const [query, setQuery]         = useState('');
  const [boards, setBoards]       = useState([]);
  const [items, setItems]         = useState([]);
  const [activeIdx, setActiveIdx] = useState(0);
  const [loading, setLoading]     = useState(false);
  const inputRef = useRef(null);
  const debounceRef = useRef(null);

  const isDark = resolvedTheme === 'dark';
  const toggleTheme = useCallback(() => setTheme(isDark ? 'light' : 'dark'), [isDark, setTheme]);

  // Reset when opened, focus the input
  useEffect(() => {
    if (open) {
      setQuery('');
      setBoards([]);
      setItems([]);
      setActiveIdx(0);
      // setTimeout because the input may not be in the DOM until next paint
      setTimeout(() => inputRef.current?.focus(), 30);
    }
  }, [open]);

  // Debounced server search whenever the query changes
  useEffect(() => {
    if (!open) return;
    clearTimeout(debounceRef.current);
    if (query.trim().length < 1) { setBoards([]); setItems([]); return; }
    debounceRef.current = setTimeout(async () => {
      setLoading(true);
      try {
        const r = await api.get('/cmdk-search', { params: { q: query.trim() } });
        setBoards(r.data.boards || []);
        setItems(r.data.items || []);
        setActiveIdx(0);
      } catch (err) {
        // Network failures shouldn't blow up the UI — just clear results.
        setBoards([]);
        setItems([]);
      } finally {
        setLoading(false);
      }
    }, 180);
    return () => clearTimeout(debounceRef.current);
  }, [query, open]);

  // ── Build the flat list of selectable rows ───────────────────────────────
  const actionsAll = useMemo(
    () => buildActions({ navigate, toggleTheme, isDark, signOut: logout }),
    [navigate, toggleTheme, isDark, logout]
  );

  const recent = useMemo(() => (open && query.trim().length === 0 ? loadRecent() : []), [open, query]);

  // Filter actions by query (substring on label OR keywords)
  const actions = useMemo(() => {
    if (!query.trim()) return actionsAll;
    const q = query.trim().toLowerCase();
    return actionsAll.filter(a =>
      a.label.toLowerCase().includes(q) || (a.keywords || '').toLowerCase().includes(q)
    );
  }, [actionsAll, query]);

  // Compose one flat list with section markers — easier to navigate by index.
  const flat = useMemo(() => {
    const rows = [];
    if (recent.length) {
      rows.push({ section: 'Recent' });
      for (const r of recent) rows.push({ ...r, _sec: 'Recent' });
    }
    if (boards.length) {
      rows.push({ section: 'Boards' });
      for (const b of boards) rows.push({ kind: 'board', ...b, _sec: 'Boards' });
    }
    if (items.length) {
      rows.push({ section: 'Items' });
      for (const it of items) rows.push({ kind: 'item', ...it, _sec: 'Items' });
    }
    if (actions.length) {
      rows.push({ section: 'Actions' });
      for (const a of actions) rows.push(a);
    }
    return rows;
  }, [recent, boards, items, actions]);

  // Selectable rows (skip section headers when computing index)
  const selectable = useMemo(() => flat.filter(r => !r.section), [flat]);

  // Clamp activeIdx if results shrink
  useEffect(() => {
    if (activeIdx >= selectable.length) setActiveIdx(Math.max(0, selectable.length - 1));
  }, [selectable.length, activeIdx]);

  // ── Execute the selected row ─────────────────────────────────────────────
  const execute = useCallback((row) => {
    if (!row) return;
    if (row.kind === 'board') {
      pushRecent({ kind: 'board', id: row.id, name: row.name, folder_name: row.folder_name });
      navigate(`/board/${row.id}`);
    } else if (row.kind === 'item') {
      pushRecent({ kind: 'item', id: row.id, name: row.name, board_id: row.board_id, board_name: row.board_name, group_name: row.group_name });
      navigate(`/board/${row.board_id}?item=${row.id}`);
    } else if (row.kind === 'action') {
      row.run();
    }
    onClose();
  }, [navigate, onClose]);

  // ── Keyboard handling ────────────────────────────────────────────────────
  const handleKey = (e) => {
    if (e.key === 'Escape') { e.preventDefault(); onClose(); return; }
    if (e.key === 'ArrowDown') { e.preventDefault(); setActiveIdx(i => Math.min(i + 1, selectable.length - 1)); return; }
    if (e.key === 'ArrowUp')   { e.preventDefault(); setActiveIdx(i => Math.max(i - 1, 0)); return; }
    if (e.key === 'Enter') { e.preventDefault(); execute(selectable[activeIdx]); return; }
  };

  if (!open) return null;

  // Map selectable index → flat index for highlight rendering
  let selectableCounter = -1;

  return (
    <div
      onClick={onClose}
      style={{
        position: 'fixed', inset: 0, zIndex: 9999,
        background: 'rgba(15, 23, 42, 0.55)',
        backdropFilter: 'blur(2px)',
        display: 'flex', justifyContent: 'center', alignItems: 'flex-start',
        paddingTop: '12vh',
      }}
    >
      <div
        onClick={e => e.stopPropagation()}
        style={{
          width: 620, maxWidth: '94vw', maxHeight: '70vh',
          background: 'var(--card-bg, #fff)', color: 'var(--text-primary, #172b4d)',
          borderRadius: 14, overflow: 'hidden',
          boxShadow: '0 24px 60px rgba(9,30,66,0.35)',
          border: '1px solid var(--border-color, #dfe1e6)',
          display: 'flex', flexDirection: 'column',
        }}
      >
        {/* Search input */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '14px 16px', borderBottom: '1px solid var(--border-color, #dfe1e6)' }}>
          <span style={{ fontSize: 18, color: 'var(--text-secondary)' }}>{loading ? '⏳' : '🔎'}</span>
          <input
            ref={inputRef}
            value={query}
            onChange={e => setQuery(e.target.value)}
            onKeyDown={handleKey}
            placeholder="Search boards, items, or commands…"
            style={{
              flex: 1, border: 'none', outline: 'none',
              background: 'transparent', color: 'var(--text-primary)',
              fontSize: 16, fontFamily: 'inherit',
            }}
          />
          <kbd style={{ fontSize: 10, color: 'var(--text-secondary)', border: '1px solid var(--border-color)', borderRadius: 4, padding: '2px 6px', fontFamily: 'monospace' }}>Esc</kbd>
        </div>

        {/* Results */}
        <div style={{ flex: 1, overflowY: 'auto', padding: '6px 0' }}>
          {flat.length === 0 ? (
            <div style={{ padding: '40px 20px', textAlign: 'center', color: 'var(--text-secondary)', fontSize: 13 }}>
              {query.trim().length === 0
                ? 'Type to search boards, items, or commands.'
                : loading ? 'Searching…' : 'No matches.'}
            </div>
          ) : flat.map((row, i) => {
            if (row.section) {
              return <SectionHeader key={`sec-${row.section}-${i}`}>{row.section}</SectionHeader>;
            }
            selectableCounter++;
            const idx = selectableCounter;
            return (
              <ResultRow
                key={`${row.kind || 'recent'}-${row.id || row._sec + row.label}-${i}`}
                result={row}
                isActive={idx === activeIdx}
                onActivate={() => setActiveIdx(idx)}
                onClick={() => execute(row)}
              />
            );
          })}
        </div>

        {/* Footer hints */}
        <div style={{
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          padding: '8px 14px', borderTop: '1px solid var(--border-color, #dfe1e6)',
          fontSize: 11, color: 'var(--text-secondary)', background: 'var(--bg-secondary, #f7f8fa)',
        }}>
          <span>Tip: Cmd-K opens this anywhere · ↑↓ to navigate · ↵ to select · Esc to close</span>
          {user?.name && <span>{user.name}</span>}
        </div>
      </div>
    </div>
  );
}
