import React, { useState, useEffect, useCallback } from 'react';
import { getMyWork } from '../api';
import { parseOwners } from './ColumnCell';
import EmptyState from './EmptyState';

// ── Helpers ───────────────────────────────────────────────────────────────────

function getStatusStyle(settings, value) {
  if (!settings?.labels || !value) return { bg: '#c4c4c4', color: '#fff' };
  const labels = Array.isArray(settings.labels) ? settings.labels : Object.values(settings.labels);
  const match = labels.find(l => l.text === value || l.id === value);
  return { bg: match?.color || '#c4c4c4', color: '#fff' };
}

function StatusPill({ colVal }) {
  const s = getStatusStyle(colVal.settings, colVal.value);
  return (
    <span style={{
      display: 'inline-block', padding: '2px 8px', borderRadius: 12,
      fontSize: 11, fontWeight: 600, background: s.bg, color: s.color,
      whiteSpace: 'nowrap', maxWidth: 120, overflow: 'hidden', textOverflow: 'ellipsis',
    }} title={colVal.col_title}>
      {colVal.value}
    </span>
  );
}

function PersonPills({ colVal }) {
  const names = parseOwners(colVal.value);
  if (!names.length) return null;
  return (
    <span style={{ display: 'inline-flex', gap: 4, flexWrap: 'wrap' }}>
      {names.map(name => (
        <span key={name} style={{
          display: 'inline-flex', alignItems: 'center', gap: 4,
          background: '#e3f0ff', color: '#0073ea',
          borderRadius: 12, padding: '2px 8px', fontSize: 11, fontWeight: 600,
        }}>
          <span style={{
            width: 16, height: 16, borderRadius: '50%', background: '#0073ea',
            color: '#fff', fontSize: 9, fontWeight: 700,
            display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
            flexShrink: 0,
          }}>
            {name.charAt(0).toUpperCase()}
          </span>
          {name}
        </span>
      ))}
    </span>
  );
}

// ── Single item row ───────────────────────────────────────────────────────────
function ItemRow({ item, onNavigate }) {
  const cols = Array.isArray(item.col_values) ? item.col_values : [];
  const statusCols = cols.filter(c => c.col_type === 'status');
  const personCols = cols.filter(c => c.col_type === 'person');
  const dateCols   = cols.filter(c => c.col_type === 'date' && c.value);

  return (
    <div
      onClick={() => onNavigate(item.board_id)}
      style={{
        display: 'grid',
        gridTemplateColumns: '1fr auto',
        alignItems: 'center',
        gap: 8,
        padding: '9px 16px',
        borderBottom: '1px solid var(--border-color)',
        cursor: 'pointer',
        transition: 'background 0.12s',
      }}
      onMouseEnter={e => e.currentTarget.style.background = 'var(--hover-bg)'}
      onMouseLeave={e => e.currentTarget.style.background = 'transparent'}
    >
      {/* Left: item name + group + persons */}
      <div style={{ minWidth: 0 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 2 }}>
          {item.parent_item_id && (
            <span style={{ fontSize: 9, color: 'var(--text-muted)', flexShrink: 0, background: 'var(--bg-secondary)', borderRadius: 3, padding: '1px 4px' }}>
              sub-item
            </span>
          )}
          <span style={{
            fontSize: 13, fontWeight: 600, color: 'var(--text-primary)',
            overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
          }}>
            {item.item_name}
          </span>
        </div>
        <div style={{ fontSize: 11, color: 'var(--text-muted)', marginBottom: personCols.length ? 4 : 0 }}>
          {item.group_name}
          {dateCols.length > 0 && (
            <span style={{ marginLeft: 8, color: 'var(--text-secondary)' }}>
              · {new Date(dateCols[0].value).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' })}
            </span>
          )}
        </div>
        {personCols.length > 0 && (
          <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
            {personCols.map(c => <PersonPills key={c.col_id} colVal={c} />)}
          </div>
        )}
      </div>

      {/* Right: status pill(s) */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 3, alignItems: 'flex-end', flexShrink: 0 }}>
        {statusCols.map(c => <StatusPill key={c.col_id} colVal={c} />)}
      </div>
    </div>
  );
}

// ── Board group header ────────────────────────────────────────────────────────
function BoardGroup({ boardName, boardId, items, onNavigate }) {
  const [collapsed, setCollapsed] = useState(false);
  return (
    <div style={{ marginBottom: 4 }}>
      <div
        onClick={() => setCollapsed(v => !v)}
        style={{
          display: 'flex', alignItems: 'center', gap: 8,
          padding: '8px 16px', cursor: 'pointer',
          background: 'var(--bg-secondary)',
          borderBottom: '1px solid var(--border-color)',
          position: 'sticky', top: 0, zIndex: 1,
        }}
      >
        <span style={{ fontSize: 10, color: 'var(--text-muted)' }}>{collapsed ? '▶' : '▼'}</span>
        <span style={{ fontSize: 14 }}>📋</span>
        <span style={{ fontSize: 13, fontWeight: 700, color: 'var(--text-primary)', flex: 1 }}>
          {boardName}
        </span>
        <span style={{
          fontSize: 11, fontWeight: 600, background: '#e3f0ff', color: '#0073ea',
          borderRadius: 12, padding: '1px 8px',
        }}>
          {items.length}
        </span>
        <button
          onClick={e => { e.stopPropagation(); onNavigate(boardId); }}
          style={{
            fontSize: 11, color: '#0073ea', background: 'transparent',
            border: '1px solid #0073ea', borderRadius: 4, padding: '2px 8px',
            cursor: 'pointer', fontWeight: 600,
          }}
          title="Open board"
        >
          Open →
        </button>
      </div>
      {!collapsed && items.map(item => (
        <ItemRow key={item.item_id} item={item} onNavigate={onNavigate} />
      ))}
    </div>
  );
}

// ── Main panel ────────────────────────────────────────────────────────────────
export default function MyWorkPanel({ onClose, onNavigateToBoard }) {
  const [items, setItems]     = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError]     = useState(null);

  useEffect(() => {
    setLoading(true);
    getMyWork()
      .then(data => { setItems(data.items || []); setLoading(false); })
      .catch(() => { setError('Failed to load your work.'); setLoading(false); });
  }, []);

  // Close on Escape
  useEffect(() => {
    const onKey = e => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);

  // Group items by board
  const boardMap = {};
  for (const item of items) {
    const key = item.board_id;
    if (!boardMap[key]) boardMap[key] = { boardName: item.board_name, boardId: item.board_id, items: [] };
    boardMap[key].items.push(item);
  }
  const boards = Object.values(boardMap);

  const handleNavigate = useCallback((boardId) => {
    onNavigateToBoard(boardId);
    onClose();
  }, [onNavigateToBoard, onClose]);

  return (
    <>
      {/* Backdrop */}
      <div
        onClick={onClose}
        style={{
          position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.35)',
          zIndex: 1100,
        }}
      />

      {/* Panel */}
      <div className="wb-side-panel" style={{
        position: 'fixed', top: 0, right: 0, bottom: 0,
        width: 520, maxWidth: '95vw',
        background: 'var(--bg-primary)',
        borderLeft: '1px solid var(--border-color)',
        display: 'flex', flexDirection: 'column',
        zIndex: 1101,
        boxShadow: '-4px 0 24px rgba(0,0,0,0.15)',
      }}>
        {/* Header */}
        <div style={{
          padding: '16px 20px',
          borderBottom: '1px solid var(--border-color)',
          display: 'flex', alignItems: 'center', gap: 10,
          flexShrink: 0,
        }}>
          <span style={{ fontSize: 20 }}>👤</span>
          <div style={{ flex: 1 }}>
            <div style={{ fontSize: 17, fontWeight: 700, color: 'var(--text-primary)' }}>My Work</div>
            <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 1 }}>
              Items where you are assigned as owner
            </div>
          </div>
          {!loading && !error && (
            <span style={{
              fontSize: 12, fontWeight: 700, background: '#e3f0ff', color: '#0073ea',
              borderRadius: 12, padding: '2px 10px',
            }}>
              {items.length} item{items.length !== 1 ? 's' : ''}
            </span>
          )}
          <button
            onClick={onClose}
            style={{
              width: 28, height: 28, borderRadius: '50%', fontSize: 18, lineHeight: 1,
              background: 'var(--hover-bg)', color: 'var(--text-muted)',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              cursor: 'pointer', border: 'none', flexShrink: 0,
            }}
            title="Close"
          >×</button>
        </div>

        {/* Body */}
        <div style={{ flex: 1, overflowY: 'auto' }}>
          {loading && (
            <div style={{ padding: 40, textAlign: 'center', color: 'var(--text-muted)' }}>
              <div style={{ fontSize: 28, marginBottom: 8 }}>⏳</div>
              Loading your assigned items…
            </div>
          )}
          {error && (
            <div style={{ padding: 40, textAlign: 'center', color: '#e2445c' }}>
              <div style={{ fontSize: 28, marginBottom: 8 }}>⚠️</div>
              {error}
            </div>
          )}
          {!loading && !error && items.length === 0 && (
            <EmptyState
              icon="🎉"
              title="Inbox zero — you're all clear"
              description="Items where someone assigns you in a Person / Owner column will land here. Until then, take a breath."
            />
          )}
          {!loading && !error && boards.map(b => (
            <BoardGroup
              key={b.boardId}
              boardName={b.boardName}
              boardId={b.boardId}
              items={b.items}
              onNavigate={handleNavigate}
            />
          ))}
        </div>
      </div>
    </>
  );
}
