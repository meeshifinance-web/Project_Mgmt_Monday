import { useThemeContext } from '../context/ThemeContext';

export const LIGHT_LOGO_SRC = '/logo.png';
export const DARK_LOGO_SRC = '/logo3.png';

export function getThemeLogoSrc(resolvedTheme) {
  return resolvedTheme === 'dark' ? DARK_LOGO_SRC : LIGHT_LOGO_SRC;
}

export function useThemeLogo() {
  const { resolvedTheme } = useThemeContext();
  const isDarkLogo = resolvedTheme === 'dark';

  return {
    logoSrc: getThemeLogoSrc(resolvedTheme),
    isDarkLogo,
  };
}
