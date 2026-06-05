import React, { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { useToast } from '../components/Toast';
import {
  updateMe, changePassword,
  getUsers, adminCreateUser, adminResetPassword, updateUserRole, setUserActive, deleteUser,
} from '../api';
import { toISODate } from '../utils/dateFormat';

const NAV = [
  { key: 'Profile', icon: '👤', sub: 'Your personal details' },
  { key: 'Security', icon: '🛡️', sub: 'Change password' },
  { key: 'Admin', icon: '⚙️', sub: 'Users & roles' },
];
const ROLES = ['admin', 'manager', 'member', 'user'];
const ROLE_COLORS = { admin: '#e2445c', manager: '#fdab3d', member: '#9b72f5', user: '#6ba0ff' };
const ROLE_LABELS = { admin: 'Admin', manager: 'Manager', member: 'Member', user: 'User (Read-only)' };

function RoleBadge({ role }) {
  return (
    <span style={{
      background: ROLE_COLORS[role] || 'var(--text-muted,#ccc)', color: '#fff',
      borderRadius: 20, padding: '3px 12px', fontSize: 11, fontWeight: 700,
      boxShadow: '0 2px 8px rgba(0,0,0,0.14)',
    }}>{ROLE_LABELS[role] || role}</span>
  );
}

function Avatar({ name, url, size = 48, ring = false }) {
  const initials = (name || '?').split(' ').map(w => w[0]).join('').toUpperCase().slice(0, 2);
  const ringStyle = ring ? { boxShadow: '0 0 0 4px rgba(255,255,255,0.35), 0 8px 24px rgba(60,30,120,0.35)' } : {};
  if (url) return <img src={url} alt={name} style={{ width: size, height: size, borderRadius: '50%', objectFit: 'cover', ...ringStyle }} />;
  return (
    <div style={{
      width: size, height: size, borderRadius: '50%',
      background: 'linear-gradient(135deg, #b58bff 0%, #7f55d6 100%)',
      color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center',
      fontWeight: 800, fontSize: size * 0.36, letterSpacing: 0.5, flexShrink: 0, ...ringStyle,
    }}>{initials}</div>
  );
}

// Donut built from a conic-gradient — no chart lib, fully theme-aware.
function Donut({ data, size = 132, label, value }) {
  const total = data.reduce((s, d) => s + d.value, 0) || 1;
  let acc = 0;
  const stops = data.map(d => {
    const start = (acc / total) * 360; acc += d.value; const end = (acc / total) * 360;
    return `${d.color} ${start}deg ${end}deg`;
  }).join(', ');
  const hole = size * 0.62;
  return (
    <div style={{ position: 'relative', width: size, height: size, flexShrink: 0 }}>
      <div style={{ width: size, height: size, borderRadius: '50%', background: `conic-gradient(${stops})`, transition: 'background 0.5s ease' }} />
      <div style={{
        position: 'absolute', top: '50%', left: '50%', transform: 'translate(-50%,-50%)',
        width: hole, height: hole, borderRadius: '50%', background: 'var(--card-bg,#fff)',
        display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
        boxShadow: 'inset 0 0 0 1px var(--border-color, rgba(155,114,245,0.13))',
      }}>
        <span style={{ fontSize: 26, fontWeight: 800, color: 'var(--text-primary,#111)', lineHeight: 1 }}>{value}</span>
        <span style={{ fontSize: 10, fontWeight: 700, color: 'var(--text-muted,#9999bb)', textTransform: 'uppercase', letterSpacing: 0.5, marginTop: 2 }}>{label}</span>
      </div>
    </div>
  );
}

export default function ProfilePage() {
  const { user, updateUser, logout, isAdmin } = useAuth();
  const toast = useToast();
  const navigate = useNavigate();
  const [tab, setTab] = useState(isAdmin ? 'Admin' : 'Profile');
  const [mounted, setMounted] = useState(false); // drives bar-grow animation per tab

  // Profile tab
  const [name, setName] = useState(user?.name || '');
  const [avatarUrl, setAvatarUrl] = useState(user?.avatar_url || '');
  const [savingProfile, setSavingProfile] = useState(false);

  // Security tab
  const [curPwd, setCurPwd] = useState('');
  const [newPwd, setNewPwd] = useState('');
  const [confPwd, setConfPwd] = useState('');
  const [changingPwd, setChangingPwd] = useState(false);

  // Admin tab
  const [users, setUsers] = useState([]);
  const [loadingUsers, setLoadingUsers] = useState(false);
  const [showCreateUser, setShowCreateUser] = useState(false);
  const [resetPasswordFor, setResetPasswordFor] = useState(null);
  const [resetPwd, setResetPwd] = useState('');
  const [resettingPwd, setResettingPwd] = useState(false);
  const [newUserName, setNewUserName] = useState('');
  const [newUserEmail, setNewUserEmail] = useState('');
  const [newUserPassword, setNewUserPassword] = useState('');
  const [newUserRole, setNewUserRole] = useState('user');
  const [creatingUser, setCreatingUser] = useState(false);
  // Filter + sort state
  const [userSearch, setUserSearch] = useState('');
  const [filterRole, setFilterRole] = useState('all');
  const [filterStatus, setFilterStatus] = useState('all');
  const [filterType, setFilterType] = useState('all');
  const [sortCol, setSortCol] = useState('created_at');
  const [sortDir, setSortDir] = useState('desc');

  // Re-trigger entrance animations whenever the active tab changes.
  useEffect(() => {
    setMounted(false);
    const t = setTimeout(() => setMounted(true), 60);
    return () => clearTimeout(t);
  }, [tab]);

  // Load the user list. `silent` polls/refreshes in the background without a
  // spinner or error toast, so live updates don't flicker the table.
  const loadUsers = useCallback((silent = false) => {
    if (!(tab === 'Admin' && isAdmin)) return;
    if (!silent) setLoadingUsers(true);
    getUsers()
      .then(r => setUsers(r.data))
      .catch(() => { if (!silent) toast('Failed to load users', 'error'); })
      .finally(() => { if (!silent) setLoadingUsers(false); });
  }, [tab, isAdmin]); // eslint-disable-line react-hooks/exhaustive-deps

  // Initial load + real-time refresh: poll every 8s while the Admin tab is
  // open, and re-fetch whenever the window regains focus. This keeps the
  // summary counts and table in sync with changes made anywhere — no manual
  // refresh needed.
  useEffect(() => {
    if (!(tab === 'Admin' && isAdmin)) return;
    loadUsers();
    const pollId = setInterval(() => loadUsers(true), 8000);
    const onFocus = () => loadUsers(true);
    window.addEventListener('focus', onFocus);
    return () => { clearInterval(pollId); window.removeEventListener('focus', onFocus); };
  }, [tab, isAdmin, loadUsers]);

  const saveProfile = async (e) => {
    e.preventDefault();
    setSavingProfile(true);
    try {
      const r = await updateMe({ name, avatar_url: avatarUrl });
      updateUser(r.data);
      toast('Profile updated', 'success');
    } catch (err) {
      toast(err.response?.data?.error || 'Failed to update', 'error');
    } finally {
      setSavingProfile(false);
    }
  };

  const handleChangePassword = async (e) => {
    e.preventDefault();
    if (newPwd !== confPwd) return toast('Passwords do not match', 'error');
    if (newPwd.length < 8) return toast('Password must be 8+ characters', 'error');
    setChangingPwd(true);
    try {
      await changePassword(curPwd, newPwd);
      toast('Password changed successfully', 'success');
      setCurPwd(''); setNewPwd(''); setConfPwd('');
    } catch (err) {
      toast(err.response?.data?.error || 'Failed to change password', 'error');
    } finally {
      setChangingPwd(false);
    }
  };

  const handleCreateUser = async (e) => {
    e.preventDefault();
    if (!newUserName.trim() || !newUserEmail.trim() || !newUserPassword) return;
    setCreatingUser(true);
    try {
      const r = await adminCreateUser({ name: newUserName.trim(), email: newUserEmail.trim(), password: newUserPassword, role: newUserRole });
      setUsers(u => [{ ...r.data, is_active: true, is_sso: false, last_login: null }, ...u]);
      setNewUserName(''); setNewUserEmail(''); setNewUserPassword(''); setNewUserRole('user');
      setShowCreateUser(false);
      toast(`User ${r.data.name} created`, 'success');
    } catch (err) {
      toast(err.response?.data?.error || 'Failed to create user', 'error');
    } finally {
      setCreatingUser(false);
    }
  };

  const handleAdminResetPassword = async (e, userId) => {
    e.preventDefault();
    if (!resetPwd) return;
    setResettingPwd(true);
    try {
      await adminResetPassword(userId, resetPwd);
      toast('Password reset successfully', 'success');
      setResetPasswordFor(null);
      setResetPwd('');
    } catch (err) {
      toast(err.response?.data?.error || 'Failed to reset password', 'error');
    } finally {
      setResettingPwd(false);
    }
  };

  const handleRoleChange = async (userId, role) => {
    try {
      const r = await updateUserRole(userId, role);
      setUsers(u => u.map(x => x.id === userId ? { ...x, role: r.data.role } : x));
      toast('Role updated', 'success');
    } catch (err) {
      toast(err.response?.data?.error || 'Failed to update role', 'error');
    }
  };

  const handleToggleActive = async (u) => {
    try {
      const r = await setUserActive(u.id, !u.is_active);
      setUsers(us => us.map(x => x.id === u.id ? { ...x, is_active: r.data.is_active } : x));
      toast(`User ${r.data.is_active ? 'activated' : 'deactivated'}`, 'success');
    } catch (err) {
      toast(err.response?.data?.error || 'Failed', 'error');
    }
  };

  const handleDeleteUser = async (u) => {
    if (!confirm(`Delete user ${u.email}? This cannot be undone.`)) return;
    try {
      await deleteUser(u.id);
      setUsers(us => us.filter(x => x.id !== u.id));
      toast('User deleted', 'success');
    } catch (err) {
      toast(err.response?.data?.error || 'Failed to delete', 'error');
    }
  };

  const visibleNav = NAV.filter(t => t.key !== 'Admin' || isAdmin);
  const hour = new Date().getHours();
  const greeting = hour < 12 ? 'Good morning' : hour < 18 ? 'Good afternoon' : 'Good evening';

  return (
    <div style={{ display: 'flex', minHeight: '100vh', background: 'var(--bg-secondary, transparent)', color: 'var(--text-primary,#323338)' }}>
      <style>{`
        @keyframes profFadeUp { from { opacity: 0; transform: translateY(16px); } to { opacity: 1; transform: none; } }
        @keyframes profPop { from { opacity: 0; transform: scale(.94); } to { opacity: 1; transform: none; } }
        @keyframes profFloat { 0%,100% { transform: translateY(0); } 50% { transform: translateY(-9px); } }
        .pf-fade { animation: profFadeUp .5s cubic-bezier(.2,.7,.3,1) both; }
        .pf-pop  { animation: profPop .45s cubic-bezier(.2,.7,.3,1) both; }
        .pf-card { transition: transform .22s cubic-bezier(.2,.7,.3,1), box-shadow .22s ease; }
        .pf-card:hover { transform: translateY(-4px); box-shadow: 0 18px 44px rgba(80,50,150,0.20); }
        .pf-nav { transition: background .18s ease, color .18s ease, transform .15s ease; }
        .pf-nav:hover { transform: translateX(2px); }
        .pf-row { transition: background .14s ease; }
        .pf-btn { transition: transform .15s ease, box-shadow .2s ease, filter .2s ease; }
        .pf-btn:hover { transform: translateY(-1px); filter: brightness(1.04); }
        .pf-bar { transition: width .9s cubic-bezier(.2,.8,.2,1); }
      `}</style>

      {/* ════════ Sidebar rail ════════ */}
      <aside style={{
        width: 264, flexShrink: 0, position: 'sticky', top: 0, alignSelf: 'flex-start', height: '100vh',
        display: 'flex', flexDirection: 'column', padding: '20px 16px',
        background: 'var(--sidebar-bg-surface, rgba(255,255,255,0.96))',
        borderRight: '1px solid var(--sidebar-border-surface, rgba(155,114,245,0.10))',
        boxShadow: 'var(--sidebar-shadow-surface, 2px 0 20px rgba(80,60,160,0.06))',
        backdropFilter: 'blur(16px)', WebkitBackdropFilter: 'blur(16px)',
      }}>
        <button onClick={() => navigate('/')} className="pf-nav" style={{
          display: 'flex', alignItems: 'center', gap: 8, color: '#9b72f5', fontWeight: 600, fontSize: 13,
          background: 'rgba(155,114,245,0.10)', borderRadius: 10, padding: '9px 12px', marginBottom: 16,
        }}>← Back to Board</button>

        {/* Mini profile card */}
        <div className="pf-pop" style={{
          display: 'flex', flexDirection: 'column', alignItems: 'center', textAlign: 'center', gap: 8,
          padding: '20px 14px', borderRadius: 16, marginBottom: 18,
          background: 'linear-gradient(150deg, #6C3DFF 0%, #9b72f5 55%, #C77DFF 110%)',
          boxShadow: '0 14px 34px rgba(108,61,255,0.32)', position: 'relative', overflow: 'hidden',
        }}>
          <div style={{ position: 'absolute', top: -40, right: -30, width: 120, height: 120, borderRadius: '50%', background: 'radial-gradient(circle, rgba(255,255,255,0.22), transparent 70%)', animation: 'profFloat 7s ease-in-out infinite' }} />
          <Avatar name={user?.name} url={user?.avatar_url} size={64} ring />
          <div style={{ fontWeight: 800, fontSize: 16, color: '#fff', lineHeight: 1.1, position: 'relative' }}>{user?.name}</div>
          <div style={{ fontSize: 11, color: 'rgba(255,255,255,0.85)', wordBreak: 'break-all', position: 'relative' }}>{user?.email}</div>
          <div style={{ position: 'relative', display: 'flex', gap: 6, flexWrap: 'wrap', justifyContent: 'center' }}>
            <RoleBadge role={user?.role} />
          </div>
        </div>

        {/* Nav */}
        <nav style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          {visibleNav.map(n => {
            const active = tab === n.key;
            return (
              <button key={n.key} className="pf-nav" onClick={() => setTab(n.key)} style={{
                display: 'flex', alignItems: 'center', gap: 12, padding: '11px 13px', borderRadius: 12,
                textAlign: 'left', cursor: 'pointer', position: 'relative',
                background: active ? 'linear-gradient(135deg, #9b72f5, #7f55d6)' : 'transparent',
                color: active ? '#fff' : 'var(--text-secondary,#555)',
                boxShadow: active ? '0 8px 20px rgba(127,85,214,0.32)' : 'none',
              }}
                onMouseEnter={e => { if (!active) e.currentTarget.style.background = 'var(--sidebar-hover, rgba(155,114,245,0.06))'; }}
                onMouseLeave={e => { if (!active) e.currentTarget.style.background = 'transparent'; }}
              >
                <span style={{
                  width: 34, height: 34, borderRadius: 9, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 17,
                  background: active ? 'rgba(255,255,255,0.22)' : 'rgba(155,114,245,0.10)',
                }}>{n.icon}</span>
                <span style={{ flex: 1 }}>
                  <span style={{ display: 'block', fontSize: 13.5, fontWeight: 700 }}>{n.key}</span>
                  <span style={{ display: 'block', fontSize: 10.5, opacity: active ? 0.85 : 0.6, marginTop: 1 }}>{n.sub}</span>
                </span>
              </button>
            );
          })}
        </nav>

        <button onClick={logout} className="pf-nav" style={{
          marginTop: 'auto', display: 'flex', alignItems: 'center', gap: 10, padding: '11px 13px', borderRadius: 12,
          color: '#e2445c', fontWeight: 700, fontSize: 13, border: '1px solid rgba(226,68,92,0.28)', background: 'transparent',
        }}
          onMouseEnter={e => e.currentTarget.style.background = 'rgba(226,68,92,0.08)'}
          onMouseLeave={e => e.currentTarget.style.background = 'transparent'}
        >
          <span style={{ fontSize: 16 }}>⎋</span> Sign Out
        </button>
      </aside>

      {/* ════════ Main content ════════ */}
      <main style={{ flex: 1, minWidth: 0, padding: '26px 34px 48px', maxWidth: 1280, margin: '0 auto', width: '100%' }}>
        {/* Greeting header */}
        <div className="pf-fade" style={{ display: 'flex', alignItems: 'flex-end', justifyContent: 'space-between', gap: 16, marginBottom: 24, flexWrap: 'wrap' }}>
          <div>
            <div style={{ fontSize: 13, fontWeight: 700, color: '#9b72f5', letterSpacing: 0.4 }}>{greeting}, {user?.name?.split(' ')[0]} 👋</div>
            <h1 style={{ margin: '4px 0 0', fontSize: 26, fontWeight: 800, color: 'var(--text-primary,#111)' }}>
              {tab === 'Admin' ? 'Admin Dashboard' : tab === 'Security' ? 'Security Center' : 'My Profile'}
            </h1>
          </div>
          <div style={{ fontSize: 12, color: 'var(--text-muted,#9999bb)', fontWeight: 600 }}>
            {new Date().toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric' })}
          </div>
        </div>

        <div key={tab} className="pf-fade">
          {/* ───────────── Profile ───────────── */}
          {tab === 'Profile' && (
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))', gap: 20, alignItems: 'start' }}>
              <form onSubmit={saveProfile} style={cardStyle}>
                <h3 style={sectionTitleStyle}>Personal Information</h3>
                <div style={{ marginBottom: 16 }}>
                  <label style={labelStyle}>Display Name</label>
                  <input value={name} onChange={e => setName(e.target.value)} style={inputStyle} placeholder="Your name" />
                </div>
                <div style={{ marginBottom: 16 }}>
                  <label style={labelStyle}>Email</label>
                  <input value={user?.email} disabled style={{ ...inputStyle, opacity: 0.72, cursor: 'not-allowed' }} />
                  <p style={{ fontSize: 11, color: 'var(--text-muted,#aaa)', marginTop: 4 }}>Email cannot be changed</p>
                </div>
                <div style={{ marginBottom: 24 }}>
                  <label style={labelStyle}>Avatar URL (optional)</label>
                  <input value={avatarUrl} onChange={e => setAvatarUrl(e.target.value)} style={inputStyle} placeholder="https://..." />
                  {avatarUrl && <div style={{ marginTop: 8 }}><Avatar name={name} url={avatarUrl} size={40} /></div>}
                </div>
                <button type="submit" disabled={savingProfile} className="pf-btn" style={btnPrimary}>
                  {savingProfile ? 'Saving…' : 'Save Changes'}
                </button>
              </form>

              {/* Account snapshot */}
              <div style={cardStyle}>
                <h3 style={sectionTitleStyle}>Account Snapshot</h3>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                  {[
                    { icon: '🎖️', label: 'Access Level', value: ROLE_LABELS[user?.role] || user?.role, accent: ROLE_COLORS[user?.role] || '#9b72f5' },
                    { icon: user?.is_sso ? '🟦' : '✉️', label: 'Sign-in Method', value: user?.is_sso ? 'Microsoft SSO' : 'Email & Password', accent: '#6C3DFF' },
                    { icon: '✨', label: 'Account Status', value: 'Active', accent: '#22c55e' },
                  ].map(s => (
                    <div key={s.label} className="pf-card" style={{
                      display: 'flex', alignItems: 'center', gap: 13, padding: '13px 15px', borderRadius: 13,
                      background: 'var(--bg-primary,#f7f8fc)', border: '1px solid var(--border-color, rgba(155,114,245,0.13))',
                    }}>
                      <div style={{ width: 40, height: 40, borderRadius: 11, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 19, background: `${s.accent}1f` }}>{s.icon}</div>
                      <div style={{ flex: 1 }}>
                        <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--text-muted,#9999bb)', textTransform: 'uppercase', letterSpacing: 0.5 }}>{s.label}</div>
                        <div style={{ fontSize: 15, fontWeight: 800, color: s.accent, marginTop: 1 }}>{s.value}</div>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          )}

          {/* ───────────── Security ───────────── */}
          {tab === 'Security' && (
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))', gap: 20, alignItems: 'start' }}>
              {/* Change password */}
              {!user?.is_sso && (
                <form onSubmit={handleChangePassword} style={cardStyle}>
                  <h3 style={sectionTitleStyle}>🔑 Change Password</h3>
                  {[
                    { label: 'Current Password', val: curPwd, set: setCurPwd },
                    { label: 'New Password', val: newPwd, set: setNewPwd },
                    { label: 'Confirm New Password', val: confPwd, set: setConfPwd },
                  ].map(({ label, val, set }) => (
                    <div key={label} style={{ marginBottom: 14 }}>
                      <label style={labelStyle}>{label}</label>
                      <input type="password" value={val} onChange={e => set(e.target.value)} style={inputStyle} required />
                    </div>
                  ))}
                  <button type="submit" disabled={changingPwd} className="pf-btn" style={btnPrimary}>
                    {changingPwd ? 'Changing…' : 'Change Password'}
                  </button>
                </form>
              )}

              {/* Password best-practices */}
              <div style={cardStyle}>
                <h3 style={sectionTitleStyle}>🔐 Keep Your Account Safe</h3>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                  {[
                    { icon: '✅', text: 'Use at least 8 characters with a mix of letters, numbers & symbols.' },
                    { icon: '🚫', text: 'Never reuse a password from another website or service.' },
                    { icon: '🔁', text: 'Change your password periodically, especially after sharing access.' },
                    { icon: '📧', text: user?.is_sso ? 'Your account signs in through Microsoft SSO.' : `You sign in with your email: ${user?.email}.` },
                  ].map((t, i) => (
                    <div key={i} style={{
                      display: 'flex', alignItems: 'flex-start', gap: 12, padding: '12px 14px', borderRadius: 12,
                      background: 'var(--bg-primary,#f7f8fc)', border: '1px solid var(--border-color, rgba(155,114,245,0.13))',
                    }}>
                      <span style={{ fontSize: 17, lineHeight: 1.3 }}>{t.icon}</span>
                      <span style={{ fontSize: 13, color: 'var(--text-secondary,#555)', lineHeight: 1.5 }}>{t.text}</span>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          )}

          {/* ───────────── Admin ───────────── */}
          {tab === 'Admin' && isAdmin && (() => {
            const fmtDate = (d) => d ? toISODate(d) : '—';
            const toggleSort = (col) => {
              if (sortCol === col) setSortDir(d => d === 'asc' ? 'desc' : 'asc');
              else { setSortCol(col); setSortDir('asc'); }
            };
            const SortIcon = ({ col }) => {
              if (sortCol !== col) return <span style={{ color: 'var(--text-muted,#ccc)', marginLeft: 4 }}>⇅</span>;
              return <span style={{ color: '#9b72f5', marginLeft: 4 }}>{sortDir === 'asc' ? '↑' : '↓'}</span>;
            };

            const q = userSearch.toLowerCase();
            const visible = users
              .filter(u => {
                if (q && !u.name.toLowerCase().includes(q) && !u.email.toLowerCase().includes(q)) return false;
                if (filterRole !== 'all' && u.role !== filterRole) return false;
                if (filterStatus === 'active' && !u.is_active) return false;
                if (filterStatus === 'inactive' && u.is_active) return false;
                if (filterType === 'sso' && !u.is_sso) return false;
                if (filterType === 'email' && u.is_sso) return false;
                return true;
              })
              .sort((a, b) => {
                let va, vb;
                if (sortCol === 'name')       { va = a.name.toLowerCase(); vb = b.name.toLowerCase(); }
                else if (sortCol === 'role')  { va = a.role; vb = b.role; }
                else if (sortCol === 'type')  { va = a.is_sso ? 1 : 0; vb = b.is_sso ? 1 : 0; }
                else if (sortCol === 'last_login') { va = a.last_login ? new Date(a.last_login) : new Date(0); vb = b.last_login ? new Date(b.last_login) : new Date(0); }
                else if (sortCol === 'status') { va = a.is_active ? 1 : 0; vb = b.is_active ? 1 : 0; }
                else { va = a.created_at ? new Date(a.created_at) : new Date(0); vb = b.created_at ? new Date(b.created_at) : new Date(0); }
                if (va < vb) return sortDir === 'asc' ? -1 : 1;
                if (va > vb) return sortDir === 'asc' ? 1 : -1;
                return 0;
              });

            // ── Metrics ──
            const counts = { admin: 0, manager: 0, member: 0, user: 0, active: 0, inactive: 0, sso: 0 };
            users.forEach(u => {
              if (counts[u.role] !== undefined) counts[u.role]++;
              if (u.is_active) counts.active++; else counts.inactive++;
              if (u.is_sso) counts.sso++;
            });
            const total = users.length || 1;
            const newThisWeek = users.filter(u => u.created_at && (Date.now() - new Date(u.created_at).getTime()) < 7 * 864e5).length;

            const kpis = [
              { label: 'Total Users', value: users.length, icon: '👥', accent: '#6C3DFF', sub: 'across the workspace' },
              { label: 'Active', value: counts.active, icon: '✅', accent: '#22c55e', sub: `${Math.round(counts.active / total * 100)}% of all users` },
              { label: 'New This Week', value: newThisWeek, icon: '✨', accent: '#fdab3d', sub: 'joined in last 7 days' },
              { label: 'Microsoft SSO', value: counts.sso, icon: '🟦', accent: '#6ba0ff', sub: `${users.length - counts.sso} via email` },
            ];

            const roleBars = ROLES.map(r => ({ role: r, label: ROLE_LABELS[r], count: counts[r], color: ROLE_COLORS[r], pct: Math.round(counts[r] / total * 100) }));
            const maxRole = Math.max(1, ...roleBars.map(r => r.count));

            const thStyle = { padding: '11px 12px', textAlign: 'left', fontWeight: 700, color: 'var(--text-secondary,#555)', fontSize: 11, cursor: 'pointer', userSelect: 'none', whiteSpace: 'nowrap', letterSpacing: '0.4px', textTransform: 'uppercase' };
            const tdStyle = { padding: '11px 12px', verticalAlign: 'middle' };

            return (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>

                {/* KPI row */}
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(190px, 1fr))', gap: 16 }}>
                  {kpis.map((k, i) => (
                    <div key={k.label} className="pf-card pf-pop" style={{ ...cardStyle, padding: '18px 20px', animationDelay: `${i * 0.06}s`, position: 'relative', overflow: 'hidden' }}>
                      <div style={{ position: 'absolute', top: -18, right: -10, fontSize: 64, opacity: 0.06 }}>{k.icon}</div>
                      <div style={{ width: 42, height: 42, borderRadius: 12, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 20, background: `${k.accent}1f`, marginBottom: 12 }}>{k.icon}</div>
                      <div style={{ fontSize: 30, fontWeight: 800, color: k.accent, lineHeight: 1 }}>{k.value}</div>
                      <div style={{ fontSize: 12.5, fontWeight: 700, color: 'var(--text-primary,#111)', marginTop: 5 }}>{k.label}</div>
                      <div style={{ fontSize: 11, color: 'var(--text-muted,#9999bb)', marginTop: 2 }}>{k.sub}</div>
                    </div>
                  ))}
                </div>

                {/* Charts row */}
                <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1.6fr) minmax(0, 1fr)', gap: 16 }}>
                  {/* Role distribution */}
                  <div style={cardStyle}>
                    <h3 style={sectionTitleStyle}>Role Distribution</h3>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
                      {roleBars.map(r => (
                        <div key={r.role}>
                          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
                            <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--text-primary,#111)' }}>{r.label}</span>
                            <span style={{ fontSize: 12, fontWeight: 700, color: r.color }}>{r.count} · {r.pct}%</span>
                          </div>
                          <div style={{ height: 12, borderRadius: 7, background: 'var(--bg-primary,#eef0f5)', overflow: 'hidden' }}>
                            <div className="pf-bar" style={{
                              width: mounted ? `${(r.count / maxRole) * 100}%` : '0%', height: '100%', borderRadius: 7,
                              background: `linear-gradient(90deg, ${r.color}cc, ${r.color})`, boxShadow: `0 0 12px ${r.color}55`,
                            }} />
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>

                  {/* Status donut */}
                  <div style={{ ...cardStyle, display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
                    <h3 style={{ ...sectionTitleStyle, alignSelf: 'flex-start' }}>Account Status</h3>
                    <Donut
                      data={[{ value: counts.active, color: '#22c55e' }, { value: counts.inactive, color: '#e2445c' }]}
                      value={`${Math.round(counts.active / total * 100)}%`} label="Active"
                    />
                    <div style={{ display: 'flex', gap: 18, marginTop: 18 }}>
                      {[{ c: '#22c55e', l: 'Active', v: counts.active }, { c: '#e2445c', l: 'Inactive', v: counts.inactive }].map(s => (
                        <div key={s.l} style={{ display: 'flex', alignItems: 'center', gap: 7 }}>
                          <span style={{ width: 10, height: 10, borderRadius: '50%', background: s.c }} />
                          <span style={{ fontSize: 12, color: 'var(--text-secondary,#555)' }}><b style={{ color: 'var(--text-primary,#111)' }}>{s.v}</b> {s.l}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                </div>

                {/* User management */}
                <div style={cardStyle}>
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 18, flexWrap: 'wrap', gap: 10 }}>
                    <h3 style={{ ...sectionTitleStyle, margin: 0 }}>User Management</h3>
                    <button onClick={() => setShowCreateUser(v => !v)} className="pf-btn" style={{
                      padding: '9px 18px', borderRadius: 10, fontWeight: 700, fontSize: 13, color: '#fff',
                      background: showCreateUser ? '#e2445c' : 'linear-gradient(135deg, #9b72f5, #7f55d6)',
                      boxShadow: showCreateUser ? 'none' : '0 8px 20px rgba(127,85,214,0.32)',
                    }}>{showCreateUser ? '✕ Cancel' : '+ Create User'}</button>
                  </div>

                  {showCreateUser && (
                    <form onSubmit={handleCreateUser} className="pf-fade" style={{ background: 'var(--bg-primary,#f7f8fc)', borderRadius: 14, padding: 22, marginBottom: 20, border: '1.5px solid var(--border-color,#e0e0e0)' }}>
                      <h4 style={{ margin: '0 0 14px', fontSize: 14, fontWeight: 700, color: 'var(--text-primary,#111122)' }}>New User Details</h4>
                      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 12, marginBottom: 12 }}>
                        <div>
                          <label style={labelStyle}>Full Name</label>
                          <input value={newUserName} onChange={e => setNewUserName(e.target.value)} style={inputStyle} placeholder="e.g. Priya Sharma" required />
                        </div>
                        <div>
                          <label style={labelStyle}>Email</label>
                          <input type="email" value={newUserEmail} onChange={e => setNewUserEmail(e.target.value)} style={inputStyle} required />
                        </div>
                        <div>
                          <label style={labelStyle}>Password (min 8 chars)</label>
                          <input type="password" value={newUserPassword} onChange={e => setNewUserPassword(e.target.value)} style={inputStyle} placeholder="••••••••" required />
                        </div>
                        <div>
                          <label style={labelStyle}>Role</label>
                          <select value={newUserRole} onChange={e => setNewUserRole(e.target.value)} style={{ ...inputStyle, cursor: 'pointer' }}>
                            {ROLES.map(r => <option key={r} value={r}>{ROLE_LABELS[r] || r}</option>)}
                          </select>
                        </div>
                      </div>
                      <button type="submit" disabled={creatingUser} className="pf-btn" style={{ ...btnPrimary, fontSize: 13, padding: '9px 22px' }}>
                        {creatingUser ? 'Creating…' : 'Create User'}
                      </button>
                    </form>
                  )}

                  {/* Filter bar */}
                  <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 14, alignItems: 'center' }}>
                    <input value={userSearch} onChange={e => setUserSearch(e.target.value)} placeholder="🔍  Search name or email…"
                      style={{ flex: 1, minWidth: 180, border: '1.5px solid var(--border-color,#ddd)', borderRadius: 9, padding: '8px 12px', fontSize: 13, outline: 'none', background: 'var(--input-bg,#fff)', color: 'var(--text-primary,#323338)' }}
                      onFocus={e => e.target.style.borderColor = '#9b72f5'} onBlur={e => e.target.style.borderColor = 'var(--border-color,#ddd)'} />
                    {[
                      { label: 'Role', value: filterRole, set: setFilterRole, options: [['all','All Roles'],['admin','Admin'],['manager','Manager'],['member','Member'],['user','Read-only']] },
                      { label: 'Status', value: filterStatus, set: setFilterStatus, options: [['all','All Status'],['active','Active'],['inactive','Inactive']] },
                      { label: 'Type', value: filterType, set: setFilterType, options: [['all','All Types'],['email','Email'],['sso','Microsoft SSO']] },
                    ].map(f => (
                      <select key={f.label} value={f.value} onChange={e => f.set(e.target.value)}
                        style={{ border: '1.5px solid var(--border-color,#ddd)', borderRadius: 9, padding: '8px 11px', fontSize: 13, cursor: 'pointer', background: f.value !== 'all' ? 'rgba(155,114,245,0.18)' : 'var(--input-bg,#fff)', color: f.value !== 'all' ? '#9b72f5' : 'var(--text-secondary,#555)', fontWeight: f.value !== 'all' ? 600 : 400 }}>
                        {f.options.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
                      </select>
                    ))}
                    {(userSearch || filterRole !== 'all' || filterStatus !== 'all' || filterType !== 'all') && (
                      <button onClick={() => { setUserSearch(''); setFilterRole('all'); setFilterStatus('all'); setFilterType('all'); }}
                        style={{ fontSize: 12, color: '#e2445c', fontWeight: 600, border: '1px solid #e2445c', borderRadius: 8, padding: '6px 11px' }}>✕ Clear</button>
                    )}
                    <span style={{ fontSize: 12, color: 'var(--text-secondary,#888)', marginLeft: 'auto' }}>
                      {visible.length} of {users.length} user{users.length !== 1 ? 's' : ''}
                    </span>
                  </div>

                  {/* Table */}
                  {loadingUsers ? (
                    <p style={{ color: 'var(--text-secondary,#888)' }}>Loading…</p>
                  ) : (
                    <div style={{ overflowX: 'auto', borderRadius: 14, border: '1px solid var(--border-color, rgba(155,114,245,0.13))' }}>
                      <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
                        <thead>
                          <tr style={{ background: 'var(--bg-primary,#f7f8fc)', borderBottom: '2px solid var(--border-color,#e0e0e0)' }}>
                            <th style={thStyle} onClick={() => toggleSort('name')}>User <SortIcon col="name" /></th>
                            <th style={thStyle} onClick={() => toggleSort('role')}>Role <SortIcon col="role" /></th>
                            <th style={thStyle} onClick={() => toggleSort('type')}>Type <SortIcon col="type" /></th>
                            <th style={thStyle} onClick={() => toggleSort('created_at')}>Created <SortIcon col="created_at" /></th>
                            <th style={thStyle} onClick={() => toggleSort('last_login')}>Last Login <SortIcon col="last_login" /></th>
                            <th style={thStyle} onClick={() => toggleSort('status')}>Status <SortIcon col="status" /></th>
                            <th style={{ ...thStyle, cursor: 'default' }}>Actions</th>
                          </tr>
                        </thead>
                        <tbody>
                          {visible.length === 0 && (
                            <tr><td colSpan={7} style={{ padding: 24, textAlign: 'center', color: 'var(--text-muted,#aaa)', fontSize: 13 }}>No users match the current filters</td></tr>
                          )}
                          {visible.map(u => (
                            <tr key={u.id} className="pf-row" style={{ borderBottom: '1px solid var(--border-color,#f0f0f0)' }}
                              onMouseEnter={e => e.currentTarget.style.background = 'var(--hover-bg, #fafbff)'}
                              onMouseLeave={e => e.currentTarget.style.background = ''}>
                              <td style={tdStyle}>
                                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                                  <Avatar name={u.name} url={u.avatar_url} size={32} />
                                  <div>
                                    <div style={{ fontWeight: 600, fontSize: 13 }}>{u.name}{u.id === user?.id && <span style={{ fontSize: 10, color: 'var(--text-secondary,#888)', marginLeft: 5 }}>(you)</span>}</div>
                                    <div style={{ color: 'var(--text-secondary,#888)', fontSize: 11 }}>{u.email}</div>
                                  </div>
                                </div>
                              </td>
                              <td style={tdStyle}>
                                {u.id === user?.id ? <RoleBadge role={u.role} /> : (
                                  <select value={u.role} onChange={e => handleRoleChange(u.id, e.target.value)}
                                    style={{ border: '1px solid var(--border-color,#ddd)', borderRadius: 6, padding: '4px 8px', fontSize: 12, cursor: 'pointer', background: 'var(--input-bg,#fff)', color: 'var(--text-primary,#323338)' }}>
                                    {ROLES.map(r => <option key={r} value={r}>{ROLE_LABELS[r] || r}</option>)}
                                  </select>
                                )}
                              </td>
                              <td style={tdStyle}>
                                <span style={{ fontSize: 11, color: 'var(--text-secondary,#555)', background: 'var(--hover-bg,#f0f0f0)', borderRadius: 10, padding: '2px 8px' }}>
                                  {u.is_sso ? '🟦 Microsoft' : '📧 Email'}
                                </span>
                              </td>
                              <td style={{ ...tdStyle, color: 'var(--text-secondary,#666)', fontSize: 12, whiteSpace: 'nowrap' }}>{fmtDate(u.created_at)}</td>
                              <td style={{ ...tdStyle, fontSize: 12, whiteSpace: 'nowrap' }}>
                                {u.last_login ? (
                                  <div>
                                    <div style={{ color: 'var(--text-primary,#323338)', fontWeight: 500 }}>{fmtDate(u.last_login)}</div>
                                    <div style={{ color: 'var(--text-secondary,#888)', fontSize: 11 }}>{(() => { const d = new Date(u.last_login); return `${String(d.getHours()).padStart(2,'0')}:${String(d.getMinutes()).padStart(2,'0')}`; })()}</div>
                                  </div>
                                ) : <span style={{ color: 'var(--text-muted,#ccc)' }}>Never</span>}
                              </td>
                              <td style={tdStyle}>
                                {u.id !== user?.id ? (
                                  <button onClick={() => handleToggleActive(u)} style={{
                                    fontSize: 11, fontWeight: 600, borderRadius: 10, padding: '3px 10px', cursor: 'pointer',
                                    background: u.is_active ? 'rgba(34,197,94,0.16)' : 'rgba(226,68,92,0.14)',
                                    color: u.is_active ? '#22c55e' : '#e2445c', border: 'none',
                                  }}>{u.is_active ? '● Active' : '○ Inactive'}</button>
                                ) : <span style={{ fontSize: 11, color: 'var(--text-secondary,#888)' }}>Active (you)</span>}
                              </td>
                              <td style={tdStyle}>
                                {u.id !== user?.id && (
                                  <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                                    <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                                      <button onClick={() => { setResetPasswordFor(resetPasswordFor === u.id ? null : u.id); setResetPwd(''); }} style={{ color: '#9b72f5', fontSize: 12, fontWeight: 600 }}>
                                        {resetPasswordFor === u.id ? 'Cancel' : '🔑 Reset Pwd'}
                                      </button>
                                      <button onClick={() => handleDeleteUser(u)} style={{ color: '#e2445c', fontSize: 12, fontWeight: 600 }}>Delete</button>
                                    </div>
                                    {resetPasswordFor === u.id && (
                                      <form onSubmit={e => handleAdminResetPassword(e, u.id)} style={{ display: 'flex', gap: 4, marginTop: 2 }}>
                                        <input type="password" value={resetPwd} onChange={e => setResetPwd(e.target.value)} placeholder="New password" minLength={8} required autoFocus
                                          style={{ border: '1.5px solid #9b72f5', borderRadius: 6, padding: '4px 8px', fontSize: 12, outline: 'none', width: 130 }} />
                                        <button type="submit" disabled={resettingPwd || resetPwd.length < 8}
                                          style={{ background: '#9b72f5', color: '#fff', borderRadius: 6, padding: '4px 10px', fontSize: 12, fontWeight: 600, opacity: resettingPwd ? 0.7 : 1 }}>{resettingPwd ? '…' : 'Set'}</button>
                                      </form>
                                    )}
                                  </div>
                                )}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}
                </div>
              </div>
            );
          })()}
        </div>
      </main>
    </div>
  );
}

const labelStyle = { display: 'block', fontSize: 12, fontWeight: 600, color: 'var(--text-secondary,#555)', marginBottom: 5 };
const sectionTitleStyle = { margin: '0 0 18px', fontSize: 16, fontWeight: 800, color: 'var(--text-primary,#111122)' };
const cardStyle = {
  background: 'var(--card-bg,#fff)', border: '1px solid var(--border-color, rgba(155,114,245,0.13))',
  borderRadius: 18, padding: 24, boxShadow: '0 10px 34px rgba(80,50,150,0.09)',
};
const inputStyle = {
  width: '100%', boxSizing: 'border-box', border: '1.5px solid var(--border-color,#ddd)',
  borderRadius: 10, padding: '10px 13px', fontSize: 14, outline: 'none',
  background: 'var(--input-bg,#fff)', color: 'var(--text-primary,#323338)',
};
const btnPrimary = {
  padding: '11px 22px', background: 'linear-gradient(135deg, #9b72f5, #7f55d6)', color: '#fff',
  borderRadius: 10, fontWeight: 700, fontSize: 14, cursor: 'pointer', border: 'none',
  boxShadow: '0 8px 22px rgba(127,85,214,0.32)',
};
