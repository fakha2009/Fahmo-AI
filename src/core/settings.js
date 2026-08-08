import { dbGet, dbPut } from './db.js';
import { normalizeApiBaseUrl } from './api.js';
import { getLanguage, setLanguage } from './i18n.js';

const runtimeConfig = globalThis.__FAHMO_CONFIG__ ?? {};
const runtimeHttpMode = runtimeConfig.apiMode === 'http';

export const DEFAULT_SETTINGS = Object.freeze({
  id: 'app-settings',
  language: 'ru',
  theme: 'system',
  textScale: 100,
  reduceMotion: false,
  resultLanguage: 'ru',
  explanationLevel: 'standard',
  analysisMode: runtimeHttpMode ? 'remote' : 'local',
  apiBaseUrl: normalizeApiBaseUrl(runtimeConfig.apiBaseUrl),
  notifications: false,
  reminderMinutes: 60,
  updatedAt: new Date(0).toISOString()
});

let cache = { ...DEFAULT_SETTINGS };

export async function loadSettings() {
  const stored = await dbGet('settings', DEFAULT_SETTINGS.id).catch(() => null);
  cache = {
    ...DEFAULT_SETTINGS,
    ...(stored ?? {}),
  };
  cache.apiBaseUrl = normalizeApiBaseUrl(cache.apiBaseUrl);
  if (runtimeHttpMode && DEFAULT_SETTINGS.apiBaseUrl) {
    cache.apiBaseUrl = DEFAULT_SETTINGS.apiBaseUrl;
    cache.analysisMode = 'remote';
  }
  const localTheme = localStorage.getItem('fahmo:theme');
  const localLanguage = localStorage.getItem('fahmo:language');
  const localScale = Number(localStorage.getItem('fahmo:text-scale'));
  const localMotion = localStorage.getItem('fahmo:reduce-motion');
  if (localTheme) cache.theme = localTheme;
  if (localLanguage) cache.language = localLanguage;
  if (Number.isFinite(localScale) && localScale >= 85 && localScale <= 130) cache.textScale = localScale;
  if (localMotion != null) cache.reduceMotion = localMotion === 'true';
  applySettings(cache, { dispatch: false });
  return cache;
}

export function getSettings() { return { ...cache }; }

export async function updateSettings(patch) {
  const safePatch = { ...patch };
  if (isApiConfigurationLocked()) {
    delete safePatch.apiBaseUrl;
    delete safePatch.analysisMode;
  }
  const normalizedPatch = { ...safePatch };
  if (Object.prototype.hasOwnProperty.call(safePatch, 'apiBaseUrl')) {
    normalizedPatch.apiBaseUrl = normalizeApiBaseUrl(safePatch.apiBaseUrl);
  }
  cache = { ...cache, ...normalizedPatch, id: DEFAULT_SETTINGS.id, updatedAt: new Date().toISOString() };
  applySettings(cache);
  await dbPut('settings', cache);
  return getSettings();
}

export function isApiConfigurationLocked() {
  return runtimeConfig.environment === 'production' || runtimeConfig.allowApiSettings !== true;
}

export function applySettings(settings, options = {}) {
  const { dispatch = true } = options;
  const root = document.documentElement;
  localStorage.setItem('fahmo:theme', settings.theme);
  localStorage.setItem('fahmo:text-scale', String(settings.textScale));
  localStorage.setItem('fahmo:reduce-motion', String(settings.reduceMotion));
  root.dataset.themePreference = settings.theme;
  root.style.setProperty('--text-scale', String(settings.textScale / 100));
  if (settings.reduceMotion) root.dataset.reduceMotion = 'true';
  else delete root.dataset.reduceMotion;
  applyTheme(settings.theme);
  if (settings.language !== getLanguage()) setLanguage(settings.language);
  if (dispatch) window.dispatchEvent(new CustomEvent('fahmo:settings-change', { detail: getSettings() }));
}

export function applyTheme(preference = cache.theme) {
  const dark = preference === 'dark' || (preference === 'system' && matchMedia('(prefers-color-scheme: dark)').matches);
  document.documentElement.dataset.theme = dark ? 'dark' : 'light';
  const themeMeta = document.querySelector('meta[name="theme-color"]');
  themeMeta?.setAttribute('content', dark ? '#0D1020' : '#6C4DFF');
}

matchMedia('(prefers-color-scheme: dark)').addEventListener?.('change', () => {
  if (cache.theme === 'system') applyTheme('system');
});
