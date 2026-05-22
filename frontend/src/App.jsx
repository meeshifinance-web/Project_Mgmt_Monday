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
import { getBoards, getBoard, createBoard, deleteBoard, updateBoard, getFolders, createFolder, updateFolder, deleteFolder, moveBoardToFolder, moveFolderToParent, cloneBoard, favoriteBoard, unfavoriteBoard } from './api';
import GlobalTrashPanel from './components/GlobalTrashPanel';
import CommandPalette from './components/CommandPalette';
import EmptyState from './components/EmptyState';
import WelcomeTour, { shouldShowWelcomeTour } from './components/WelcomeTour';
import ApiKeysPanel from './components/ApiKeysPanel';
import MyWorkPanel from './components/MyWorkPanel';
import DashboardPage from './components/DashboardPage';
import { getDashboards, createDashboard, deleteDashboard } from './api';
import { useThemeLogo } from './hooks/useThemeLogo';

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

// Shared style for items inside the folder kebab dropdown — kept at module
// scope so it isn't recreated on every render of the sidebar.
const menuItemStyle = {
  display: 'block',
  width: '100%',
  textAlign: 'left',
  padding: '7px 14px',
  fontSize: 12,
  color: 'inherit',
  background: 'transparent',
  border: 'none',
  cursor: 'pointer',
  whiteSpace: 'nowrap',
};

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
          flex: '1 1 auto', minWidth: 0, width: '100%', boxSizing: 'border-box',
          fontSize: 18, fontWeight: 700, color: 'var(--text-primary)',
          border: '1.5px solid #9b72f5', borderRadius: 6, padding: '2px 8px',
          outline: 'none', background: 'var(--input-bg)',
        }}
      />
    );
  }

  return (
    <h1
      onClick={() => { setDraft(name); setEditing(true); }}
      title="Click to rename board"
      style={{
        fontSize: 18, fontWeight: 700, color: 'var(--text-primary)',
        flex: '1 1 auto', minWidth: 0,
        cursor: 'text', borderRadius: 6, padding: '2px 8px',
        border: '1.5px solid transparent',
        overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
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
    width: 18, height: 18, borderRadius: 4, border: `2px solid ${checked ? '#9b72f5' : '#c5c7d4'}`,
    background: checked ? '#9b72f5' : 'transparent', display: 'flex', alignItems: 'center',
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
                onFocus={e => e.currentTarget.style.borderColor = '#9b72f5'}
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
                border: 'none', background: loading ? '#a0c4f1' : '#9b72f5',
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
  // Counter that bumps each time the user picks "Trash" from a board's
  // sidebar kebab. Board listens for changes and opens the panel.
  const [trashOpenSignal, setTrashOpenSignal] = useState(0);
  const [newBoardName, setNewBoardName] = useState('');
  const [newBoardVisibility, setNewBoardVisibility] = useState('private');
  const [showNewBoard, setShowNewBoard] = useState(false);
  const [folders, setFolders] = useState([]);
  const [collapsedFolders, setCollapsedFolders] = useState(new Set());
  const [renamingFolderId, setRenamingFolderId] = useState(null);
  const [renameFolderDraft, setRenameFolderDraft] = useState('');
  // Inline folder-create state. null = idle, '__top__' = creating a new
  // top-level folder, <number> = creating a subfolder of that parent.
  const [creatingInParent, setCreatingInParent] = useState(null);
  const [newFolderDraft, setNewFolderDraft] = useState('');
  const [showGlobalTrash, setShowGlobalTrash] = useState(false);
  const [showApiKeys, setShowApiKeys] = useState(false);
  const [showMyWork, setShowMyWork] = useState(false);
  const [dashboards, setDashboards] = useState([]);
  const [activeDashboardId, setActiveDashboardId] = useState(null);
  const [dashboardsExpanded, setDashboardsExpanded] = useState(true);
  const [boardMenuId, setBoardMenuId] = useState(null);
  const [folderMenuId, setFolderMenuId] = useState(null);
  const [folderMoveTarget, setFolderMoveTarget] = useState(null); // folder being moved
  const [isNavCollapsed, setIsNavCollapsed] = useState(() => localStorage.getItem('workboard_nav_collapsed') === 'true');
  const [mobileNavOpen, setMobileNavOpen] = useState(false);
  const [cloneTargetBoard, setCloneTargetBoard] = useState(null);
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [showWelcome, setShowWelcome] = useState(() => shouldShowWelcomeTour());
  const { logoSrc, isDarkLogo } = useThemeLogo();

  // Cmd-K / Ctrl-K — global keyboard shortcut to open the command palette.
  // Captured at the document level so it works no matter what's focused
  // (inputs included). Esc closes via the palette's own keyhandler.
  useEffect(() => {
    const onKey = (e) => {
      const isCmdK = (e.metaKey || e.ctrlKey) && (e.key === 'k' || e.key === 'K');
      if (isCmdK) {
        e.preventDefault();
        setPaletteOpen(o => !o);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  // Listen for chord shortcuts dispatched from the Board's keyboard handler:
  //   g+b → open the mobile sidebar (no-op on desktop where it's always visible)
  //   g+m → open the My Work panel
  // Decoupled via window CustomEvents so the Board doesn't need to know about
  // App-level state.
  useEffect(() => {
    const onShortcut = (e) => {
      if (e.detail === 'open-sidebar') setMobileNavOpen(true);
      if (e.detail === 'open-mywork')  setShowMyWork(true);
    };
    window.addEventListener('wb-shortcut', onShortcut);
    return () => window.removeEventListener('wb-shortcut', onShortcut);
  }, []);

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
    getDashboards().then(data => setDashboards(data)).catch(() => {});
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

  // React to URL changes after initial mount — e.g. when Cmd-K (or any other
  // navigate(...) call) switches /board/:id while the app is already loaded.
  // The initial-mount effect above only runs once with `[]` deps, so without
  // this the URL would change but the board wouldn't reload.
  useEffect(() => {
    if (!urlBoardId) return;
    if (activeBoard && String(activeBoard.id) === String(urlBoardId)) return;
    if (!boards.length) return; // initial-mount effect will handle it
    const target = boards.find(b => String(b.id) === String(urlBoardId));
    if (target) loadBoard(target.id);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [urlBoardId]);

  const loadBoard = async (id) => {
    setActiveDashboardId(null); // always clear dashboard when opening a board
    setLoading(true);
    try {
      const r = await getBoard(id);
      setActiveBoard(r.data);
    } catch (err) {
      const status = err.response?.status;
      // Friendlier copy for the most common failures so users understand
      // *why* and can move on, instead of a generic "Failed to load".
      if (status === 404) {
        toast('That board no longer exists — it may have been deleted', 'warning');
      } else if (status === 403) {
        toast('You no longer have access to that board', 'warning');
      } else {
        toast('Failed to load board', 'error');
      }
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

  // Toggle the per-user favourite ("star") on a board. Updates both the
  // sidebar list and the active board so the header star icon stays in sync.
  const handleToggleFavorite = async (b, e) => {
    if (e) e.stopPropagation();
    const next = !b.is_favorite;
    // Optimistic update — revert on failure.
    setBoards(bs => bs.map(x => x.id === b.id ? { ...x, is_favorite: next } : x));
    if (activeBoard?.id === b.id) setActiveBoard(prev => ({ ...prev, is_favorite: next }));
    try {
      if (next) await favoriteBoard(b.id);
      else      await unfavoriteBoard(b.id);
    } catch {
      setBoards(bs => bs.map(x => x.id === b.id ? { ...x, is_favorite: !next } : x));
      if (activeBoard?.id === b.id) setActiveBoard(prev => ({ ...prev, is_favorite: !next }));
      toast('Failed to update favourite', 'error');
    }
  };

  // ── Folder handlers ──────────────────────────────────────────────────────────
  // Legacy prompt-based create — kept only for the EmptyState "Create one"
  // button inside the move-folder picker, where the inline create row would
  // disappear together with the popover.
  const handleCreateFolder = async (parentFolderId = null) => {
    const name = prompt(parentFolderId ? 'Subfolder name:' : 'Folder name:');
    if (!name?.trim()) return;
    try {
      const r = await createFolder(name.trim(), parentFolderId);
      setFolders(f => [...f, r.data]);
      toast(parentFolderId ? 'Subfolder created' : 'Folder created', 'success');
    } catch (err) {
      toast(err.response?.data?.error || 'Failed to create folder', 'error');
    }
  };

  // Inline create flow used by the sidebar "New Folder" button and the
  // per-folder "New subfolder" menu item — drops an input row in place
  // instead of opening a browser prompt.
  const startCreatingFolder = (parentTag) => {
    setFolderMenuId(null);
    setNewFolderDraft('');
    setCreatingInParent(parentTag);
    // If we're creating a subfolder, make sure the parent is expanded so
    // the new input row is actually visible.
    if (parentTag !== '__top__' && parentTag != null) {
      setCollapsedFolders(s => { const n = new Set(s); n.delete(parentTag); return n; });
    }
  };

  const cancelCreateFolder = () => {
    setCreatingInParent(null);
    setNewFolderDraft('');
  };

  const commitCreateFolder = async () => {
    const parentTag = creatingInParent;
    const name      = newFolderDraft.trim();
    // Clear state first so onBlur firing during unmount can't double-submit.
    setCreatingInParent(null);
    setNewFolderDraft('');
    if (parentTag == null || !name) return;
    const parentId = parentTag === '__top__' ? null : parentTag;
    try {
      const r = await createFolder(name, parentId);
      setFolders(f => [...f, r.data]);
      toast(parentId ? 'Subfolder created' : 'Folder created', 'success');
    } catch (err) {
      toast(err.response?.data?.error || 'Failed to create folder', 'error');
    }
  };

  // Move a folder under another folder, or out to top-level (newParentId=null).
  // The picker in the UI only ever passes top-level folder ids or null, so
  // depth-cap and cycle violations are caught server-side as a safety net.
  const handleMoveFolder = async (folderId, newParentId) => {
    setFolderMenuId(null);
    setFolderMoveTarget(null);
    try {
      const r = await moveFolderToParent(folderId, newParentId);
      setFolders(fs => fs.map(f => f.id === folderId ? r.data : f));
      toast(newParentId ? 'Folder moved into folder' : 'Folder moved to top level', 'success');
    } catch (err) {
      toast(err.response?.data?.error || 'Failed to move folder', 'error');
    }
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
      setFolders(f => f
        .filter(x => x.id !== id)
        // Subfolders of the deleted folder are promoted to top-level on the server
        // — mirror that here so the UI doesn't show them stranded inside a vanished parent.
        .map(x => r.data.promotedFolderIds?.includes(x.id) ? { ...x, parent_folder_id: null } : x)
      );
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

  // Copy a shareable board link to the clipboard from the sidebar kebab.
  const handleShareBoard = async (b) => {
    setBoardMenuId(null);
    const url = `${window.location.origin}/board/${b.id}`;
    try {
      await navigator.clipboard.writeText(url);
      toast('Board link copied to clipboard', 'success');
    } catch {
      // Clipboard API unavailable (insecure origin / older browser) — fall
      // back to a plain prompt so the user can copy manually.
      prompt('Copy this board link:', url);
    }
  };

  // Open the per-board Trash panel from the sidebar kebab. If we're already
  // on this board we just bump the signal; otherwise loadBoard fetches the
  // full board (groups + columns + etc.) and *then* the signal bump opens
  // the panel against that fully-hydrated data.
  // (setActiveBoard(b) would clobber the full activeBoard with the thin
  // sidebar metadata and blank the page until refresh.)
  const handleOpenBoardTrash = (b) => {
    setBoardMenuId(null);
    if (activeBoard?.id !== b.id) loadBoard(b.id);
    setTrashOpenSignal(c => c + 1);
  };

  // Toggle a board between Private and Public from the sidebar kebab.
  // Note: the DB value stays as 'org_wide' for "Public" to avoid a migration;
  // only the user-facing label has been renamed to "Public".
  const handleBoardVisibility = async (b) => {
    setBoardMenuId(null);
    const next = b.visibility === 'private' ? 'org_wide' : 'private';
    try {
      const r = await updateBoard(b.id, { name: b.name, description: b.description, visibility: next });
      setBoards(bs => bs.map(x => x.id === b.id ? { ...x, visibility: r.data.visibility } : x));
      toast(`Board is now ${next === 'private' ? '🔒 Private' : '🌐 Public'}`, 'success');
    } catch { toast('Failed to update visibility', 'error'); }
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
            cursor: 'pointer', height: 40,
            background: isActive ? 'var(--sidebar-active-bg)' : 'transparent',
            borderLeft: isActive ? '3px solid #9b72f5' : '3px solid transparent',
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
            padding: indent ? '8px 16px 8px 30px' : '8px 18px',
            background: isActive ? 'var(--sidebar-active-bg)' : 'transparent',
            borderLeft: isActive ? '3px solid #9b72f5' : '3px solid transparent',
          }}
          onMouseEnter={e => { if (!isActive) e.currentTarget.style.background = 'var(--sidebar-hover)'; }}
          onMouseLeave={e => { if (!isActive) e.currentTarget.style.background = 'transparent'; }}
        >
          <span style={{ fontSize: 12, marginRight: 8, color: 'var(--sidebar-text-muted)' }} title={b.visibility === 'private' ? 'Private' : 'Public'}>
            {b.visibility === 'private' ? '🔒' : '🌐'}
          </span>
          <span style={{
            fontSize: 15, flex: 1, color: isActive ? '#9b72f5' : 'var(--sidebar-text)', fontWeight: 800, letterSpacing: 0,
            overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
          }}>
            {b.name}
          </span>
          <button
            onClick={e => handleToggleFavorite(b, e)}
            title={b.is_favorite ? 'Remove from favourites' : 'Add to favourites'}
            aria-label={b.is_favorite ? 'Remove from favourites' : 'Add to favourites'}
            style={{
              color: b.is_favorite ? '#fdab3d' : 'var(--sidebar-text-muted)',
              fontSize: 14, flexShrink: 0, lineHeight: 1, padding: '0 4px',
              background: 'none', border: 'none', cursor: 'pointer',
              opacity: b.is_favorite ? 1 : 0.55,
            }}
          >{b.is_favorite ? '★' : '☆'}</button>
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
              background: 'var(--menu-bg)', borderRadius: 8, boxShadow: 'var(--menu-shadow)',
              border: '1px solid var(--menu-border)',
              padding: '6px 0', minWidth: 160, color: 'var(--text-primary)',
            }}
          >
            <div style={{ fontSize: 10, color: 'var(--text-muted)', padding: '4px 12px 2px', textTransform: 'uppercase', letterSpacing: 0.5 }}>Move to</div>
            {b.folder_id && (
              <div
                onClick={() => handleMoveBoard(b.id, null)}
                style={{ padding: '6px 12px', fontSize: 12, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 6 }}
                onMouseEnter={e => e.currentTarget.style.background = 'var(--menu-hover)'}
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
                onMouseEnter={e => e.currentTarget.style.background = 'var(--menu-hover)'}
                onMouseLeave={e => e.currentTarget.style.background = 'transparent'}
              >
                <span>📁</span> {f.name}
              </div>
            ) : null)}
            {folders.length === 0 && !b.folder_id && (
              <EmptyState
                compact
                icon="📁"
                title="No folders yet"
                primaryAction={isManager ? { label: 'Create one', onClick: () => handleCreateFolder() } : null}
              />
            )}
            {/* Share + visibility — moved here from the board header. */}
            <div style={{ borderTop: '1px solid var(--menu-divider)', margin: '4px 0' }} />
            <div
              onClick={() => handleShareBoard(b)}
              style={{ padding: '6px 12px', fontSize: 12, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 6 }}
              onMouseEnter={e => e.currentTarget.style.background = 'var(--menu-hover)'}
              onMouseLeave={e => e.currentTarget.style.background = 'transparent'}
            >
              🔗 Share
            </div>
            {isManager && (
              <div
                onClick={() => handleBoardVisibility(b)}
                style={{ padding: '6px 12px', fontSize: 12, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 6 }}
                onMouseEnter={e => e.currentTarget.style.background = 'var(--menu-hover)'}
                onMouseLeave={e => e.currentTarget.style.background = 'transparent'}
              >
                {b.visibility === 'private' ? '🌐 Make Public' : '🔒 Make Private'}
              </div>
            )}
            <div
              onClick={() => handleOpenBoardTrash(b)}
              style={{ padding: '6px 12px', fontSize: 12, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 6 }}
              onMouseEnter={e => e.currentTarget.style.background = 'var(--menu-hover)'}
              onMouseLeave={e => e.currentTarget.style.background = 'transparent'}
            >
              🗑️ Trash
            </div>
            {isManager && (
              <>
                <div style={{ borderTop: '1px solid var(--menu-divider)', margin: '4px 0' }} />
                <div
                  onClick={() => { setBoardMenuId(null); setCloneTargetBoard(b); }}
                  style={{ padding: '6px 12px', fontSize: 12, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 6 }}
                  onMouseEnter={e => e.currentTarget.style.background = 'var(--menu-hover)'}
                  onMouseLeave={e => e.currentTarget.style.background = 'transparent'}
                >
                  📋 Duplicate Board
                </div>
              </>
            )}
            {(isAdmin || (isManager && b.created_by === currentUser?.id)) && (
              <>
                <div style={{ borderTop: '1px solid var(--menu-divider)', margin: '4px 0' }} />
                <div
                  onClick={() => { setBoardMenuId(null); handleDeleteBoard(b.id); }}
                  style={{ padding: '6px 12px', fontSize: 12, cursor: 'pointer', color: 'var(--error-red)' }}
                  onMouseEnter={e => e.currentTarget.style.background = 'var(--menu-danger-hover)'}
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
    <div className="app-shell" style={{
      display: 'flex', height: '100vh', overflow: 'hidden',
      background: 'var(--app-shell-bg)',
      backgroundColor: 'var(--app-shell-bg-color)',
    }}>
      {/* Mobile drawer overlay */}
      {mobileNavOpen && (
        <div className="sidebar-overlay" onClick={() => setMobileNavOpen(false)} />
      )}

      {/* Sidebar */}
      <div
        className={`app-sidebar${mobileNavOpen ? ' sidebar-open' : ''}`}
        style={{
          width: isNavCollapsed ? 52 : 236,
          background: 'var(--sidebar-bg-surface)',
          backdropFilter: 'blur(20px)',
          WebkitBackdropFilter: 'blur(20px)',
          color: 'var(--sidebar-text)',
          display: 'flex',
          flexDirection: 'column',
          flexShrink: 0,
          transition: 'width 0.22s cubic-bezier(0.4,0,0.2,1)',
          overflow: 'hidden',
          borderRight: '1px solid var(--sidebar-border-surface)',
          boxShadow: 'var(--sidebar-shadow-surface)',
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
                className="theme-logo app-brand-logo"
                src={logoSrc}
                alt="Simplix"
                style={{
                  height: isDarkLogo ? 72 : 72,
                  width: 'auto',
                  maxWidth: 156,
                  objectFit: 'contain',
                  display: 'block',
                }}
              />
            </div>
          )}
          {isNavCollapsed && (
            <img
              className="theme-logo app-brand-logo"
              src={logoSrc}
              alt="Simplix"
              style={{
                height: isDarkLogo ? 22 : 28,
                width: 'auto',
                maxWidth: 36,
                objectFit: 'contain',
                display: 'block',
              }}
              title="Simplix"
            />
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
              {/* Desktop collapse button — hidden until sidebar is hovered */}
              <button
                className="sidebar-collapse-btn"
                onClick={toggleNav}
                title="Collapse sidebar"
                style={{
                  width: 28, height: 28, borderRadius: '50%', flexShrink: 0,
                  background: 'var(--sidebar-btn-bg)',
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  color: 'var(--sidebar-text)', fontSize: 14,
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
          {/* My Work */}
          {isNavCollapsed ? (
            <div
              onClick={() => setShowMyWork(true)}
              title="My Work"
              style={{
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                height: 36, cursor: 'pointer',
                background: showMyWork ? 'var(--sidebar-active-bg)' : 'transparent',
                borderLeft: showMyWork ? '3px solid #9b72f5' : '3px solid transparent',
              }}
              onMouseEnter={e => { if (!showMyWork) e.currentTarget.style.background = 'var(--sidebar-hover)'; }}
              onMouseLeave={e => { e.currentTarget.style.background = showMyWork ? 'var(--sidebar-active-bg)' : 'transparent'; }}
            >
              <span style={{ fontSize: 15 }}>👤</span>
            </div>
          ) : (
            <button
              onClick={() => setShowMyWork(true)}
              style={{
                width: '100%', display: 'flex', alignItems: 'center', gap: 8,
                padding: '10px 18px', cursor: 'pointer', textAlign: 'left',
                background: showMyWork ? 'var(--sidebar-active-bg)' : 'transparent',
                borderLeft: showMyWork ? '3px solid #9b72f5' : '3px solid transparent',
                color: showMyWork ? '#9b72f5' : 'var(--sidebar-text)',
                fontWeight: 800, fontSize: 16, letterSpacing: 0,
              }}
              onMouseEnter={e => { if (!showMyWork) e.currentTarget.style.background = 'var(--sidebar-hover)'; }}
              onMouseLeave={e => { e.currentTarget.style.background = showMyWork ? 'var(--sidebar-active-bg)' : 'transparent'; }}
            >
              <span style={{ fontSize: 17, flexShrink: 0 }}>👤</span>
              My Work
            </button>
          )}

          {/* Create actions — intentionally placed below My Work */}
          {isNavCollapsed ? (
            isManager && (
              <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', padding: '6px 0', gap: 6 }}>
                <button
                  onClick={() => { setIsNavCollapsed(false); localStorage.setItem('workboard_nav_collapsed', 'false'); setTimeout(() => setShowNewBoard(true), 220); }}
                  title="New Board"
                  style={{
                    width: 32, height: 32, borderRadius: 8, fontSize: 16, fontWeight: 800,
                    background: 'rgba(155,114,245,0.12)', color: 'var(--sidebar-text)',
                    border: '1px solid rgba(155,114,245,0.52)',
                    boxShadow: '0 0 12px rgba(155,114,245,0.16)',
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                    transition: 'background 0.15s, border-color 0.15s',
                  }}
                  onMouseEnter={e => { e.currentTarget.style.background = 'rgba(155,114,245,0.20)'; e.currentTarget.style.borderColor = '#9b72f5'; }}
                  onMouseLeave={e => { e.currentTarget.style.background = 'rgba(155,114,245,0.12)'; e.currentTarget.style.borderColor = 'rgba(155,114,245,0.52)'; }}
                >▣</button>
              </div>
            )
          ) : isManager && (
            <div style={{ padding: '4px 14px 10px', display: 'flex', flexDirection: 'column', gap: 7 }}>
              {showNewBoard ? (
                <form ref={newBoardFormRef} onSubmit={handleCreateBoard} style={{ padding: 10, border: '1px solid rgba(155,114,245,0.42)', borderRadius: 8, background: 'rgba(155,114,245,0.08)', boxShadow: '0 0 14px rgba(155,114,245,0.12)' }}>
                  <input
                    autoFocus value={newBoardName} onChange={e => setNewBoardName(e.target.value)}
                    placeholder="Board name..."
                    style={{
                      width: '100%', border: '1px solid var(--sidebar-input-border)', background: 'var(--sidebar-input-bg)',
                      color: 'var(--sidebar-text)', borderRadius: 6, padding: '7px 9px', outline: 'none', fontSize: 14,
                      marginBottom: 7, boxSizing: 'border-box',
                    }}
                  />
                  <div style={{ display: 'flex', gap: 6 }}>
                    {['org_wide', 'private'].map(v => (
                      <button
                        key={v} type="button"
                        onClick={() => setNewBoardVisibility(v)}
                        style={{
                          flex: 1, padding: '5px 0', borderRadius: 5, fontSize: 12, fontWeight: 800,
                          border: `1.5px solid ${newBoardVisibility === v ? '#9b72f5' : 'var(--sidebar-input-border)'}`,
                          background: newBoardVisibility === v ? '#9b72f5' : 'transparent',
                          color: newBoardVisibility === v ? '#fff' : 'var(--sidebar-text-muted)',
                        }}
                      >
                        {v === 'org_wide' ? '🌐 Org' : '🔒 Private'}
                      </button>
                    ))}
                  </div>
                  <button type="submit" style={{
                    width: '100%', marginTop: 7, padding: '7px 0',
                    background: 'linear-gradient(90deg, #9b72f5 0%, #b86cff 100%)', color: '#fff', borderRadius: 6, fontSize: 14, fontWeight: 800,
                  }}>Create Board</button>
                </form>
              ) : (
                <>
                  <button
                    onClick={() => setShowNewBoard(true)}
                    style={{
                      width: '100%', display: 'flex', alignItems: 'center', gap: 9,
                      padding: '9px 12px', textAlign: 'left', color: 'var(--sidebar-text)', fontSize: 15, fontWeight: 800,
                      border: '1px solid rgba(155,114,245,0.46)', borderRadius: 8,
                      background: 'rgba(155,114,245,0.08)', boxShadow: '0 0 14px rgba(155,114,245,0.12)',
                    }}
                    onMouseEnter={e => { e.currentTarget.style.background = 'rgba(155,114,245,0.16)'; e.currentTarget.style.borderColor = '#9b72f5'; }}
                    onMouseLeave={e => { e.currentTarget.style.background = 'rgba(155,114,245,0.08)'; e.currentTarget.style.borderColor = 'rgba(155,114,245,0.46)'; }}
                  >
                    <span style={{ fontSize: 15 }}>▣</span>
                    New Board
                  </button>
                  <button
                    onClick={() => startCreatingFolder('__top__')}
                    style={{
                      width: '100%', display: 'flex', alignItems: 'center', gap: 9,
                      padding: '9px 12px', textAlign: 'left', color: 'var(--sidebar-text)', fontSize: 15, fontWeight: 800,
                      border: '1px solid rgba(82,234,255,0.38)', borderRadius: 8,
                      background: 'rgba(82,234,255,0.06)', boxShadow: '0 0 12px rgba(82,234,255,0.10)',
                    }}
                    onMouseEnter={e => { e.currentTarget.style.background = 'rgba(82,234,255,0.12)'; e.currentTarget.style.borderColor = 'rgba(82,234,255,0.72)'; }}
                    onMouseLeave={e => { e.currentTarget.style.background = 'rgba(82,234,255,0.06)'; e.currentTarget.style.borderColor = 'rgba(82,234,255,0.38)'; }}
                  >
                    <span style={{ fontSize: 15 }}>📁</span>
                    New Folder
                  </button>
                </>
              )}
            </div>
          )}

          {/* ── Dashboards ── */}
          {isNavCollapsed ? (
            <div
              onClick={() => { setActiveDashboardId(d => d ? null : (dashboards[0]?.id ?? '__list__')); setActiveBoard(null); }}
              title="Dashboards"
              style={{
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                height: 36, cursor: 'pointer',
                background: activeDashboardId ? 'var(--sidebar-active-bg)' : 'transparent',
                borderLeft: activeDashboardId ? '3px solid #9b72f5' : '3px solid transparent',
              }}
              onMouseEnter={e => { if (!activeDashboardId) e.currentTarget.style.background = 'var(--sidebar-hover)'; }}
              onMouseLeave={e => { e.currentTarget.style.background = activeDashboardId ? 'var(--sidebar-active-bg)' : 'transparent'; }}
            >
              <span style={{ fontSize: 15 }}>📊</span>
            </div>
          ) : (
            <>
              <div style={{ padding: '10px 18px 5px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', cursor: 'pointer' }}
                onClick={() => setDashboardsExpanded(v => !v)}>
                <span style={{ fontSize: 12, fontWeight: 800, color: 'var(--sidebar-text-muted)', textTransform: 'uppercase', letterSpacing: '0.08em' }}>
                  {dashboardsExpanded ? '▼' : '▶'}&nbsp; Dashboards
                </span>
                {isManager && (
                  <button
                    onClick={async (e) => {
                      e.stopPropagation();
                      try {
                        const d = await createDashboard({ name: 'New Dashboard' });
                        setDashboards(prev => [d, ...prev]);
                        setActiveDashboardId(d.id);
                        setActiveBoard(null);
                      } catch { toast('Failed to create dashboard', 'error'); }
                    }}
                    title="New Dashboard"
                    style={{ fontSize: 18, color: 'var(--sidebar-text-muted)', background: 'none', border: 'none', cursor: 'pointer', lineHeight: 1, padding: '0 2px' }}
                    onMouseEnter={e => e.currentTarget.style.color = '#9b72f5'}
                    onMouseLeave={e => e.currentTarget.style.color = 'var(--sidebar-text-muted)'}
                  >+</button>
                )}
              </div>
              {dashboardsExpanded && (
                <div>
                  {dashboards.length === 0 && (
                    <div style={{ padding: '6px 18px 6px 30px', fontSize: 14, color: 'var(--sidebar-text-muted)', fontStyle: 'italic' }}>
                      {isManager ? 'Click + to create a dashboard' : 'No dashboards yet'}
                    </div>
                  )}
                  {dashboards.map(d => {
                    const isActive = activeDashboardId === d.id;
                    return (
                      <div key={d.id} style={{ display: 'flex', alignItems: 'center', paddingLeft: 12 }}>
                        <button
                          onClick={() => { setActiveDashboardId(d.id); setActiveBoard(null); }}
                          style={{
                            flex: 1, display: 'flex', alignItems: 'center', gap: 6,
                            padding: '8px 8px', textAlign: 'left', fontSize: 15,
                            background: isActive ? 'var(--sidebar-active-bg)' : 'transparent',
                            borderLeft: isActive ? '3px solid #9b72f5' : '3px solid transparent',
                            color: isActive ? '#9b72f5' : 'var(--sidebar-text)',
                            fontWeight: 800,
                            overflow: 'hidden',
                          }}
                          onMouseEnter={e => { if (!isActive) e.currentTarget.style.background = 'var(--sidebar-hover)'; }}
                          onMouseLeave={e => { e.currentTarget.style.background = isActive ? 'var(--sidebar-active-bg)' : 'transparent'; }}
                        >
                          <span style={{ fontSize: 15, flexShrink: 0 }}>📊</span>
                          <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{d.name}</span>
                        </button>
                        {isManager && isActive && (
                          <button
                            onClick={async () => {
                              if (!window.confirm(`Delete dashboard "${d.name}"?`)) return;
                              try {
                                await deleteDashboard(d.id);
                                setDashboards(prev => prev.filter(x => x.id !== d.id));
                                setActiveDashboardId(null);
                              } catch { toast('Failed to delete dashboard', 'error'); }
                            }}
                            title="Delete dashboard"
                            style={{ padding: '4px 6px', marginRight: 6, color: '#e2445c', background: 'none', border: 'none', fontSize: 14, cursor: 'pointer', flexShrink: 0 }}
                            onMouseEnter={e => e.currentTarget.style.background = '#fff5f5'}
                            onMouseLeave={e => e.currentTarget.style.background = 'none'}
                          >×</button>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}
            </>
          )}

          {/* Favourites — per-user starred boards, shown above folder tree */}
          {(() => {
            const favBoards = boards.filter(b => b.is_favorite);
            if (!favBoards.length || isNavCollapsed) return null;
            return (
              <>
                <div style={{ padding: '10px 18px 6px', display: 'flex', alignItems: 'center', gap: 6, marginTop: 4 }}>
                  <span style={{ fontSize: 12, color: '#fdab3d' }}>★</span>
                  <span style={{ fontSize: 12, fontWeight: 800, color: 'var(--sidebar-text-muted)', textTransform: 'uppercase', letterSpacing: '0.08em' }}>
                    Favourites
                  </span>
                </div>
                {favBoards.map(b => renderBoardRow(b, false))}
              </>
            );
          })()}

          {/* Header row */}
          {!isNavCollapsed && (
            <div style={{ padding: '10px 18px 6px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginTop: 4 }}>
              <span style={{ fontSize: 12, fontWeight: 800, color: 'var(--sidebar-text-muted)', textTransform: 'uppercase', letterSpacing: '0.08em' }}>
                {isAdmin ? 'All Boards' : 'Boards'}
              </span>
              {isAdmin && (
                <span style={{ fontSize: 10, background: 'rgba(253,171,61,0.15)', color: '#fdab3d', borderRadius: 4, padding: '1px 5px', fontWeight: 700, letterSpacing: 0.3 }}>
                  ADMIN
                </span>
              )}
            </div>
          )}

          {/* ── Folder tree with optional 1-level subfolders ─────────────────────
              Backend caps depth at 2 (top-folder → subfolder; subfolders cannot
              themselves contain folders). The render below mirrors that: when
              a folder has parent_folder_id set, it is shown indented under
              its parent. We also build a list of top-level folders for the
              "Move to folder" picker so users only ever see valid targets. */}
          {(() => {
            const topLevelFolders = folders.filter(f => !f.parent_folder_id);
            const subfoldersByParent = folders.reduce((acc, f) => {
              if (f.parent_folder_id) (acc[f.parent_folder_id] = acc[f.parent_folder_id] || []).push(f);
              return acc;
            }, {});

            // Inline input row used for in-place folder/subfolder creation.
            // Mirrors the existing rename-input pattern so visuals stay
            // consistent with how a folder name is edited.
            const renderInlineCreateRow = (indented) => (
              <div style={{
                position: 'relative',
                display: 'flex', alignItems: 'center',
                padding: indented ? '7px 18px 7px 34px' : '8px 18px',
                gap: 6,
              }}>
                <span style={{ fontSize: 12, color: 'var(--sidebar-text-muted)', marginRight: 2, userSelect: 'none', flexShrink: 0, width: 9 }} />
                <span style={{ fontSize: 15, color: 'var(--sidebar-text-muted)', flexShrink: 0 }}>{indented ? '📂' : '📁'}</span>
                <input
                  autoFocus
                  value={newFolderDraft}
                  onChange={e => setNewFolderDraft(e.target.value)}
                  onBlur={commitCreateFolder}
                  onKeyDown={e => {
                    if (e.key === 'Enter')  { e.preventDefault(); commitCreateFolder(); }
                    if (e.key === 'Escape') { e.preventDefault(); cancelCreateFolder(); }
                  }}
                  placeholder={indented ? 'Subfolder name…' : 'Folder name…'}
                  style={{
                    flex: 1, background: 'var(--sidebar-input-bg)', border: '1px solid var(--sidebar-input-border)',
                    color: 'var(--sidebar-text)', borderRadius: 4, padding: '2px 7px', fontSize: 14, outline: 'none',
                  }}
                />
              </div>
            );

            // Render a single folder row + its boards. The `isSub` flag adds
            // indentation, hides "New subfolder" in the menu, and offers
            // "Move to top level" instead of nesting options.
            const renderFolder = (folder, isSub = false) => {
              const folderBoards = boardsByFolder[folder.id] || [];
              const childFolders = subfoldersByParent[folder.id] || [];
              const collapsed = collapsedFolders.has(folder.id);
              const isRenaming = renamingFolderId === folder.id;
              const menuOpen = folderMenuId === folder.id;
              const moveOpen = folderMoveTarget === folder.id;
              const totalCount = folderBoards.length + childFolders.reduce((sum, c) => sum + (boardsByFolder[c.id]?.length || 0), 0);

              return (
                <div key={folder.id}>
                  {isNavCollapsed ? (
                    <div
                      onClick={() => setCollapsedFolders(s => { const n = new Set(s); n.has(folder.id) ? n.delete(folder.id) : n.add(folder.id); return n; })}
                      title={folder.name + (isSub ? ' (subfolder)' : '')}
                      style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: 38, cursor: 'pointer' }}
                      onMouseEnter={e => e.currentTarget.style.background = 'var(--sidebar-hover)'}
                      onMouseLeave={e => e.currentTarget.style.background = 'transparent'}
                    >
                      <span style={{ fontSize: 13 }}>{isSub ? '📂' : '📁'}</span>
                    </div>
                  ) : (
                    <div
                      style={{
                        position: 'relative',
                        display: 'flex', alignItems: 'center',
                        padding: isSub ? '7px 18px 7px 34px' : '8px 18px',
                        cursor: 'pointer', gap: 6,
                      }}
                      onMouseEnter={e => e.currentTarget.style.background = 'var(--sidebar-hover)'}
                      onMouseLeave={e => e.currentTarget.style.background = 'transparent'}
                    >
                      <span
                        onClick={() => setCollapsedFolders(s => { const n = new Set(s); n.has(folder.id) ? n.delete(folder.id) : n.add(folder.id); return n; })}
                        style={{ fontSize: 12, color: 'var(--sidebar-text-muted)', marginRight: 2, userSelect: 'none', flexShrink: 0 }}
                      >
                        {collapsed ? '▶' : '▼'}
                      </span>
                      <span style={{ fontSize: 15, color: 'var(--sidebar-text-muted)', flexShrink: 0 }}>{isSub ? '📂' : '📁'}</span>
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
                            color: 'var(--sidebar-text)', borderRadius: 4, padding: '2px 7px', fontSize: 14, outline: 'none',
                          }}
                        />
                      ) : (
                        <span
                          onDoubleClick={isManager ? () => { setRenamingFolderId(folder.id); setRenameFolderDraft(folder.name); } : undefined}
                          onClick={() => setCollapsedFolders(s => { const n = new Set(s); n.has(folder.id) ? n.delete(folder.id) : n.add(folder.id); return n; })}
                          style={{ flex: 1, fontSize: 15, color: 'var(--sidebar-text)', fontWeight: 800, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}
                          title={isManager ? 'Double-click to rename' : undefined}
                        >
                          {folder.name}
                          {totalCount > 0 && (
                            <span style={{ fontSize: 12, color: 'var(--sidebar-text-muted)', marginLeft: 4, fontWeight: 800 }}>
                              ({totalCount})
                            </span>
                          )}
                        </span>
                      )}
                      {isManager && !isRenaming && (
                        <button
                          onClick={e => { e.stopPropagation(); setFolderMenuId(menuOpen ? null : folder.id); setFolderMoveTarget(null); }}
                          style={{ color: 'var(--sidebar-text-muted)', fontSize: 14, flexShrink: 0, padding: '0 4px', lineHeight: 1, fontWeight: 700 }}
                          title="More actions"
                        >⋮</button>
                      )}
                      {/* Kebab menu */}
                      {menuOpen && (
                        <div
                          onClick={e => e.stopPropagation()}
                          style={{
                            position: 'absolute', top: '100%', right: 8, zIndex: 50,
                            background: 'var(--menu-bg)', color: 'var(--text-primary)',
                            border: '1px solid var(--menu-border)', borderRadius: 8,
                            boxShadow: 'var(--menu-shadow)',
                            minWidth: 200, padding: '4px 0', fontSize: 12,
                          }}
                        >
                          <button
                            onClick={() => { setFolderMenuId(null); setRenamingFolderId(folder.id); setRenameFolderDraft(folder.name); }}
                            style={menuItemStyle}
                          >✏️ &nbsp; Rename</button>
                          {!isSub && (
                            <button
                              onClick={() => startCreatingFolder(folder.id)}
                              style={menuItemStyle}
                            >📂 &nbsp; New subfolder</button>
                          )}
                          <button
                            onClick={() => setFolderMoveTarget(moveOpen ? null : folder.id)}
                            style={menuItemStyle}
                          >➡️ &nbsp; Move to folder…</button>
                          {moveOpen && (
                            <div style={{ borderTop: '1px solid var(--menu-divider)', borderBottom: '1px solid var(--menu-divider)', maxHeight: 200, overflowY: 'auto', background: 'var(--menu-hover)' }}>
                              {/* Always offer "Top level" if the folder is currently nested */}
                              {folder.parent_folder_id && (
                                <button onClick={() => handleMoveFolder(folder.id, null)} style={{ ...menuItemStyle, fontStyle: 'italic' }}>
                                  ⬆ Move to top level
                                </button>
                              )}
                              {topLevelFolders
                                .filter(t => t.id !== folder.id && t.id !== folder.parent_folder_id)
                                .map(t => (
                                  <button key={t.id} onClick={() => handleMoveFolder(folder.id, t.id)} style={menuItemStyle}>
                                    📁 &nbsp; Into "{t.name}"
                                  </button>
                                ))}
                              {topLevelFolders.filter(t => t.id !== folder.id && t.id !== folder.parent_folder_id).length === 0 && !folder.parent_folder_id && (
                                <div style={{ padding: '6px 12px', color: 'var(--text-muted, #999)', fontStyle: 'italic' }}>
                                  No other folders to move into
                                </div>
                              )}
                            </div>
                          )}
                          <button
                            onClick={() => { setFolderMenuId(null); handleDeleteFolder(folder.id); }}
                            style={{ ...menuItemStyle, color: '#e2445c' }}
                          >🗑️ &nbsp; Delete folder</button>
                        </div>
                      )}
                    </div>
                  )}

                  {/* Boards directly inside this folder */}
                  {!collapsed && folderBoards.map(b => renderBoardRow(b, !isNavCollapsed))}

                  {/* Subfolders (only on top-level folders) */}
                  {!collapsed && !isSub && childFolders.map(child => renderFolder(child, true))}

                  {/* Inline subfolder-create input — appears when the user
                      picks "New subfolder" from this folder's kebab menu. */}
                  {!collapsed && !isSub && !isNavCollapsed && creatingInParent === folder.id && (
                    renderInlineCreateRow(true)
                  )}
                </div>
              );
            };

            return (
              <>
                {/* Inline top-level folder-create input — appears above
                    existing folders when the user clicks "New Folder". */}
                {!isNavCollapsed && creatingInParent === '__top__' && renderInlineCreateRow(false)}
                {topLevelFolders.map(f => renderFolder(f, false))}
              </>
            );
          })()}

          {/* Unfiled boards */}
          {unfiledBoards.length > 0 && (
            <>
              {folders.length > 0 && !isNavCollapsed && (
                <div style={{ padding: '10px 18px 4px', fontSize: 12, fontWeight: 800, color: 'var(--sidebar-text-muted)', textTransform: 'uppercase', letterSpacing: '0.08em' }}>
                  No Folder
                </div>
              )}
              {unfiledBoards.map(b => renderBoardRow(b, false))}
            </>
          )}

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
          <div style={{ padding: '10px 16px', borderTop: '1px solid var(--sidebar-border)', fontSize: 11, fontWeight: 500, color: 'var(--sidebar-text-muted)', whiteSpace: 'nowrap', fontFamily: "'Inter', sans-serif", letterSpacing: '0.02em' }}>
            © Simplix 2024
          </div>
        )}
      </div>

      {/* Main content */}
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden', background: 'transparent' }}>
        {/* Top bar */}
        <div
          className="app-topbar wb-safe-top wb-safe-left wb-safe-right"
          style={{
            background: 'var(--topbar-bg)',
            backdropFilter: 'blur(28px)',
            WebkitBackdropFilter: 'blur(28px)',
            borderBottom: '1px solid var(--topbar-border)',
            padding: '0 24px', height: 56, display: 'flex', alignItems: 'center', gap: 10,
          }}
        >
          {/* Hamburger — mobile only */}
          <button
            className="mobile-hamburger"
            onClick={() => setMobileNavOpen(true)}
            aria-label="Open navigation"
          >☰</button>

          {activeDashboardId ? (
            <h1 style={{ fontSize: 20, fontWeight: 600, color: 'var(--text-primary)', flex: 1, display: 'flex', alignItems: 'center', gap: 8, fontFamily: "'Cormorant Garamond', 'Playfair Display', Georgia, serif", letterSpacing: '-0.01em' }}>
              <span style={{ fontSize: 16 }}>📊</span>
              {dashboards.find(d => d.id === activeDashboardId)?.name || 'Dashboard'}
            </h1>
          ) : activeBoard && isManager ? (
            <>
              <BoardNameEditor name={activeBoard.name} onSave={name => handleBoardRename(activeBoard.id, name)} />
              <button
                onClick={() => handleToggleFavorite(activeBoard)}
                title={activeBoard.is_favorite ? 'Remove from favourites' : 'Add to favourites'}
                aria-label={activeBoard.is_favorite ? 'Remove from favourites' : 'Add to favourites'}
                style={{
                  background: 'none', border: 'none', cursor: 'pointer',
                  color: activeBoard.is_favorite ? '#fdab3d' : 'var(--text-muted)',
                  fontSize: 20, lineHeight: 1, padding: '2px 6px',
                }}
              >{activeBoard.is_favorite ? '★' : '☆'}</button>
            </>
          ) : activeBoard ? (
            <>
              <h1 style={{ fontSize: 22, fontWeight: 600, color: 'var(--text-primary)', flex: 1, fontFamily: "'Cormorant Garamond', 'Playfair Display', Georgia, serif", letterSpacing: '-0.01em', lineHeight: 1.2 }}>{activeBoard.name}</h1>
              <button
                onClick={() => handleToggleFavorite(activeBoard)}
                title={activeBoard.is_favorite ? 'Remove from favourites' : 'Add to favourites'}
                aria-label={activeBoard.is_favorite ? 'Remove from favourites' : 'Add to favourites'}
                style={{
                  background: 'none', border: 'none', cursor: 'pointer',
                  color: activeBoard.is_favorite ? '#fdab3d' : 'var(--text-muted)',
                  fontSize: 20, lineHeight: 1, padding: '2px 6px',
                }}
              >{activeBoard.is_favorite ? '★' : '☆'}</button>
            </>
          ) : (
            <h1 style={{ fontSize: 22, fontWeight: 600, color: 'var(--text-primary)', flex: 1, fontFamily: "'Cormorant Garamond', 'Playfair Display', Georgia, serif", letterSpacing: '-0.01em', lineHeight: 1.2 }}>Select a Board</h1>
          )}
          {!activeDashboardId && isAdmin && activeBoard && !activeBoard.members?.some(m => m.id === currentUser?.id) && (
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

        {/* Board / Dashboard area */}
        {activeDashboardId ? (
          <DashboardPage
            dashboardId={activeDashboardId}
            dashboard={dashboards.find(d => d.id === activeDashboardId)}
            boards={boards}
            onDashboardUpdate={updated => setDashboards(prev => prev.map(d => d.id === updated.id ? updated : d))}
          />
        ) : loading ? (
          <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <div style={{ textAlign: 'center', color: '#888' }}>
              <div style={{ fontSize: 32, marginBottom: 8 }}>⏳</div>
              <div>Loading…</div>
            </div>
          </div>
        ) : activeBoard ? (
          <Board board={activeBoard} onBoardChange={handleBoardChange} openItemId={openItemId} onOpenItemDone={() => setOpenItemId(null)} openTrashSignal={trashOpenSignal} />
        ) : (
          <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <EmptyState
              icon="📋"
              title={isManager ? "Let's create your first board" : 'No boards shared with you yet'}
              description={isManager
                ? 'Boards are where work lives — track tasks, deadlines, and ownership across your team. Pick a board on the left or create a new one to get started.'
                : 'Ask your team admin or a manager to add you to a board. Once you\'re a member, it\'ll appear in the sidebar on the left.'}
              primaryAction={isManager ? { label: '+ Create your first board', onClick: () => setShowNewBoard(true) } : null}
            />
          </div>
        )}
      </div>

      {/* My Work panel */}
      {showMyWork && (
        <MyWorkPanel
          onClose={() => setShowMyWork(false)}
          onNavigateToBoard={(boardId) => {
            loadBoard(boardId);
            navigate(`/board/${boardId}`, { replace: true });
          }}
        />
      )}

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

      {/* Cmd-K command palette — overlay mounted at the root so it can
          take focus from anywhere in the app. */}
      <CommandPalette open={paletteOpen} onClose={() => setPaletteOpen(false)} />

      {/* First-login welcome tour — shown only once per browser. */}
      {showWelcome && (
        <WelcomeTour
          userName={currentUser?.name}
          onDismiss={() => setShowWelcome(false)}
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
