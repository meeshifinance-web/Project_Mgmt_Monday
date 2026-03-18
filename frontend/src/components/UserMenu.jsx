import React, { useState, useRef, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';

const ROLE_COLORS = { admin: '#e2445c', manager: '#fdab3d', user: '#0073ea' };

export default function UserMenu() {
  const [open, setOpen] = useState(false);
  const { user, logout, isAdmin } = useAuth();
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
        onMouseEnter={e => e.currentTarget.style.background = '#f0f2f5'}
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
          <div style={{ fontSize: 13, fontWeight: 600, color: '#323338', lineHeight: 1.2 }}>{user.name}</div>
          <span style={{
            fontSize: 10, fontWeight: 700, color: ROLE_COLORS[user.role] || '#888',
            textTransform: 'capitalize',
          }}>{user.role}</span>
        </div>
        <span style={{ fontSize: 10, color: '#aaa', marginLeft: 2 }}>▼</span>
      </button>

      {open && (
        <div style={{
          position: 'absolute', top: '100%', right: 0, marginTop: 4, zIndex: 200,
          background: '#fff', borderRadius: 10, boxShadow: '0 4px 20px rgba(0,0,0,0.15)',
          minWidth: 200, padding: 6,
        }}>
          <div style={{ padding: '8px 12px', borderBottom: '1px solid #f0f0f0', marginBottom: 4 }}>
            <div style={{ fontWeight: 600, fontSize: 13 }}>{user.name}</div>
            <div style={{ fontSize: 11, color: '#888' }}>{user.email}</div>
          </div>

          <MenuItem icon="👤" label="My Profile" onClick={() => { navigate('/profile'); setOpen(false); }} />
          {isAdmin && <MenuItem icon="⚙️" label="Admin — Users" onClick={() => { navigate('/profile'); setOpen(false); }} />}

          <div style={{ borderTop: '1px solid #f0f0f0', marginTop: 4, paddingTop: 4 }}>
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
        color: danger ? '#e2445c' : '#323338', fontWeight: 500, cursor: 'pointer',
      }}
      onMouseEnter={e => e.currentTarget.style.background = danger ? '#fde8e8' : '#f7f8fc'}
      onMouseLeave={e => e.currentTarget.style.background = 'transparent'}
    >
      <span>{icon}</span>{label}
    </button>
  );
}
