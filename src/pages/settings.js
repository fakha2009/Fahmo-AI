import { dbClear, exportDatabase } from '../core/db.js';
import { setLanguage, t } from '../core/i18n.js';
import { getSettings, isApiConfigurationLocked, updateSettings } from '../core/settings.js';
import { navigate } from '../core/router.js';
import { downloadBlob, escapeAttribute, escapeHtml } from '../core/utils.js';
import { confirmDialog } from '../ui/dialogs.js';
import { icon } from '../ui/icons.js';
import { renderShell } from '../ui/shell.js';
import { showToast } from '../ui/toast.js';

let settings;

function option(value, label, selected) {
  return `<option value="${escapeAttribute(value)}" ${selected === value ? 'selected' : ''}>${escapeHtml(label)}</option>`;
}

function render() {
  settings = getSettings();
  renderShell({
    title: t('navSettings'),
    currentPath: '/settings',
    content: `
      <header class="page-header">
        <div class="page-header__copy"><h1 class="page-title">${escapeHtml(t('settingsTitle'))}</h1><p class="page-subtitle">${escapeHtml(t('settingsSubtitle'))}</p></div>
      </header>
      <div class="settings-page">
        <div class="settings-sections">
          <section class="card settings-section">
            <h2>${escapeHtml(t('interface'))}</h2>
            <div class="setting-row">
              <div class="setting-row__label"><strong>${escapeHtml(t('language'))}</strong><span>Русский · Тоҷикӣ · English</span></div>
              <select class="select" data-setting="language">${option('ru', 'Русский', settings.language)}${option('tg', 'Тоҷикӣ', settings.language)}${option('en', 'English', settings.language)}</select>
            </div>
            <div class="setting-row">
              <div class="setting-row__label"><strong>${escapeHtml(t('theme'))}</strong><span>${escapeHtml(t('themeSystem'))} / ${escapeHtml(t('themeLight'))} / ${escapeHtml(t('themeDark'))}</span></div>
              <select class="select" data-setting="theme">${option('system', t('themeSystem'), settings.theme)}${option('light', t('themeLight'), settings.theme)}${option('dark', t('themeDark'), settings.theme)}</select>
            </div>
            <div class="setting-row">
              <div class="setting-row__label"><strong>${escapeHtml(t('textSize'))}</strong><span>${settings.textScale}%</span></div>
              <select class="select" data-setting="textScale">${[90,100,110,120,130].map((value) => option(String(value), `${value}%`, String(settings.textScale))).join('')}</select>
            </div>
            <div class="setting-row">
              <div class="setting-row__label"><strong>${escapeHtml(t('reduceMotion'))}</strong><span>prefers-reduced-motion</span></div>
              <button class="switch" type="button" role="switch" aria-checked="${settings.reduceMotion}" data-toggle="reduceMotion"><span class="sr-only">${escapeHtml(t('reduceMotion'))}</span></button>
            </div>
          </section>

          <section class="card settings-section">
            <h2>${escapeHtml(t('analysis'))}</h2>
            <div class="setting-row">
              <div class="setting-row__label"><strong>${escapeHtml(t('defaultResultLanguage'))}</strong><span>${escapeHtml(t('resultLanguage'))}</span></div>
              <select class="select" data-setting="resultLanguage">${option('ru', 'Русский', settings.resultLanguage)}${option('tg', 'Тоҷикӣ', settings.resultLanguage)}${option('en', 'English', settings.resultLanguage)}</select>
            </div>
            <div class="setting-row">
              <div class="setting-row__label"><strong>${escapeHtml(t('defaultExplanation'))}</strong><span>${escapeHtml(t('verySimpleDesc'))}</span></div>
              <select class="select" data-setting="explanationLevel">${option('standard', t('standard'), settings.explanationLevel)}${option('simple', t('verySimple'), settings.explanationLevel)}</select>
            </div>
            ${isApiConfigurationLocked() ? '' : `<div class="setting-row">
              <div class="setting-row__label"><strong>${escapeHtml(t('analysisMode'))}</strong><span>${escapeHtml(settings.analysisMode === 'remote' ? t('remoteProvider') : t('localProvider'))}</span></div>
              <select class="select" data-setting="analysisMode">${option('local', t('localProvider'), settings.analysisMode)}${option('remote', t('remoteProvider'), settings.analysisMode)}</select>
            </div>
            <div class="setting-row">
              <div class="setting-row__label"><strong>${escapeHtml(t('apiUrl'))}</strong><span>${escapeHtml(t('apiUrlHint'))}</span></div>
              <input class="input" type="url" inputmode="url" data-api-url value="${escapeAttribute(settings.apiBaseUrl)}" placeholder="https://api.example.com">
            </div>`}
          </section>

          <section class="card settings-section">
            <h2>${escapeHtml(t('notifications'))}</h2>
            <div class="setting-row">
              <div class="setting-row__label"><strong>${escapeHtml(t('allowNotifications'))}</strong><span>${escapeHtml('Notification' in window ? Notification.permission : 'unsupported')}</span></div>
              <button class="switch" type="button" role="switch" aria-checked="${settings.notifications && 'Notification' in window && Notification.permission === 'granted'}" data-toggle="notifications"></button>
            </div>
            <div class="setting-row">
              <div class="setting-row__label"><strong>${escapeHtml(t('testNotification'))}</strong><span>Web Notification API</span></div>
              <button class="button button--secondary button--small" type="button" data-test-notification>${icon('bell')} ${escapeHtml(t('testNotification'))}</button>
            </div>
          </section>

          <section class="card settings-section">
            <h2>${escapeHtml(t('data'))}</h2>
            <div class="alert alert--info">${icon('info')}<div><strong>${escapeHtml(t('sourceDeletionInfo'))}</strong><p>${escapeHtml(t('localAnalysisNotice'))}</p></div></div>
            <div class="setting-row">
              <div class="setting-row__label"><strong>${escapeHtml(t('exportData'))}</strong><span>JSON без исходных файлов</span></div>
              <button class="button button--secondary button--small" type="button" data-export>${icon('download')} ${escapeHtml(t('exportData'))}</button>
            </div>
            <div class="setting-row">
              <div class="setting-row__label"><strong>${escapeHtml(t('deleteHistory'))}</strong><span>${escapeHtml(t('confirmDeleteText'))}</span></div>
              <button class="button button--danger button--small" type="button" data-delete-history>${icon('trash')} ${escapeHtml(t('deleteHistory'))}</button>
            </div>
          </section>
        </div>

        <aside>
          <section class="card card--padded">
            <div class="card__header"><div><h2 class="card__title">${escapeHtml(t('pwa'))}</h2><p class="card__description">${escapeHtml(t('installSubtitle'))}</p></div></div>
            <div class="settings-stack">
              <div class="data-item"><div class="data-item__type">${escapeHtml(t('version'))}</div><div class="data-item__value">${escapeHtml(globalThis.__FAHMO_CONFIG__?.appVersion ?? '1.1.3')}</div></div>
              <div class="data-item"><div class="data-item__type">${escapeHtml(t('cacheStatus'))}</div><div class="data-item__value">${escapeHtml('serviceWorker' in navigator ? t('ready') : '—')}</div></div>
              <button class="button button--primary button--wide" type="button" data-install>${icon('install')} ${escapeHtml(t('installApp'))}</button>
              <button class="button button--secondary button--wide" type="button" data-update>${icon('refresh')} ${escapeHtml(t('updateApp'))}</button>
              <a class="button button--ghost button--wide" href="/install" data-router>${icon('info')} ${escapeHtml(t('installTitle'))}</a>
            </div>
          </section>
        </aside>
      </div>`
  });
  bindEvents();
}

async function changeSetting(key, value) {
  if (key === 'textScale') value = Number(value);
  if (key === 'language') setLanguage(value);
  await updateSettings({ [key]: value });
  render();
}

async function toggleSetting(key, button) {
  if (key === 'notifications') {
    if (!('Notification' in window)) {
      showToast({ title: t('errorTitle'), message: 'Notification API is unavailable.', type: 'warning' });
      return;
    }
    const permission = await Notification.requestPermission();
    const enabled = permission === 'granted';
    await updateSettings({ notifications: enabled });
    button.setAttribute('aria-checked', String(enabled));
    return;
  }
  const next = !settings[key];
  await updateSettings({ [key]: next });
  render();
}

async function exportData() {
  const database = await exportDatabase();
  const sanitized = {
    ...database,
    data: {
      analyses: database.data.analyses.map((item) => ({ ...item, sources: item.sources?.map(({ blob: _blob, ...source }) => source) })),
      drafts: database.data.drafts.map((item) => ({ ...item, sources: item.sources?.map(({ blob: _blob, ...source }) => source) })),
      settings: database.data.settings,
      shares: database.data.shares
    }
  };
  downloadBlob(new Blob([JSON.stringify(sanitized, null, 2)], { type: 'application/json;charset=utf-8' }), `fahmo-ai-export-${new Date().toISOString().slice(0,10)}.json`);
  showToast({ title: t('dataExported'), type: 'success' });
}

async function deleteHistory() {
  const confirmed = await confirmDialog({ title: t('deleteHistory'), message: t('confirmDeleteText'), confirmLabel: t('delete'), cancelLabel: t('cancel'), danger: true });
  if (!confirmed) return;
  await Promise.all([dbClear('analyses'), dbClear('drafts'), dbClear('shares')]);
  showToast({ title: t('historyDeleted'), type: 'success' });
}

async function installApp() {
  navigate('/install');
}

async function checkUpdate() {
  const registration = await navigator.serviceWorker?.getRegistration();
  if (!registration) {
    showToast({ title: t('cacheStatus'), message: 'Service worker is not registered.', type: 'warning' });
    return;
  }
  await registration.update();
  showToast({ title: t('updateApp'), message: t('ready'), type: 'success' });
}

function testNotification() {
  if (!('Notification' in window)) {
    showToast({ title: t('errorTitle'), message: 'Notification API is unavailable.', type: 'warning' });
    return;
  }
  if (Notification.permission !== 'granted') {
    showToast({ title: t('errorTitle'), message: t('allowNotifications'), type: 'warning' });
    return;
  }
  new Notification(t('appName'), { body: t('notificationSent'), icon: '/public/assets/icon-192-v2.png' });
  showToast({ title: t('notificationSent'), type: 'success' });
}

function bindEvents() {
  document.querySelectorAll('[data-setting]').forEach((select) => select.addEventListener('change', () => changeSetting(select.dataset.setting, select.value)));
  document.querySelectorAll('[data-toggle]').forEach((button) => button.addEventListener('click', () => toggleSetting(button.dataset.toggle, button)));
  const apiInput = document.querySelector('[data-api-url]');
  apiInput?.addEventListener('change', async () => {
    const value = apiInput.value.trim().replace(/\/+$/, '');
    await updateSettings({ apiBaseUrl: value });
    showToast({ title: t('saved'), type: 'success' });
  });
  document.querySelector('[data-test-notification]')?.addEventListener('click', testNotification);
  document.querySelector('[data-export]')?.addEventListener('click', exportData);
  document.querySelector('[data-delete-history]')?.addEventListener('click', deleteHistory);
  document.querySelector('[data-install]')?.addEventListener('click', installApp);
  document.querySelector('[data-update]')?.addEventListener('click', checkUpdate);
}

export async function settingsPage() {
  render();
  return { title: t('settingsTitle') };
}
