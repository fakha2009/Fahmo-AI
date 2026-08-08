import { spawn } from 'node:child_process';
import { setTimeout as delay } from 'node:timers/promises';

const port = 43000 + Math.floor(Math.random() * 1000);
const origin = `http://127.0.0.1:${port}`;
const server = spawn(process.execPath, ['server.mjs', '--dev', `--port=${port}`], {
  cwd: new URL('..', import.meta.url),
  env: { ...process.env, HOST: '127.0.0.1' },
  stdio: ['ignore', 'pipe', 'pipe']
});

let output = '';
server.stdout.on('data', (chunk) => { output += chunk; });
server.stderr.on('data', (chunk) => { output += chunk; });

async function waitForServer() {
  for (let attempt = 0; attempt < 40; attempt += 1) {
    try {
      const response = await fetch(origin, { redirect: 'manual' });
      if (response.ok) return;
    } catch { /* server is still starting */ }
    await delay(100);
  }
  throw new Error(`Server did not start.\n${output}`);
}

async function check(path, expectedType, headers = {}) {
  const response = await fetch(`${origin}${path}`, { redirect: 'manual', headers });
  if (!response.ok) throw new Error(`${path}: expected 2xx, received ${response.status}`);
  const contentType = response.headers.get('content-type') ?? '';
  if (expectedType && !contentType.includes(expectedType)) {
    throw new Error(`${path}: expected content-type ${expectedType}, received ${contentType}`);
  }
  return response;
}

try {
  await waitForServer();
  const html = await check('/', 'text/html');
  const csp = html.headers.get('content-security-policy') ?? '';
  for (const required of ["object-src 'none'", "base-uri 'self'", "form-action 'self'"]) {
    if (!csp.includes(required)) throw new Error(`CSP is missing: ${required}`);
  }

  for (const route of ['/analyze', '/tasks', '/history', '/settings', '/offline', '/install', '/shared/not-existing', '/not-found']) {
    await check(route, 'text/html', { Accept: 'text/html' });
  }

  await check('/manifest.webmanifest', 'application/manifest+json');
  await check('/sw.js', 'text/javascript');
  await check('/config.js', 'text/javascript');
  await check('/src/app.js', 'text/javascript');
  await check('/src/styles.css', 'text/css');
  await check('/public/assets/mascot-light.webp', 'image/webp');
  await check('/public/assets/mascot-dark.webp', 'image/webp');
  await check('/public/assets/hero-documents-light.webp', 'image/webp');
  await check('/public/assets/hero-documents-dark.webp', 'image/webp');
  await check('/public/assets/mascot-analyzing.webp', 'image/webp');
  await check('/public/assets/mascot-analyzing.gif', 'image/gif');
  await check('/public/assets/favicon-16-v2.png', 'image/png');
  await check('/public/assets/favicon-32-v2.png', 'image/png');
  await check('/public/assets/apple-touch-icon-v2.png', 'image/png');
  await check('/public/assets/icon-192-v2.png', 'image/png');
  await check('/public/assets/icon-512-v2.png', 'image/png');
  await check('/public/assets/icon-maskable-512-v2.png', 'image/png');

  const missing = await fetch(`${origin}/does-not-exist.js`);
  if (missing.status !== 404) throw new Error(`Unknown static file must return 404, received ${missing.status}`);

  console.log('Smoke check passed.');
} finally {
  server.kill('SIGTERM');
  await Promise.race([
    new Promise((resolve) => server.once('exit', resolve)),
    delay(1_000).then(() => server.kill('SIGKILL'))
  ]);
}
