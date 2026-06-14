import React, { useState, useEffect } from 'react';
import { useNavigate, Link, useSearchParams } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { authLogin, authMfaVerify } from '../api';
import { useToast } from '../components/Toast';
import { LIGHT_LOGO_SRC } from '../hooks/useThemeLogo';

const ERROR_MESSAGES = {
  account_disabled:          'Your account has been deactivated. Contact an admin.',
  invalid_state:             'OAuth state mismatch. Please try again.',
};

export default function LoginPage() {
  const [email,        setEmail]        = useState('');
  const [password,     setPassword]     = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [mfaStep,      setMfaStep]      = useState(false);
  const [tempToken,    setTempToken]    = useState('');
  const [mfaCode,      setMfaCode]      = useState('');
  const [loading,      setLoading]      = useState(false);
  const { login }      = useAuth();
  const navigate       = useNavigate();
  const toast          = useToast();
  const [searchParams] = useSearchParams();
  useEffect(() => {
    const err = searchParams.get('error');
    if (err) toast(ERROR_MESSAGES[err] || 'External login failed. Please try again.', 'error');
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
    <>
      <style>{`
        /* ── Reset inside login scope ─────────────────────────────────────── */
        .spx *, .spx *::before, .spx *::after { box-sizing: border-box; margin: 0; padding: 0; }

        /* ── Page shell ───────────────────────────────────────────────────── */
        .spx {
          position: relative;
          width: 100vw;
          height: 100vh;
          overflow: hidden;
          display: flex;
          align-items: center;
          justify-content: center;
          font-family: 'DM Sans', sans-serif;

          /*
           * TOP HALF  : exact horizontal gradient (lavender → blush → peach)
           * BOTTOM HALF: smooth slow fade to pure white
           * Layered: fade-mask on top, colour base underneath
           */
          background:
            linear-gradient(
              to bottom,
              transparent          0%,
              transparent         42%,
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

        /* ── Subtle top-left radial glow blob ────────────────────────────── */
        .spx::after {
          content: '';
          position: absolute;
          top: -80px; left: -60px;
          width: 460px; height: 460px;
          background: radial-gradient(circle, rgba(195,166,255,0.22) 0%, transparent 68%);
          pointer-events: none;
          z-index: 0;
        }

        /* ── Logo — absolutely pinned top-left ───────────────────────────── */
        .spx-logo-fixed {
          position: absolute;
          top: 28px;
          left: 32px;
          z-index: 10;
          text-decoration: none;
          display: inline-block;
          line-height: 0;
        }
        .spx-logo-fixed img {
          height: 100px;
          width: auto;
          object-fit: contain;
          display: block;
        }

        /* ── Character — absolutely pinned bottom-left ───────────────────── */
        .spx-char-fixed {
          position: absolute;
          bottom: -10px;
          left: 190px;
          width: 355px;
          z-index: 2;
          pointer-events: none;
          line-height: 0;
        }
        .spx-char-fixed img {
          width: 100%;
          height: auto;
          object-fit: contain;
          display: block;
          filter: drop-shadow(0 16px 36px rgba(130,90,190,0.16));
        }

        /* ── Content grid — fits exactly in 100vh ────────────────────────── */
        .spx-wrap {
          position: relative;
          z-index: 1;
          width: 100%;
          max-width: 1320px;
          height: 100%;
          display: grid;
          grid-template-columns: 1fr 1fr;
          gap: 40px;
          align-items: center;
          /* top padding clears the logo; bottom clears the character */
          padding: 130px 64px 150px 64px;
        }

        /* ── LEFT — hero text only (logo + char are absolute) ────────────── */
        .spx-left {
  display: flex;
  flex-direction: column;
  justify-content: center;
  padding-left: 2px;
  padding-top: 2px;
}

        /* Hero text */
        .spx-hero {
          margin-top: 0;
          transform: translate(-34px, -46px);
          display: flex;
          flex-direction: column;
          align-items: center;
          width: max-content;
        }

        .spx-title {
          font-family: 'Satoshi', 'Geist', 'General Sans', 'Inter', 'DM Sans', system-ui, -apple-system, BlinkMacSystemFont, sans-serif;
          font-size: clamp(82px, 5.25vw, 98px);
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

        .spx-title-word {
          display: inline-block;
        }

        .spx-title-back {
          background: linear-gradient(
            90deg,
            #6C4CFF 0%,
            #B45CFF 35%,
            #FF78B2 68%,
            #FFB38A 100%
          );
          -webkit-background-clip: text;
          -webkit-text-fill-color: transparent;
          background-clip: text;
        }

        .spx-accent {
          width: 64px;
          height: 3.5px;
          border-radius: 3px;
          background: linear-gradient(90deg, #b48aff, #f87a8c);
          margin: 0 auto 26px;
          /* subtle glow on the accent line */
          box-shadow: 0 2px 12px rgba(180,138,255,0.45);
        }

        .spx-desc {
          font-family: 'Inter', 'DM Sans', sans-serif;
          font-size: 17px;
          font-weight: 900;
          line-height: 1.62;
          color: #20243a;
          margin: 0 auto 14px;
          max-width: 380px;
          text-align: center;
          letter-spacing: -0.01em;
        }

        .spx-tagline {
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

        /* ── RIGHT ────────────────────────────────────────────────────────── */
         .spx-right {
  display: flex;
  align-items: flex-start;
  justify-content: flex-end;
  padding-top: 72px;
  max-height: calc(100vh - 80px);
  overflow-y: auto;
}

        /* Card — premium glass-ish white */
        .spx-card {
          background: rgba(255,255,255,0.97);
          border-radius: 24px;
          padding: 48px 48px 40px;
          width: 100%;
          max-width: 530px;
          box-shadow:
            0 2px 0px rgba(255,255,255,0.8) inset,      /* top inner highlight */
            0 12px 48px rgba(100,70,180,0.10),
            0 2px  8px rgba(100,70,180,0.06);
          border: 1px solid rgba(255,255,255,0.72);
          backdrop-filter: blur(2px);
        }

        .spx-card-title {
          font-family: 'Satoshi', 'Geist', 'General Sans', 'Inter', 'DM Sans', system-ui, -apple-system, BlinkMacSystemFont, sans-serif;
          font-size: clamp(42px, 3.5vw, 54px);
          font-weight: 800;
          color: #1a1a2e !important;
          margin: 0 0 4px 0;
          letter-spacing: -0.045em;
          line-height: 0.98;
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
          text-rendering: geometricPrecision;
          -webkit-font-smoothing: antialiased;
          -moz-osx-font-smoothing: grayscale;
        }

        .spx-card-title::before,
        .spx-card-title::after,
        .spx-card-sub::before,
        .spx-card-sub::after {
          content: none !important;
          display: none !important;
        }

        .spx-card-sub {
          font-size: 14.5px;
          color: #6b6b85 !important;
          font-weight: 700;
          margin: 0 0 30px 0;
          letter-spacing: -0.01em;
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

        /* Form labels */
        .spx-label {
          display: block;
          font-size: 14px;
          font-weight: 500;
          color: #1a1a2e;
          margin-bottom: 8px;
          letter-spacing: 0.1px;
        }

        /* Field wrapper */
        .spx-field {
          position: relative;
          margin-bottom: 20px;
        }

        .spx-field input {
          width: 100%;
          height: 54px;
          border: 1.5px solid #b8aed0;
          border-radius: 11px;
          padding: 0 18px;
          font-family: 'DM Sans', sans-serif;
          font-size: 15px;
          color: #1a1a2e;
          background: #ffffff;
          outline: none;
          transition: border-color 0.2s, box-shadow 0.2s;
          box-shadow: 0 1px 2px rgba(100, 70, 180, 0.04);
          /* Kill iOS / Android native input chrome so our border actually
             shows. Without this, iOS Safari draws its own inset gradient
             that visually erases the 1.5px purple-gray border. */
          -webkit-appearance: none;
          appearance: none;
          color-scheme: light;
        }
        .spx-field input:focus {
          border-color: #b48aff;
          background: #ffffff !important;
          background-color: #ffffff !important;
          box-shadow: 0 0 0 3.5px rgba(180,138,255,0.14);
        }
        .spx-field input::placeholder { color: #c8c4d8 !important; }
        .spx-field input::-webkit-input-placeholder { color: #c8c4d8 !important; }
        .spx-field input::-moz-placeholder           { color: #c8c4d8 !important; opacity: 1; }
        .spx-field input:-ms-input-placeholder       { color: #c8c4d8 !important; }
        /* override any global autofill/focus-visible blue tint */
        .spx-field input { background: #ffffff !important; color-scheme: light; }
        .spx-field input:hover,
        .spx-field input:active,
        .spx-field input:valid,
        .spx-field input:invalid,
        .spx-field input:-webkit-autofill,
        .spx-field input:-webkit-autofill:hover,
        .spx-field input:-webkit-autofill:focus,
        .spx-field input:-webkit-autofill:active {
          background: #ffffff !important;
          background-color: #ffffff !important;
          background-image: none !important;
          -webkit-box-shadow: 0 0 0 1000px #ffffff inset !important;
          -webkit-text-fill-color: #1a1a2e !important;
          caret-color: #1a1a2e;
        }

        .spx-eye {
          position: absolute;
          right: 15px;
          top: 50%;
          transform: translateY(-50%);
          background: none;
          border: none;
          cursor: pointer;
          padding: 0;
          color: #b0a8c8;
          display: flex;
          align-items: center;
          transition: color 0.15s;
        }
        .spx-eye:hover { color: #7c6fa0; }

        .spx-hint {
          font-size: 12px;
          color: #6b6688;
          margin-top: -14px;
          margin-bottom: 20px;
          line-height: 1.5;
        }

        /* Divider */
        .spx-divider {
          display: flex;
          align-items: center;
          gap: 14px;
          margin-bottom: 18px;
        }
        .spx-divider::before,
        .spx-divider::after {
          content: '';
          flex: 1;
          height: 1px;
          background: #ede9f5;
        }
        .spx-divider span {
          font-size: 13px;
          color: #a09ab8;
          white-space: nowrap;
        }

        /* Main gradient CTA button */
        .spx-submit {
          width: 100%;
          height: 58px;
          border: none;
          border-radius: 15px;
          /* EXACT gradient from reference */
          background: linear-gradient(90deg, #c9b4ff 0%, #d99fe0 50%, #f5c89a 100%);
          font-family: 'Playfair Display', serif;
          font-size: 19px;
          font-weight: 500;
          color: #1a1a2e;
          letter-spacing: 0.3px;
          cursor: pointer;
          display: flex;
          align-items: center;
          justify-content: center;
          gap: 10px;
          margin-bottom: 22px;
          transition: opacity 0.2s, transform 0.15s, box-shadow 0.2s;
          box-shadow: 0 6px 24px rgba(180,138,255,0.28);
        }
        .spx-submit:hover:not(:disabled) {
          opacity: 0.92;
          transform: translateY(-1.5px);
          box-shadow: 0 10px 32px rgba(180,138,255,0.36);
        }
        .spx-submit:active:not(:disabled) { transform: scale(0.985); }
        .spx-submit:disabled { opacity: 0.65; cursor: not-allowed; }

        /* Footer */
        .spx-footer {
          text-align: center;
          font-size: 14px;
          color: #6b6b85;
        }
        .spx-footer a {
          color: #1f6ad0;
          font-weight: 500;
          text-decoration: none;
        }
        .spx-footer a:hover { text-decoration: underline; }

        /* Back button (MFA) */
        .spx-back {
          width: 100%;
          height: 50px;
          background: none;
          border: 1.5px solid #b8aed0;
          border-radius: 12px;
          font-family: 'DM Sans', sans-serif;
          font-size: 14px;
          font-weight: 500;
          color: #8e8ea8;
          cursor: pointer;
          transition: border-color 0.15s, color 0.15s;
        }
        .spx-back:hover { border-color: #b48aff; color: #7c6fa0; }

        /* Forgot password link */
        .spx-forgot {
          display: block;
          text-align: right;
          margin-top: -10px;
          margin-bottom: 22px;
          font-size: 13px;
          color: #7a52e0;
          text-decoration: none;
          font-family: 'DM Sans', sans-serif;
          transition: color 0.15s;
        }
        .spx-forgot:hover { color: #6a45c8; text-decoration: underline; }

        /* Spinner */
        @keyframes spxSpin { to { transform: rotate(360deg); } }
        .spx-spinner {
          display: inline-block;
          width: 18px; height: 18px;
          border: 2.5px solid rgba(26,26,46,0.2);
          border-top-color: #1a1a2e;
          border-radius: 50%;
          animation: spxSpin 0.7s linear infinite;
          flex-shrink: 0;
        }

        /* Mobile character — hidden on desktop */
        .spx-char-mobile { display: none; }

        /* ── Short-screen desktop tweak ──────────────────────────────────── */
        @media (max-height: 740px) and (min-width: 641px) {
          .spx-wrap           { padding: 80px 52px 220px 52px; }
          .spx-title          { font-size: 62px; }
          .spx-card           { padding: 32px 36px 28px; }
          .spx-char-fixed     { bottom: -8px; left: 150px; width: 250px; }
          .spx-logo-fixed img { height: 82px; }
        }

        /* ── Tablet — 641px to 900px ─────────────────────────────────────── */
        @media (max-width: 900px) and (min-width: 641px) {
          .spx-wrap  { grid-template-columns: 1fr; padding: 100px 48px 300px 48px; height: auto; }
          .spx       { height: auto; min-height: 100vh; overflow-y: auto; }
          .spx-right { justify-content: center; max-height: none; overflow-y: visible; }
          .spx-char-fixed { width: 240px; left: 50%; transform: translateX(-50%); }
          .spx-left  { text-align: center; }
          .spx-hero  { transform: none; }
          .spx-accent { margin: 0 auto 24px; }
          .spx-desc, .spx-tagline { margin-left: auto; margin-right: auto; text-align: center; }
        }

        /* ══ MOBILE — ≤ 640px ════════════════════════════════════════════════ */
        @media (max-width: 640px) {

          /* Allow scrolling so the submit button and footer stay reachable
             on small phones and when the on-screen keyboard is open.
             min-height lets the page grow as the keyboard shrinks the viewport. */
          .spx {
            height: auto;
            min-height: 100dvh;
            overflow-y: auto;
            -webkit-overflow-scrolling: touch;
            display: flex;
            flex-direction: column;
            align-items: stretch;
          }

          /* Logo: in flow, centered, properly sized */
          .spx-logo-fixed {
            position: relative;
            top: auto; left: auto;
            padding: 20px 20px 0;
            display: flex;
            align-items: center;
            justify-content: center;
            align-self: center;
            flex-shrink: 0;
          }
          .spx-logo-fixed img { height: 72px; }

          /* Desktop absolute character: hidden */
          .spx-char-fixed { display: none; }

          /* Grid → flex column. Let it grow naturally; respect the iOS
             home-indicator with safe-area padding at the bottom. */
          .spx-wrap {
            display: flex;
            flex-direction: column;
            flex: 1 0 auto;
            height: auto;
            min-height: 0;
            padding: 12px 16px calc(20px + env(safe-area-inset-bottom));
            gap: 0;
            overflow: visible;
          }

          /* Left: compact, centered, no scroll */
          .spx-left {
            display: flex;
            flex-direction: column;
            align-items: center;
            text-align: center;
            flex-shrink: 0;
          }

          /* Title — one line, readable */
          .spx-hero {
            transform: none;
            width: 100%;
          }

          .spx-title {
            font-size: clamp(30px, 8.8vw, 42px);
            white-space: nowrap;
            letter-spacing: -0.035em;
            line-height: 0.98;
            margin-bottom: 8px;
          }

          .spx-accent {
            width: 40px;
            height: 2.5px;
            margin: 0 auto 10px;
          }

          /* Keep "Designed for teams that build the future" on mobile,
             matching the desktop styling but slightly tightened. Tagline
             stays hidden to save space. */
          .spx-desc {
            display: block;
            font-size: 15px;
            margin: 0 auto 10px;
            max-width: 320px;
          }
          .spx-tagline { display: none; }

          /* Character — compact, decorative */
          .spx-char-mobile {
            display: block;
            width: 110px;
            margin: 8px auto 0;
            line-height: 0;
            flex-shrink: 0;
          }
          .spx-char-mobile img {
            width: 100%;
            height: auto;
            object-fit: contain;
            display: block;
            filter: drop-shadow(0 6px 14px rgba(130,90,190,0.18));
          }

          /* Right: grows with content, no inner scroll, no fixed height */
          .spx-right {
            flex: 0 0 auto;
            margin-top: 10px;
            overflow: visible;
            justify-content: center;
            max-height: none;
            padding-top: 0;
          }

          /* Card: grows to fit content; no clipped overflow */
          .spx-card {
            max-width: 100%;
            height: auto;
            border-radius: 20px;
            padding: 18px 18px 18px;
            box-shadow:
              0 2px 0 rgba(255,255,255,0.9) inset,
              0 8px 28px rgba(100,70,180,0.11),
              0 2px 6px rgba(100,70,180,0.06);
            overflow: visible;
          }

          .spx-card-title { font-size: 30px; margin-bottom: 2px; }
          .spx-card-sub   { font-size: 12px; margin-bottom: 12px; }

          .spx-label { font-size: 12px; margin-bottom: 4px; }

          .spx-field            { margin-bottom: 8px; }
          .spx-field input {
            height: 44px;
            font-size: 15px;
            border-radius: 9px;
            padding: 0 14px;
            /* Bump to 2px so the border survives sub-pixel rounding on
               high-DPI phone screens. Darker tone for clearer contrast. */
            border: 2px solid #8a7eb8 !important;
            box-shadow: 0 1px 3px rgba(100, 70, 180, 0.08);
            -webkit-appearance: none !important;
            appearance: none !important;
            background-clip: padding-box;
          }
          .spx-field input[style] { padding-right: 42px !important; }

          .spx-hint   { font-size: 10.5px; margin-top: -6px; margin-bottom: 6px; }
          .spx-forgot { margin-top: -2px; margin-bottom: 10px; font-size: 12px; }
          .spx-divider { margin-bottom: 8px; }
          .spx-divider span { font-size: 12px; }

          .spx-submit {
            height: 46px;
            font-size: 16px;
            border-radius: 12px;
            margin-bottom: 10px;
            box-shadow: 0 4px 16px rgba(180,138,255,0.22);
          }

          .spx-footer { font-size: 12px; }
        }

        /* Extra small phones — 375px and below */
        @media (max-width: 375px) {
          .spx-logo-fixed img  { height: 64px; }
          .spx-title           { font-size: 30px; }
          .spx-char-mobile     { width: 88px; margin-top: 4px; }
          .spx-card            { padding: 14px 14px 14px; border-radius: 16px; }
          .spx-card-title      { font-size: 26px; }
          .spx-field input     { height: 38px; }
          .spx-submit          { height: 42px; font-size: 15px; }
        }

        /* Short phones in landscape — keep the form reachable */
        @media (max-width: 900px) and (max-height: 520px) {
          .spx-char-mobile { display: none; }
          .spx-logo-fixed  { padding: 10px 16px 0; }
          .spx-logo-fixed img { height: 52px; }
          .spx-wrap        { padding: 8px 16px calc(16px + env(safe-area-inset-bottom)); }
          .spx-card        { padding: 14px 16px 14px; }
        }
      `}</style>

      <div className="spx">

        {/* Logo — absolutely pinned top-left */}
        <a href="#" className="spx-logo-fixed">
          <img
            className="spx-login-logo"
            src={LIGHT_LOGO_SRC}
            alt="simplix"
          />
        </a>

        {/* Character — absolutely pinned bottom-left */}
        <div className="spx-char-fixed">
          <img src="/character.png" alt="3D character with headphones on laptop" />
        </div>

        <div className="spx-wrap">

          {/* ══ LEFT — hero text + mobile character ══════════════════════════ */}
          <div className="spx-left">
            <div className="spx-hero">
              <h1 className="spx-title">
                <span className="spx-title-word">Welcome&nbsp;</span><span className="spx-title-word spx-title-back">Back</span>
              </h1>
              <div className="spx-accent" />
              <p className="spx-desc">
                Designed for teams that build<br />the future
              </p>
              <p className="spx-tagline">
                Simplify collaboration.<br />Elevate productivity.
              </p>
            </div>

            {/* Mobile-only: character appears between text and card */}
            <div className="spx-char-mobile">
              <img src="/character.png" alt="3D character with headphones on laptop" />
            </div>
          </div>

          {/* ══ RIGHT ═════════════════════════════════════════════════════════ */}
          <div className="spx-right">
            <div className="spx-card">

              {!mfaStep ? (
                <>
                  <h2 className="spx-card-title">Sign In</h2>
                  <p className="spx-card-sub">Plan. Build. Ship. Repeat.</p>

                  <form onSubmit={handleLogin}>
                    {/* Email */}
                    <label className="spx-label" htmlFor="spx-email">Email</label>
                    <div className="spx-field">
                      <input
                        id="spx-email"
                        type="email"
                        value={email}
                        onChange={e => setEmail(e.target.value)}
                        required
                        autoFocus
                      />
                    </div>

                    {/* Password */}
                    <label className="spx-label" htmlFor="spx-pwd">Password</label>
                    <div className="spx-field">
                      <input
                        id="spx-pwd"
                        type={showPassword ? 'text' : 'password'}
                        value={password}
                        onChange={e => setPassword(e.target.value)}
                        required
                        style={{ paddingRight: '48px' }}
                      />
                      <button
                        type="button"
                        className="spx-eye"
                        onClick={() => setShowPassword(v => !v)}
                        aria-label="Toggle password"
                      >
                        {showPassword ? (
                          <svg width="20" height="20" viewBox="0 0 24 24" fill="none"
                               stroke="currentColor" strokeWidth="1.8"
                               strokeLinecap="round" strokeLinejoin="round">
                            <path d="M1 12S5 4 12 4s11 8 11 8-4 8-11 8S1 12 1 12z"/>
                            <circle cx="12" cy="12" r="3"/>
                          </svg>
                        ) : (
                          /* exact eye-slash SVG from reference HTML */
                          <svg width="20" height="20" viewBox="0 0 24 24" fill="none"
                               stroke="currentColor" strokeWidth="1.8"
                               strokeLinecap="round" strokeLinejoin="round">
                            <path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94"/>
                            <path d="M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19"/>
                            <line x1="1" y1="1" x2="23" y2="23"/>
                          </svg>
                        )}
                      </button>
                    </div>
                    <p className="spx-hint">
                      Use 8 or more characters with a mix of letters, numbers &amp; symbols.
                    </p>

                    {/* Forgot password */}
                    <Link to="/forgot-password" className="spx-forgot">
                      Forgot password?
                    </Link>

                    {/* Main gradient CTA */}
                    <button type="submit" className="spx-submit" disabled={loading}>
                      {loading
                        ? <><span className="spx-spinner" />Signing in…</>
                        : 'Sign In'}
                    </button>
                  </form>

                  <p className="spx-footer">
                    Don't have an account?{' '}
                    <Link to="/register">Register</Link>
                  </p>
                </>
              ) : (

                /* ── MFA step ─────────────────────────────────────────────── */
                <>
                  <h2 className="spx-card-title">Two-Factor Auth</h2>
                  <p className="spx-card-sub">
                    Enter the 6-digit code from your authenticator app
                  </p>

                  <form onSubmit={handleMfa}>
                    <label className="spx-label" htmlFor="spx-mfa">Code</label>
                    <div className="spx-field">
                      <input
                        id="spx-mfa"
                        autoFocus
                        value={mfaCode}
                        onChange={e => setMfaCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
                        placeholder="000000"
                        maxLength={6}
                        style={{
                          textAlign: 'center',
                          fontSize: '28px',
                          letterSpacing: '12px',
                          fontWeight: 600,
                        }}
                      />
                    </div>

                    <button
                      type="submit"
                      className="spx-submit"
                      disabled={loading || mfaCode.length !== 6}
                    >
                      {loading
                        ? <><span className="spx-spinner" />Verifying…</>
                        : 'Verify'}
                    </button>
                  </form>

                  <button
                    type="button"
                    className="spx-back"
                    onClick={() => { setMfaStep(false); setMfaCode(''); }}
                  >
                    ← Back
                  </button>
                </>
              )}

            </div>
          </div>

        </div>
      </div>
    </>
  );
}
