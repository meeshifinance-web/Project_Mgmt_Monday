import React, { useState, useRef, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { useThemeContext } from '../context/ThemeContext';

const ROLE_COLORS = { admin: '#e2445c', manager: '#fdab3d', member: '#00c875', user: '#0073ea' };

const THEME_OPTIONS = [
  { value: 'light', label: 'Light', icon: '☀️' },
  { value: 'dark',  label: 'Dark',  icon: '🌙' },
  { value: 'system', label: 'System Default', icon: '💻' },
];

export default function UserMenu() {
  const [open, setOpen] = useState(false);
  const { user, logout, isAdmin } = useAuth();
  const themeCtx = useThemeContext();
  const theme = themeCtx?.theme ?? 'system';
  const setTheme = themeCtx?.setTheme ?? (() => {});
  const navigate = useNavigate();
  const ref = useRef(null);

  useEffect(() => {
    const handler = (e) => { if (ref.current && !ref.current.contains(e.target)) setOpen(false); };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  if (!user) return null;

  const initials = (user.name || '?').split(' ').map(w => w[0]).join('').toUpperCase().slice(0, 2);

  return (
    <div ref={ref} style={{ position: 'relative' }}>
      <button
        onClick={() => setOpen(o => !o)}
        style={{
          display: 'flex', alignItems: 'center', gap: 8, padding: '4px 8px',
          borderRadius: 8, cursor: 'pointer', border: '1px solid transparent',
          transition: 'background 0.15s',
        }}
        onMouseEnter={e => e.currentTarget.style.background = 'var(--hover-bg)'}
        onMouseLeave={e => e.currentTarget.style.background = 'transparent'}
      >
        {user.avatar_url ? (
          <img src={user.avatar_url} alt={user.name} style={{ width: 32, height: 32, borderRadius: '50%', objectFit: 'cover' }} />
        ) : (
          <div style={{
            width: 32, height: 32, borderRadius: '50%', background: '#0073ea',
            color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center',
            fontWeight: 700, fontSize: 13,
          }}>{initials}</div>
        )}
        <div style={{ textAlign: 'left' }}>
          <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--text-primary)', lineHeight: 1.2 }}>{user.name}</div>
          <span style={{
            fontSize: 10, fontWeight: 700, color: ROLE_COLORS[user.role] || '#888',
            textTransform: 'capitalize',
          }}>{user.role}</span>
        </div>
        <span style={{ fontSize: 10, color: 'var(--text-secondary)', marginLeft: 2 }}>▼</span>
      </button>

      {open && (
        <div style={{
          position: 'absolute', top: '100%', right: 0, marginTop: 4, zIndex: 200,
          background: 'var(--card-bg)', borderRadius: 10,
          boxShadow: 'var(--shadow)', border: '1px solid var(--border-color)',
          minWidth: 210, padding: 6,
        }}>
          <div style={{ padding: '8px 12px', borderBottom: '1px solid var(--border-color)', marginBottom: 4 }}>
            <div style={{ fontWeight: 600, fontSize: 13, color: 'var(--text-primary)' }}>{user.name}</div>
            <div style={{ fontSize: 11, color: 'var(--text-secondary)' }}>{user.email}</div>
          </div>

          <MenuItem icon="👤" label="My Profile" onClick={() => { navigate('/profile'); setOpen(false); }} />
          {isAdmin && <MenuItem icon="⚙️" label="Admin — Users" onClick={() => { navigate('/profile'); setOpen(false); }} />}

          {/* Theme Section */}
          <div style={{ borderTop: '1px solid var(--border-color)', marginTop: 4, paddingTop: 4 }}>
            <div style={{ padding: '4px 12px 4px', fontSize: 11, fontWeight: 500, color: 'var(--text-secondary)', textTransform: 'uppercase', letterSpacing: '0.5px' }}>
              Theme
            </div>
            {THEME_OPTIONS.map(opt => (
              <button
                key={opt.value}
                onClick={() => setTheme(opt.value)}
                style={{
                  width: '100%', textAlign: 'left', padding: '7px 12px', borderRadius: 6,
                  display: 'flex', alignItems: 'center', gap: 8, fontSize: 13,
                  color: 'var(--text-primary)', fontWeight: theme === opt.value ? 600 : 400,
                  background: theme === opt.value ? 'var(--hover-bg)' : 'transparent',
                  cursor: 'pointer', transition: 'background 0.1s',
                }}
                onMouseEnter={e => { if (theme !== opt.value) e.currentTarget.style.background = 'var(--hover-bg)'; }}
                onMouseLeave={e => { if (theme !== opt.value) e.currentTarget.style.background = 'transparent'; }}
              >
                <span style={{ fontSize: 14 }}>{opt.icon}</span>
                <span style={{ flex: 1 }}>{opt.label}</span>
                {theme === opt.value && <span style={{ fontSize: 12, color: '#0073ea' }}>✓</span>}
              </button>
            ))}
          </div>

          <div style={{ borderTop: '1px solid var(--border-color)', marginTop: 4, paddingTop: 4 }}>
            <MenuItem icon="🚪" label="Sign Out" onClick={() => { logout(); navigate('/login'); }} danger />
          </div>
        </div>
      )}
    </div>
  );
}

function MenuItem({ icon, label, onClick, danger }) {
  return (
    <button
      onClick={onClick}
      style={{
        width: '100%', textAlign: 'left', padding: '8px 12px', borderRadius: 6,
        display: 'flex', alignItems: 'center', gap: 8, fontSize: 13,
        color: danger ? '#e2445c' : 'var(--text-primary)', fontWeight: 500, cursor: 'pointer',
        transition: 'background 0.1s',
      }}
      onMouseEnter={e => e.currentTarget.style.background = danger ? '#fde8e8' : 'var(--hover-bg)'}
      onMouseLeave={e => e.currentTarget.style.background = 'transparent'}
    >
      <span>{icon}</span>{label}
    </button>
  );
}
