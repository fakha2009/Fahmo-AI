import { cp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..');
const output = resolve(root, 'dist');
const isProduction = process.env.NODE_ENV === 'production' || Boolean(process.env.VERCEL);
const apiMode = process.env.NEXT_PUBLIC_API_MODE ?? (isProduction ? 'http' : 'mock');
const apiBaseUrl = normalizePublicUrl(process.env.NEXT_PUBLIC_API_BASE_URL ?? '');
const apiPrefix = normalizePrefix(process.env.NEXT_PUBLIC_API_PREFIX ?? '/api/v1');
const deploymentHost = process.env.VERCEL_PROJECT_PRODUCTION_URL ?? process.env.VERCEL_URL ?? '';
const appUrl = normalizePublicUrl(process.env.NEXT_PUBLIC_APP_URL ?? (deploymentHost ? `https://${deploymentHost}` : ''));

if (isProduction && apiMode !== 'http') {
  throw new Error('Production build requires NEXT_PUBLIC_API_MODE=http');
}
if (isProduction && (!apiBaseUrl || !apiBaseUrl.startsWith('https://') || isLocalUrl(apiBaseUrl))) {
  throw new Error('Production build requires a non-local HTTPS NEXT_PUBLIC_API_BASE_URL');
}

await rm(output, { recursive: true, force: true });
await mkdir(output, { recursive: true });
for (const path of ['index.html', 'manifest.webmanifest', 'sw.js']) {
  await cp(resolve(root, path), resolve(output, path));
}
for (const path of ['src', 'public']) {
  await cp(resolve(root, path), resolve(output, path), { recursive: true });
}

const packageJson = JSON.parse(await readFile(resolve(root, 'package.json'), 'utf8'));
const runtimeConfig = {
  apiBaseUrl,
  apiPrefix,
  apiMode,
  appUrl,
  environment: isProduction ? 'production' : 'development',
  allowApiSettings: !isProduction,
  appVersion: packageJson.version,
};
await writeFile(
  resolve(output, 'config.js'),
  `window.__FAHMO_CONFIG__ = Object.freeze(${JSON.stringify(runtimeConfig, null, 2)});\n`,
  'utf8',
);

console.log(`Built Fahmo AI ${packageJson.version} (${runtimeConfig.environment}) into dist/`);

function normalizePublicUrl(value) {
  const raw = String(value).trim().replace(/\/+$/u, '');
  if (!raw) return '';
  const parsed = new URL(raw);
  if (!['http:', 'https:'].includes(parsed.protocol) || parsed.username || parsed.password) {
    throw new Error(`Invalid public URL: ${raw}`);
  }
  return parsed.toString().replace(/\/+$/u, '');
}

function normalizePrefix(value) {
  const normalized = `/${String(value).trim().replace(/^\/+|\/+$/gu, '')}`;
  if (!/^\/[A-Za-z0-9/_-]+$/u.test(normalized)) throw new Error('Invalid NEXT_PUBLIC_API_PREFIX');
  return normalized;
}

function isLocalUrl(value) {
  const hostname = new URL(value).hostname;
  return hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '::1';
}
