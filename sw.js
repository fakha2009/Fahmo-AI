const CACHE_VERSION = 'fahmo-ai-v1.2.0';
const APP_SHELL = [
  '/',
  '/index.html',
  '/manifest.webmanifest',
  '/config.js',
  '/src/styles.css',
  '/public/assets/mascot-light.webp',
  '/public/assets/mascot-dark.webp',
  '/public/assets/hero-documents-light.webp',
  '/public/assets/hero-documents-dark.webp',
  '/public/assets/icon-192.png',
  '/public/assets/icon-512.png',
  '/public/assets/icon-maskable-512.png',
  '/src/app.js',
  '/src/core/api.js',
  '/src/core/db.js',
  '/src/core/i18n.js',
  '/src/core/repository.js',
  '/src/core/router.js',
  '/src/core/settings.js',
  '/src/core/utils.js',
  '/src/domain/analyzer.js',
  '/src/domain/document-reader.js',
  '/src/domain/exporters.js',
  '/src/domain/validators.js',
  '/src/pages/analyze.js',
  '/src/pages/history.js',
  '/src/pages/home.js',
  '/src/pages/misc.js',
  '/src/pages/process.js',
  '/src/pages/result.js',
  '/src/pages/settings.js',
  '/src/theme-init.js',
  '/src/ui/dialogs.js',
  '/src/ui/icons.js',
  '/src/ui/shell.js',
  '/src/ui/toast.js',
];

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(CACHE_VERSION).then((cache) => cache.addAll(APP_SHELL)));
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((key) => key !== CACHE_VERSION).map((key) => caches.delete(key))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('message', (event) => {
  if (event.data?.type === 'SKIP_WAITING') self.skipWaiting();
});

self.addEventListener('fetch', (event) => {
  const request = event.request;
  if (request.method !== 'GET') return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  const cacheResponse = (requestToCache, response) => {
    const clone = response.clone();
    return caches.open(CACHE_VERSION).then((cache) => cache.put(requestToCache, clone));
  };

  // API responses can contain private document data and must never be stored in Cache Storage.
  if (url.pathname.startsWith('/v1/') || url.pathname.startsWith('/api/')) {
    event.respondWith(fetch(request));
    return;
  }

  if (request.mode === 'navigate') {
    event.respondWith(
      fetch(request)
        .then((response) => {
          if (response.ok) {
            event.waitUntil(cacheResponse('/index.html', response));
          }
          return response;
        })
        .catch(async () => (await caches.match('/index.html')) ?? Response.error())
    );
    return;
  }

  event.respondWith(
    caches.match(request).then((cached) => {
      const network = fetch(request)
        .then((response) => {
          if (response.ok && response.type === 'basic') {
            event.waitUntil(cacheResponse(request, response));
          }
          return response;
        })
        .catch(() => cached ?? Response.error());
      return cached ?? network;
    })
  );
});
