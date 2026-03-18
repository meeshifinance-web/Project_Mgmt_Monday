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
import { getBoards, getBoard, createBoard, deleteBoard, updateBoard } from './api';

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
  const [openItemId, setOpenItemId] = useState(null); // from notification click
  const [newBoardName, setNewBoardName] = useState('');
  const [newBoardVisibility, setNewBoardVisibility] = useState('org_wide');
  const [showNewBoard, setShowNewBoard] = useState(false);
  const newBoardFormRef = useRef(null);
  const { isManager } = useAuth();
  const toast = useToast();
  const navigate = useNavigate();

  const closeNewBoard = () => { setShowNewBoard(false); setNewBoardName(''); setNewBoardVisibility('org_wide'); };

  useEffect(() => {
    if (!showNewBoard) return;
    const onMouseDown = (e) => { if (newBoardFormRef.current && !newBoardFormRef.current.contains(e.target)) closeNewBoard(); };
    const onKeyDown = (e) => { if (e.key === 'Escape') closeNewBoard(); };
    document.addEventListener('mousedown', onMouseDown);
    document.addEventListener('keydown', onKeyDown);
    return () => { document.removeEventListener('mousedown', onMouseDown); document.removeEventListener('keydown', onKeyDown); };
  }, [showNewBoard]);

  useEffect(() => {
    getBoards()
      .then(r => {
        setBoards(r.data);
        if (r.data.length > 0) loadBoard(r.data[0].id);
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

  // Called when user clicks a notification — load the board then open the item panel
  const handleOpenItem = useCallback(({ board_id, item_id }) => {
    setOpenItemId(item_id);
    if (activeBoard?.id !== board_id) {
      loadBoard(board_id);
    }
  }, [activeBoard?.id]);

  const handleCreateBoard = async (e) => {
    e.preventDefault();
    if (!newBoardName.trim()) return;
    try {
      const r = await createBoard({ name: newBoardName.trim(), visibility: newBoardVisibility });
      setBoards(b => [...b, r.data]);
      setNewBoardName('');
      setNewBoardVisibility('org_wide');
      setShowNewBoard(false);
      loadBoard(r.data.id);
      toast('Board created', 'success');
    } catch (err) {
      toast(err.response?.data?.error || 'Failed to create board', 'error');
    }
  };

  const handleDeleteBoard = async (id) => {
    if (!confirm('Delete this board?')) return;
    try {
      await deleteBoard(id);
      const remaining = boards.filter(b => b.id !== id);
      setBoards(remaining);
      if (activeBoard?.id === id) {
        if (remaining.length) loadBoard(remaining[0].id);
        else setActiveBoard(null);
      }
      toast('Board deleted');
    } catch (err) {
      toast(err.response?.data?.error || 'Failed to delete board', 'error');
    }
  };

  const handleBoardRename = async (id, newName) => {
    if (!newName.trim()) return;
    try {
      const board = boards.find(b => b.id === id) || activeBoard;
      const r = await updateBoard(id, { name: newName.trim(), description: board?.description, visibility: board?.visibility || 'org_wide' });
      setBoards(bs => bs.map(b => b.id === id ? { ...b, name: r.data.name } : b));
      if (activeBoard?.id === id) setActiveBoard(prev => ({ ...prev, name: r.data.name }));
      toast('Board renamed', 'success');
    } catch { toast('Failed to rename board', 'error'); }
  };

  const handleBoardChange = useCallback((updater) => {
    setActiveBoard(prev => {
      const next = updater(prev);
      // Keep sidebar board list in sync with visibility/name changes
      if (next.visibility !== prev?.visibility || next.name !== prev?.name) {
        setBoards(bs => bs.map(b => b.id === next.id ? { ...b, visibility: next.visibility, name: next.name } : b));
      }
      return next;
    });
  }, []);

  return (
    <div style={{ display: 'flex', height: '100vh', overflow: 'hidden' }}>
      {/* Sidebar */}
      <div style={{ width: 220, background: '#1c1f3b', color: '#fff', display: 'flex', flexDirection: 'column', flexShrink: 0 }}>
        <div style={{ padding: '18px 16px', borderBottom: '1px solid rgba(255,255,255,0.1)' }}>
          <div style={{ fontWeight: 800, fontSize: 16, letterSpacing: 0.5 }}>
            <span style={{ color: '#fdab3d' }}>D'Decor</span>
            <span style={{ color: '#fff', marginLeft: 4 }}>Workboard</span>
          </div>
          <div style={{ fontSize: 11, color: 'rgba(255,255,255,0.4)', marginTop: 2 }}>Project Management</div>
        </div>

        <div style={{ flex: 1, overflowY: 'auto', padding: '8px 0' }}>
          <div style={{ padding: '6px 16px', fontSize: 11, color: 'rgba(255,255,255,0.4)', textTransform: 'uppercase', letterSpacing: 1, marginBottom: 4 }}>
            Boards
          </div>
          {boards.map(b => (
            <div
              key={b.id}
              onClick={() => loadBoard(b.id)}
              style={{
                display: 'flex', alignItems: 'center', padding: '7px 16px', cursor: 'pointer',
                background: activeBoard?.id === b.id ? 'rgba(255,255,255,0.12)' : 'transparent',
                borderLeft: activeBoard?.id === b.id ? '3px solid #0073ea' : '3px solid transparent',
              }}
              onMouseEnter={e => { if (activeBoard?.id !== b.id) e.currentTarget.style.background = 'rgba(255,255,255,0.06)'; }}
              onMouseLeave={e => { if (activeBoard?.id !== b.id) e.currentTarget.style.background = 'transparent'; }}
            >
              <span style={{ fontSize: 11, marginRight: 5, opacity: 0.6 }} title={b.visibility === 'private' ? 'Private' : 'Org-wide'}>
                {b.visibility === 'private' ? '🔒' : '🌐'}
              </span>
              <span style={{ fontSize: 13, flex: 1, color: activeBoard?.id === b.id ? '#fff' : 'rgba(255,255,255,0.7)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {b.name}
              </span>
              {boards.length > 1 && isManager && (
                <button onClick={e => { e.stopPropagation(); handleDeleteBoard(b.id); }}
                  style={{ color: 'rgba(255,255,255,0.25)', fontSize: 14, flexShrink: 0 }} title="Delete">×</button>
              )}
            </div>
          ))}

          {showNewBoard ? (
            <form ref={newBoardFormRef} onSubmit={handleCreateBoard} style={{ padding: '8px 12px' }}>
              <input
                autoFocus value={newBoardName} onChange={e => setNewBoardName(e.target.value)}
                placeholder="Board name…"
                style={{
                  width: '100%', border: '1px solid rgba(255,255,255,0.2)', background: 'rgba(255,255,255,0.1)',
                  color: '#fff', borderRadius: 6, padding: '6px 8px', outline: 'none', fontSize: 13,
                  marginBottom: 6,
                }}
              />
              {/* Visibility selector */}
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
            <button onClick={() => setShowNewBoard(true)}
              style={{ width: '100%', padding: '8px 16px', textAlign: 'left', color: 'rgba(255,255,255,0.5)', fontSize: 13 }}>
              + New Board
            </button>
          ) : null}
        </div>

        <div style={{ padding: '12px 16px', borderTop: '1px solid rgba(255,255,255,0.1)', fontSize: 11, color: 'rgba(255,255,255,0.3)' }}>
          D'Decor Home Fabrics
        </div>
      </div>

      {/* Main content */}
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden', background: '#f0f2f5' }}>
        {/* Top bar */}
        <div style={{
          background: '#fff', borderBottom: '1px solid #e0e0e0',
          padding: '0 20px', height: 52, display: 'flex', alignItems: 'center',
        }}>
          {activeBoard && isManager
            ? <BoardNameEditor name={activeBoard.name} onSave={name => handleBoardRename(activeBoard.id, name)} />
            : <h1 style={{ fontSize: 18, fontWeight: 700, color: '#323338', flex: 1 }}>{activeBoard?.name || 'Select a Board'}</h1>
          }
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
