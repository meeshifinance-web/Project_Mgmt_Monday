import React, { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { authRegister } from '../api';
import { useToast } from '../components/Toast';
import { LIGHT_LOGO_SRC } from '../hooks/useThemeLogo';

export default function RegisterPage() {
  const [form, setForm] = useState({ name: '', email: '', password: '', confirm: '' });
  const [showPwd, setShowPwd]         = useState(false);
  const [showConfirm, setShowConfirm] = useState(false);
  const [loading, setLoading]         = useState(false);
  const { login }   = useAuth();
  const navigate    = useNavigate();
  const toast       = useToast();

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
    <>
      <style>{`
        .reg *, .reg *::before, .reg *::after { box-sizing: border-box; margin: 0; padding: 0; }

        /* ── Page shell — identical gradient to login ─────────────────────── */
        .reg {
          position: relative;
          width: 100vw;
          height: 100vh;
          overflow: hidden;
          display: flex;
          align-items: center;
          justify-content: center;
          font-family: 'DM Sans', sans-serif;
          background:
            linear-gradient(
              to bottom,
              transparent            0%,
              transparent           42%,
              rgba(255,255,255,0.30) 54%,
              rgba(255,255,255,0.68) 65%,
              rgba(255,255,255,0.90) 76%,
              rgba(255,255,255,1)   88%
            ),
            linear-gradient(
              90deg,
              rgba(234,226,255,1)   0%,
              rgba(246,238,245,1)  52%,
              rgba(248,238,229,1) 100%
            );
        }

        .reg::after {
          content: '';
          position: absolute;
          top: -80px; left: -60px;
          width: 460px; height: 460px;
          background: radial-gradient(circle, rgba(195,166,255,0.22) 0%, transparent 68%);
          pointer-events: none;
          z-index: 0;
        }

        /* ── Logo — pinned top-left ───────────────────────────────────────── */
        .reg-logo {
          position: absolute;
          top: 28px; left: 32px;
          z-index: 10;
          text-decoration: none;
          display: inline-block;
          line-height: 0;
        }
        .reg-logo img {
          height: 100px;
          width: auto;
          object-fit: contain;
          display: block;
        }

        /* ── Character — pinned bottom-left ──────────────────────────────── */
        .reg-char {
          position: absolute;
          bottom: 0; left: 145px;
          width: 355px;
          z-index: 2;
          pointer-events: none;
          line-height: 0;
        }
        .reg-char img {
          width: 100%;
          height: auto;
          object-fit: contain;
          display: block;
          filter: drop-shadow(0 16px 36px rgba(130,90,190,0.16));
        }

        /* ── Two-column grid ─────────────────────────────────────────────── */
        .reg-wrap {
          position: relative;
          z-index: 1;
          width: 100%;
          max-width: 1320px;
          height: 100%;
          display: grid;
          grid-template-columns: 1fr 1fr;
          gap: 40px;
          align-items: center;
          padding: 130px 64px 130px 64px;
        }

        /* ── LEFT hero ───────────────────────────────────────────────────── */
        .reg-left {
          display: flex;
          flex-direction: column;
          justify-content: center;
          align-items: center;
          width: max-content;
          transform: translate(-34px, -46px);
        }

        .reg-title {
          font-family: 'Satoshi', 'Geist', 'General Sans', 'Inter', 'DM Sans', system-ui, -apple-system, BlinkMacSystemFont, sans-serif;
          font-size: clamp(70px, 5.25vw, 98px);
          font-weight: 800;
          line-height: 0.95;
          color: #0B1020;
          letter-spacing: -0.05em;
          margin-bottom: 22px;
          white-space: nowrap;
          text-rendering: geometricPrecision;
          -webkit-font-smoothing: antialiased;
          -moz-osx-font-smoothing: grayscale;
        }

        .reg-title-grad {
          background: linear-gradient(90deg, #6C4CFF 0%, #B45CFF 35%, #FF78B2 68%, #FFB38A 100%);
          -webkit-background-clip: text;
          -webkit-text-fill-color: transparent;
          background-clip: text;
        }

        .reg-accent {
          width: 64px;
          height: 3.5px;
          border-radius: 3px;
          background: linear-gradient(90deg, #b48aff, #f87a8c);
          margin: 0 auto 26px;
          box-shadow: 0 2px 12px rgba(180,138,255,0.45);
        }

        .reg-desc {
          font-family: 'Inter', 'DM Sans', sans-serif;
          font-size: 17px;
          font-weight: 900;
          line-height: 1.72;
          color: #20243a;
          margin: 0 auto 14px;
          max-width: 380px;
          text-align: center;
          letter-spacing: -0.01em;
        }

        .reg-tagline {
          font-family: 'Cormorant Garamond', 'Georgia', serif;
          font-style: italic;
          font-size: 20px;
          font-weight: 600;
          color: #2e2e4a;
          line-height: 1.65;
          letter-spacing: 0.1px;
          margin: 0 auto;
          text-align: center;
        }

        .reg-char-mobile { display: none; }

        /* ── RIGHT card ──────────────────────────────────────────────────── */
        .reg-right {
          display: flex;
          align-items: center;
          justify-content: flex-end;
          max-height: calc(100vh - 80px);
          overflow-y: auto;
        }

        .reg-card {
          background: rgba(255,255,255,0.97);
          border-radius: 24px;
          padding: 36px 44px 30px;
          width: 100%;
          max-width: 530px;
          box-shadow:
            0 2px 0px rgba(255,255,255,0.8) inset,
            0 12px 48px rgba(100,70,180,0.10),
            0 2px  8px rgba(100,70,180,0.06);
          border: 1px solid rgba(255,255,255,0.72);
          backdrop-filter: blur(2px);
        }

        .reg-card-title {
          font-family: 'Cormorant Garamond', 'Georgia', serif;
          font-size: clamp(28px, 3vw, 40px);
          font-weight: 500;
          color: #1a1a2e !important;
          margin: 0 0 4px 0;
          letter-spacing: -0.5px;
          line-height: 1.1;
          display: block;
          width: auto;
          max-width: none;
          padding: 0;
          background: none !important;
          background-color: transparent !important;
          border: 0 !important;
          border-radius: 0 !important;
          box-shadow: none !important;
          outline: 0 !important;
        }

        .reg-card-sub {
          font-size: 14px;
          color: #8e8ea8 !important;
          font-weight: 400;
          margin: 0 0 22px 0;
          display: block;
          width: auto;
          max-width: none;
          padding: 0;
          background: none !important;
          background-color: transparent !important;
          border: 0 !important;
          border-radius: 0 !important;
          box-shadow: none !important;
          outline: 0 !important;
        }

        .reg-card-title::before,
        .reg-card-title::after,
        .reg-card-sub::before,
        .reg-card-sub::after {
          content: none !important;
          display: none !important;
        }

        /* ── Form fields ─────────────────────────────────────────────────── */
        .reg-label {
          display: block;
          font-size: 14px;
          font-weight: 500;
          color: #1a1a2e;
          margin-bottom: 7px;
          letter-spacing: 0.1px;
        }

        .reg-field {
          position: relative;
          margin-bottom: 16px;
        }

        .reg .reg-field input,
        .reg .reg-field input[type="text"],
        .reg .reg-field input[type="email"],
        .reg .reg-field input[type="password"] {
          width: 100%;
          height: 50px;
          border: 1.5px solid #e8e4f0;
          border-radius: 11px;
          padding: 0 18px;
          font-family: 'DM Sans', sans-serif;
          font-size: 15px;
          color: #1a1a2e !important;
          background: #ffffff !important;
          background-color: #ffffff !important;
          background-image: none !important;
          box-shadow: none;
          -webkit-box-shadow: 0 0 0 1000px #ffffff inset !important;
          -webkit-text-fill-color: #1a1a2e !important;
          caret-color: #1a1a2e;
          appearance: none;
          -webkit-appearance: none;
          outline: none;
          transition: border-color 0.2s, box-shadow 0.2s;
          color-scheme: light;
        }
        .reg .reg-field input:focus {
          border-color: #b48aff;
          box-shadow: 0 0 0 3.5px rgba(180,138,255,0.14);
          -webkit-box-shadow: 0 0 0 1000px #ffffff inset, 0 0 0 3.5px rgba(180,138,255,0.14) !important;
        }
        .reg .reg-field input:hover,
        .reg .reg-field input:active,
        .reg .reg-field input:valid,
        .reg .reg-field input:invalid,
        .reg .reg-field input:-webkit-autofill,
        .reg .reg-field input:-webkit-autofill:hover,
        .reg .reg-field input:-webkit-autofill:focus,
        .reg .reg-field input:-webkit-autofill:active,
        [data-theme="dark"] .reg .reg-field input,
        [data-theme="dark"] .reg .reg-field input[type="text"],
        [data-theme="dark"] .reg .reg-field input[type="email"],
        [data-theme="dark"] .reg .reg-field input[type="password"] {
          background: #ffffff !important;
          background-color: #ffffff !important;
          background-image: none !important;
          color: #1a1a2e !important;
          box-shadow: none;
          -webkit-box-shadow: 0 0 0 1000px #ffffff inset !important;
          -webkit-text-fill-color: #1a1a2e !important;
          caret-color: #1a1a2e;
        }
        .reg-field input::placeholder               { color: #c8c4d8 !important; }
        .reg-field input::-webkit-input-placeholder { color: #c8c4d8 !important; }
        .reg-field input::-moz-placeholder          { color: #c8c4d8 !important; opacity: 1; }

        .reg-eye {
          position: absolute;
          right: 14px; top: 50%;
          transform: translateY(-50%);
          background: none; border: none;
          cursor: pointer; padding: 0;
          color: #b0a8c8;
          display: flex; align-items: center;
          transition: color 0.15s;
        }
        .reg-eye:hover { color: #7c6fa0; }

        /* Admin note */
        .reg-note {
          font-size: 12px;
          color: #9e9ab2;
          background: rgba(180,138,255,0.06);
          border: 1px solid rgba(180,138,255,0.15);
          border-radius: 8px;
          padding: 8px 12px;
          margin-bottom: 18px;
          line-height: 1.5;
        }

        /* ── Gradient submit button — identical to login ──────────────────── */
        .reg-submit {
          width: 100%;
          height: 56px;
          border: none;
          border-radius: 15px;
          background: linear-gradient(90deg, #c9b4ff 0%, #d99fe0 50%, #f5c89a 100%);
          font-family: 'Cormorant Garamond', serif;
          font-size: 19px;
          font-weight: 500;
          color: #1a1a2e;
          letter-spacing: 0.3px;
          cursor: pointer;
          display: flex;
          align-items: center;
          justify-content: center;
          gap: 10px;
          margin-bottom: 18px;
          transition: opacity 0.2s, transform 0.15s, box-shadow 0.2s;
          box-shadow: 0 6px 24px rgba(180,138,255,0.28);
        }
        .reg-submit:hover:not(:disabled) {
          opacity: 0.92;
          transform: translateY(-1.5px);
          box-shadow: 0 10px 32px rgba(180,138,255,0.36);
        }
        .reg-submit:active:not(:disabled) { transform: scale(0.985); }
        .reg-submit:disabled { opacity: 0.65; cursor: not-allowed; }

        .reg-footer {
          text-align: center;
          font-size: 14px;
          color: #8e8ea8;
        }
        .reg-footer a {
          color: #2f7ee8;
          font-weight: 500;
          text-decoration: none;
        }
        .reg-footer a:hover { text-decoration: underline; }

        @keyframes regSpin { to { transform: rotate(360deg); } }
        .reg-spinner {
          display: inline-block;
          width: 18px; height: 18px;
          border: 2.5px solid rgba(26,26,46,0.2);
          border-top-color: #1a1a2e;
          border-radius: 50%;
          animation: regSpin 0.7s linear infinite;
          flex-shrink: 0;
        }

        /* ── Short screen ────────────────────────────────────────────────── */
        @media (max-height: 740px) and (min-width: 641px) {
          .reg-wrap        { padding: 80px 52px 220px 52px; }
          .reg-title       { font-size: 42px; }
          .reg-card        { padding: 28px 36px 24px; }
          .reg-char        { left: 120px; width: 250px; }
          .reg-logo img    { height: 72px; }
          .reg-field       { margin-bottom: 10px; }
          .reg-field input { height: 44px; }
          .reg-card-sub    { margin-bottom: 16px; }
          .reg-submit      { height: 48px; margin-bottom: 12px; }
        }

        /* ── Tablet ──────────────────────────────────────────────────────── */
        @media (max-width: 900px) and (min-width: 641px) {
          .reg-wrap  { grid-template-columns: 1fr; padding: 100px 48px 300px 48px; height: auto; }
          .reg       { height: auto; min-height: 100vh; overflow-y: auto; }
          .reg-right { justify-content: center; max-height: none; overflow-y: visible; }
          .reg-char  { width: 240px; left: 50%; transform: translateX(-50%); }
          .reg-left  { text-align: center; transform: none; }
          .reg-accent { margin: 0 auto 24px; }
        }

        /* ── Mobile ──────────────────────────────────────────────────────── */
        @media (max-width: 640px) {
          .reg {
            height: 100dvh;
            overflow: hidden;
            display: flex;
            flex-direction: column;
            align-items: stretch;
          }

          .reg-logo {
            position: relative;
            top: auto; left: auto;
            padding: 20px 20px 0;
            display: flex;
            align-items: center;
            flex-shrink: 0;
          }
          .reg-logo img { height: 72px; }

          .reg-char { display: none; }

          .reg-wrap {
            display: flex;
            flex-direction: column;
            flex: 1;
            height: 0;
            padding: 10px 16px 14px;
            gap: 0;
            overflow: hidden;
          }

          .reg-left {
            display: flex;
            flex-direction: column;
            align-items: center;
            text-align: center;
            flex-shrink: 0;
            transform: none;
          }

          .reg-title   { font-size: clamp(28px, 8.8vw, 40px); white-space: nowrap; margin-bottom: 6px; letter-spacing: -0.035em; }
          .reg-accent  { width: 40px; height: 2.5px; margin: 0 auto 8px; }
          .reg-desc    { display: none; }
          .reg-tagline { display: none; }
          .reg-char-mobile {
            display: block;
            width: 110px;
            margin: 4px auto 0;
            line-height: 0;
            flex-shrink: 0;
          }
          .reg-char-mobile img {
            width: 100%;
            height: auto;
            object-fit: contain;
            display: block;
            filter: drop-shadow(0 6px 14px rgba(130,90,190,0.18));
          }

          .reg-right {
            flex: 1;
            margin-top: 8px;
            overflow-y: auto;
            justify-content: center;
            max-height: none;
          }

          .reg-card {
            max-width: 100%;
            border-radius: 20px;
            padding: 16px 18px 12px;
          }

          .reg-card-title { font-size: 22px; margin-bottom: 2px; }
          .reg-card-sub   { font-size: 12px; margin-bottom: 12px; }
          .reg-label      { font-size: 12px; margin-bottom: 4px; }
          .reg-field      { margin-bottom: 8px; }
          .reg-field input { height: 40px; font-size: 14px; border-radius: 9px; }
          .reg-note       { font-size: 11px; padding: 6px 10px; margin-bottom: 12px; }
          .reg-submit     { height: 44px; font-size: 16px; border-radius: 12px; margin-bottom: 10px; }
          .reg-footer     { font-size: 12px; }
        }

        @media (max-width: 375px) {
          .reg-logo img    { height: 64px; }
          .reg-title       { font-size: 28px; }
          .reg-char-mobile { width: 88px; }
          .reg-card        { padding: 12px 14px 10px; }
          .reg-field input { height: 36px; }
          .reg-submit      { height: 40px; }
        }
      `}</style>

      <div className="reg">

        {/* Logo — top-left */}
        <a href="#" className="reg-logo">
          <img
            className="reg-login-logo"
            src={LIGHT_LOGO_SRC}
            alt="simplix"
          />
        </a>

        {/* Character — bottom-left */}
        <div className="reg-char">
          <img src="/character.png" alt="3D character" />
        </div>

        <div className="reg-wrap">

          {/* ══ LEFT ══════════════════════════════════════════════════════════ */}
          <div className="reg-left">
            <h1 className="reg-title">Get <span className="reg-title-grad">Started</span></h1>
            <div className="reg-accent" />
            <p className="reg-desc">
              Designed for teams that build<br />the future
            </p>
            <p className="reg-tagline">
              Simplify collaboration.<br />Elevate productivity.
            </p>
            <div className="reg-char-mobile">
              <img src="/character.png" alt="3D character" />
            </div>
          </div>

          {/* ══ RIGHT card ════════════════════════════════════════════════════ */}
          <div className="reg-right">
            <div className="reg-card">

              <h2 className="reg-card-title">Create Account</h2>
              <p className="reg-card-sub">Join Workboard</p>

              <form onSubmit={handleSubmit}>

                {/* Full Name */}
                <label className="reg-label" htmlFor="reg-name">Full Name</label>
                <div className="reg-field">
                  <input
                    id="reg-name"
                    type="text"
                    value={form.name}
                    onChange={set('name')}
                    required
                    autoFocus
                    placeholder=""
                  />
                </div>

                {/* Email */}
                <label className="reg-label" htmlFor="reg-email">Email</label>
                <div className="reg-field">
                  <input
                    id="reg-email"
                    type="email"
                    value={form.email}
                    onChange={set('email')}
                    required
                    placeholder=""
                  />
                </div>

                {/* Password */}
                <label className="reg-label" htmlFor="reg-pwd">Password</label>
                <div className="reg-field">
                  <input
                    id="reg-pwd"
                    type={showPwd ? 'text' : 'password'}
                    value={form.password}
                    onChange={set('password')}
                    required
                    placeholder=""
                    style={{ paddingRight: '46px' }}
                  />
                  <button type="button" className="reg-eye" onClick={() => setShowPwd(v => !v)}>
                    {showPwd ? (
                      <svg width="18" height="18" viewBox="0 0 24 24" fill="none"
                           stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                        <path d="M1 12S5 4 12 4s11 8 11 8-4 8-11 8S1 12 1 12z"/>
                        <circle cx="12" cy="12" r="3"/>
                      </svg>
                    ) : (
                      <svg width="18" height="18" viewBox="0 0 24 24" fill="none"
                           stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                        <path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94"/>
                        <path d="M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19"/>
                        <line x1="1" y1="1" x2="23" y2="23"/>
                      </svg>
                    )}
                  </button>
                </div>

                {/* Confirm Password */}
                <label className="reg-label" htmlFor="reg-confirm">Confirm Password</label>
                <div className="reg-field">
                  <input
                    id="reg-confirm"
                    type={showConfirm ? 'text' : 'password'}
                    value={form.confirm}
                    onChange={set('confirm')}
                    required
                    placeholder=""
                    style={{ paddingRight: '46px' }}
                  />
                  <button type="button" className="reg-eye" onClick={() => setShowConfirm(v => !v)}>
                    {showConfirm ? (
                      <svg width="18" height="18" viewBox="0 0 24 24" fill="none"
                           stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                        <path d="M1 12S5 4 12 4s11 8 11 8-4 8-11 8S1 12 1 12z"/>
                        <circle cx="12" cy="12" r="3"/>
                      </svg>
                    ) : (
                      <svg width="18" height="18" viewBox="0 0 24 24" fill="none"
                           stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                        <path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94"/>
                        <path d="M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19"/>
                        <line x1="1" y1="1" x2="23" y2="23"/>
                      </svg>
                    )}
                  </button>
                </div>

                {/* Admin note */}
                <p className="reg-note">
                  <strong>Note:</strong> The first registered user automatically becomes <strong>Admin</strong>.
                </p>

                {/* Submit */}
                <button type="submit" className="reg-submit" disabled={loading}>
                  {loading
                    ? <><span className="reg-spinner" />Creating account…</>
                    : 'Create Account'}
                </button>
              </form>

              <p className="reg-footer">
                Already have an account?{' '}
                <Link to="/login">Sign In</Link>
              </p>

            </div>
          </div>

        </div>
      </div>
    </>
  );
}
