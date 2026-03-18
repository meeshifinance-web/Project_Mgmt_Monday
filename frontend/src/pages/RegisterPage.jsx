import React, { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { authRegister } from '../api';
import { useToast } from '../components/Toast';

export default function RegisterPage() {
  const [form, setForm] = useState({ name: '', email: '', password: '', confirm: '' });
  const [loading, setLoading] = useState(false);
  const { login } = useAuth();
  const navigate = useNavigate();
  const toast = useToast();

  const set = (k) => (e) => setForm(f => ({ ...f, [k]: e.target.value }));

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (form.password !== form.confirm) return toast('Passwords do not match', 'error');
    if (form.password.length < 8) return toast('Password must be at least 8 characters', 'error');

    setLoading(true);
    try {
      const r = await authRegister({ name: form.name, email: form.email, password: form.password });
      login(r.data.token, r.data.user);
      toast(`Welcome, ${r.data.user.name}!`, 'success');
      navigate('/');
    } catch (err) {
      toast(err.response?.data?.error || 'Registration failed', 'error');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', background: '#f0f2f5' }}>
      <div style={{ width: '100%', maxWidth: 420, background: '#fff', borderRadius: 12, padding: 36, boxShadow: '0 4px 24px rgba(0,0,0,0.08)' }}>
        <div style={{ textAlign: 'center', marginBottom: 28 }}>
          <div style={{ fontSize: 36, marginBottom: 8 }}>📋</div>
          <h1 style={{ fontSize: 22, fontWeight: 700, color: '#1c1f3b' }}>Create Account</h1>
          <p style={{ color: '#888', fontSize: 13, marginTop: 4 }}>Join D'Decor Workboard</p>
        </div>

        <form onSubmit={handleSubmit}>
          {[
            { label: 'Full Name', key: 'name', type: 'text', placeholder: 'Anupam Kumar' },
            { label: 'Email', key: 'email', type: 'email', placeholder: 'you@ddecor.com' },
            { label: 'Password', key: 'password', type: 'password', placeholder: '8+ characters' },
            { label: 'Confirm Password', key: 'confirm', type: 'password', placeholder: 'Repeat password' },
          ].map(({ label, key, type, placeholder }) => (
            <label key={key} style={{ display: 'block', marginBottom: 14 }}>
              <span style={{ display: 'block', fontSize: 12, fontWeight: 600, color: '#555', marginBottom: 5 }}>{label}</span>
              <input
                type={type} value={form[key]} onChange={set(key)}
                placeholder={placeholder} required
                style={{ width: '100%', border: '1.5px solid #ddd', borderRadius: 8, padding: '10px 12px', fontSize: 14, outline: 'none' }}
              />
            </label>
          ))}

          <div style={{ fontSize: 12, color: '#888', marginBottom: 16, background: '#f7f8fc', borderRadius: 6, padding: '8px 12px' }}>
            <strong>Note:</strong> The first registered user automatically becomes <strong>Admin</strong>.
          </div>

          <button type="submit" disabled={loading} style={{
            width: '100%', padding: '11px', background: '#0073ea', color: '#fff',
            borderRadius: 8, fontWeight: 700, fontSize: 14, cursor: 'pointer',
          }}>
            {loading ? 'Creating account…' : 'Create Account'}
          </button>
        </form>

        <p style={{ textAlign: 'center', marginTop: 20, fontSize: 13, color: '#888' }}>
          Already have an account?{' '}
          <Link to="/login" style={{ color: '#0073ea', textDecoration: 'none', fontWeight: 600 }}>Sign in</Link>
        </p>
      </div>
    </div>
  );
}
