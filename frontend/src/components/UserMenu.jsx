import React, { useState, useRef, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { useThemeContext } from '../context/ThemeContext';

const ROLE_COLORS = { admin: '#e2445c', manager: '#fdab3d', member: '#00c875', user: '#9b72f5' };

const THEME_OPTIONS = [
  { value: 'light', label: 'Light', icon: '☀️' },
  { value: 'dark',  label: 'Dark',  icon: '🌙' },
  { value: 'system', label: 'System Default', icon: '💻' },
];

export default function UserMenu() {
  const [open, setOpen] = useState(false);
  const [menuPos, setMenuPos] = useState(null);
  const { user, logout, isAdmin } = useAuth();
  const themeCtx = useThemeContext();
  const theme = themeCtx?.theme ?? 'system';
  const setTheme = themeCtx?.setTheme ?? (() => {});
  const navigate = useNavigate();
  const ref = useRef(null);
  const btnRef = useRef(null);
  const menuRef = useRef(null);

  const computeMenuPos = () => {
    const rect = btnRef.current?.getBoundingClientRect();
    if (!rect) return null;
    return { top: rect.bottom + 4, right: Math.max(8, window.innerWidth - rect.right) };
  };

  useEffect(() => {
    const handler = (e) => {
      if (
        ref.current && !ref.current.contains(e.target) &&
        menuRef.current && !menuRef.current.contains(e.target)
      ) {
        setOpen(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  useEffect(() => {
    if (!open) return undefined;
    const update = () => {
      const pos = computeMenuPos();
      if (pos) setMenuPos(pos);
    };
    update();
    window.addEventListener('resize', update);
    window.addEventListener('scroll', update, true);
    return () => {
      window.removeEventListener('resize', update);
      window.removeEventListener('scroll', update, true);
    };
  }, [open]);

  if (!user) return null;

  const initials = (user.name || '?').split(' ').map(w => w[0]).join('').toUpperCase().slice(0, 2);
  const openMenu = () => {
    const pos = computeMenuPos();
    if (pos) setMenuPos(pos);
    setOpen(o => !o);
  };

  return (
    <div ref={ref} style={{ position: 'relative', flexShrink: 0 }}>
      <button
        ref={btnRef}
        onClick={openMenu}
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
            width: 32, height: 32, borderRadius: '50%', background: '#9b72f5',
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

      {open && menuPos && createPortal((
        <div style={{
          position: 'fixed', top: menuPos.top, right: menuPos.right, zIndex: 10000,
          background: 'var(--card-bg)', borderRadius: 10,
          boxShadow: 'var(--shadow)', border: '1px solid var(--border-color)',
          width: 210, padding: 6,
        }} ref={menuRef}>
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
                {theme === opt.value && <span style={{ fontSize: 12, color: '#9b72f5' }}>✓</span>}
              </button>
            ))}
          </div>

          <div style={{ borderTop: '1px solid var(--border-color)', marginTop: 4, paddingTop: 4 }}>
            <MenuItem icon="🚪" label="Sign Out" onClick={() => { logout(); navigate('/login'); }} danger />
          </div>
        </div>
      ), document.body)}
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
