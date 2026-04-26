import React, { useState, useEffect } from 'react';
import {
  getGlobalTrash,
  restoreTrashedBoard, restoreTrashedFolder,
  permanentDeleteBoard, permanentDeleteFolder,
  emptyGlobalTrash,
} from '../api';

function daysLeft(item) {
  return Math.max(0, Math.ceil(Number(item.days_left) || 0));
}

function formatDate(ts) {
  return new Date(ts).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' });
}

// ── Single trashed entry ──────────────────────────────────────────────────────
function TrashEntry({ entry, type, onRestore, onDelete }) {
  const left   = daysLeft(entry);
  const urgent = left <= 3;
  const isBoard  = type === 'board';
  const icon     = isBoard ? '📋' : '📁';
  const typeLabel = isBoard ? 'Board' : 'Folder';

  return (
    <div style={{
      background: '#fafbfd',
      border: `1px solid ${urgent ? '#ffd0d8' : '#e6e9ef'}`,
      borderRadius: 8, padding: '12px 14px', marginBottom: 8,
    }}>
      <div style={{ display: 'flex', alignItems: 'flex-start', gap: 10 }}>
        {/* Icon */}
        <div style={{
          width: 36, height: 36, borderRadius: 8, flexShrink: 0,
          background: isBoard ? '#e3f0ff' : '#fff8e1',
          display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 18,
        }}>{icon}</div>

        <div style={{ flex: 1, minWidth: 0 }}>
          {/* Name + type badge */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 3 }}>
            <span style={{
              fontSize: 10, fontWeight: 700, padding: '1px 6px', borderRadius: 4,
              background: isBoard ? '#e3f0ff' : '#fff8e1',
              color:      isBoard ? '#0073ea' : '#b05e00',
              textTransform: 'uppercase', letterSpacing: 0.4,
            }}>{typeLabel}</span>
            <span style={{
              fontWeight: 600, fontSize: 13, color: '#323338',
              overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
            }}>{entry.name}</span>
          </div>

          {/* Meta */}
          <div style={{ fontSize: 11, color: '#888', lineHeight: 1.7 }}>
            <div>
              Deleted by:{' '}
              <span style={{ color: '#555', fontWeight: 500 }}>
                {entry.deleted_by_user_name || 'Unknown'}
              </span>
              {' · '}{formatDate(entry.deleted_at)}
            </div>
            {!isBoard && Array.isArray(entry.board_ids_snapshot) && entry.board_ids_snapshot.length > 0 && (
              <div style={{ color: '#0073ea' }}>
                {entry.board_ids_snapshot.length} board{entry.board_ids_snapshot.length > 1 ? 's' : ''} will be re-filed on restore
              </div>
            )}
          </div>
        </div>

        {/* Days-left badge */}
        <span style={{
          fontSize: 10, fontWeight: 700, padding: '3px 8px', borderRadius: 12,
          background: urgent ? '#ffe8ec' : '#f0f6ff',
          color:      urgent ? '#e2445c' : '#0073ea',
          flexShrink: 0, whiteSpace: 'nowrap',
        }}>{left}d left</span>
      </div>

      {/* Actions */}
      <div style={{ display: 'flex', gap: 6, marginTop: 10 }}>
        <button
          onClick={() => onRestore(entry.id)}
          style={{
            flex: 1, padding: '6px 0', background: '#00c875', color: '#fff',
            borderRadius: 6, fontSize: 12, fontWeight: 600, cursor: 'pointer',
          }}
          onMouseEnter={e => e.currentTarget.style.background = '#00b468'}
          onMouseLeave={e => e.currentTarget.style.background = '#00c875'}
        >↩ Restore</button>
        <button
          onClick={() => onDelete(entry.id)}
          style={{
            padding: '6px 14px', border: '1.5px solid #e2445c', borderRadius: 6,
            fontSize: 12, fontWeight: 600, color: '#e2445c', cursor: 'pointer', background: '#fff',
          }}
          onMouseEnter={e => { e.currentTarget.style.background = '#e2445c'; e.currentTarget.style.color = '#fff'; }}
          onMouseLeave={e => { e.currentTarget.style.background = '#fff'; e.currentTarget.style.color = '#e2445c'; }}
          title="Permanently delete"
        >Delete</button>
      </div>
    </div>
  );
}

// ── Main panel ────────────────────────────────────────────────────────────────
export default function GlobalTrashPanel({ onClose, onBoardRestored, onFolderRestored }) {
  const [boards,     setBoards]     = useState([]);
  const [folders,    setFolders]    = useState([]);
  const [loading,    setLoading]    = useState(true);
  const [confirming, setConfirming] = useState(false);
  const [tab,        setTab]        = useState('boards'); // 'boards' | 'folders'

  const load = async () => {
    setLoading(true);
    try {
      const r = await getGlobalTrash();
      setBoards(r.data.boards  || []);
      setFolders(r.data.folders || []);
    } catch (_) {}
    setLoading(false);
  };

  useEffect(() => { load(); }, []);

  const handleRestoreBoard = async (id) => {
    try {
      const r = await restoreTrashedBoard(id);
      setBoards(prev => prev.filter(b => b.id !== id));
      onBoardRestored?.(r.data.board);
    } catch (_) {}
  };

  const handleRestoreFolder = async (id) => {
    try {
      const r = await restoreTrashedFolder(id);
      setFolders(prev => prev.filter(f => f.id !== id));
      onFolderRestored?.(r.data.folder, r.data.refiledBoardIds);
    } catch (_) {}
  };

  const handleDeleteBoard = async (id) => {
    try {
      await permanentDeleteBoard(id);
      setBoards(prev => prev.filter(b => b.id !== id));
    } catch (_) {}
  };

  const handleDeleteFolder = async (id) => {
    try {
      await permanentDeleteFolder(id);
      setFolders(prev => prev.filter(f => f.id !== id));
    } catch (_) {}
  };

  const handleEmpty = async () => {
    try {
      await emptyGlobalTrash();
      setBoards([]);
      setFolders([]);
      setConfirming(false);
    } catch (_) {}
  };

  const total = boards.length + folders.length;
  const list  = tab === 'boards' ? boards : folders;

  return (
    <>
      {/* Backdrop */}
      <div onClick={onClose} style={{ position: 'fixed', inset: 0, zIndex: 399, background: 'rgba(0,0,0,0.25)' }} />

      {/* Panel */}
      <div className="wb-side-panel" style={{
        position: 'fixed', top: 0, right: 0, bottom: 0, width: 460, zIndex: 400,
        background: '#fff', boxShadow: '-4px 0 24px rgba(0,0,0,0.14)',
        display: 'flex', flexDirection: 'column',
        fontFamily: 'Figtree, Roboto, -apple-system, sans-serif',
      }}>
        {/* Header */}
        <div style={{
          padding: '16px 20px', borderBottom: '1px solid #e6e9ef',
          display: 'flex', alignItems: 'center', gap: 10, flexShrink: 0,
        }}>
          <span style={{ fontSize: 20 }}>🗑️</span>
          <div style={{ flex: 1 }}>
            <div style={{ fontWeight: 700, fontSize: 16, color: '#323338' }}>Global Trash</div>
            <div style={{ fontSize: 11, color: '#888', marginTop: 1 }}>
              Boards and folders are permanently deleted after 15 days
            </div>
          </div>
          {total > 0 && !confirming && (
            <button
              onClick={() => setConfirming(true)}
              style={{
                padding: '5px 12px', border: '1.5px solid #e2445c', borderRadius: 6,
                fontSize: 12, fontWeight: 600, color: '#e2445c', cursor: 'pointer', background: '#fff',
              }}
            >Empty Trash</button>
          )}
          <button onClick={onClose} style={{ fontSize: 22, color: '#888', cursor: 'pointer', lineHeight: 1, flexShrink: 0 }}>×</button>
        </div>

        {/* Empty-all confirmation bar */}
        {confirming && (
          <div style={{
            padding: '10px 20px', background: '#fff5f7', borderBottom: '1px solid #ffd0d8',
            display: 'flex', alignItems: 'center', gap: 10, flexShrink: 0,
          }}>
            <span style={{ flex: 1, fontSize: 13, color: '#323338', fontWeight: 500 }}>
              Permanently delete all {total} item{total !== 1 ? 's' : ''}? This cannot be undone.
            </span>
            <button
              onClick={handleEmpty}
              style={{ padding: '5px 14px', background: '#e2445c', color: '#fff', borderRadius: 6, fontSize: 12, fontWeight: 700, cursor: 'pointer' }}
            >Yes, delete all</button>
            <button
              onClick={() => setConfirming(false)}
              style={{ padding: '5px 12px', border: '1px solid #ddd', borderRadius: 6, fontSize: 12, color: '#555', cursor: 'pointer' }}
            >Cancel</button>
          </div>
        )}

        {/* Tabs */}
        <div style={{ display: 'flex', borderBottom: '1px solid #e6e9ef', flexShrink: 0 }}>
          {[
            ['boards',  `📋 Boards${boards.length  ? ` (${boards.length})`  : ''}`],
            ['folders', `📁 Folders${folders.length ? ` (${folders.length})` : ''}`],
          ].map(([key, label]) => (
            <button
              key={key}
              onClick={() => setTab(key)}
              style={{
                flex: 1, padding: '10px 0', fontSize: 13, fontWeight: 600,
                color: tab === key ? '#0073ea' : '#676879',
                borderBottom: tab === key ? '2px solid #0073ea' : '2px solid transparent',
                transition: 'color 0.15s',
              }}
            >{label}</button>
          ))}
        </div>

        {/* List */}
        <div style={{ flex: 1, overflowY: 'auto', padding: 12 }}>
          {loading ? (
            <div style={{ textAlign: 'center', padding: 60, color: '#888', fontSize: 13 }}>Loading…</div>
          ) : list.length === 0 ? (
            <div style={{ textAlign: 'center', padding: 60, color: '#888' }}>
              <div style={{ fontSize: 44, marginBottom: 14 }}>🗑️</div>
              <div style={{ fontWeight: 700, fontSize: 15, marginBottom: 6, color: '#323338' }}>
                No trashed {tab} yet
              </div>
              <div style={{ fontSize: 12 }}>Deleted {tab} appear here for 15 days</div>
            </div>
          ) : (
            list.map(entry =>
              tab === 'boards'
                ? <TrashEntry key={`b-${entry.id}`} entry={entry} type="board"  onRestore={handleRestoreBoard}  onDelete={handleDeleteBoard}  />
                : <TrashEntry key={`f-${entry.id}`} entry={entry} type="folder" onRestore={handleRestoreFolder} onDelete={handleDeleteFolder} />
            )
          )}
        </div>
      </div>
    </>
  );
}
