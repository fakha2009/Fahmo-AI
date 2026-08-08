import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import vm from 'node:vm';

async function loadFetchHandler({ cachedIndex = null } = {}) {
  const listeners = new Map();
  const source = await readFile(new URL('../sw.js', import.meta.url), 'utf8');
  const self = {
    location: { origin: 'https://fahmo-ai.test' },
    clients: { claim: async () => undefined },
    addEventListener(type, listener) { listeners.set(type, listener); },
    skipWaiting() {},
  };
  const caches = {
    async keys() { return []; },
    async open() { return { addAll: async () => undefined, put: async () => undefined }; },
    async match(key) { return key === '/index.html' ? cachedIndex : null; },
  };
  const context = vm.createContext({
    URL,
    Response,
    caches,
    fetch: async () => { throw new TypeError('offline'); },
    self,
  });
  new vm.Script(source, { filename: 'sw.js' }).runInContext(context);
  return listeners.get('fetch');
}

async function dispatchNavigation(handler) {
  let responsePromise;
  handler({
    request: { method: 'GET', mode: 'navigate', url: 'https://fahmo-ai.test/result/analysis-1' },
    respondWith(value) { responsePromise = Promise.resolve(value); },
    waitUntil() {},
  });
  return responsePromise;
}

test('service worker returns a valid offline navigation response', async () => {
  const response = await dispatchNavigation(await loadFetchHandler());
  assert.equal(response.status, 503);
  assert.notEqual(response.type, 'error');
  assert.match(response.headers.get('content-type') ?? '', /text\/html/u);
  assert.match(await response.text(), /Нет подключения/u);
});

test('service worker uses the cached app shell for offline deep links', async () => {
  const cached = new Response('<!doctype html><title>Fahmo AI</title>', { headers: { 'Content-Type': 'text/html' } });
  const response = await dispatchNavigation(await loadFetchHandler({ cachedIndex: cached }));
  assert.equal(response.status, 200);
  assert.match(await response.text(), /Fahmo AI/u);
});
