import React, { useState, useEffect, useCallback, useRef } from 'react';
import { BrowserRouter, Routes, Route, Navigate, useNavigate } from 'react-router-dom';
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
import { getBoards, getBoard, createBoard, deleteBoard, updateBoard, getFolders, createFolder, updateFolder, deleteFolder, moveBoardToFolder } from './api';
import GlobalTrashPanel from './components/GlobalTrashPanel';

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
    <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', background: '#f0f2f5' }}>
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
          flex: 1, fontSize: 18, fontWeight: 700, color: '#323338',
          border: '1.5px solid #0073ea', borderRadius: 6, padding: '2px 8px',
          outline: 'none', background: '#f0f6ff', maxWidth: 400,
        }}
      />
    );
  }

  return (
    <h1
      onClick={() => { setDraft(name); setEditing(true); }}
      title="Click to rename board"
      style={{
        fontSize: 18, fontWeight: 700, color: '#323338', flex: 1,
        cursor: 'text', borderRadius: 6, padding: '2px 8px',
        border: '1.5px solid transparent',
        transition: 'border-color 0.15s, background 0.15s',
      }}
      onMouseEnter={e => { e.currentTarget.style.borderColor = '#d0e4ff'; e.currentTarget.style.background = '#f5f9ff'; }}
      onMouseLeave={e => { e.currentTarget.style.borderColor = 'transparent'; e.currentTarget.style.background = 'transparent'; }}
    >
      {name}
      <span style={{ fontSize: 12, color: '#c5c7d0', marginLeft: 6, fontWeight: 400 }}>✎</span>
    </h1>
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
  const [boardMenuId, setBoardMenuId] = useState(null);
  const newBoardFormRef = useRef(null);
  const { user: currentUser, isManager, isAdmin } = useAuth();
  const toast = useToast();
  const navigate = useNavigate();

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

  useEffect(() => {
    Promise.all([getBoards(), getFolders()])
      .then(([boardsRes, foldersRes]) => {
        setBoards(boardsRes.data);
        setFolders(foldersRes.data);
        if (boardsRes.data.length > 0) loadBoard(boardsRes.data[0].id);
        else setLoading(false);
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
        if (remaining.length) loadBoard(remaining[0].id);
        else setActiveBoard(null);
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
    return (
      <div key={b.id} style={{ position: 'relative' }}>
        <div
          onClick={() => loadBoard(b.id)}
          style={{
            display: 'flex', alignItems: 'center', cursor: 'pointer',
            padding: indent ? '6px 16px 6px 28px' : '6px 16px',
            background: isActive ? 'rgba(255,255,255,0.12)' : 'transparent',
            borderLeft: isActive ? '3px solid #0073ea' : '3px solid transparent',
          }}
          onMouseEnter={e => { if (!isActive) e.currentTarget.style.background = 'rgba(255,255,255,0.06)'; }}
          onMouseLeave={e => { if (!isActive) e.currentTarget.style.background = 'transparent'; }}
        >
          <span style={{ fontSize: 10, marginRight: 5, opacity: 0.5 }} title={b.visibility === 'private' ? 'Private' : 'Org-wide'}>
            {b.visibility === 'private' ? '🔒' : '🌐'}
          </span>
          <span style={{
            fontSize: 12, flex: 1, color: isActive ? '#fff' : 'rgba(255,255,255,0.75)',
            overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
          }}>
            {b.name}
          </span>
          {isManager && (
            <button
              onClick={e => { e.stopPropagation(); setBoardMenuId(menuOpen ? null : b.id); }}
              style={{ color: 'rgba(255,255,255,0.3)', fontSize: 16, flexShrink: 0, lineHeight: 1, padding: '0 2px' }}
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
      {/* Sidebar */}
      <div style={{ width: 230, background: '#1c1f3b', color: '#fff', display: 'flex', flexDirection: 'column', flexShrink: 0 }}>
        <div style={{ padding: '18px 16px', borderBottom: '1px solid rgba(255,255,255,0.1)' }}>
          <div style={{ fontWeight: 800, fontSize: 16, letterSpacing: 0.5 }}>
            <span style={{ color: '#fdab3d' }}>D'Decor</span>
            <span style={{ color: '#fff', marginLeft: 4 }}>Workboard</span>
          </div>
          <div style={{ fontSize: 11, color: 'rgba(255,255,255,0.4)', marginTop: 2 }}>Project Management</div>
        </div>

        <div style={{ flex: 1, overflowY: 'auto', padding: '8px 0' }}>
          {/* Header row */}
          <div style={{ padding: '6px 16px 4px', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <span style={{ fontSize: 11, color: 'rgba(255,255,255,0.4)', textTransform: 'uppercase', letterSpacing: 1 }}>
              {isAdmin ? 'All Boards' : 'Boards'}
            </span>
            {isAdmin && (
              <span style={{ fontSize: 10, background: 'rgba(253,171,61,0.2)', color: '#fdab3d', borderRadius: 4, padding: '1px 5px', fontWeight: 700, letterSpacing: 0.3 }}>
                ADMIN
              </span>
            )}
          </div>

          {/* Folders with their boards */}
          {folders.map(folder => {
            const folderBoards = boardsByFolder[folder.id] || [];
            const collapsed = collapsedFolders.has(folder.id);
            const isRenaming = renamingFolderId === folder.id;
            return (
              <div key={folder.id}>
                {/* Folder header */}
                <div
                  style={{ display: 'flex', alignItems: 'center', padding: '5px 16px', cursor: 'pointer', gap: 4 }}
                  onMouseEnter={e => e.currentTarget.style.background = 'rgba(255,255,255,0.04)'}
                  onMouseLeave={e => e.currentTarget.style.background = 'transparent'}
                >
                  <span
                    onClick={() => setCollapsedFolders(s => { const n = new Set(s); n.has(folder.id) ? n.delete(folder.id) : n.add(folder.id); return n; })}
                    style={{ fontSize: 10, opacity: 0.5, marginRight: 2, userSelect: 'none', flexShrink: 0 }}
                  >
                    {collapsed ? '▶' : '▼'}
                  </span>
                  <span style={{ fontSize: 12, opacity: 0.6, flexShrink: 0 }}>📁</span>
                  {isRenaming ? (
                    <input
                      autoFocus
                      value={renameFolderDraft}
                      onChange={e => setRenameFolderDraft(e.target.value)}
                      onBlur={() => handleRenameFolder(folder.id)}
                      onKeyDown={e => { if (e.key === 'Enter') handleRenameFolder(folder.id); if (e.key === 'Escape') setRenamingFolderId(null); }}
                      onClick={e => e.stopPropagation()}
                      style={{
                        flex: 1, background: 'rgba(255,255,255,0.1)', border: '1px solid rgba(255,255,255,0.3)',
                        color: '#fff', borderRadius: 4, padding: '1px 6px', fontSize: 12, outline: 'none',
                      }}
                    />
                  ) : (
                    <span
                      onDoubleClick={isManager ? () => { setRenamingFolderId(folder.id); setRenameFolderDraft(folder.name); } : undefined}
                      onClick={() => setCollapsedFolders(s => { const n = new Set(s); n.has(folder.id) ? n.delete(folder.id) : n.add(folder.id); return n; })}
                      style={{ flex: 1, fontSize: 12, color: 'rgba(255,255,255,0.8)', fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}
                      title={isManager ? 'Double-click to rename' : undefined}
                    >
                      {folder.name}
                      {folderBoards.length > 0 && (
                        <span style={{ fontSize: 10, color: 'rgba(255,255,255,0.3)', marginLeft: 4, fontWeight: 400 }}>
                          ({folderBoards.length})
                        </span>
                      )}
                    </span>
                  )}
                  {isManager && !isRenaming && (
                    <>
                      <button
                        onClick={e => { e.stopPropagation(); setRenamingFolderId(folder.id); setRenameFolderDraft(folder.name); }}
                        style={{ color: 'rgba(255,255,255,0.2)', fontSize: 12, flexShrink: 0, padding: '0 2px', lineHeight: 1 }}
                        title="Rename folder"
                      >✏️</button>
                      <button
                        onClick={e => { e.stopPropagation(); handleDeleteFolder(folder.id); }}
                        style={{ color: 'rgba(255,255,255,0.2)', fontSize: 14, flexShrink: 0, padding: '0 2px' }}
                        title="Delete folder"
                      >×</button>
                    </>
                  )}
                </div>

                {/* Boards inside this folder */}
                {!collapsed && folderBoards.map(b => renderBoardRow(b, true))}
              </div>
            );
          })}

          {/* Unfiled boards */}
          {unfiledBoards.length > 0 && (
            <>
              {folders.length > 0 && (
                <div style={{ padding: '8px 16px 2px', fontSize: 10, color: 'rgba(255,255,255,0.3)', textTransform: 'uppercase', letterSpacing: 0.5 }}>
                  No Folder
                </div>
              )}
              {unfiledBoards.map(b => renderBoardRow(b, false))}
            </>
          )}

          {/* New board form / button */}
          {showNewBoard ? (
            <form ref={newBoardFormRef} onSubmit={handleCreateBoard} style={{ padding: '8px 12px', marginTop: 4 }}>
              <input
                autoFocus value={newBoardName} onChange={e => setNewBoardName(e.target.value)}
                placeholder="Board name…"
                style={{
                  width: '100%', border: '1px solid rgba(255,255,255,0.2)', background: 'rgba(255,255,255,0.1)',
                  color: '#fff', borderRadius: 6, padding: '6px 8px', outline: 'none', fontSize: 13,
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
                      border: `1.5px solid ${newBoardVisibility === v ? '#0073ea' : 'rgba(255,255,255,0.2)'}`,
                      background: newBoardVisibility === v ? '#0073ea' : 'transparent',
                      color: newBoardVisibility === v ? '#fff' : 'rgba(255,255,255,0.5)',
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
                style={{ width: '100%', padding: '7px 16px', textAlign: 'left', color: 'rgba(255,255,255,0.45)', fontSize: 12 }}
              >
                + New Board
              </button>
              <button
                onClick={handleCreateFolder}
                style={{ width: '100%', padding: '7px 16px', textAlign: 'left', color: 'rgba(255,255,255,0.45)', fontSize: 12 }}
              >
                + New Folder
              </button>
            </div>
          ) : null}
        </div>

        {isAdmin && (
          <div style={{ padding: '8px 16px', borderTop: '1px solid rgba(255,255,255,0.1)' }}>
            <button
              onClick={() => setShowGlobalTrash(true)}
              style={{
                width: '100%', textAlign: 'left', padding: '7px 4px',
                fontSize: 12, color: 'rgba(255,255,255,0.35)',
                display: 'flex', alignItems: 'center', gap: 6,
              }}
              onMouseEnter={e => e.currentTarget.style.color = 'rgba(255,255,255,0.65)'}
              onMouseLeave={e => e.currentTarget.style.color = 'rgba(255,255,255,0.35)'}
            >
              🗑️ Trash
            </button>
          </div>
        )}
        <div style={{ padding: '8px 16px', borderTop: '1px solid rgba(255,255,255,0.08)', fontSize: 11, color: 'rgba(255,255,255,0.3)' }}>
          D'Decor Home Fabrics
        </div>
      </div>

      {/* Main content */}
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden', background: '#f0f2f5' }}>
        {/* Top bar */}
        <div style={{
          background: '#fff', borderBottom: '1px solid #e0e0e0',
          padding: '0 20px', height: 52, display: 'flex', alignItems: 'center', gap: 10,
        }}>
          {activeBoard && isManager
            ? <BoardNameEditor name={activeBoard.name} onSave={name => handleBoardRename(activeBoard.id, name)} />
            : <h1 style={{ fontSize: 18, fontWeight: 700, color: '#323338', flex: 1 }}>{activeBoard?.name || 'Select a Board'}</h1>
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
