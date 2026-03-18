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
    const token = searchParams.get('token');
    if (!token) {
      toast('Microsoft login failed', 'error');
      navigate('/login');
      return;
    }
    // Set token, then fetch user profile
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
