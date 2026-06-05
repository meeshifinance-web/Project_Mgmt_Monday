import React, { createContext, useContext, useState, useEffect, useCallback } from 'react';
import { getUnreadNotificationCount, markAllNotificationsRead } from '../api';
import { useAuth } from './AuthContext';

const NotificationContext = createContext(null);

export function NotificationProvider({ children }) {
  const [unreadCount, setUnreadCount] = useState(0);
  const { user } = useAuth();

  const refresh = useCallback(() => {
    if (!user) return;
    getUnreadNotificationCount()
      .then(r => setUnreadCount(r.data.count))
      .catch(() => {});
  }, [user]);

  // Poll the unread badge every 15 s, and refresh immediately when the tab
  // regains focus so the count stays current without a manual page refresh.
  useEffect(() => {
    refresh();
    const id = setInterval(() => { if (!document.hidden) refresh(); }, 15000);
    const onFocus = () => refresh();
    window.addEventListener('focus', onFocus);
    document.addEventListener('visibilitychange', onFocus);
    return () => { clearInterval(id); window.removeEventListener('focus', onFocus); document.removeEventListener('visibilitychange', onFocus); };
  }, [refresh]);

  const markAllRead = useCallback(async () => {
    try {
      await markAllNotificationsRead();
      setUnreadCount(0);
    } catch { /* silent */ }
  }, []);

  const decrementUnread = useCallback((n = 1) => {
    setUnreadCount(c => Math.max(0, c - n));
  }, []);

  const incrementUnread = useCallback(() => {
    setUnreadCount(c => c + 1);
  }, []);

  return (
    <NotificationContext.Provider value={{ unreadCount, refresh, markAllRead, decrementUnread, incrementUnread }}>
      {children}
    </NotificationContext.Provider>
  );
}

export function useNotifications() {
  const ctx = useContext(NotificationContext);
  if (!ctx) throw new Error('useNotifications must be used within NotificationProvider');
  return ctx;
}
