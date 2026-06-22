export const THEME_STORAGE_KEY = 'taskman_theme';
export const THEME_OPTIONS = ['light', 'dark', 'system'];

export function getSystemTheme() {
  if (typeof window === 'undefined' || !window.matchMedia) return 'light';
  return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}

export function getResolvedTheme(preference) {
  if (preference === 'system') return getSystemTheme();
  return preference === 'dark' ? 'dark' : 'light';
}

export function readStoredThemePreference() {
  if (typeof window === 'undefined') return 'system';
  const stored = window.localStorage.getItem(THEME_STORAGE_KEY);
  return THEME_OPTIONS.includes(stored) ? stored : 'system';
}

export function applyThemeToDocument(resolvedTheme) {
  if (typeof document === 'undefined') return;
  const theme = resolvedTheme === 'dark' ? 'dark' : 'light';
  document.documentElement.dataset.theme = theme;
  document.documentElement.style.colorScheme = theme;
}
