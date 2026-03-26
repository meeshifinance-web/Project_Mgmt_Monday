import React, { createContext, useContext } from 'react';
import { useTheme } from '../hooks/useTheme';

const defaultTheme = { theme: 'system', setTheme: () => {}, resolvedTheme: 'light' };
const ThemeContext = createContext(defaultTheme);

export function ThemeProvider({ children }) {
  const themeValue = useTheme();
  return <ThemeContext.Provider value={themeValue}>{children}</ThemeContext.Provider>;
}

export function useThemeContext() {
  return useContext(ThemeContext);
}
