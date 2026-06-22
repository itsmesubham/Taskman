import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { applyThemeToDocument, getResolvedTheme, nextThemePreference, readStoredThemePreference, normalizeThemePreference, THEME_STORAGE_KEY } from '../utils/theme.js';

const ThemeContext = createContext(null);

export function ThemeProvider({ children }) {
  const [themePreference, setThemePreferenceState] = useState(() => readStoredThemePreference());
  const [resolvedTheme, setResolvedTheme] = useState(() => getResolvedTheme(themePreference));

  useEffect(() => {
    const nextResolved = getResolvedTheme(themePreference);
    setResolvedTheme(nextResolved);
    applyThemeToDocument(nextResolved);
  }, [themePreference]);

  useEffect(() => {
    if (themePreference !== 'system' || typeof window === 'undefined' || !window.matchMedia) return undefined;
    const media = window.matchMedia('(prefers-color-scheme: dark)');
    const onChange = () => {
      const nextResolved = getResolvedTheme('system');
      setResolvedTheme(nextResolved);
      applyThemeToDocument(nextResolved);
    };
    if (media.addEventListener) {
      media.addEventListener('change', onChange);
      return () => media.removeEventListener('change', onChange);
    }
    media.addListener(onChange);
    return () => media.removeListener(onChange);
  }, [themePreference]);

  useEffect(() => {
    if (typeof window === 'undefined') return undefined;
    try {
      window.localStorage.setItem(THEME_STORAGE_KEY, themePreference);
    } catch {
      // ignore storage failures
    }
    return undefined;
  }, [themePreference]);

  const setThemePreference = useCallback((nextPreference) => {
    const preference = normalizeThemePreference(nextPreference);
    setThemePreferenceState(preference);
  }, []);

  const toggleTheme = useCallback(() => {
    setThemePreferenceState((current) => nextThemePreference(current));
  }, []);

  const value = useMemo(() => ({
    themePreference,
    resolvedTheme,
    setThemePreference,
    toggleTheme
  }), [resolvedTheme, setThemePreference, themePreference, toggleTheme]);

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export function useTheme() {
  const value = useContext(ThemeContext);
  if (!value) throw new Error('useTheme must be used inside ThemeProvider');
  return value;
}
