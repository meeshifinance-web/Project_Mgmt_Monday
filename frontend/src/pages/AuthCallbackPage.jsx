import React, { useEffect } from 'react';
import { useSearchParams, useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { getMe } from '../api';
import { useToast } from '../components/Toast';

export default function AuthCallbackPage() {
  const [searchParams] = useSearchParams();
  const { login } = useAuth();
  const navigate = useNavigate();
  const toast = useToast();

  useEffect(() => {
    const success = searchParams.get('success');
    const token   = searchParams.get('token');

    if (success === 'true') {
      // New flow: backend set an httpOnly cookie — no token in URL.
      // Verify by calling /auth/me (cookie is sent automatically).
      getMe()
        .then(r => {
          login(null, r.data);
          toast(`Welcome, ${r.data.name}!`, 'success');
          navigate('/');
        })
        .catch(() => {
          toast('Authentication failed', 'error');
          navigate('/login');
        });
    } else if (token) {
      // Legacy fallback: token arrived in the URL (old backend).
      localStorage.setItem('wb_token', token);
      getMe()
        .then(r => {
          login(token, r.data);
          toast(`Welcome, ${r.data.name}!`, 'success');
          navigate('/');
        })
        .catch(() => {
          localStorage.removeItem('wb_token');
          toast('Authentication failed', 'error');
          navigate('/login');
        });
    } else {
      toast('Microsoft login failed', 'error');
      navigate('/login');
    }
  }, []);

  return (
    <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', background: '#f0f2f5' }}>
      <div style={{ textAlign: 'center' }}>
        <div style={{ fontSize: 36, marginBottom: 12 }}>⏳</div>
        <p style={{ color: '#555', fontWeight: 500 }}>Completing sign-in…</p>
      </div>
    </div>
  );
}
