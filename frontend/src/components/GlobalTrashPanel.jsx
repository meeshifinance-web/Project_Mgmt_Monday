import React, { useState, useEffect, useMemo } from 'react';
import {
  getGlobalTrash,
  restoreTrashedBoard, restoreTrashedFolder,
  permanentDeleteBoard, permanentDeleteFolder,
  emptyGlobalTrash,
} from '../api';
import { toISODate } from '../utils/dateFormat';

const daysLeft = (it) => Math.max(0, Math.ceil(Number(it.days_left) || 0));
const formatDate = toISODate;

function relativeTime(dateStr) {
  if (!dateStr) return '';
  const m = Math.floor((Date.now() - new Date(dateStr).getTime()) / 60000);
  if (m < 1)  return 'just now';
  if (m < 60) return `${m} min ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.floor(h / 24);
  return `${d} day${d > 1 ? 's' : ''} ago`;
}
function expiryDate(dateStr) {
  if (!dateStr) return '';
  const dt = new Date(dateStr);
  dt.setDate(dt.getDate() + 15);
  return formatDate(dt.toISOString());
}
const chipStyle = {
  display: 'inline-flex', alignItems: 'center', gap: 4, fontSize: 11, fontWeight: 600,
  padding: '3px 9px', borderRadius: 999, background: 'var(--bg-secondary,#f3f1fb)',
  color: 'var(--text-secondary,#6b7280)', border: '1px solid var(--border-color,#ece9f6)',
};

// ── Trashed entry card ─────────────────────────────────────────────────────────
function TrashEntry({ entry, type, onRestore, onDelete }) {
  const left   = daysLeft(entry);
  const urgent = left <= 3;
  const isBoard = type === 'board';
  const icon    = isBoard ? '📋' : '📁';
  const hasDesc = isBoard && entry.description && String(entry.description).trim();
  const refiled = !isBoard && Array.isArray(entry.board_ids_snapshot) ? entry.board_ids_snapshot.length : 0;

  const Meta = ({ ic, children }) => (
    <div style={{ display: 'flex', gap: 9, alignItems: 'flex-start', fontSize: 12.5, lineHeight: 1.5, color: 'var(--text-secondary,#7b8194)' }}>
      <span style={{ width: 15, textAlign: 'center', flexShrink: 0, opacity: .6 }}>{ic}</span>
      <span style={{ flex: 1, minWidth: 0 }}>{children}</span>
    </div>
  );

  return (
    <div className="gt-card" style={{
      border: '1px solid transparent',
      background: `linear-gradient(var(--bg-primary,#fff),var(--bg-primary,#fff)) padding-box, ${
        urgent
          ? 'linear-gradient(120deg,#f6a9b6,#f6c9d2)'
          : 'linear-gradient(120deg, rgba(155,114,245,.5), rgba(255,143,171,.5))'
      } border-box`,
      borderRadius: 16, padding: 20, display: 'flex', flexDirection: 'column',
    }}>
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 13 }}>
        <div style={{
          width: 44, height: 44, borderRadius: 12, flexShrink: 0, fontSize: 21,
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          background: isBoard
            ? 'linear-gradient(135deg, rgba(155,114,245,.18), rgba(255,143,171,.15))'
            : 'linear-gradient(135deg, rgba(255,179,138,.22), rgba(255,202,128,.18))',
        }}>{icon}</div>

        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 7, marginBottom: 2 }}>
            <span style={{
              fontSize: 9, fontWeight: 800, padding: '2px 7px', borderRadius: 5, letterSpacing: 0.5, textTransform: 'uppercase',
              background: isBoard ? 'rgba(155,114,245,.12)' : 'rgba(176,94,0,.10)',
              color:      isBoard ? '#9b72f5' : '#b05e00',
            }}>{isBoard ? 'Board' : 'Folder'}</span>
            <span style={{
              fontSize: 10.5, fontWeight: 700, padding: '3px 9px', borderRadius: 999, whiteSpace: 'nowrap',
              background: urgent ? '#ffe8ec' : 'rgba(155,114,245,.1)', color: urgent ? '#e2445c' : '#9b72f5',
            }}>{left}d left</span>
          </div>
          <div style={{
            fontWeight: 700, fontSize: 15.5, color: 'var(--text-primary,#1f2d3d)',
            overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
          }}>{entry.name}</div>
        </div>
      </div>

      {/* Chips */}
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginTop: 14 }}>
        {isBoard && <span style={chipStyle}>{entry.visibility === 'org_wide' ? '🌐 Org-wide' : '🔒 Private'}</span>}
        {isBoard && entry.folder_id != null && <span style={chipStyle}>📁 In a folder</span>}
        {!isBoard && <span style={chipStyle}>📋 {refiled} board{refiled === 1 ? '' : 's'}</span>}
      </div>

      {/* Description */}
      {hasDesc && (
        <div style={{
          fontSize: 12.5, color: 'var(--text-secondary,#7b8194)', marginTop: 11, lineHeight: 1.5,
          display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden',
        }}>{entry.description}</div>
      )}

      {/* Divider */}
      <div style={{ height: 1, background: 'var(--border-color,#eef0f5)', margin: '15px 0 13px' }} />

      {/* Meta */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
        <Meta ic="👤">Deleted by <span style={{ color: 'var(--text-primary,#1f2d3d)', fontWeight: 600 }}>{entry.deleted_by_user_name || 'Unknown'}</span> · {formatDate(entry.deleted_at)}</Meta>
        <Meta ic="🗓">Expires <span style={{ color: urgent ? '#e2445c' : 'var(--text-primary,#1f2d3d)', fontWeight: 600 }}>{expiryDate(entry.deleted_at)}</span></Meta>
        {refiled > 0 && <Meta ic="↻"><span style={{ color: '#9b72f5' }}>{refiled} board{refiled > 1 ? 's' : ''} re-filed on restore</span></Meta>}
      </div>

      {/* Actions */}
      <div style={{ display: 'flex', gap: 9, marginTop: 18 }}>
        <button onClick={() => onRestore(entry.id)} className="gt-restore" style={{
          flex: 1, padding: '10px 0', background: '#d8f3e3', color: '#0f9d58', border: '1px solid #b9e8cd',
          borderRadius: 10, fontSize: 13.5, fontWeight: 700, cursor: 'pointer',
        }}>↩ Restore</button>
        <button onClick={() => onDelete(entry.id)} className="gt-delete" title="Permanently delete" style={{
          padding: '10px 18px', border: '1.5px solid #f0bcc6', borderRadius: 10,
          fontSize: 13.5, fontWeight: 700, color: '#e2445c', cursor: 'pointer', background: 'var(--bg-primary,#fff)',
        }}>Delete</button>
      </div>
    </div>
  );
}

// ── Main modal ────────────────────────────────────────────────────────────────
export default function GlobalTrashPanel({ onClose, onBoardRestored, onFolderRestored }) {
  const [boards,  setBoards]  = useState([]);
  const [folders, setFolders] = useState([]);
  const [loading, setLoading] = useState(true);
  const [confirming, setConfirming] = useState(false);
  const [tab, setTab] = useState('all');     // 'all' | 'boards' | 'folders'
  const [query, setQuery] = useState('');

  const load = async () => {
    setLoading(true);
    try { const r = await getGlobalTrash(); setBoards(r.data.boards || []); setFolders(r.data.folders || []); } catch (_) {}
    setLoading(false);
  };
  useEffect(() => { load(); }, []);
  useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);

  const handleRestoreBoard  = async (id) => { try { const r = await restoreTrashedBoard(id);  setBoards(p => p.filter(b => b.id !== id)); onBoardRestored?.(r.data.board); } catch (_) {} };
  const handleRestoreFolder = async (id) => { try { const r = await restoreTrashedFolder(id); setFolders(p => p.filter(f => f.id !== id)); onFolderRestored?.(r.data.folder, r.data.refiledBoardIds); } catch (_) {} };
  const handleDeleteBoard   = async (id) => { try { await permanentDeleteBoard(id);  setBoards(p => p.filter(b => b.id !== id)); } catch (_) {} };
  const handleDeleteFolder  = async (id) => { try { await permanentDeleteFolder(id); setFolders(p => p.filter(f => f.id !== id)); } catch (_) {} };
  const handleEmpty = async () => { try { await emptyGlobalTrash(); setBoards([]); setFolders([]); setConfirming(false); } catch (_) {} };

  const total = boards.length + folders.length;

  // Build the rendered list (with type) for the active tab, filtered by search.
  const items = useMemo(() => {
    let arr = [];
    if (tab !== 'folders') arr = arr.concat(boards.map(e => ({ entry: e, type: 'board' })));
    if (tab !== 'boards')  arr = arr.concat(folders.map(e => ({ entry: e, type: 'folder' })));
    const q = query.trim().toLowerCase();
    if (q) arr = arr.filter(({ entry }) => (entry.name || '').toLowerCase().includes(q));
    return arr;
  }, [boards, folders, tab, query]);

  const NAV = [
    { key: 'all',     icon: '🗂️', label: 'All items', count: total },
    { key: 'boards',  icon: '📋', label: 'Boards',    count: boards.length },
    { key: 'folders', icon: '📁', label: 'Folders',   count: folders.length },
  ];

  return (
    <>
      <div onClick={onClose} style={{
        position: 'fixed', inset: 0, zIndex: 1099,
        background: 'rgba(15,10,25,0.55)', backdropFilter: 'blur(5px)', WebkitBackdropFilter: 'blur(5px)',
      }} />

      <div style={{ position: 'fixed', inset: 0, zIndex: 1100, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24, pointerEvents: 'none' }}>
        <div className="gt-modal" style={{
          pointerEvents: 'auto', width: '100%', maxWidth: 1180, height: '90vh',
          background: 'var(--bg-primary,#fff)', borderRadius: 20, overflow: 'hidden',
          boxShadow: '0 34px 100px rgba(31,45,61,0.32)', display: 'flex',
          fontFamily: 'Figtree, Roboto, -apple-system, sans-serif',
          animation: 'gtRise .3s cubic-bezier(.22,1,.36,1)',
        }}>
          {/* Left rail */}
          <div className="gt-rail" style={{
            width: 248, flexShrink: 0, borderRight: '1px solid var(--border-color,#eef0f5)',
            background: 'linear-gradient(180deg, rgba(155,114,245,.08), rgba(255,143,171,.04))',
            display: 'flex', flexDirection: 'column', padding: '24px 18px',
          }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 22 }}>
              <div style={{
                width: 46, height: 46, borderRadius: 13, fontSize: 23, color: '#fff', flexShrink: 0,
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                background: 'linear-gradient(135deg,#9b72f5,#ff8fab)', boxShadow: '0 8px 22px rgba(155,114,245,.36)',
              }}>🗑️</div>
              <div>
                <div style={{ fontWeight: 800, fontSize: 19, color: 'var(--text-primary,#1f2d3d)' }}>Trash</div>
                <div style={{ fontSize: 11.5, color: 'var(--text-secondary,#7b8194)' }}>Recover or remove</div>
              </div>
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
              {NAV.map(n => {
                const active = tab === n.key;
                return (
                  <button key={n.key} onClick={() => setTab(n.key)} className="gt-nav" style={{
                    display: 'flex', alignItems: 'center', gap: 11, padding: '11px 13px', borderRadius: 11,
                    border: 'none', cursor: 'pointer', textAlign: 'left', width: '100%',
                    fontSize: 14, fontWeight: 700, transition: 'all .15s',
                    background: active ? 'var(--bg-primary,#fff)' : 'transparent',
                    color: active ? '#9b72f5' : 'var(--text-secondary,#6b7280)',
                    boxShadow: active ? '0 4px 14px rgba(155,114,245,.16)' : 'none',
                  }}>
                    <span style={{ fontSize: 17 }}>{n.icon}</span>
                    <span style={{ flex: 1 }}>{n.label}</span>
                    <span style={{
                      fontSize: 11.5, fontWeight: 800, padding: '2px 9px', borderRadius: 999,
                      background: active ? 'rgba(155,114,245,.14)' : 'rgba(123,129,148,.12)',
                      color: active ? '#9b72f5' : 'var(--text-secondary,#7b8194)',
                    }}>{n.count}</span>
                  </button>
                );
              })}
            </div>

            <div style={{ marginTop: 'auto' }}>
              <div style={{ fontSize: 11.5, color: 'var(--text-secondary,#9296a3)', lineHeight: 1.5, marginBottom: 12 }}>
                Items are permanently deleted after <strong>15 days</strong>.
              </div>
              {total > 0 && (
                <button onClick={() => setConfirming(true)} style={{
                  width: '100%', padding: '10px 0', border: '1.5px solid #f0bcc6', borderRadius: 10,
                  fontSize: 13, fontWeight: 700, color: '#e2445c', cursor: 'pointer', background: 'var(--bg-primary,#fff)',
                }}>🗑 Empty Trash</button>
              )}
            </div>
          </div>

          {/* Right content */}
          <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column' }}>
            {/* Top bar: search + close */}
            <div style={{ padding: '18px 24px', borderBottom: '1px solid var(--border-color,#eef0f5)', display: 'flex', alignItems: 'center', gap: 12, flexShrink: 0 }}>
              <div style={{ position: 'relative', flex: 1, maxWidth: 420 }}>
                <span style={{ position: 'absolute', left: 13, top: '50%', transform: 'translateY(-50%)', fontSize: 14, opacity: .5 }}>🔍</span>
                <input
                  value={query} onChange={e => setQuery(e.target.value)} placeholder="Search trash…"
                  style={{
                    width: '100%', padding: '10px 14px 10px 36px', borderRadius: 11, fontSize: 14,
                    border: '1.5px solid var(--border-color,#e7e3f3)', outline: 'none',
                    background: 'var(--input-bg,#fff)', color: 'var(--text-primary,#1f2d3d)', fontFamily: 'inherit',
                  }}
                  onFocus={e => e.currentTarget.style.borderColor = '#9b72f5'}
                  onBlur={e => e.currentTarget.style.borderColor = 'var(--border-color,#e7e3f3)'}
                />
              </div>
              <div style={{ flex: 1 }} />
              <button onClick={onClose} aria-label="Close" style={{
                width: 36, height: 36, borderRadius: '50%', border: 'none', cursor: 'pointer', flexShrink: 0,
                background: 'var(--hover-bg,#f1f0f7)', color: 'var(--text-secondary,#7b8194)', fontSize: 20,
                display: 'flex', alignItems: 'center', justifyContent: 'center',
              }}>×</button>
            </div>

            {/* Confirmation */}
            {confirming && (
              <div style={{ padding: '12px 24px', background: '#fff5f7', borderBottom: '1px solid #ffd0d8', display: 'flex', alignItems: 'center', gap: 12, flexShrink: 0 }}>
                <span style={{ flex: 1, fontSize: 13.5, color: 'var(--text-primary,#1f2d3d)', fontWeight: 600 }}>
                  Permanently delete all {total} item{total !== 1 ? 's' : ''}? This cannot be undone.
                </span>
                <button onClick={handleEmpty} style={{ padding: '7px 16px', background: '#e2445c', color: '#fff', border: 'none', borderRadius: 8, fontSize: 13, fontWeight: 700, cursor: 'pointer' }}>Yes, delete all</button>
                <button onClick={() => setConfirming(false)} style={{ padding: '7px 14px', border: '1px solid var(--border-color,#ddd)', borderRadius: 8, fontSize: 13, color: 'var(--text-secondary,#555)', cursor: 'pointer', background: 'var(--bg-primary,#fff)' }}>Cancel</button>
              </div>
            )}

            {/* Grid body */}
            <div style={{ flex: 1, overflowY: 'auto', padding: '20px 24px 26px', background: 'var(--bg-secondary,#faf9fe)' }}>
              {loading ? (
                <div style={{ textAlign: 'center', padding: 80, color: 'var(--text-secondary,#888)', fontSize: 14 }}>Loading…</div>
              ) : items.length === 0 ? (
                <div style={{ textAlign: 'center', padding: '80px 24px', color: 'var(--text-secondary,#888)' }}>
                  <div style={{ fontSize: 56, marginBottom: 16, opacity: .8 }}>{query ? '🔍' : '🗑️'}</div>
                  <div style={{ fontWeight: 700, fontSize: 17, marginBottom: 6, color: 'var(--text-primary,#1f2d3d)' }}>
                    {query ? 'No matches' : `Trash is empty`}
                  </div>
                  <div style={{ fontSize: 13.5 }}>
                    {query ? 'Try a different search.' : 'Deleted boards and folders appear here for 15 days.'}
                  </div>
                </div>
              ) : (
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(300px, 1fr))', gap: 16 }}>
                  {items.map(({ entry, type }) => (
                    <TrashEntry
                      key={`${type}-${entry.id}`} entry={entry} type={type}
                      onRestore={type === 'board' ? handleRestoreBoard : handleRestoreFolder}
                      onDelete={type === 'board' ? handleDeleteBoard : handleDeleteFolder}
                    />
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>
      </div>

      <style>{`
        @keyframes gtRise { from { opacity:0; transform:translateY(18px) scale(.985) } to { opacity:1; transform:none } }
        .gt-card { transition: transform .15s, box-shadow .15s, border-color .15s; }
        .gt-card:hover { transform: translateY(-3px); box-shadow: 0 12px 30px rgba(155,114,245,.16);
          background: linear-gradient(var(--bg-primary,#fff),var(--bg-primary,#fff)) padding-box, linear-gradient(120deg,#9b72f5,#ff8fab) border-box !important; }
        .gt-restore:hover { background:#c7edd6 !important; border-color:#a6e0c0 !important; }
        .gt-delete:hover { background:#e2445c !important; color:#fff !important; border-color:#e2445c !important; }
        .gt-nav:hover { background: rgba(255,255,255,.6) !important; }
        @media (max-width: 820px){
          .gt-modal{ flex-direction:column; height:92vh; }
          .gt-rail{ width:auto; flex-direction:row; align-items:center; gap:10px; overflow-x:auto; padding:14px 16px; }
          .gt-rail > div:first-child{ margin-bottom:0; }
          .gt-rail > div:nth-child(2){ flex-direction:row; }
          .gt-rail > div:last-child{ margin-top:0; display:flex; align-items:center; gap:10px; }
          .gt-rail > div:last-child > div{ display:none; }
        }
      `}</style>
    </>
  );
}
