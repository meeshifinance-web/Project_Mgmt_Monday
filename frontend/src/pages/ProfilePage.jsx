import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { useToast } from '../components/Toast';
import {
  updateMe, changePassword, setupMfa, enableMfa, disableMfa,
  getUsers, adminCreateUser, adminResetPassword, updateUserRole, setUserActive, deleteUser,
} from '../api';

const TABS = ['Profile', 'Security', 'Admin'];
const ROLES = ['admin', 'manager', 'member', 'user'];
const ROLE_COLORS = { admin: '#e2445c', manager: '#fdab3d', member: '#0073ea', user: '#888' };
const ROLE_LABELS = { admin: 'Admin', manager: 'Manager', member: 'Member', user: 'User (Read-only)' };

function RoleBadge({ role }) {
  return (
    <span style={{
      background: ROLE_COLORS[role] || '#ccc', color: '#fff',
      borderRadius: 12, padding: '2px 10px', fontSize: 11, fontWeight: 700,
    }}>{ROLE_LABELS[role] || role}</span>
  );
}

function Avatar({ name, url, size = 48 }) {
  const initials = (name || '?').split(' ').map(w => w[0]).join('').toUpperCase().slice(0, 2);
  if (url) return <img src={url} alt={name} style={{ width: size, height: size, borderRadius: '50%', objectFit: 'cover' }} />;
  return (
    <div style={{
      width: size, height: size, borderRadius: '50%', background: '#0073ea',
      color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center',
      fontWeight: 700, fontSize: size * 0.35,
    }}>{initials}</div>
  );
}

export default function ProfilePage() {
  const { user, updateUser, logout, isAdmin } = useAuth();
  const toast = useToast();
  const navigate = useNavigate();
  const [tab, setTab] = useState('Profile');

  // Profile tab
  const [name, setName] = useState(user?.name || '');
  const [avatarUrl, setAvatarUrl] = useState(user?.avatar_url || '');
  const [savingProfile, setSavingProfile] = useState(false);

  // Security tab
  const [curPwd, setCurPwd] = useState('');
  const [newPwd, setNewPwd] = useState('');
  const [confPwd, setConfPwd] = useState('');
  const [changingPwd, setChangingPwd] = useState(false);

  // MFA tab
  const [mfaQr, setMfaQr] = useState(null);
  const [mfaCode, setMfaCode] = useState('');
  const [mfaEnabled, setMfaEnabled] = useState(user?.mfa_enabled || false);
  const [disablePwd, setDisablePwd] = useState('');
  const [loadingMfa, setLoadingMfa] = useState(false);

  // Admin tab
  const [users, setUsers] = useState([]);
  const [loadingUsers, setLoadingUsers] = useState(false);
  const [showCreateUser, setShowCreateUser] = useState(false);
  const [resetPasswordFor, setResetPasswordFor] = useState(null); // userId
  const [resetPwd, setResetPwd] = useState('');
  const [resettingPwd, setResettingPwd] = useState(false);
  const [newUserName, setNewUserName] = useState('');
  const [newUserEmail, setNewUserEmail] = useState('');
  const [newUserPassword, setNewUserPassword] = useState('');
  const [newUserRole, setNewUserRole] = useState('user');
  const [creatingUser, setCreatingUser] = useState(false);

  useEffect(() => {
    if (tab === 'Admin' && isAdmin) {
      setLoadingUsers(true);
      getUsers().then(r => setUsers(r.data)).catch(() => toast('Failed to load users', 'error')).finally(() => setLoadingUsers(false));
    }
  }, [tab]);

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

  const handleMfaSetup = async () => {
    setLoadingMfa(true);
    try {
      const r = await setupMfa();
      setMfaQr(r.data);
    } catch (err) {
      toast(err.response?.data?.error || 'MFA setup failed', 'error');
    } finally {
      setLoadingMfa(false);
    }
  };

  const handleMfaEnable = async (e) => {
    e.preventDefault();
    setLoadingMfa(true);
    try {
      await enableMfa(mfaCode);
      setMfaEnabled(true);
      setMfaQr(null);
      setMfaCode('');
      updateUser({ mfa_enabled: true });
      toast('MFA enabled successfully', 'success');
    } catch (err) {
      toast(err.response?.data?.error || 'Invalid code', 'error');
    } finally {
      setLoadingMfa(false);
    }
  };

  const handleMfaDisable = async (e) => {
    e.preventDefault();
    setLoadingMfa(true);
    try {
      await disableMfa(disablePwd);
      setMfaEnabled(false);
      setDisablePwd('');
      updateUser({ mfa_enabled: false });
      toast('MFA disabled', 'success');
    } catch (err) {
      toast(err.response?.data?.error || 'Failed to disable MFA', 'error');
    } finally {
      setLoadingMfa(false);
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

  const visibleTabs = TABS.filter(t => t !== 'Admin' || isAdmin);

  return (
    <div style={{ minHeight: '100vh', background: '#f0f2f5' }}>
      {/* Header */}
      <div style={{ background: '#fff', borderBottom: '1px solid #e0e0e0', padding: '0 24px', height: 52, display: 'flex', alignItems: 'center', gap: 12 }}>
        <button onClick={() => navigate('/')} style={{ color: '#0073ea', fontWeight: 600, fontSize: 13 }}>← Back to Board</button>
        <span style={{ color: '#ccc' }}>|</span>
        <span style={{ fontWeight: 700, fontSize: 16 }}>Profile & Settings</span>
      </div>

      <div style={{ maxWidth: 780, margin: '0 auto', padding: '32px 16px' }}>
        {/* User card */}
        <div style={{ background: '#fff', borderRadius: 12, padding: 24, marginBottom: 24, display: 'flex', alignItems: 'center', gap: 16, boxShadow: '0 2px 8px rgba(0,0,0,0.06)' }}>
          <Avatar name={user?.name} url={user?.avatar_url} size={64} />
          <div>
            <div style={{ fontWeight: 700, fontSize: 18, color: '#1c1f3b' }}>{user?.name}</div>
            <div style={{ color: '#888', fontSize: 13, marginBottom: 6 }}>{user?.email}</div>
            <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
              <RoleBadge role={user?.role} />
              {user?.is_sso && <span style={{ fontSize: 11, color: '#555', background: '#f0f0f0', borderRadius: 10, padding: '2px 8px' }}>Microsoft SSO</span>}
              {user?.mfa_enabled && <span style={{ fontSize: 11, color: '#037f4c', background: '#e8f7ee', borderRadius: 10, padding: '2px 8px' }}>🔒 MFA On</span>}
            </div>
          </div>
          <button onClick={logout} style={{ marginLeft: 'auto', color: '#e2445c', fontWeight: 600, fontSize: 13, border: '1px solid #e2445c', borderRadius: 6, padding: '6px 14px' }}>
            Sign Out
          </button>
        </div>

        {/* Tabs */}
        <div style={{ display: 'flex', gap: 0, background: '#fff', borderRadius: 10, padding: 4, boxShadow: '0 2px 8px rgba(0,0,0,0.06)', marginBottom: 24 }}>
          {visibleTabs.map(t => (
            <button key={t} onClick={() => setTab(t)} style={{
              flex: 1, padding: '8px 0', borderRadius: 8, fontWeight: 600, fontSize: 13,
              background: tab === t ? '#0073ea' : 'transparent',
              color: tab === t ? '#fff' : '#555',
            }}>{t}</button>
          ))}
        </div>

        <div style={{ background: '#fff', borderRadius: 12, padding: 28, boxShadow: '0 2px 8px rgba(0,0,0,0.06)' }}>
          {/* ── Profile Tab ── */}
          {tab === 'Profile' && (
            <form onSubmit={saveProfile}>
              <h3 style={{ marginBottom: 20, fontSize: 15, fontWeight: 700 }}>Personal Information</h3>
              <div style={{ marginBottom: 16 }}>
                <label style={labelStyle}>Display Name</label>
                <input value={name} onChange={e => setName(e.target.value)} style={inputStyle} placeholder="Your name" />
              </div>
              <div style={{ marginBottom: 16 }}>
                <label style={labelStyle}>Email</label>
                <input value={user?.email} disabled style={{ ...inputStyle, background: '#f7f8fc', color: '#888', cursor: 'not-allowed' }} />
                <p style={{ fontSize: 11, color: '#aaa', marginTop: 4 }}>Email cannot be changed</p>
              </div>
              <div style={{ marginBottom: 24 }}>
                <label style={labelStyle}>Avatar URL (optional)</label>
                <input value={avatarUrl} onChange={e => setAvatarUrl(e.target.value)} style={inputStyle} placeholder="https://..." />
                {avatarUrl && (
                  <div style={{ marginTop: 8 }}>
                    <Avatar name={name} url={avatarUrl} size={40} />
                  </div>
                )}
              </div>
              <button type="submit" disabled={savingProfile} style={btnPrimary}>
                {savingProfile ? 'Saving…' : 'Save Changes'}
              </button>
            </form>
          )}

          {/* ── Security Tab ── */}
          {tab === 'Security' && (
            <div>
              {/* Change password */}
              {!user?.is_sso && (
                <div style={{ marginBottom: 36 }}>
                  <h3 style={{ marginBottom: 16, fontSize: 15, fontWeight: 700 }}>Change Password</h3>
                  <form onSubmit={handleChangePassword}>
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
                    <button type="submit" disabled={changingPwd} style={btnPrimary}>
                      {changingPwd ? 'Changing…' : 'Change Password'}
                    </button>
                  </form>
                </div>
              )}

              {/* MFA section */}
              <div>
                <h3 style={{ marginBottom: 4, fontSize: 15, fontWeight: 700 }}>Two-Factor Authentication (TOTP)</h3>
                <p style={{ color: '#888', fontSize: 13, marginBottom: 16 }}>
                  Use an authenticator app like Google Authenticator or Microsoft Authenticator.
                </p>

                {mfaEnabled ? (
                  <div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 16, background: '#e8f7ee', borderRadius: 8, padding: '10px 14px' }}>
                      <span style={{ fontSize: 18 }}>🔒</span>
                      <span style={{ fontWeight: 600, color: '#037f4c', fontSize: 13 }}>MFA is enabled on your account</span>
                    </div>
                    <form onSubmit={handleMfaDisable}>
                      {!user?.is_sso && (
                        <div style={{ marginBottom: 12 }}>
                          <label style={labelStyle}>Enter password to disable</label>
                          <input type="password" value={disablePwd} onChange={e => setDisablePwd(e.target.value)} style={inputStyle} required />
                        </div>
                      )}
                      <button type="submit" disabled={loadingMfa} style={{ ...btnPrimary, background: '#e2445c' }}>
                        {loadingMfa ? 'Disabling…' : 'Disable MFA'}
                      </button>
                    </form>
                  </div>
                ) : mfaQr ? (
                  <div>
                    <p style={{ fontSize: 13, color: '#555', marginBottom: 12 }}>
                      Scan this QR code with your authenticator app, then enter the 6-digit code to confirm:
                    </p>
                    <img src={mfaQr.qrCode} alt="MFA QR" style={{ width: 180, marginBottom: 12, display: 'block' }} />
                    <p style={{ fontSize: 11, color: '#888', marginBottom: 12 }}>
                      Manual key: <code style={{ background: '#f0f0f0', padding: '2px 6px', borderRadius: 4 }}>{mfaQr.secret}</code>
                    </p>
                    <form onSubmit={handleMfaEnable} style={{ display: 'flex', gap: 8 }}>
                      <input
                        value={mfaCode} onChange={e => setMfaCode(e.target.value.replace(/\D/g,'').slice(0,6))}
                        placeholder="6-digit code" maxLength={6} style={{ ...inputStyle, width: 140, textAlign: 'center', letterSpacing: 4 }}
                      />
                      <button type="submit" disabled={loadingMfa || mfaCode.length !== 6} style={{ ...btnPrimary, width: 'auto', padding: '8px 20px' }}>
                        {loadingMfa ? '…' : 'Enable'}
                      </button>
                    </form>
                  </div>
                ) : (
                  <button onClick={handleMfaSetup} disabled={loadingMfa} style={{ ...btnPrimary, width: 'auto', padding: '8px 20px' }}>
                    {loadingMfa ? 'Loading…' : 'Set Up MFA'}
                  </button>
                )}
              </div>
            </div>
          )}

          {/* ── Admin Tab ── */}
          {tab === 'Admin' && isAdmin && (
            <div>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16 }}>
                <h3 style={{ fontSize: 15, fontWeight: 700, margin: 0 }}>User Management</h3>
                <button
                  onClick={() => setShowCreateUser(v => !v)}
                  style={{ padding: '7px 16px', background: '#0073ea', color: '#fff', borderRadius: 8, fontWeight: 600, fontSize: 13 }}
                >
                  {showCreateUser ? '✕ Cancel' : '+ Create User'}
                </button>
              </div>

              {showCreateUser && (
                <form onSubmit={handleCreateUser} style={{
                  background: '#f7f8fc', borderRadius: 10, padding: 20, marginBottom: 20,
                  border: '1.5px solid #e0e0e0',
                }}>
                  <h4 style={{ margin: '0 0 14px', fontSize: 14, fontWeight: 700, color: '#323338' }}>New User Details</h4>
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginBottom: 12 }}>
                    <div>
                      <label style={labelStyle}>Full Name</label>
                      <input value={newUserName} onChange={e => setNewUserName(e.target.value)} style={inputStyle} placeholder="e.g. Priya Sharma" required />
                    </div>
                    <div>
                      <label style={labelStyle}>Email</label>
                      <input type="email" value={newUserEmail} onChange={e => setNewUserEmail(e.target.value)} style={inputStyle} placeholder="priya@ddecor.com" required />
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
                  <button type="submit" disabled={creatingUser} style={{ ...btnPrimary, fontSize: 13, padding: '8px 20px' }}>
                    {creatingUser ? 'Creating…' : 'Create User'}
                  </button>
                </form>
              )}

              {loadingUsers ? (
                <p style={{ color: '#888' }}>Loading…</p>
              ) : (
                <div style={{ overflowX: 'auto' }}>
                  <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
                    <thead>
                      <tr style={{ background: '#f7f8fc', borderBottom: '2px solid #e0e0e0' }}>
                        {['User', 'Role', 'Type', 'Last Login', 'Status', 'Actions'].map(h => (
                          <th key={h} style={{ padding: '8px 12px', textAlign: 'left', fontWeight: 700, color: '#555', fontSize: 12 }}>{h}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {users.map(u => (
                        <tr key={u.id} style={{ borderBottom: '1px solid #f0f0f0' }}>
                          <td style={{ padding: '10px 12px' }}>
                            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                              <Avatar name={u.name} url={u.avatar_url} size={32} />
                              <div>
                                <div style={{ fontWeight: 600 }}>{u.name}</div>
                                <div style={{ color: '#888', fontSize: 11 }}>{u.email}</div>
                              </div>
                            </div>
                          </td>
                          <td style={{ padding: '10px 12px' }}>
                            {u.id === user?.id ? (
                              <RoleBadge role={u.role} />
                            ) : (
                              <select
                                value={u.role}
                                onChange={e => handleRoleChange(u.id, e.target.value)}
                                style={{ border: '1px solid #ddd', borderRadius: 6, padding: '4px 8px', fontSize: 12, cursor: 'pointer' }}
                              >
                                {ROLES.map(r => <option key={r} value={r}>{r}</option>)}
                              </select>
                            )}
                          </td>
                          <td style={{ padding: '10px 12px' }}>
                            <span style={{ fontSize: 11, color: '#555', background: '#f0f0f0', borderRadius: 10, padding: '2px 8px' }}>
                              {u.is_sso ? '🟦 Microsoft' : '📧 Email'}
                            </span>
                          </td>
                          <td style={{ padding: '10px 12px', color: '#888', fontSize: 12 }}>
                            {u.last_login ? new Date(u.last_login).toLocaleDateString('en-IN') : 'Never'}
                          </td>
                          <td style={{ padding: '10px 12px' }}>
                            {u.id !== user?.id ? (
                              <button
                                onClick={() => handleToggleActive(u)}
                                style={{
                                  fontSize: 11, fontWeight: 600, borderRadius: 10, padding: '3px 10px', cursor: 'pointer',
                                  background: u.is_active ? '#e8f7ee' : '#fde8e8',
                                  color: u.is_active ? '#037f4c' : '#e2445c',
                                  border: 'none',
                                }}
                              >
                                {u.is_active ? '● Active' : '○ Inactive'}
                              </button>
                            ) : (
                              <span style={{ fontSize: 11, color: '#888' }}>You</span>
                            )}
                          </td>
                          <td style={{ padding: '10px 12px' }}>
                            {u.id !== user?.id && (
                              <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                                <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                                  <button
                                    onClick={() => { setResetPasswordFor(resetPasswordFor === u.id ? null : u.id); setResetPwd(''); }}
                                    style={{ color: '#0073ea', fontSize: 12, fontWeight: 600 }}
                                    title="Reset password"
                                  >
                                    {resetPasswordFor === u.id ? 'Cancel' : '🔑 Reset Pwd'}
                                  </button>
                                  <button onClick={() => handleDeleteUser(u)} style={{ color: '#e2445c', fontSize: 12, fontWeight: 600 }}>
                                    Delete
                                  </button>
                                </div>
                                {resetPasswordFor === u.id && (
                                  <form onSubmit={e => handleAdminResetPassword(e, u.id)} style={{ display: 'flex', gap: 4, marginTop: 2 }}>
                                    <input
                                      type="password"
                                      value={resetPwd}
                                      onChange={e => setResetPwd(e.target.value)}
                                      placeholder="New password"
                                      minLength={8}
                                      required
                                      autoFocus
                                      style={{ border: '1.5px solid #0073ea', borderRadius: 6, padding: '4px 8px', fontSize: 12, outline: 'none', width: 130 }}
                                    />
                                    <button
                                      type="submit"
                                      disabled={resettingPwd || resetPwd.length < 8}
                                      style={{ background: '#0073ea', color: '#fff', borderRadius: 6, padding: '4px 10px', fontSize: 12, fontWeight: 600, opacity: resettingPwd ? 0.7 : 1 }}
                                    >
                                      {resettingPwd ? '…' : 'Set'}
                                    </button>
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
          )}
        </div>
      </div>
    </div>
  );
}

const labelStyle = { display: 'block', fontSize: 12, fontWeight: 600, color: '#555', marginBottom: 5 };
const inputStyle = { width: '100%', border: '1.5px solid #ddd', borderRadius: 8, padding: '9px 12px', fontSize: 14, outline: 'none' };
const btnPrimary = { padding: '10px 20px', background: '#0073ea', color: '#fff', borderRadius: 8, fontWeight: 700, fontSize: 14, cursor: 'pointer' };
