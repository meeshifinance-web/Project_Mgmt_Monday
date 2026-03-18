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

  // Poll every 30 s
  useEffect(() => {
    refresh();
    const id = setInterval(refresh, 30000);
    return () => clearInterval(id);
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
