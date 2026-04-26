/**
 * Toast.jsx
 *
 * Thin wrapper around `sonner` that preserves our existing `useToast()`
 * call signature — `toast(message, type)` — while upgrading the visual
 * language to a polished, theme-aware notification stack with stacked
 * animations, hover-to-pause, close button, and optional inline actions
 * (for things like "Item deleted · Undo").
 *
 * Existing call sites continue to work unchanged:
 *   const toast = useToast();
 *   toast('Saved');                       // neutral
 *   toast('All good', 'success');
 *   toast('Boom', 'error');
 *
 * New, opt-in capabilities — pass an options object as the second arg:
 *   toast('Item deleted', {
 *     type: 'success',
 *     action: { label: 'Undo', onClick: () => restore(id) },
 *     duration: 8000,
 *   });
 *
 *   toast.promise(savePromise, {
 *     loading: 'Saving…', success: 'Saved', error: 'Save failed'
 *   });
 */

import React from 'react';
import { Toaster, toast as sonnerToast } from 'sonner';
import { useThemeContext } from '../context/ThemeContext';

// ── Provider — drops a single Toaster at the app root ────────────────────────
// Theme prop is bound to the resolved theme so toasts flip when the user does.
// `richColors` enables the colored success/error/warning treatment that reads
// as "considered" instead of generic. `closeButton` adds a hover-revealed × so
// users can dismiss persistent / long-duration toasts manually.
export function ToastProvider({ children }) {
  const { resolvedTheme } = useThemeContext();
  return (
    <>
      {children}
      <Toaster
        position="bottom-right"
        theme={resolvedTheme === 'dark' ? 'dark' : 'light'}
        richColors
        closeButton
        expand={false}
        visibleToasts={4}
        toastOptions={{
          duration: 4000,
          style: { fontFamily: 'inherit', fontSize: 13 },
        }}
      />
    </>
  );
}

// ── dispatch(message, typeOrOptions) — preserves the legacy 2-arg signature ──
//
// 2nd arg can be:
//   - a string  → 'success' | 'error' | 'warning' | 'info' (legacy)
//   - an object → { type, action, duration, ... } (richer)
//   - undefined → neutral toast
//
// Lives at module scope (not inside a component) so the function reference is
// stable across renders — useToast() consumers don't need useCallback.
function dispatch(message, typeOrOptions) {
  if (message == null || message === '') return;

  // Legacy form: dispatch('Saved', 'success')
  if (typeof typeOrOptions === 'string' || typeOrOptions === undefined) {
    const type = typeOrOptions;
    if (type === 'success') return sonnerToast.success(message);
    if (type === 'error')   return sonnerToast.error(message);
    if (type === 'warning') return sonnerToast.warning(message);
    if (type === 'info')    return sonnerToast.info(message);
    return sonnerToast(message);
  }

  // Rich form: dispatch('Saved', { type:'success', action: { label, onClick }})
  const opts = typeOrOptions || {};
  const fn = opts.type === 'success' ? sonnerToast.success
           : opts.type === 'error'   ? sonnerToast.error
           : opts.type === 'warning' ? sonnerToast.warning
           : opts.type === 'info'    ? sonnerToast.info
           : sonnerToast;
  return fn(message, {
    duration: opts.duration,
    action: opts.action,        // { label, onClick }
    cancel:  opts.cancel,       // { label, onClick }
    description: opts.description,
  });
}

// Expose sonner.promise straight through — useful for "Saving…" → "Saved"
// flows around any awaitable. Attached to the dispatch function so
// `useToast().promise(...)` works without a separate import.
dispatch.promise = sonnerToast.promise.bind(sonnerToast);
dispatch.dismiss = sonnerToast.dismiss.bind(sonnerToast);

export function useToast() {
  return dispatch;
}
