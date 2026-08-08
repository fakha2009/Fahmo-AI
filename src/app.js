import { loadSettings } from './core/settings.js';
import { initRouter, registerRoute, renderRoute } from './core/router.js';
import { t } from './core/i18n.js';
import { homePage } from './pages/home.js';
import { analyzePage } from './pages/analyze.js';
import { processPage } from './pages/process.js';
import { resultPage } from './pages/result.js';
import { historyPage } from './pages/history.js';
import { settingsPage } from './pages/settings.js';
import { installPage, notFoundPage, offlinePage, sharedPage } from './pages/misc.js';
import { showToast } from './ui/toast.js';
import { startReminderScheduler } from './core/reminder-scheduler.js';
import { tasksPage } from './pages/tasks.js';

registerRoute('/', homePage);
registerRoute('/analyze', analyzePage);
registerRoute('/analyze/:analysisId', processPage);
registerRoute('/result/:analysisId', resultPage);
registerRoute('/history', historyPage);
registerRoute('/tasks', tasksPage);
registerRoute('/settings', settingsPage);
registerRoute('/offline', offlinePage);
registerRoute('/install', installPage);
registerRoute('/shared/:shareId', sharedPage);
registerRoute('/not-found', notFoundPage);

let reloadForServiceWorkerUpdate = false;

window.addEventListener('appinstalled', () => {
  showToast({ title: t('installApp'), message: t('ready'), type: 'success' });
});

window.addEventListener('fahmo:language-change', () => renderRoute());
window.addEventListener('fahmo:settings-change', (event) => {
  if (event.detail?.language) document.documentElement.lang = event.detail.language;
});

window.addEventListener('error', (event) => {
  console.error(event.error ?? event.message);
});
window.addEventListener('unhandledrejection', (event) => {
  console.error(event.reason);
});

navigator.serviceWorker?.addEventListener?.('message', (event) => {
  if (event.data?.type === 'NAVIGATE' && typeof event.data.url === 'string') {
    history.pushState({}, '', event.data.url);
    renderRoute();
  }
});

async function registerServiceWorker() {
  if (!('serviceWorker' in navigator) || location.protocol === 'file:') return;
  try {
    const registration = await navigator.serviceWorker.register('/sw.js', { scope: '/', updateViaCache: 'none' });
    if (registration.waiting) showUpdate(registration);
    registration.addEventListener('updatefound', () => {
      const worker = registration.installing;
      worker?.addEventListener('statechange', () => {
        if (worker.state === 'installed' && navigator.serviceWorker.controller) showUpdate(registration);
      });
    });
    navigator.serviceWorker.addEventListener('controllerchange', () => {
      if (reloadForServiceWorkerUpdate) location.reload();
    });
  } catch (error) {
    console.warn('Service worker registration failed', error);
  }
}

function showUpdate(registration) {
  showToast({
    title: t('updateAvailable'),
    message: t('updateNow'),
    type: 'info',
    duration: 0,
    action: {
      label: t('updateNow'),
      onClick: () => {
        reloadForServiceWorkerUpdate = true;
        registration.waiting?.postMessage({ type: 'SKIP_WAITING' });
      }
    }
  });
}

await loadSettings();
await initRouter();
registerServiceWorker();
startReminderScheduler();
