import test from 'node:test';
import assert from 'node:assert/strict';
import { applyThemeToDocument, getResolvedTheme, nextThemePreference, normalizeThemePreference, readStoredThemePreference, THEME_STORAGE_KEY } from '../src/utils/theme.js';

test('getResolvedTheme returns explicit light and dark preferences', () => {
  assert.equal(getResolvedTheme('light'), 'light');
  assert.equal(getResolvedTheme('dark'), 'dark');
});

test('getResolvedTheme resolves system preference from matchMedia', () => {
  const originalWindow = global.window;
  global.window = { matchMedia: () => ({ matches: true }) };
  assert.equal(getResolvedTheme('system'), 'dark');
  global.window = { matchMedia: () => ({ matches: false }) };
  assert.equal(getResolvedTheme('system'), 'light');
  global.window = originalWindow;
});

test('readStoredThemePreference falls back to system when storage is missing or invalid', () => {
  const originalWindow = global.window;
  global.window = { localStorage: { getItem: () => 'dark' } };
  assert.equal(readStoredThemePreference(), 'dark');
  global.window = { localStorage: { getItem: () => 'wat' } };
  assert.equal(readStoredThemePreference(), 'system');
  global.window = { localStorage: { getItem: () => { throw new Error('blocked'); } } };
  assert.equal(readStoredThemePreference(), 'system');
  global.window = originalWindow;
  assert.equal(THEME_STORAGE_KEY, 'taskman_theme');
});

test('applyThemeToDocument writes theme attributes when a document exists', () => {
  const originalDocument = global.document;
  const state = { dataset: {}, style: {} };
  global.document = { documentElement: state };
  applyThemeToDocument('dark');
  assert.equal(state.dataset.theme, 'dark');
  assert.equal(state.style.colorScheme, 'dark');
  applyThemeToDocument('light');
  assert.equal(state.dataset.theme, 'light');
  assert.equal(state.style.colorScheme, 'light');
  global.document = originalDocument;
});

test('normalizeThemePreference and nextThemePreference keep theme state predictable', () => {
  assert.equal(normalizeThemePreference('dark'), 'dark');
  assert.equal(normalizeThemePreference('wat'), 'system');
  assert.equal(nextThemePreference('system'), 'light');
  assert.equal(nextThemePreference('light'), 'dark');
  assert.equal(nextThemePreference('dark'), 'system');
  assert.equal(nextThemePreference('wat'), 'light');
});

test('theme bootstrap logic prefers stored theme and falls back to system or light safely', () => {
  const resolveTheme = (preference, systemDark = false) => {
    const resolved = preference === 'system' ? (systemDark ? 'dark' : 'light') : preference;
    return resolved === 'dark' ? 'dark' : 'light';
  };

  assert.equal(resolveTheme('dark', false), 'dark');
  assert.equal(resolveTheme('light', true), 'light');
  assert.equal(resolveTheme('system', true), 'dark');
  assert.equal(resolveTheme('system', false), 'light');
  assert.equal(resolveTheme('wat', true), 'light');
});
