/**
 * EmptyState.jsx
 *
 * One reusable surface for "there's nothing here yet" messaging across the
 * app. Replaces the hand-rolled "📁 No folders yet" placeholders that were
 * scattered around the codebase, so every empty surface gets the same
 * polish — proper hierarchy, friendly tone, a clear primary action, and
 * theme-aware colors.
 *
 * Usage:
 *   <EmptyState
 *     icon="📁"
 *     title="Create your first folder"
 *     description="Group related boards so your team finds things faster."
 *     primaryAction={{ label: '+ New folder', onClick: handleCreate }}
 *   />
 *
 * Variants:
 *   `compact` — for tight sidebar / panel slots; smaller icon, no description
 *   `kind="filtered"` — adjusts copy to suggest clearing filters instead of
 *                       creating data when the emptiness is filter-driven
 */

import React from 'react';

export default function EmptyState({
  icon = '✨',
  title,
  description,
  primaryAction,    // { label, onClick }
  secondaryAction,  // { label, onClick, href }
  compact = false,
  kind,             // 'filtered' to soften copy when it's a filter-not-data issue
  style,
}) {
  const isFiltered = kind === 'filtered';
  const padY = compact ? 18 : 36;
  const iconSize = compact ? 28 : 56;
  const titleSize = compact ? 13 : 16;

  return (
    <div
      role="status"
      style={{
        padding: `${padY}px 24px`,
        textAlign: 'center',
        color: 'var(--text-secondary)',
        display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
        gap: compact ? 6 : 12,
        ...style,
      }}
    >
      <div
        aria-hidden
        style={{
          fontSize: iconSize,
          lineHeight: 1,
          opacity: 0.55,
          // Subtle scale-in so the empty surface feels intentional rather than
          // like a missing component. Keeps duration short — no animation on
          // every render, only first mount.
          animation: 'wb-empty-pop 260ms cubic-bezier(0.34, 1.56, 0.64, 1) both',
        }}
      >
        {icon}
      </div>

      {title && (
        <div style={{ fontSize: titleSize, fontWeight: 700, color: 'var(--text-primary)' }}>
          {title}
        </div>
      )}

      {!compact && description && (
        <div style={{ fontSize: 13, lineHeight: 1.55, maxWidth: 360, color: 'var(--text-secondary)' }}>
          {description}
        </div>
      )}

      {(primaryAction || secondaryAction) && !compact && (
        <div style={{ display: 'flex', gap: 8, marginTop: 6, flexWrap: 'wrap', justifyContent: 'center' }}>
          {primaryAction && (
            <button
              onClick={primaryAction.onClick}
              style={{
                background: isFiltered ? 'transparent' : '#9b72f5',
                color: isFiltered ? '#9b72f5' : '#fff',
                border: isFiltered ? '1.5px solid #9b72f5' : 'none',
                borderRadius: 8, padding: '8px 16px',
                fontSize: 13, fontWeight: 600, cursor: 'pointer',
                boxShadow: isFiltered ? 'none' : '0 1px 2px rgba(0,115,234,0.25)',
                transition: 'transform 0.1s ease, box-shadow 0.1s ease',
              }}
              onMouseEnter={e => { e.currentTarget.style.transform = 'translateY(-1px)'; }}
              onMouseLeave={e => { e.currentTarget.style.transform = 'translateY(0)'; }}
            >
              {primaryAction.label}
            </button>
          )}
          {secondaryAction && (
            secondaryAction.href ? (
              <a
                href={secondaryAction.href}
                target={secondaryAction.href.startsWith('http') ? '_blank' : undefined}
                rel={secondaryAction.href.startsWith('http') ? 'noopener noreferrer' : undefined}
                style={{ fontSize: 12, color: 'var(--text-secondary)', alignSelf: 'center', textDecoration: 'none' }}
              >
                {secondaryAction.label} ↗
              </a>
            ) : (
              <button
                onClick={secondaryAction.onClick}
                style={{
                  background: 'transparent', color: 'var(--text-secondary)',
                  border: 'none', fontSize: 12, padding: '8px 12px', cursor: 'pointer',
                }}
              >
                {secondaryAction.label}
              </button>
            )
          )}
        </div>
      )}

      {/* Compact variant inlines a small action link */}
      {compact && primaryAction && (
        <button
          onClick={primaryAction.onClick}
          style={{
            background: 'transparent', color: '#9b72f5',
            border: 'none', fontSize: 12, fontWeight: 600, cursor: 'pointer', padding: 0,
          }}
        >
          {primaryAction.label}
        </button>
      )}

      <style>{`
        @keyframes wb-empty-pop {
          from { opacity: 0; transform: scale(0.85) translateY(4px); }
          to   { opacity: 0.55; transform: scale(1) translateY(0); }
        }
      `}</style>
    </div>
  );
}
