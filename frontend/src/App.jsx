import { useThemeContext } from './context/ThemeContext';
import React, { useState, useEffect, useCallback, useRef } from 'react';
import { BrowserRouter, Routes, Route, Navigate, useNavigate, useParams } from 'react-router-dom';
import { AuthProvider, useAuth } from './context/AuthContext';
import { NotificationProvider } from './context/NotificationContext';
import { ToastProvider, useToast } from './components/Toast';
import NotificationBell from './components/NotificationBell';
import Board from './components/Board';
import UserMenu from './components/UserMenu';
import LoginPage from './pages/LoginPage';
import RegisterPage from './pages/RegisterPage';
import ForgotPasswordPage from './pages/ForgotPasswordPage';
import ResetPasswordPage from './pages/ResetPasswordPage';
import ProfilePage from './pages/ProfilePage';
import AuthCallbackPage from './pages/AuthCallbackPage';
import PublicForm from './pages/PublicForm';
import { getBoards, getBoard, createBoard, deleteBoard, updateBoard, getFolders, createFolder, updateFolder, deleteFolder, moveBoardToFolder, cloneBoard } from './api';
import GlobalTrashPanel from './components/GlobalTrashPanel';
import ApiKeysPanel from './components/ApiKeysPanel';

// ── Route guards ──────────────────────────────────────────────────────────────

function ProtectedRoute({ children }) {
  const { user, loading } = useAuth();
  if (loading) return <LoadingScreen />;
  if (!user) return <Navigate to="/login" replace />;
  return children;
}

function PublicRoute({ children }) {
  const { user, loading } = useAuth();
  if (loading) return <LoadingScreen />;
  if (user) return <Navigate to="/" replace />;
  return children;
}

function LoadingScreen() {
  return (
    <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'var(--bg-secondary)' }}>
      <div style={{ textAlign: 'center', color: '#888' }}>
        <div style={{ fontSize: 40, marginBottom: 10 }}>📋</div>
        <div>Loading…</div>
      </div>
    </div>
  );
}

// ── Inline board name editor ──────────────────────────────────────────────────
function BoardNameEditor({ name, onSave }) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(name);

  // Keep draft in sync if parent changes name (e.g. after save)
  React.useEffect(() => { if (!editing) setDraft(name); }, [name, editing]);

  const commit = () => {
    const trimmed = draft.trim();
    if (trimmed && trimmed !== name) onSave(trimmed);
    else setDraft(name);
    setEditing(false);
  };

  if (editing) {
    return (
      <input
        autoFocus
        value={draft}
        onChange={e => setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={e => { if (e.key === 'Enter') commit(); if (e.key === 'Escape') { setDraft(name); setEditing(false); } }}
        style={{
          flex: 1, fontSize: 18, fontWeight: 700, color: 'var(--text-primary)',
          border: '1.5px solid #0073ea', borderRadius: 6, padding: '2px 8px',
          outline: 'none', background: 'var(--input-bg)', maxWidth: 400,
        }}
      />
    );
  }

  return (
    <h1
      onClick={() => { setDraft(name); setEditing(true); }}
      title="Click to rename board"
      style={{
        fontSize: 18, fontWeight: 700, color: 'var(--text-primary)', flex: 1,
        cursor: 'text', borderRadius: 6, padding: '2px 8px',
        border: '1.5px solid transparent',
        transition: 'border-color 0.15s, background 0.15s',
      }}
      onMouseEnter={e => { e.currentTarget.style.borderColor = 'var(--border-color)'; e.currentTarget.style.background = 'var(--hover-bg)'; }}
      onMouseLeave={e => { e.currentTarget.style.borderColor = 'transparent'; e.currentTarget.style.background = 'transparent'; }}
    >
      {name}
      <span style={{ fontSize: 12, color: 'var(--text-muted)', marginLeft: 6, fontWeight: 400 }}>✎</span>
    </h1>
  );
}

// ── Clone Board Modal ─────────────────────────────────────────────────────────

function CloneModal({ board, onClose, onCloned }) {
  const [name, setName] = useState(`Copy of ${board.name}`);
  const [includeGroups, setIncludeGroups] = useState(true);
  const [includeItems, setIncludeItems] = useState(true);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const toast = useToast();

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!name.trim()) return;
    setLoading(true);
    setError(null);
    try {
      const result = await cloneBoard(board.id, {
        name: name.trim(),
        includeColumns: true,
        includeGroups,
        includeItems: includeGroups && includeItems,
      });
      onCloned(result.board);
    } catch (err) {
      setError(err.response?.data?.error || 'Failed to duplicate board. Please try again.');
      setLoading(false);
    }
  };

  // Close on overlay click or Escape
  React.useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);

  const overlayStyle = {
    position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)',
    zIndex: 1000, display: 'flex', alignItems: 'center', justifyContent: 'center',
    padding: 16,
  };
  const modalStyle = {
    background: 'var(--bg-primary)', borderRadius: 10, width: '100%', maxWidth: 420,
    boxShadow: '0 8px 40px rgba(0,0,0,0.28)', display: 'flex', flexDirection: 'column',
    overflow: 'hidden',
  };
  const cbRow = { display: 'flex', alignItems: 'center', gap: 10, padding: '8px 0', cursor: 'pointer' };
  const cbBox = (checked, disabled) => ({
    width: 18, height: 18, borderRadius: 4, border: `2px solid ${checked ? '#0073ea' : '#c5c7d4'}`,
    background: checked ? '#0073ea' : 'transparent', display: 'flex', alignItems: 'center',
    justifyContent: 'center', flexShrink: 0, opacity: disabled ? 0.5 : 1,
    transition: 'all 0.12s',
  });

  return (
    <div style={overlayStyle} onClick={onClose}>
      <div style={modalStyle} onClick={e => e.stopPropagation()}>
        {/* Header */}
        <div style={{ padding: '20px 24px 16px', borderBottom: '1px solid var(--border-color)' }}>
          <div style={{ fontWeight: 700, fontSize: 17, color: 'var(--text-primary)' }}>Duplicate Board</div>
          <div style={{ fontSize: 13, color: 'var(--text-secondary)', marginTop: 4 }}>
            Creating a copy of: <strong>{board.name}</strong>
          </div>
        </div>

        {/* Body */}
        <form onSubmit={handleSubmit}>
          <div style={{ padding: '20px 24px', display: 'flex', flexDirection: 'column', gap: 18 }}>
            {/* Board name input */}
            <div>
              <label style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-secondary)', display: 'block', marginBottom: 6 }}>
                New board name
              </label>
              <input
                autoFocus
                value={name}
                onChange={e => setName(e.target.value)}
                style={{
                  width: '100%', padding: '8px 12px', borderRadius: 6, fontSize: 14,
                  border: '1.5px solid var(--border-color)', background: 'var(--input-bg)',
                  color: 'var(--text-primary)', outline: 'none', boxSizing: 'border-box',
                }}
                onFocus={e => e.currentTarget.style.borderColor = '#0073ea'}
                onBlur={e => e.currentTarget.style.borderColor = 'var(--border-color)'}
              />
            </div>

            {/* Checkboxes */}
            <div>
              <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-secondary)', marginBottom: 4 }}>
                What to include
              </div>

              {/* Structure — always checked, disabled */}
              <label style={{ ...cbRow, cursor: 'default', opacity: 0.7 }}>
                <div style={cbBox(true, true)}>
                  <span style={{ color: '#fff', fontSize: 11, fontWeight: 700 }}>✓</span>
                </div>
                <span style={{ fontSize: 14, color: 'var(--text-primary)' }}>Board structure &amp; columns</span>
              </label>

              {/* Groups */}
              <label style={cbRow} onClick={() => setIncludeGroups(v => !v)}>
                <div style={cbBox(includeGroups, false)}>
                  {includeGroups && <span style={{ color: '#fff', fontSize: 11, fontWeight: 700 }}>✓</span>}
                </div>
                <span style={{ fontSize: 14, color: 'var(--text-primary)' }}>Groups / Swimlanes</span>
              </label>

              {/* Items — disabled if groups unchecked */}
              <label
                style={{ ...cbRow, paddingLeft: 24, opacity: includeGroups ? 1 : 0.4, cursor: includeGroups ? 'pointer' : 'default' }}
                onClick={() => { if (includeGroups) setIncludeItems(v => !v); }}
              >
                <div style={cbBox(includeItems && includeGroups, !includeGroups)}>
                  {includeItems && includeGroups && <span style={{ color: '#fff', fontSize: 11, fontWeight: 700 }}>✓</span>}
                </div>
                <span style={{ fontSize: 14, color: 'var(--text-primary)' }}>Items &amp; tasks</span>
              </label>
            </div>

            <div style={{ fontSize: 12, color: 'var(--text-secondary)', fontStyle: 'italic' }}>
              Items will be copied without assignees or comments.
            </div>

            {error && (
              <div style={{ fontSize: 13, color: '#e2445c', background: '#fff5f7', padding: '8px 12px', borderRadius: 6, border: '1px solid #f5c0ca' }}>
                {error}
              </div>
            )}
          </div>

          {/* Footer */}
          <div style={{ padding: '12px 24px 20px', display: 'flex', justifyContent: 'flex-end', gap: 10, borderTop: '1px solid var(--border-color)' }}>
            <button
              type="button"
              onClick={onClose}
              disabled={loading}
              style={{
                padding: '8px 18px', borderRadius: 6, fontWeight: 600, fontSize: 14,
                border: '1.5px solid var(--border-color)', background: 'var(--bg-primary)',
                color: 'var(--text-secondary)', cursor: 'pointer',
              }}
            >Cancel</button>
            <button
              type="submit"
              disabled={loading || !name.trim()}
              style={{
                padding: '8px 18px', borderRadius: 6, fontWeight: 600, fontSize: 14,
                border: 'none', background: loading ? '#a0c4f1' : '#0073ea',
                color: '#fff', cursor: loading ? 'not-allowed' : 'pointer',
                display: 'flex', alignItems: 'center', gap: 6,
              }}
            >
              {loading ? (
                <>
                  <span style={{ display: 'inline-block', width: 14, height: 14, border: '2px solid rgba(255,255,255,0.4)', borderTopColor: '#fff', borderRadius: '50%', animation: 'spin 0.6s linear infinite' }} />
                  Duplicating…
                </>
              ) : 'Duplicate Board →'}
            </button>
          </div>
        </form>
      </div>
      <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
    </div>
  );
}

// ── Main board app (authenticated) ───────────────────────────────────────────

function MainApp() {
  const [boards, setBoards] = useState([]);
  const [activeBoard, setActiveBoard] = useState(null);
  const [loading, setLoading] = useState(true);
  const [openItemId, setOpenItemId] = useState(null);
  const [newBoardName, setNewBoardName] = useState('');
  const [newBoardVisibility, setNewBoardVisibility] = useState('private');
  const [showNewBoard, setShowNewBoard] = useState(false);
  const [folders, setFolders] = useState([]);
  const [collapsedFolders, setCollapsedFolders] = useState(new Set());
  const [renamingFolderId, setRenamingFolderId] = useState(null);
  const [renameFolderDraft, setRenameFolderDraft] = useState('');
  const [showGlobalTrash, setShowGlobalTrash] = useState(false);
  const [showApiKeys, setShowApiKeys] = useState(false);
  const [boardMenuId, setBoardMenuId] = useState(null);
  const [isNavCollapsed, setIsNavCollapsed] = useState(() => localStorage.getItem('workboard_nav_collapsed') === 'true');
  const [mobileNavOpen, setMobileNavOpen] = useState(false);
  const [cloneTargetBoard, setCloneTargetBoard] = useState(null);
  const { resolvedTheme } = useThemeContext();
  const isDark = resolvedTheme === 'dark';

  const toggleNav = () => setIsNavCollapsed(v => {
    const next = !v;
    localStorage.setItem('workboard_nav_collapsed', String(next));
    return next;
  });
  const newBoardFormRef = useRef(null);
  const { user: currentUser, isManager, isAdmin } = useAuth();
  const toast = useToast();
  const navigate = useNavigate();
  const { boardId: urlBoardId } = useParams();

  const closeNewBoard = () => { setShowNewBoard(false); setNewBoardName(''); setNewBoardVisibility('private'); };

  useEffect(() => {
    if (!showNewBoard) return;
    const onMouseDown = (e) => { if (newBoardFormRef.current && !newBoardFormRef.current.contains(e.target)) closeNewBoard(); };
    const onKeyDown = (e) => { if (e.key === 'Escape') closeNewBoard(); };
    document.addEventListener('mousedown', onMouseDown);
    document.addEventListener('keydown', onKeyDown);
    return () => { document.removeEventListener('mousedown', onMouseDown); document.removeEventListener('keydown', onKeyDown); };
  }, [showNewBoard]);

  // Close board ⋯ menu on outside click
  useEffect(() => {
    if (!boardMenuId) return;
    const close = () => setBoardMenuId(null);
    document.addEventListener('mousedown', close);
    return () => document.removeEventListener('mousedown', close);
  }, [boardMenuId]);

  // Auto-close mobile drawer when viewport grows to desktop width
  useEffect(() => {
    const mq = window.matchMedia('(max-width: 768px)');
    const handler = (e) => { if (!e.matches) setMobileNavOpen(false); };
    mq.addEventListener('change', handler);
    return () => mq.removeEventListener('change', handler);
  }, []);

  useEffect(() => {
    Promise.all([getBoards(), getFolders()])
      .then(([boardsRes, foldersRes]) => {
        setBoards(boardsRes.data);
        setFolders(foldersRes.data);
        if (urlBoardId) {
          const target = boardsRes.data.find(b => String(b.id) === String(urlBoardId));
          if (target) {
            loadBoard(target.id);
          } else {
            toast('Board not found or you don\'t have access', 'error');
            navigate('/', { replace: true });
            setLoading(false);
          }
        } else if (boardsRes.data.length > 0) {
          loadBoard(boardsRes.data[0].id);
        } else {
          setLoading(false);
        }
      })
      .catch(() => { toast('Failed to load boards', 'error'); setLoading(false); });
  }, []);

  const loadBoard = async (id) => {
    setLoading(true);
    try {
      const r = await getBoard(id);
      setActiveBoard(r.data);
    } catch {
      toast('Failed to load board', 'error');
    } finally {
      setLoading(false);
    }
  };

  const handleOpenItem = useCallback(({ board_id, item_id }) => {
    setOpenItemId(item_id);
    if (activeBoard?.id !== board_id) loadBoard(board_id);
  }, [activeBoard?.id]);

  const handleCreateBoard = async (e) => {
    e.preventDefault();
    if (!newBoardName.trim()) return;
    try {
      const r = await createBoard({ name: newBoardName.trim(), visibility: newBoardVisibility });
      setBoards(b => [...b, r.data]);
      setNewBoardName('');
      setNewBoardVisibility('private');
      setShowNewBoard(false);
      loadBoard(r.data.id);
      navigate(`/board/${r.data.id}`, { replace: true });
      toast('Board created', 'success');
    } catch (err) {
      toast(err.response?.data?.error || 'Failed to create board', 'error');
    }
  };

  const handleDeleteBoard = async (id) => {
    try {
      await deleteBoard(id);
      const remaining = boards.filter(b => b.id !== id);
      setBoards(remaining);
      if (activeBoard?.id === id) {
        if (remaining.length) {
          loadBoard(remaining[0].id);
          navigate(`/board/${remaining[0].id}`, { replace: true });
        } else {
          setActiveBoard(null);
          navigate('/', { replace: true });
        }
      }
      toast('Board moved to trash · restores within 15 days');
    } catch (err) {
      toast(err.response?.data?.error || 'Failed to delete board', 'error');
    }
  };

  const handleBoardRename = async (id, newName) => {
    if (!newName.trim()) return;
    try {
      const board = boards.find(b => b.id === id) || activeBoard;
      const r = await updateBoard(id, { name: newName.trim(), description: board?.description, visibility: board?.visibility || 'private' });
      setBoards(bs => bs.map(b => b.id === id ? { ...b, name: r.data.name } : b));
      if (activeBoard?.id === id) setActiveBoard(prev => ({ ...prev, name: r.data.name }));
      toast('Board renamed', 'success');
    } catch { toast('Failed to rename board', 'error'); }
  };

  const handleBoardChange = useCallback((updater) => {
    setActiveBoard(prev => {
      const next = updater(prev);
      if (next.visibility !== prev?.visibility || next.name !== prev?.name) {
        setBoards(bs => bs.map(b => b.id === next.id ? { ...b, visibility: next.visibility, name: next.name } : b));
      }
      return next;
    });
  }, []);

  // ── Folder handlers ──────────────────────────────────────────────────────────
  const handleCreateFolder = async () => {
    const name = prompt('Folder name:');
    if (!name?.trim()) return;
    try {
      const r = await createFolder(name.trim());
      setFolders(f => [...f, r.data]);
      toast('Folder created', 'success');
    } catch { toast('Failed to create folder', 'error'); }
  };

  const handleRenameFolder = async (id) => {
    const trimmed = renameFolderDraft.trim();
    setRenamingFolderId(null);
    if (!trimmed) return;
    try {
      const r = await updateFolder(id, trimmed);
      setFolders(f => f.map(x => x.id === id ? r.data : x));
    } catch { toast('Failed to rename folder', 'error'); }
  };

  const handleDeleteFolder = async (id) => {
    try {
      const r = await deleteFolder(id);
      setFolders(f => f.filter(x => x.id !== id));
      // Unfile boards that were in this folder
      if (r.data.unfiledBoardIds?.length) {
        setBoards(bs => bs.map(b => r.data.unfiledBoardIds.includes(b.id) ? { ...b, folder_id: null } : b));
      }
      toast('Folder moved to trash · restores within 15 days');
    } catch { toast('Failed to delete folder', 'error'); }
  };

  const handleMoveBoard = async (boardId, folderId) => {
    try {
      const r = await moveBoardToFolder(boardId, folderId);
      setBoards(bs => bs.map(b => b.id === boardId ? { ...b, folder_id: r.data.folder_id } : b));
      setBoardMenuId(null);
      toast('Board moved', 'success');
    } catch { toast('Failed to move board', 'error'); }
  };

  // ── Sidebar board row renderer ────────────────────────────────────────────────
  const renderBoardRow = (b, indent = false) => {
    const isActive = activeBoard?.id === b.id;
    const menuOpen = boardMenuId === b.id;

    // Collapsed: icon-only with tooltip
    if (isNavCollapsed) {
      return (
        <div
          key={b.id}
          onClick={() => { loadBoard(b.id); navigate(`/board/${b.id}`, { replace: true }); setMobileNavOpen(false); }}
          title={b.name}
          style={{
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            cursor: 'pointer', height: 36,
            background: isActive ? 'var(--sidebar-active-bg)' : 'transparent',
            borderLeft: isActive ? '3px solid #0073ea' : '3px solid transparent',
          }}
          onMouseEnter={e => { if (!isActive) e.currentTarget.style.background = 'var(--sidebar-hover)'; }}
          onMouseLeave={e => { e.currentTarget.style.background = isActive ? 'var(--sidebar-active-bg)' : 'transparent'; }}
        >
          <span style={{ fontSize: 12 }}>
            {b.visibility === 'private' ? '🔒' : '🌐'}
          </span>
        </div>
      );
    }

    return (
      <div key={b.id} style={{ position: 'relative' }}>
        <div
          onClick={() => { loadBoard(b.id); navigate(`/board/${b.id}`, { replace: true }); setMobileNavOpen(false); }}
          style={{
            display: 'flex', alignItems: 'center', cursor: 'pointer',
            padding: indent ? '6px 16px 6px 28px' : '6px 16px',
            background: isActive ? 'var(--sidebar-active-bg)' : 'transparent',
            borderLeft: isActive ? '3px solid #0073ea' : '3px solid transparent',
          }}
          onMouseEnter={e => { if (!isActive) e.currentTarget.style.background = 'var(--sidebar-hover)'; }}
          onMouseLeave={e => { if (!isActive) e.currentTarget.style.background = 'transparent'; }}
        >
          <span style={{ fontSize: 10, marginRight: 5, color: 'var(--sidebar-text-muted)' }} title={b.visibility === 'private' ? 'Private' : 'Org-wide'}>
            {b.visibility === 'private' ? '🔒' : '🌐'}
          </span>
          <span style={{
            fontSize: 12, flex: 1, color: isActive ? 'var(--primary-blue)' : 'var(--sidebar-text)',
            fontWeight: isActive ? 600 : 400,
            overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
          }}>
            {b.name}
          </span>
          {isManager && (
            <button
              onClick={e => { e.stopPropagation(); setBoardMenuId(menuOpen ? null : b.id); }}
              style={{ color: 'var(--sidebar-text-muted)', fontSize: 16, flexShrink: 0, lineHeight: 1, padding: '0 2px' }}
              title="Board options"
            >⋯</button>
          )}
        </div>

        {/* Board options menu */}
        {menuOpen && (
          <div
            onMouseDown={e => e.stopPropagation()}
            style={{
              position: 'absolute', left: 16, top: '100%', zIndex: 200,
              background: '#fff', borderRadius: 8, boxShadow: '0 4px 16px rgba(0,0,0,0.18)',
              padding: '6px 0', minWidth: 160, color: '#323338',
            }}
          >
            <div style={{ fontSize: 10, color: '#888', padding: '4px 12px 2px', textTransform: 'uppercase', letterSpacing: 0.5 }}>Move to</div>
            {b.folder_id && (
              <div
                onClick={() => handleMoveBoard(b.id, null)}
                style={{ padding: '6px 12px', fontSize: 12, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 6 }}
                onMouseEnter={e => e.currentTarget.style.background = '#f5f6f8'}
                onMouseLeave={e => e.currentTarget.style.background = 'transparent'}
              >
                <span style={{ opacity: 0.5 }}>📂</span> No Folder
              </div>
            )}
            {folders.map(f => f.id !== b.folder_id ? (
              <div
                key={f.id}
                onClick={() => handleMoveBoard(b.id, f.id)}
                style={{ padding: '6px 12px', fontSize: 12, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 6 }}
                onMouseEnter={e => e.currentTarget.style.background = '#f5f6f8'}
                onMouseLeave={e => e.currentTarget.style.background = 'transparent'}
              >
                <span>📁</span> {f.name}
              </div>
            ) : null)}
            {folders.length === 0 && !b.folder_id && (
              <div style={{ padding: '6px 12px', fontSize: 11, color: '#aaa', fontStyle: 'italic' }}>No folders yet</div>
            )}
            {isManager && (
              <>
                <div style={{ borderTop: '1px solid #eee', margin: '4px 0' }} />
                <div
                  onClick={() => { setBoardMenuId(null); setCloneTargetBoard(b); }}
                  style={{ padding: '6px 12px', fontSize: 12, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 6 }}
                  onMouseEnter={e => e.currentTarget.style.background = '#f5f6f8'}
                  onMouseLeave={e => e.currentTarget.style.background = 'transparent'}
                >
                  📋 Duplicate Board
                </div>
              </>
            )}
            {isAdmin && (
              <>
                <div style={{ borderTop: '1px solid #eee', margin: '4px 0' }} />
                <div
                  onClick={() => { setBoardMenuId(null); handleDeleteBoard(b.id); }}
                  style={{ padding: '6px 12px', fontSize: 12, cursor: 'pointer', color: '#e44' }}
                  onMouseEnter={e => e.currentTarget.style.background = '#fff5f5'}
                  onMouseLeave={e => e.currentTarget.style.background = 'transparent'}
                >
                  Delete board
                </div>
              </>
            )}
          </div>
        )}
      </div>
    );
  };

  // Group boards by folder
  const boardsByFolder = {};
  const unfiledBoards = [];
  for (const b of boards) {
    if (b.folder_id) {
      if (!boardsByFolder[b.folder_id]) boardsByFolder[b.folder_id] = [];
      boardsByFolder[b.folder_id].push(b);
    } else {
      unfiledBoards.push(b);
    }
  }

  return (
    <div style={{ display: 'flex', height: '100vh', overflow: 'hidden' }}>
      {/* Mobile drawer overlay */}
      {mobileNavOpen && (
        <div className="sidebar-overlay" onClick={() => setMobileNavOpen(false)} />
      )}

      {/* Sidebar */}
      <div
        className={`app-sidebar${mobileNavOpen ? ' sidebar-open' : ''}`}
        style={{
          width: isNavCollapsed ? 48 : 230,
          background: 'var(--bg-sidebar)',
          color: 'var(--sidebar-text)',
          display: 'flex',
          flexDirection: 'column',
          flexShrink: 0,
          transition: 'width 0.2s ease',
          overflow: 'hidden',
          borderRight: '1px solid var(--border-color)',
        }}
      >
        <div style={{
          padding: isNavCollapsed ? '14px 0' : '14px 12px 14px 16px',
          borderBottom: '1px solid var(--sidebar-border)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: isNavCollapsed ? 'center' : 'space-between',
          flexShrink: 0,
          minHeight: 56,
        }}>
          {!isNavCollapsed && (
            <div>
              <img
                src="/ddecor-logo.png"
                alt="D'Decor"
                style={{ height: 64, width: 'auto', objectFit: 'contain', display: 'block', filter: isDark ? 'brightness(0) invert(1)' : 'none', }}
              />
              <div style={{ fontSize: 14, color: 'var(--sidebar-text)', marginTop: 4, letterSpacing: 0.3, fontWeight: 1600, textAlign: 'center' }}>
                TUESDAY.COM
              </div>
            </div>

          )}
          {isNavCollapsed && (
            <img src="/ddecor-logo.png" alt="D'Decor" style={{ height: 24, width: 'auto', objectFit: 'contain', display: 'block', filter: isDark ? 'brightness(0) invert(1)' : 'none', }} title="TUESDAY.COM" />
          )}
          {!isNavCollapsed && (
            <div style={{ display: 'flex', alignItems: 'center', gap: 4, flexShrink: 0 }}>
              {/* Mobile close button */}
              <button
                className="sidebar-close-btn"
                onClick={() => setMobileNavOpen(false)}
                title="Close navigation"
                aria-label="Close navigation"
              >×</button>
              {/* Desktop collapse button */}
              <button
                onClick={toggleNav}
                title="Collapse sidebar"
                style={{
                  width: 28, height: 28, borderRadius: '50%', flexShrink: 0,
                  background: 'var(--sidebar-btn-bg)',
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  color: 'var(--sidebar-text)', fontSize: 14, transition: 'background 0.15s',
                }}
                onMouseEnter={e => e.currentTarget.style.background = 'var(--sidebar-btn-hover)'}
                onMouseLeave={e => e.currentTarget.style.background = 'var(--sidebar-btn-bg)'}
              >‹</button>
            </div>
          )}
        </div>

        {/* Expand button shown when collapsed */}
        {isNavCollapsed && (
          <div style={{ display: 'flex', justifyContent: 'center', padding: '6px 0', borderBottom: '1px solid var(--sidebar-border)' }}>
            <button
              onClick={toggleNav}
              title="Expand sidebar"
              style={{
                width: 28, height: 28, borderRadius: '50%',
                background: 'var(--sidebar-btn-bg)',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                color: 'var(--sidebar-text)', fontSize: 14, transition: 'background 0.15s',
              }}
              onMouseEnter={e => e.currentTarget.style.background = 'var(--sidebar-btn-hover)'}
              onMouseLeave={e => e.currentTarget.style.background = 'var(--sidebar-btn-bg)'}
            >›</button>
          </div>
        )}

        <div style={{ flex: 1, overflowY: 'auto', padding: '8px 0' }}>
          {/* Header row */}
          {!isNavCollapsed && (
            <div style={{ padding: '6px 16px 4px', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <span style={{ fontSize: 11, color: 'var(--sidebar-text-muted)', textTransform: 'uppercase', letterSpacing: 1 }}>
                {isAdmin ? 'All Boards' : 'Boards'}
              </span>
              {isAdmin && (
                <span style={{ fontSize: 10, background: 'rgba(253,171,61,0.15)', color: '#fdab3d', borderRadius: 4, padding: '1px 5px', fontWeight: 700, letterSpacing: 0.3 }}>
                  ADMIN
                </span>
              )}
            </div>
          )}

          {/* Folders with their boards */}
          {folders.map(folder => {
            const folderBoards = boardsByFolder[folder.id] || [];
            const collapsed = collapsedFolders.has(folder.id);
            const isRenaming = renamingFolderId === folder.id;
            return (
              <div key={folder.id}>
                {/* Folder header — collapsed nav: icon only */}
                {isNavCollapsed ? (
                  <div
                    onClick={() => setCollapsedFolders(s => { const n = new Set(s); n.has(folder.id) ? n.delete(folder.id) : n.add(folder.id); return n; })}
                    title={folder.name}
                    style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: 36, cursor: 'pointer' }}
                    onMouseEnter={e => e.currentTarget.style.background = 'var(--sidebar-hover)'}
                    onMouseLeave={e => e.currentTarget.style.background = 'transparent'}
                  >
                    <span style={{ fontSize: 14 }}>📁</span>
                  </div>
                ) : (
                  <div
                    style={{ display: 'flex', alignItems: 'center', padding: '5px 16px', cursor: 'pointer', gap: 4 }}
                    onMouseEnter={e => e.currentTarget.style.background = 'var(--sidebar-hover)'}
                    onMouseLeave={e => e.currentTarget.style.background = 'transparent'}
                  >
                    <span
                      onClick={() => setCollapsedFolders(s => { const n = new Set(s); n.has(folder.id) ? n.delete(folder.id) : n.add(folder.id); return n; })}
                      style={{ fontSize: 10, color: 'var(--sidebar-text-muted)', marginRight: 2, userSelect: 'none', flexShrink: 0 }}
                    >
                      {collapsed ? '▶' : '▼'}
                    </span>
                    <span style={{ fontSize: 12, color: 'var(--sidebar-text-muted)', flexShrink: 0 }}>📁</span>
                    {isRenaming ? (
                      <input
                        autoFocus
                        value={renameFolderDraft}
                        onChange={e => setRenameFolderDraft(e.target.value)}
                        onBlur={() => handleRenameFolder(folder.id)}
                        onKeyDown={e => { if (e.key === 'Enter') handleRenameFolder(folder.id); if (e.key === 'Escape') setRenamingFolderId(null); }}
                        onClick={e => e.stopPropagation()}
                        style={{
                          flex: 1, background: 'var(--sidebar-input-bg)', border: '1px solid var(--sidebar-input-border)',
                          color: 'var(--sidebar-text)', borderRadius: 4, padding: '1px 6px', fontSize: 12, outline: 'none',
                        }}
                      />
                    ) : (
                      <span
                        onDoubleClick={isManager ? () => { setRenamingFolderId(folder.id); setRenameFolderDraft(folder.name); } : undefined}
                        onClick={() => setCollapsedFolders(s => { const n = new Set(s); n.has(folder.id) ? n.delete(folder.id) : n.add(folder.id); return n; })}
                        style={{ flex: 1, fontSize: 12, color: 'var(--sidebar-text)', fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}
                        title={isManager ? 'Double-click to rename' : undefined}
                      >
                        {folder.name}
                        {folderBoards.length > 0 && (
                          <span style={{ fontSize: 10, color: 'var(--sidebar-text-muted)', marginLeft: 4, fontWeight: 400 }}>
                            ({folderBoards.length})
                          </span>
                        )}
                      </span>
                    )}
                    {isManager && !isRenaming && (
                      <>
                        <button
                          onClick={e => { e.stopPropagation(); setRenamingFolderId(folder.id); setRenameFolderDraft(folder.name); }}
                          style={{ color: 'var(--sidebar-text-muted)', fontSize: 12, flexShrink: 0, padding: '0 2px', lineHeight: 1 }}
                          title="Rename folder"
                        >✏️</button>
                        <button
                          onClick={e => { e.stopPropagation(); handleDeleteFolder(folder.id); }}
                          style={{ color: 'var(--sidebar-text-muted)', fontSize: 14, flexShrink: 0, padding: '0 2px' }}
                          title="Delete folder"
                        >×</button>
                      </>
                    )}
                  </div>
                )}

                {/* Boards inside this folder */}
                {!collapsed && folderBoards.map(b => renderBoardRow(b, !isNavCollapsed))}
              </div>
            );
          })}

          {/* Unfiled boards */}
          {unfiledBoards.length > 0 && (
            <>
              {folders.length > 0 && !isNavCollapsed && (
                <div style={{ padding: '8px 16px 2px', fontSize: 10, color: 'var(--sidebar-text-muted)', textTransform: 'uppercase', letterSpacing: 0.5 }}>
                  No Folder
                </div>
              )}
              {unfiledBoards.map(b => renderBoardRow(b, false))}
            </>
          )}

          {/* New board form / button */}
          {isNavCollapsed ? (
            isManager && (
              <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', padding: '6px 0', gap: 4 }}>
                <button
                  onClick={() => { setIsNavCollapsed(false); localStorage.setItem('workboard_nav_collapsed', 'false'); setTimeout(() => setShowNewBoard(true), 220); }}
                  title="New Board"
                  style={{
                    width: 30, height: 30, borderRadius: '50%', fontSize: 18, fontWeight: 300,
                    background: 'var(--sidebar-btn-bg)', color: 'var(--sidebar-text)',
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                    transition: 'background 0.15s',
                  }}
                  onMouseEnter={e => e.currentTarget.style.background = 'var(--sidebar-btn-hover)'}
                  onMouseLeave={e => e.currentTarget.style.background = 'var(--sidebar-btn-bg)'}
                >+</button>
              </div>
            )
          ) : showNewBoard ? (
            <form ref={newBoardFormRef} onSubmit={handleCreateBoard} style={{ padding: '8px 12px', marginTop: 4 }}>
              <input
                autoFocus value={newBoardName} onChange={e => setNewBoardName(e.target.value)}
                placeholder="Board name…"
                style={{
                  width: '100%', border: '1px solid var(--sidebar-input-border)', background: 'var(--sidebar-input-bg)',
                  color: 'var(--sidebar-text)', borderRadius: 6, padding: '6px 8px', outline: 'none', fontSize: 13,
                  marginBottom: 6, boxSizing: 'border-box',
                }}
              />
              <div style={{ display: 'flex', gap: 6 }}>
                {['org_wide', 'private'].map(v => (
                  <button
                    key={v} type="button"
                    onClick={() => setNewBoardVisibility(v)}
                    style={{
                      flex: 1, padding: '4px 0', borderRadius: 5, fontSize: 11, fontWeight: 600,
                      border: `1.5px solid ${newBoardVisibility === v ? '#0073ea' : 'var(--sidebar-input-border)'}`,
                      background: newBoardVisibility === v ? '#0073ea' : 'transparent',
                      color: newBoardVisibility === v ? '#fff' : 'var(--sidebar-text-muted)',
                    }}
                  >
                    {v === 'org_wide' ? '🌐 Org' : '🔒 Private'}
                  </button>
                ))}
              </div>
              <button type="submit" style={{
                width: '100%', marginTop: 6, padding: '5px 0',
                background: '#0073ea', color: '#fff', borderRadius: 5, fontSize: 12, fontWeight: 600,
              }}>Create Board</button>
            </form>
          ) : isManager ? (
            <div style={{ padding: '4px 0' }}>
              <button
                onClick={() => setShowNewBoard(true)}
                style={{ width: '100%', padding: '7px 16px', textAlign: 'left', color: 'var(--sidebar-text-muted)', fontSize: 12 }}
                onMouseEnter={e => e.currentTarget.style.background = 'var(--sidebar-hover)'}
                onMouseLeave={e => e.currentTarget.style.background = 'transparent'}
              >
                + New Board
              </button>
              <button
                onClick={handleCreateFolder}
                style={{ width: '100%', padding: '7px 16px', textAlign: 'left', color: 'var(--sidebar-text-muted)', fontSize: 12 }}
                onMouseEnter={e => e.currentTarget.style.background = 'var(--sidebar-hover)'}
                onMouseLeave={e => e.currentTarget.style.background = 'transparent'}
              >
                + New Folder
              </button>
            </div>
          ) : null}
        </div>

        {isAdmin && (
          <div style={{ padding: isNavCollapsed ? '8px 0' : '8px 16px', borderTop: '1px solid var(--sidebar-border)', display: 'flex', flexDirection: 'column', alignItems: isNavCollapsed ? 'center' : 'flex-start', gap: 2 }}>
            <button
              onClick={() => setShowGlobalTrash(true)}
              title="Trash"
              style={{
                textAlign: isNavCollapsed ? 'center' : 'left',
                padding: isNavCollapsed ? '7px 0' : '7px 4px',
                fontSize: 12, color: 'var(--sidebar-text-muted)',
                display: 'flex', alignItems: 'center', gap: isNavCollapsed ? 0 : 6,
                width: '100%',
              }}
              onMouseEnter={e => e.currentTarget.style.color = 'var(--sidebar-text)'}
              onMouseLeave={e => e.currentTarget.style.color = 'var(--sidebar-text-muted)'}
            >
              🗑️{!isNavCollapsed && ' Trash'}
            </button>
            <button
              onClick={() => setShowApiKeys(true)}
              title="API Keys"
              style={{
                textAlign: isNavCollapsed ? 'center' : 'left',
                padding: isNavCollapsed ? '7px 0' : '7px 4px',
                fontSize: 12, color: 'var(--sidebar-text-muted)',
                display: 'flex', alignItems: 'center', gap: isNavCollapsed ? 0 : 6,
                width: '100%',
              }}
              onMouseEnter={e => e.currentTarget.style.color = 'var(--sidebar-text)'}
              onMouseLeave={e => e.currentTarget.style.color = 'var(--sidebar-text-muted)'}
            >
              🔑{!isNavCollapsed && ' API Keys'}
            </button>
          </div>
        )}
        {!isNavCollapsed && (
          <div style={{ padding: '8px 16px', borderTop: '1px solid var(--sidebar-border)', fontSize: 11, color: 'var(--sidebar-text-muted)', whiteSpace: 'nowrap' }}>
            D'Decor Home Fabrics
          </div>
        )}
      </div>

      {/* Main content */}
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden', background: 'var(--bg-secondary)' }}>
        {/* Top bar */}
        <div
          className="app-topbar"
          style={{
            background: 'var(--bg-primary)', borderBottom: '1px solid var(--border-color)',
            padding: '0 20px', height: 52, display: 'flex', alignItems: 'center', gap: 10,
          }}
        >
          {/* Hamburger — mobile only */}
          <button
            className="mobile-hamburger"
            onClick={() => setMobileNavOpen(true)}
            aria-label="Open navigation"
          >☰</button>

          {activeBoard && isManager
            ? <BoardNameEditor name={activeBoard.name} onSave={name => handleBoardRename(activeBoard.id, name)} />
            : <h1 style={{ fontSize: 18, fontWeight: 700, color: 'var(--text-primary)', flex: 1 }}>{activeBoard?.name || 'Select a Board'}</h1>
          }
          {isAdmin && activeBoard && !activeBoard.members?.some(m => m.id === currentUser?.id) && (
            <span style={{
              fontSize: 11, fontWeight: 700, padding: '3px 8px', borderRadius: 5,
              background: '#fff4e0', color: '#b05e00', border: '1px solid #fdab3d',
              whiteSpace: 'nowrap',
            }} title="You are viewing this board as an administrator">
              👁 Admin view
            </span>
          )}
          <NotificationBell onOpenItem={handleOpenItem} />
          <UserMenu />
        </div>

        {/* Board area */}
        {loading ? (
          <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <div style={{ textAlign: 'center', color: '#888' }}>
              <div style={{ fontSize: 32, marginBottom: 8 }}>⏳</div>
              <div>Loading…</div>
            </div>
          </div>
        ) : activeBoard ? (
          <Board board={activeBoard} onBoardChange={handleBoardChange} openItemId={openItemId} onOpenItemDone={() => setOpenItemId(null)} />
        ) : (
          <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <div style={{ textAlign: 'center', color: '#888' }}>
              <div style={{ fontSize: 48, marginBottom: 12 }}>📋</div>
              <div style={{ fontSize: 16, marginBottom: 8 }}>No boards yet</div>
              {isManager && (
                <button onClick={() => setShowNewBoard(true)}
                  style={{ padding: '10px 20px', background: '#0073ea', color: '#fff', borderRadius: 8, fontWeight: 600 }}>
                  Create Your First Board
                </button>
              )}
            </div>
          </div>
        )}
      </div>

      {/* Global trash panel — boards + folders */}
      {showGlobalTrash && (
        <GlobalTrashPanel
          onClose={() => setShowGlobalTrash(false)}
          onBoardRestored={(board) => {
            setBoards(prev => {
              if (prev.some(b => b.id === board.id)) return prev;
              return [...prev, board];
            });
            toast(`Board "${board.name}" restored`, 'success');
          }}
          onFolderRestored={(folder, refiledBoardIds) => {
            setFolders(prev => {
              if (prev.some(f => f.id === folder.id)) return prev;
              return [...prev, folder];
            });
            if (refiledBoardIds?.length) {
              setBoards(prev => prev.map(b =>
                refiledBoardIds.includes(b.id) ? { ...b, folder_id: folder.id } : b
              ));
            }
            toast(`Folder "${folder.name}" restored`, 'success');
          }}
        />
      )}

      {/* API Keys panel */}
      {showApiKeys && (
        <ApiKeysPanel
          boards={boards}
          onClose={() => setShowApiKeys(false)}
        />
      )}

      {/* Clone board modal */}
      {cloneTargetBoard && (
        <CloneModal
          board={cloneTargetBoard}
          onClose={() => setCloneTargetBoard(null)}
          onCloned={(newBoard) => {
            setBoards(bs => [...bs, newBoard]);
            setCloneTargetBoard(null);
            loadBoard(newBoard.id);
            navigate(`/board/${newBoard.id}`, { replace: true });
            toast('Board duplicated successfully!', 'success');
          }}
        />
      )}
    </div>
  );
}

// ── Root ──────────────────────────────────────────────────────────────────────

export default function App() {
  return (
    <BrowserRouter>
      <AuthProvider>
        <NotificationProvider>
          <ToastProvider>
            <Routes>
              {/* Public */}
              <Route path="/login" element={<PublicRoute><LoginPage /></PublicRoute>} />
              <Route path="/register" element={<PublicRoute><RegisterPage /></PublicRoute>} />
              <Route path="/forgot-password" element={<PublicRoute><ForgotPasswordPage /></PublicRoute>} />
              <Route path="/reset-password" element={<ResetPasswordPage />} />
              <Route path="/auth/callback" element={<AuthCallbackPage />} />

              {/* Public form — no auth needed */}
              <Route path="/form/:slug" element={<PublicForm />} />

              {/* Protected */}
              <Route path="/profile" element={<ProtectedRoute><ProfilePage /></ProtectedRoute>} />
              <Route path="/board/:boardId" element={<ProtectedRoute><MainApp /></ProtectedRoute>} />
              <Route path="/" element={<ProtectedRoute><MainApp /></ProtectedRoute>} />

              {/* Fallback */}
              <Route path="*" element={<Navigate to="/" replace />} />
            </Routes>
          </ToastProvider>
        </NotificationProvider>
      </AuthProvider>
    </BrowserRouter>
  );
}
