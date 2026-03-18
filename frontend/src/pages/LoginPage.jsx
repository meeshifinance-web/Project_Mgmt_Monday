import React, { useState, useEffect } from 'react';
import { useNavigate, Link, useSearchParams } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { authLogin, authMfaVerify } from '../api';
import { useToast } from '../components/Toast';

const ERROR_MESSAGES = {
  microsoft_not_configured: 'Microsoft SSO is not configured yet.',
  account_disabled: 'Your account has been deactivated. Contact an admin.',
  microsoft_auth_failed: 'Microsoft login failed. Please try again.',
  invalid_state: 'OAuth state mismatch. Please try again.',
};

export default function LoginPage() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [mfaStep, setMfaStep] = useState(false);
  const [tempToken, setTempToken] = useState('');
  const [mfaCode, setMfaCode] = useState('');
  const [loading, setLoading] = useState(false);
  const { login } = useAuth();
  const navigate = useNavigate();
  const toast = useToast();
  const [searchParams] = useSearchParams();

  useEffect(() => {
    const err = searchParams.get('error');
    if (err) toast(ERROR_MESSAGES[err] || `Login error: ${err}`, 'error');
  }, []);

  const handleLogin = async (e) => {
    e.preventDefault();
    setLoading(true);
    try {
      const r = await authLogin(email, password);
      if (r.data.mfa_required) {
        setTempToken(r.data.temp_token);
        setMfaStep(true);
      } else {
        login(r.data.token, r.data.user);
        navigate('/');
      }
    } catch (err) {
      toast(err.response?.data?.error || 'Login failed', 'error');
    } finally {
      setLoading(false);
    }
  };

  const handleMfa = async (e) => {
    e.preventDefault();
    setLoading(true);
    try {
      const r = await authMfaVerify(tempToken, mfaCode);
      login(r.data.token, r.data.user);
      navigate('/');
    } catch (err) {
      toast(err.response?.data?.error || 'Invalid code', 'error');
      setMfaCode('');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div style={{
      minHeight: '100vh', display: 'flex', background: '#f0f2f5',
    }}>
      {/* Left panel */}
      <div style={{
        width: 420, background: '#1c1f3b', display: 'flex', flexDirection: 'column',
        alignItems: 'center', justifyContent: 'center', padding: 48,
        flexShrink: 0,
      }}>
        <div style={{ textAlign: 'center', color: '#fff' }}>
          <div style={{ fontSize: 48, marginBottom: 16 }}>📋</div>
          <div style={{ fontSize: 26, fontWeight: 800, marginBottom: 8 }}>
            <span style={{ color: '#fdab3d' }}>D'Decor</span> Workboard
          </div>
          <div style={{ color: 'rgba(255,255,255,0.5)', fontSize: 14, lineHeight: 1.6 }}>
            Project management for<br />D'Decor Home Fabrics
          </div>
          <div style={{ marginTop: 40, display: 'flex', flexDirection: 'column', gap: 16 }}>
            {['Track projects', 'Manage teams', 'Automate workflows'].map(t => (
              <div key={t} style={{ display: 'flex', alignItems: 'center', gap: 10, color: 'rgba(255,255,255,0.7)', fontSize: 14 }}>
                <span style={{ color: '#00c875', fontSize: 16 }}>✓</span>{t}
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Right panel */}
      <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24 }}>
        <div style={{ width: '100%', maxWidth: 400 }}>
          {!mfaStep ? (
            <>
              <h1 style={{ fontSize: 24, fontWeight: 700, marginBottom: 6, color: '#1c1f3b' }}>Sign in</h1>
              <p style={{ color: '#888', marginBottom: 28, fontSize: 14 }}>Enter your credentials to access your board</p>

              {/* Microsoft SSO */}
              <a
                href="/api/auth/microsoft"
                style={{
                  display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 10,
                  width: '100%', padding: '11px 16px', border: '1.5px solid #ddd', borderRadius: 8,
                  background: '#fff', color: '#323338', fontWeight: 600, fontSize: 14,
                  textDecoration: 'none', marginBottom: 20, transition: 'border-color 0.15s',
                }}
                onMouseEnter={e => e.currentTarget.style.borderColor = '#0073ea'}
                onMouseLeave={e => e.currentTarget.style.borderColor = '#ddd'}
              >
                <svg width="20" height="20" viewBox="0 0 21 21"><rect x="1" y="1" width="9" height="9" fill="#f25022"/><rect x="11" y="1" width="9" height="9" fill="#7fba00"/><rect x="1" y="11" width="9" height="9" fill="#00a4ef"/><rect x="11" y="11" width="9" height="9" fill="#ffb900"/></svg>
                Sign in with Microsoft
              </a>

              <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 20 }}>
                <div style={{ flex: 1, height: 1, background: '#e0e0e0' }} />
                <span style={{ color: '#aaa', fontSize: 12 }}>or sign in with email</span>
                <div style={{ flex: 1, height: 1, background: '#e0e0e0' }} />
              </div>

              <form onSubmit={handleLogin}>
                <label style={{ display: 'block', marginBottom: 14 }}>
                  <span style={labelStyle}>Email</span>
                  <input
                    type="email" value={email} onChange={e => setEmail(e.target.value)}
                    placeholder="you@ddecor.com" required autoFocus style={inputStyle}
                  />
                </label>
                <label style={{ display: 'block', marginBottom: 8 }}>
                  <span style={labelStyle}>Password</span>
                  <input
                    type="password" value={password} onChange={e => setPassword(e.target.value)}
                    placeholder="••••••••" required style={inputStyle}
                  />
                </label>
                <div style={{ textAlign: 'right', marginBottom: 20 }}>
                  <Link to="/forgot-password" style={{ fontSize: 13, color: '#0073ea', textDecoration: 'none' }}>
                    Forgot password?
                  </Link>
                </div>
                <button type="submit" disabled={loading} style={btnPrimary}>
                  {loading ? 'Signing in…' : 'Sign in'}
                </button>
              </form>

              <p style={{ textAlign: 'center', marginTop: 20, fontSize: 13, color: '#888' }}>
                Don't have an account?{' '}
                <Link to="/register" style={{ color: '#0073ea', textDecoration: 'none', fontWeight: 600 }}>Register</Link>
              </p>
            </>
          ) : (
            <>
              <h1 style={{ fontSize: 24, fontWeight: 700, marginBottom: 6, color: '#1c1f3b' }}>Two-Factor Auth</h1>
              <p style={{ color: '#888', marginBottom: 28, fontSize: 14 }}>
                Enter the 6-digit code from your authenticator app
              </p>
              <form onSubmit={handleMfa}>
                <input
                  autoFocus value={mfaCode} onChange={e => setMfaCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
                  placeholder="000000" maxLength={6} style={{ ...inputStyle, textAlign: 'center', fontSize: 24, letterSpacing: 8 }}
                />
                <button type="submit" disabled={loading || mfaCode.length !== 6} style={{ ...btnPrimary, marginTop: 16 }}>
                  {loading ? 'Verifying…' : 'Verify'}
                </button>
                <button type="button" onClick={() => { setMfaStep(false); setMfaCode(''); }}
                  style={{ ...btnSecondary, marginTop: 8 }}>
                  ← Back
                </button>
              </form>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

const labelStyle = { display: 'block', fontSize: 12, fontWeight: 600, color: '#555', marginBottom: 6 };
const inputStyle = {
  width: '100%', border: '1.5px solid #ddd', borderRadius: 8, padding: '10px 12px',
  fontSize: 14, outline: 'none', transition: 'border-color 0.15s',
  onFocus: e => e.target.style.borderColor = '#0073ea',
};
const btnPrimary = {
  width: '100%', padding: '11px 16px', background: '#0073ea', color: '#fff',
  borderRadius: 8, fontWeight: 700, fontSize: 14, cursor: 'pointer',
  opacity: 1, transition: 'opacity 0.15s',
};
const btnSecondary = {
  width: '100%', padding: '10px 16px', border: '1.5px solid #ddd', borderRadius: 8,
  fontWeight: 600, fontSize: 14, cursor: 'pointer', background: '#fff',
};
