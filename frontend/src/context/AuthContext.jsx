import React, { createContext, useContext, useState, useEffect, useCallback } from 'react';
import api from '../api';

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);

  // Bootstrap: verify session on mount.
  // Attaches the localStorage token as Authorization header if present (backward compat),
  // then calls /auth/me — which succeeds via either the httpOnly cookie OR the header.
  useEffect(() => {
    const token = localStorage.getItem('wb_token');
    if (token) {
      api.defaults.headers.common['Authorization'] = `Bearer ${token}`;
    }
    api.get('/auth/me')
      .then(r => setUser(r.data))
      .catch(() => {
        localStorage.removeItem('wb_token');
        delete api.defaults.headers.common['Authorization'];
      })
      .finally(() => setLoading(false));
  }, []);

  const login = useCallback((token, userData) => {
    if (token) {
      // Store token for backward compat and attach to headers.
      // When token is null (cookie-only flow), the httpOnly cookie handles auth.
      localStorage.setItem('wb_token', token);
      api.defaults.headers.common['Authorization'] = `Bearer ${token}`;
    }
    setUser(userData);
  }, []);

  const logout = useCallback(() => {
    // Fire-and-forget: clear the httpOnly cookie server-side.
    // State is cleared synchronously so navigation after logout works immediately.
    api.post('/auth/logout').catch(() => {});
    localStorage.removeItem('wb_token');
    delete api.defaults.headers.common['Authorization'];
    setUser(null);
  }, []);

  const updateUser = useCallback((updates) => {
    setUser(prev => ({ ...prev, ...updates }));
  }, []);

  // Silently re-fetch the current profile so admin-side changes (role,
  // is_active, mcp_enabled) propagate without the user reloading the app.
  const refreshUser = useCallback(() => {
    api.get('/auth/me').then(r => setUser(r.data)).catch(() => {});
  }, []);

  // Keep the profile fresh: on tab focus / becoming visible, and on a short
  // interval. This makes e.g. an admin disabling a user's MCP access reflect in
  // that user's UI within seconds (or instantly when they return to the tab),
  // rather than only on a manual refresh. (Server-side access is already
  // enforced live on every request — this just keeps the UI in sync.)
  useEffect(() => {
    if (!user?.id) return;
    const onFocus = () => refreshUser();
    const onVisible = () => { if (document.visibilityState === 'visible') refreshUser(); };
    window.addEventListener('focus', onFocus);
    document.addEventListener('visibilitychange', onVisible);
    const interval = setInterval(refreshUser, 30000); // every 30s
    return () => {
      window.removeEventListener('focus', onFocus);
      document.removeEventListener('visibilitychange', onVisible);
      clearInterval(interval);
    };
  }, [user?.id, refreshUser]);

  const isAdmin    = user?.role === 'admin';
  const isManager  = user?.role === 'admin'   || user?.role === 'manager';
  const canEdit    = user?.role === 'admin'   || user?.role === 'manager' || user?.role === 'member';
  const isReadOnly = user?.role === 'user';

  return (
    <AuthContext.Provider value={{ user, loading, login, logout, updateUser, refreshUser, isAdmin, isManager, canEdit, isReadOnly }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within AuthProvider');
  return ctx;
}
