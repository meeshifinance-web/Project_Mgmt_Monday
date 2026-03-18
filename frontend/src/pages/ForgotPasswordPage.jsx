import React, { useState } from 'react';
import { Link } from 'react-router-dom';
import { authForgotPassword } from '../api';

export default function ForgotPasswordPage() {
  const [email, setEmail] = useState('');
  const [sent, setSent] = useState(false);
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setLoading(true);
    try {
      await authForgotPassword(email);
      setSent(true);
    } catch {
      setSent(true); // Don't reveal errors
    } finally {
      setLoading(false);
    }
  };

  return (
    <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', background: '#f0f2f5' }}>
      <div style={{ width: '100%', maxWidth: 400, background: '#fff', borderRadius: 12, padding: 36, boxShadow: '0 4px 24px rgba(0,0,0,0.08)' }}>
        <div style={{ textAlign: 'center', marginBottom: 28 }}>
          <div style={{ fontSize: 36, marginBottom: 8 }}>🔑</div>
          <h1 style={{ fontSize: 22, fontWeight: 700, color: '#1c1f3b' }}>Reset Password</h1>
          <p style={{ color: '#888', fontSize: 13, marginTop: 4 }}>
            Enter your email and we'll send you a reset link
          </p>
        </div>

        {sent ? (
          <div style={{ textAlign: 'center' }}>
            <div style={{ fontSize: 48, marginBottom: 12 }}>📬</div>
            <p style={{ color: '#323338', fontWeight: 600, marginBottom: 8 }}>Check your inbox</p>
            <p style={{ color: '#888', fontSize: 13, marginBottom: 24 }}>
              If <strong>{email}</strong> is registered, you'll receive a reset link shortly.<br />
              (If email is not configured, check the backend console for the link.)
            </p>
            <Link to="/login" style={{ color: '#0073ea', fontWeight: 600, textDecoration: 'none' }}>← Back to Login</Link>
          </div>
        ) : (
          <form onSubmit={handleSubmit}>
            <label style={{ display: 'block', marginBottom: 20 }}>
              <span style={{ display: 'block', fontSize: 12, fontWeight: 600, color: '#555', marginBottom: 6 }}>Email</span>
              <input
                type="email" value={email} onChange={e => setEmail(e.target.value)}
                placeholder="you@ddecor.com" required autoFocus
                style={{ width: '100%', border: '1.5px solid #ddd', borderRadius: 8, padding: '10px 12px', fontSize: 14, outline: 'none' }}
              />
            </label>
            <button type="submit" disabled={loading} style={{
              width: '100%', padding: '11px', background: '#0073ea', color: '#fff',
              borderRadius: 8, fontWeight: 700, fontSize: 14, cursor: 'pointer',
            }}>
              {loading ? 'Sending…' : 'Send Reset Link'}
            </button>
            <p style={{ textAlign: 'center', marginTop: 16, fontSize: 13 }}>
              <Link to="/login" style={{ color: '#0073ea', textDecoration: 'none' }}>← Back to Login</Link>
            </p>
          </form>
        )}
      </div>
    </div>
  );
}
