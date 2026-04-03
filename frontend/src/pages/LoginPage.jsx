import React, { useState, useEffect } from 'react';
import { useNavigate, Link, useSearchParams } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { authLogin, authMfaVerify } from '../api';
import { useToast } from '../components/Toast';
import { useThemeContext } from '../context/ThemeContext';

const ERROR_MESSAGES = {
  microsoft_not_configured: 'Microsoft SSO is not configured yet.',
  account_disabled: 'Your account has been deactivated. Contact an admin.',
  microsoft_auth_failed: 'Microsoft login failed. Please try again.',
  invalid_state: 'OAuth state mismatch. Please try again.',
};

export default function LoginPage() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [mfaStep, setMfaStep] = useState(false);
  const [tempToken, setTempToken] = useState('');
  const [mfaCode, setMfaCode] = useState('');
  const [loading, setLoading] = useState(false);
  const { login } = useAuth();
  const navigate = useNavigate();
  const toast = useToast();
  const [searchParams] = useSearchParams();
  const { resolvedTheme } = useThemeContext();
  const isDark = resolvedTheme === 'dark';

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

  const features = [
    { icon: '✅', text: 'Track tasks & projects in real time' },
    { icon: '🔔', text: 'Automated reminders & escalations' },
    { icon: '👥', text: 'Collaborate across teams seamlessly' },
    { icon: '📊', text: 'Full visibility on project delivery' },
  ];

  return (
    <div style={{ minHeight: '100vh', display: 'flex', background: 'var(--bg-primary)' }}>

      {/* ── Left branding panel (desktop only) ─────────────────────────────── */}
      <div
        className="login-left-panel"
        style={{
          width: '50%',
          background: '#1f2d3d',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          padding: '48px',
          position: 'relative',
          animation: 'loginFadeIn 0.5s ease 0.1s both',
        }}
      >
        <div style={{ textAlign: 'center' }}>
          <img
            src="/ddecor-logo.png"
            alt="D'Decor"
            style={{ width: '220px', marginBottom: '8px', filter: 'brightness(0) invert(1)' }}
          />
          <div style={{ color: '#0073ea', fontSize: '22px', fontWeight: 700, letterSpacing: '-0.5px', marginBottom: '4px' }}>
            Workboard
          </div>
          <div style={{ color: '#8ba3bc', fontSize: '14px', marginBottom: '48px', fontStyle: 'italic' }}>
            Your team's project management hub
          </div>
          <div style={{ width: '60px', height: '2px', background: '#0073ea', borderRadius: '2px', margin: '0 auto 40px' }} />
          <div style={{ display: 'flex', flexDirection: 'column', gap: '16px', textAlign: 'left' }}>
            {features.map(({ icon, text }) => (
              <div key={text} style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                <span style={{ fontSize: '20px' }}>{icon}</span>
                <span style={{ color: '#c5cdd8', fontSize: '14px', lineHeight: 1.5 }}>{text}</span>
              </div>
            ))}
          </div>
        </div>
        <div style={{ position: 'absolute', bottom: '24px', color: '#4a6580', fontSize: '11px' }}>
          © D'Decor Home Fabrics Pvt. Ltd.
        </div>
      </div>

      {/* ── Right form panel (also full-screen on mobile) ───────────────────── */}
      <div style={{
        flex: 1,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        background: 'var(--bg-primary)',
        padding: '32px 24px',
        minHeight: '100vh',
      }}>
        <div style={{ width: '100%', maxWidth: '400px', padding: '48px 32px', animation: 'loginFadeIn 0.4s ease forwards' }}>

          {/* Mobile-only logo header */}
          <div
            className="login-mobile-logo"
            style={{ flexDirection: 'column', alignItems: 'center', marginBottom: '32px' }}
          >
            <img
              src="/ddecor-logo.png"
              alt="D'Decor"
              style={{ width: '180px', marginBottom: '6px', filter: isDark ? 'brightness(0) invert(1)' : 'none' }}
            />
            <div style={{ color: '#0073ea', fontSize: '20px', fontWeight: 700, marginBottom: '4px' }}>Workboard</div>
            <div style={{ color: 'var(--text-secondary)', fontSize: '13px', textAlign: 'center' }}>
              Project Management Platform
            </div>
          </div>

          {!mfaStep ? (
            <>
              <h1 style={{ fontSize: '28px', fontWeight: 700, color: 'var(--text-primary)', marginBottom: '8px' }}>
                Welcome back 👋
              </h1>
              <p style={{ fontSize: '14px', color: 'var(--text-secondary)', marginBottom: '32px' }}>
                Sign in to your Workboard account
              </p>

              {/* Microsoft SSO button */}
              <a
                href="/api/auth/microsoft"
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  gap: '12px',
                  width: '100%',
                  height: '52px',
                  background: '#ffffff',
                  border: '1.5px solid #e6e9ef',
                  borderRadius: '10px',
                  cursor: 'pointer',
                  boxShadow: '0 1px 4px rgba(0,0,0,0.08)',
                  textDecoration: 'none',
                  transition: 'all 0.2s ease',
                  marginBottom: '20px',
                }}
                onMouseEnter={e => {
                  e.currentTarget.style.background = '#f7f8f9';
                  e.currentTarget.style.boxShadow = '0 4px 12px rgba(0,0,0,0.12)';
                  e.currentTarget.style.borderColor = '#d0d9e6';
                }}
                onMouseLeave={e => {
                  e.currentTarget.style.background = '#ffffff';
                  e.currentTarget.style.boxShadow = '0 1px 4px rgba(0,0,0,0.08)';
                  e.currentTarget.style.borderColor = '#e6e9ef';
                }}
              >
                <svg width="20" height="20" viewBox="0 0 21 21">
                  <rect x="1" y="1" width="9" height="9" fill="#f25022"/>
                  <rect x="11" y="1" width="9" height="9" fill="#7fba00"/>
                  <rect x="1" y="11" width="9" height="9" fill="#00a4ef"/>
                  <rect x="11" y="11" width="9" height="9" fill="#ffb900"/>
                </svg>
                <span style={{ fontSize: '15px', fontWeight: 500, color: '#323338' }}>Sign in with Microsoft</span>
              </a>

              {/* OR divider */}
              <div style={{ display: 'flex', alignItems: 'center', gap: '12px', marginTop: '20px', marginBottom: '20px' }}>
                <div style={{ flex: 1, height: '1px', background: 'var(--border-color)' }} />
                <span style={{ fontSize: '13px', color: 'var(--text-secondary)' }}>or sign in with email</span>
                <div style={{ flex: 1, height: '1px', background: 'var(--border-color)' }} />
              </div>

              <form onSubmit={handleLogin}>
                {/* Email */}
                <input
                  type="email"
                  value={email}
                  onChange={e => setEmail(e.target.value)}
                  placeholder="your@ddecor.com"
                  required
                  autoFocus
                  style={inputStyle}
                  onFocus={e => {
                    e.target.style.borderColor = '#0073ea';
                    e.target.style.boxShadow = '0 0 0 3px rgba(0,115,234,0.12)';
                  }}
                  onBlur={e => {
                    e.target.style.borderColor = 'var(--border-color)';
                    e.target.style.boxShadow = 'none';
                  }}
                />

                {/* Password with show/hide toggle */}
                <div style={{ position: 'relative', marginBottom: '6px' }}>
                  <input
                    type={showPassword ? 'text' : 'password'}
                    value={password}
                    onChange={e => setPassword(e.target.value)}
                    placeholder="••••••••"
                    required
                    style={{ ...inputStyle, marginBottom: 0, paddingRight: '44px' }}
                    onFocus={e => {
                      e.target.style.borderColor = '#0073ea';
                      e.target.style.boxShadow = '0 0 0 3px rgba(0,115,234,0.12)';
                    }}
                    onBlur={e => {
                      e.target.style.borderColor = 'var(--border-color)';
                      e.target.style.boxShadow = 'none';
                    }}
                  />
                  <button
                    type="button"
                    className="login-pwd-toggle"
                    onClick={() => setShowPassword(v => !v)}
                    style={{
                      position: 'absolute',
                      right: '12px',
                      top: '50%',
                      transform: 'translateY(-50%)',
                      background: 'none',
                      border: 'none',
                      color: 'var(--text-secondary)',
                      cursor: 'pointer',
                      fontSize: '16px',
                      lineHeight: 1,
                    }}
                  >
                    {showPassword ? '👁' : '👁‍🗨'}
                  </button>
                </div>

                {/* Forgot password */}
                <div style={{ textAlign: 'right', marginTop: '6px', marginBottom: '24px' }}>
                  <Link
                    to="/forgot-password"
                    style={{ fontSize: '13px', color: '#0073ea', textDecoration: 'none' }}
                    onMouseEnter={e => e.currentTarget.style.textDecoration = 'underline'}
                    onMouseLeave={e => e.currentTarget.style.textDecoration = 'none'}
                  >
                    Forgot password?
                  </Link>
                </div>

                {/* Sign In button */}
                <button
                  type="submit"
                  disabled={loading}
                  style={{
                    width: '100%',
                    height: '48px',
                    background: '#0073ea',
                    color: '#ffffff',
                    fontSize: '15px',
                    fontWeight: 600,
                    border: 'none',
                    borderRadius: '8px',
                    cursor: loading ? 'not-allowed' : 'pointer',
                    opacity: loading ? 0.7 : 1,
                    transition: 'background 0.15s ease',
                    marginBottom: '24px',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    gap: '8px',
                  }}
                  onMouseEnter={e => { if (!loading) e.currentTarget.style.background = '#0060c0'; }}
                  onMouseLeave={e => { if (!loading) e.currentTarget.style.background = '#0073ea'; }}
                  onMouseDown={e => { if (!loading) e.currentTarget.style.background = '#0052a3'; }}
                  onMouseUp={e => { if (!loading) e.currentTarget.style.background = '#0060c0'; }}
                >
                  {loading ? (
                    <>
                      <span style={{
                        display: 'inline-block',
                        width: '16px',
                        height: '16px',
                        border: '2px solid rgba(255,255,255,0.3)',
                        borderTopColor: '#fff',
                        borderRadius: '50%',
                        animation: 'spin 0.7s linear infinite',
                        flexShrink: 0,
                      }} />
                      Signing in...
                    </>
                  ) : 'Sign in'}
                </button>
              </form>

              {/* Register link */}
              <p style={{ textAlign: 'center', fontSize: '13px', color: 'var(--text-secondary)' }}>
                Don't have an account?{' '}
                <Link to="/register" style={{ color: '#0073ea', textDecoration: 'none', fontWeight: 500 }}>
                  Register
                </Link>
              </p>
            </>
          ) : (
            /* ── MFA step ──────────────────────────────────────────────────── */
            <>
              <h1 style={{ fontSize: '28px', fontWeight: 700, marginBottom: '8px', color: 'var(--text-primary)' }}>
                Two-Factor Auth
              </h1>
              <p style={{ color: 'var(--text-secondary)', marginBottom: '28px', fontSize: '14px' }}>
                Enter the 6-digit code from your authenticator app
              </p>
              <form onSubmit={handleMfa}>
                <input
                  autoFocus
                  value={mfaCode}
                  onChange={e => setMfaCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
                  placeholder="000000"
                  maxLength={6}
                  style={{ ...inputStyle, textAlign: 'center', fontSize: '24px', letterSpacing: '8px' }}
                  onFocus={e => {
                    e.target.style.borderColor = '#0073ea';
                    e.target.style.boxShadow = '0 0 0 3px rgba(0,115,234,0.12)';
                  }}
                  onBlur={e => {
                    e.target.style.borderColor = 'var(--border-color)';
                    e.target.style.boxShadow = 'none';
                  }}
                />
                <button
                  type="submit"
                  disabled={loading || mfaCode.length !== 6}
                  style={{
                    width: '100%',
                    height: '48px',
                    background: '#0073ea',
                    color: '#ffffff',
                    fontSize: '15px',
                    fontWeight: 600,
                    border: 'none',
                    borderRadius: '8px',
                    cursor: (loading || mfaCode.length !== 6) ? 'not-allowed' : 'pointer',
                    opacity: (loading || mfaCode.length !== 6) ? 0.7 : 1,
                    transition: 'background 0.15s ease',
                    marginTop: '16px',
                    marginBottom: '8px',
                  }}
                  onMouseEnter={e => { if (!loading && mfaCode.length === 6) e.currentTarget.style.background = '#0060c0'; }}
                  onMouseLeave={e => { if (!loading && mfaCode.length === 6) e.currentTarget.style.background = '#0073ea'; }}
                >
                  {loading ? 'Verifying…' : 'Verify'}
                </button>
                <button
                  type="button"
                  onClick={() => { setMfaStep(false); setMfaCode(''); }}
                  style={{
                    width: '100%',
                    height: '44px',
                    background: 'none',
                    border: '1.5px solid var(--border-color)',
                    borderRadius: '8px',
                    fontSize: '14px',
                    fontWeight: 500,
                    color: 'var(--text-secondary)',
                    cursor: 'pointer',
                    marginTop: '8px',
                    transition: 'border-color 0.15s',
                  }}
                  onMouseEnter={e => e.currentTarget.style.borderColor = '#0073ea'}
                  onMouseLeave={e => e.currentTarget.style.borderColor = 'var(--border-color)'}
                >
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

const inputStyle = {
  display: 'block',
  width: '100%',
  height: '46px',
  border: '1.5px solid var(--border-color)',
  borderRadius: '8px',
  padding: '0 16px',
  fontSize: '14px',
  color: 'var(--text-primary)',
  background: 'var(--input-bg)',
  marginBottom: '12px',
  outline: 'none',
  transition: 'border-color 0.2s, box-shadow 0.2s',
};
