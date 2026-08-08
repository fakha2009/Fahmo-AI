import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

async function pngSize(path) {
  const data = await readFile(new URL(path, import.meta.url));
  assert.equal(data.subarray(1, 4).toString('ascii'), 'PNG');
  return { width: data.readUInt32BE(16), height: data.readUInt32BE(20) };
}

test('versioned PWA and browser icons have their declared sizes', async () => {
  const expected = new Map([
    ['../public/assets/favicon-16-v2.png', 16],
    ['../public/assets/favicon-32-v2.png', 32],
    ['../public/assets/apple-touch-icon-v2.png', 180],
    ['../public/assets/icon-192-v2.png', 192],
    ['../public/assets/icon-512-v2.png', 512],
    ['../public/assets/icon-maskable-512-v2.png', 512],
  ]);
  for (const [path, size] of expected) {
    assert.deepEqual(await pngSize(path), { width: size, height: size });
  }
});

test('manifest references only the refreshed icon set', async () => {
  const manifest = JSON.parse(await readFile(new URL('../manifest.webmanifest', import.meta.url), 'utf8'));
  const sources = manifest.icons.map((icon) => icon.src);
  assert.ok(sources.every((source) => source.includes('-v2.png')));
  assert.ok(manifest.icons.some((icon) => icon.purpose === 'maskable'));
});

test('PWA installation uses the browser prompt without suppressing its banner', async () => {
  const appSource = await readFile(new URL('../src/app.js', import.meta.url), 'utf8');
  assert.doesNotMatch(appSource, /beforeinstallprompt[\s\S]{0,160}preventDefault/u);
});

test('the entry module is release-versioned to bypass an older service-worker cache', async () => {
  const packageJson = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8'));
  const index = await readFile(new URL('../index.html', import.meta.url), 'utf8');
  const serviceWorker = await readFile(new URL('../sw.js', import.meta.url), 'utf8');
  const entry = `/src/app.js?v=${packageJson.version}`;
  assert.ok(index.includes(`src="${entry}"`));
  assert.ok(serviceWorker.includes(`'${entry}'`));
  assert.match(serviceWorker, /url\.pathname\.startsWith\('\/src\/'\)/u);
});

test('retrying a failed remote analysis creates a fresh backend job', async () => {
  const processSource = await readFile(new URL('../src/pages/process.js', import.meta.url), 'utf8');
  assert.match(processSource, /analysis\.remoteId = null/u);
  assert.match(processSource, /analysis\.idempotencyKey = uid\('idem'\)/u);
});
