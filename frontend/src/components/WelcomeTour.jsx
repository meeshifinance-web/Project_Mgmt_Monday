/**
 * WelcomeTour.jsx
 *
 * One-time welcome modal shown to a user the first time they sign in to
 * the app. Surfaces the four shortcuts new users almost always miss:
 * Cmd-K palette, keyboard navigation, My Work, and the notification bell.
 *
 * Storage:
 *   localStorage["wb_tour_seen"] = "1"  (set when dismissed)
 *
 * Behavior:
 *   - Renders as a centered modal with 4 short tips
 *   - Esc / overlay click / "Got it" all dismiss + persist seen flag
 *   - Keyboard accessible (focus on dismiss button by default)
 *   - Theme-aware (uses existing CSS variables)
 *   - Skipped automatically on subsequent logins, ever — until they
 *     clear localStorage or we bump the storage key.
 */

import React, { useEffect, useRef } from 'react';
import { useThemeLogo } from '../hooks/useThemeLogo';

const TOUR_KEY = 'wb_tour_seen';

export function shouldShowWelcomeTour() {
  try { return localStorage.getItem(TOUR_KEY) !== '1'; }
  catch { return false; }
}

export function dismissWelcomeTour() {
  try { localStorage.setItem(TOUR_KEY, '1'); }
  catch { /* localStorage disabled — fall back to in-memory dismissal */ }
}

const TIPS = [
  {
    icon: '⌘',
    title: 'Press Cmd-K (or Ctrl-K) anywhere',
    body: 'Jump to any board or task, run actions like "toggle theme" or "open My Work" — without ever touching the sidebar.',
  },
  {
    icon: '⌨️',
    title: 'Press ? to see keyboard shortcuts',
    body: 'Use j / k to move between rows, e or Enter to open an item, x to bulk-select. Stays on keyboard, gets you through reviews 5x faster.',
  },
  {
    icon: '📋',
    title: 'My Work shows everything assigned to you',
    body: 'Across every board you have access to, in one filtered view. No more hunting for "what was that task again?"',
  },
  {
    icon: '🔔',
    title: 'The bell is your inbox',
    body: 'Mentions, assignments, and replies land here. Click any notification to jump straight to the item.',
  },
];

export default function WelcomeTour({ onDismiss, userName }) {
  const dismissBtnRef = useRef(null);
  const { logoSrc, isDarkLogo } = useThemeLogo();
  useEffect(() => { dismissBtnRef.current?.focus(); }, []);

  // Esc closes the modal — separate from the global handlers so it works
  // even if focus isn't on the dismiss button.
  useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape') handleDismiss(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleDismiss = () => {
    dismissWelcomeTour();
    onDismiss?.();
  };

  const firstName = (userName || '').split(/\s+/)[0] || 'there';

  return (
    <div
      onClick={handleDismiss}
      style={{
        position: 'fixed', inset: 0, zIndex: 9990,
        background: 'rgba(15, 23, 42, 0.55)',
        backdropFilter: 'blur(2px)',
        display: 'flex', justifyContent: 'center', alignItems: 'center',
        padding: 16,
        animation: 'wb-tour-fade 200ms ease both',
      }}
    >
      <div
        onClick={e => e.stopPropagation()}
        style={{
          width: 560, maxWidth: '94vw', maxHeight: '90vh', overflowY: 'auto',
          background: 'var(--card-bg, #fff)',
          color: 'var(--text-primary, #172b4d)',
          border: '1px solid var(--border-color, #dfe1e6)',
          borderRadius: 16,
          boxShadow: '0 28px 80px rgba(9,30,66,0.4)',
          padding: '28px 28px 22px',
          animation: 'wb-tour-pop 280ms cubic-bezier(0.34, 1.56, 0.64, 1) both',
        }}
      >
        {/* Header */}
        <div style={{ textAlign: 'center', marginBottom: 22 }}>
          <div style={{ marginBottom: 14 }}>
            <img
              className="theme-logo"
              src={logoSrc}
              alt="Simplix"
              style={{ height: isDarkLogo ? 34 : 40, maxWidth: 160, objectFit: 'contain' }}
            />
          </div>
          <h1 style={{ fontSize: 22, fontWeight: 800, margin: '0 0 6px', color: 'var(--text-primary)' }}>
            Welcome, {firstName} 👋
          </h1>
          <p style={{ fontSize: 13, color: 'var(--text-secondary)', margin: 0, lineHeight: 1.5 }}>
            Four shortcuts to know before you dive in. Each one will save you a few clicks every day.
          </p>
        </div>

        {/* Tips grid */}
        <div style={{ display: 'grid', gap: 12, marginBottom: 18 }}>
          {TIPS.map((t, i) => (
            <div
              key={i}
              style={{
                display: 'flex', gap: 12, padding: '12px 14px',
                background: 'var(--bg-secondary, #f7f8fa)',
                borderRadius: 10,
                border: '1px solid var(--border-color, #e6e9ef)',
              }}
            >
              <div style={{
                width: 38, height: 38, flexShrink: 0,
                background: 'var(--card-bg, #fff)',
                border: '1px solid var(--border-color, #dfe1e6)',
                borderRadius: 10,
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                fontSize: 18,
              }}>
                {t.icon}
              </div>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--text-primary)' }}>
                  {t.title}
                </div>
                <div style={{ fontSize: 12, color: 'var(--text-secondary)', marginTop: 3, lineHeight: 1.5 }}>
                  {t.body}
                </div>
              </div>
            </div>
          ))}
        </div>

        {/* Action row */}
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10, alignItems: 'center' }}>
          <span style={{ fontSize: 11, color: 'var(--text-secondary)', marginRight: 'auto' }}>
            You can re-open shortcuts anytime with <kbd style={{
              fontFamily: 'ui-monospace, monospace', fontSize: 10,
              background: 'var(--bg-secondary)', border: '1px solid var(--border-color)',
              borderBottomWidth: 2, borderRadius: 4, padding: '1px 6px',
            }}>?</kbd>
          </span>
          <button
            ref={dismissBtnRef}
            onClick={handleDismiss}
            style={{
              background: '#9b72f5', color: '#fff',
              border: 'none', borderRadius: 8,
              padding: '10px 22px', fontSize: 13, fontWeight: 600,
              cursor: 'pointer',
              boxShadow: '0 1px 2px rgba(0,115,234,0.3)',
            }}
          >
            Got it — let's go →
          </button>
        </div>
      </div>

      <style>{`
        @keyframes wb-tour-fade { from { opacity: 0; } to { opacity: 1; } }
        @keyframes wb-tour-pop  { from { opacity: 0; transform: scale(0.92) translateY(8px); } to { opacity: 1; transform: scale(1) translateY(0); } }
      `}</style>
    </div>
  );
}
