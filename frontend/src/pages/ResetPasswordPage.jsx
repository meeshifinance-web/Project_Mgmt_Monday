import React, { useState } from 'react';
import { useSearchParams, Link, useNavigate } from 'react-router-dom';
import { authResetPassword } from '../api';
import { useToast } from '../components/Toast';

export default function ResetPasswordPage() {
  const [searchParams] = useSearchParams();
  const token = searchParams.get('token');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [done, setDone] = useState(false);
  const [loading, setLoading] = useState(false);
  const toast = useToast();
  const navigate = useNavigate();

  if (!token) {
    return (
      <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', background: '#f0f2f5' }}>
        <div style={{ textAlign: 'center' }}>
          <div style={{ fontSize: 48, marginBottom: 12 }}>❌</div>
          <p style={{ color: '#e2445c', fontWeight: 600 }}>Invalid reset link</p>
          <Link to="/login" style={{ color: '#0073ea', marginTop: 16, display: 'block' }}>Back to Login</Link>
        </div>
      </div>
    );
  }

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (password !== confirm) return toast('Passwords do not match', 'error');
    if (password.length < 8) return toast('Password must be at least 8 characters', 'error');

    setLoading(true);
    try {
      await authResetPassword(token, password);
      setDone(true);
      setTimeout(() => navigate('/login'), 2500);
    } catch (err) {
      toast(err.response?.data?.error || 'Reset failed', 'error');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', background: '#f0f2f5' }}>
      <div style={{ width: '100%', maxWidth: 400, background: '#fff', borderRadius: 12, padding: 36, boxShadow: '0 4px 24px rgba(0,0,0,0.08)' }}>
        <div style={{ textAlign: 'center', marginBottom: 28 }}>
          <div style={{ fontSize: 36, marginBottom: 8 }}>🔐</div>
          <h1 style={{ fontSize: 22, fontWeight: 700, color: '#1c1f3b' }}>New Password</h1>
        </div>

        {done ? (
          <div style={{ textAlign: 'center' }}>
            <div style={{ fontSize: 48, marginBottom: 12 }}>✅</div>
            <p style={{ fontWeight: 600, color: '#00c875' }}>Password reset successfully!</p>
            <p style={{ color: '#888', fontSize: 13, marginTop: 6 }}>Redirecting to login…</p>
          </div>
        ) : (
          <form onSubmit={handleSubmit}>
            {[
              { label: 'New Password', val: password, set: setPassword, placeholder: '8+ characters' },
              { label: 'Confirm Password', val: confirm, set: setConfirm, placeholder: 'Repeat password' },
            ].map(({ label, val, set, placeholder }) => (
              <label key={label} style={{ display: 'block', marginBottom: 14 }}>
                <span style={{ display: 'block', fontSize: 12, fontWeight: 600, color: '#555', marginBottom: 5 }}>{label}</span>
                <input
                  type="password" value={val} onChange={e => set(e.target.value)}
                  placeholder={placeholder} required
                  style={{ width: '100%', border: '1.5px solid #ddd', borderRadius: 8, padding: '10px 12px', fontSize: 14, outline: 'none' }}
                />
              </label>
            ))}
            <button type="submit" disabled={loading} style={{
              width: '100%', padding: '11px', background: '#0073ea', color: '#fff',
              borderRadius: 8, fontWeight: 700, fontSize: 14, cursor: 'pointer', marginTop: 4,
            }}>
              {loading ? 'Resetting…' : 'Set New Password'}
            </button>
          </form>
        )}
      </div>
    </div>
  );
}
