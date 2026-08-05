import { createServer } from 'node:http';
import { createReadStream, existsSync, statSync } from 'node:fs';
import { extname, join, normalize, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(fileURLToPath(new URL('.', import.meta.url)));
const portArg = process.argv.find((value) => /^--port=\d+$/.test(value));
const port = Number(portArg?.split('=')[1] ?? process.env.PORT ?? 4173);
const host = process.env.HOST ?? '127.0.0.1';
const dev = process.argv.includes('--dev');

const mimeTypes = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.webmanifest': 'application/manifest+json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.txt': 'text/plain; charset=utf-8',
  '.md': 'text/markdown; charset=utf-8'
};

function safePath(urlPath) {
  try {
    const decoded = decodeURIComponent(urlPath.split('?')[0]);
    const normalized = normalize(decoded).replace(/^([/\\])+/, '');
    const absolute = resolve(root, normalized);
    return absolute === root || absolute.startsWith(`${root}${sep}`) ? absolute : null;
  } catch {
    return null;
  }
}

function isSpaNavigation(request, requestedPath) {
  const acceptsHtml = (request.headers.accept ?? '').includes('text/html');
  return acceptsHtml && !extname(requestedPath);
}

function cacheControlFor(filePath) {
  const extension = extname(filePath).toLowerCase();
  const basename = filePath.slice(filePath.lastIndexOf(sep) + 1);
  if (dev) return 'no-store';
  if (extension === '.html' || basename === 'sw.js' || basename === 'config.js' || extension === '.webmanifest') {
    return 'public, max-age=0, must-revalidate';
  }
  return 'public, max-age=3600, stale-while-revalidate=86400';
}

const server = createServer((request, response) => {
  if (!request.url || !['GET', 'HEAD'].includes(request.method ?? 'GET')) {
    response.writeHead(405, { Allow: 'GET, HEAD' });
    response.end('Method Not Allowed');
    return;
  }

  const requested = safePath(request.url);
  if (!requested) {
    response.writeHead(400, { 'Content-Type': 'text/plain; charset=utf-8' });
    response.end('Bad Request');
    return;
  }

  let filePath = requested;
  if (existsSync(filePath) && statSync(filePath).isDirectory()) {
    filePath = join(filePath, 'index.html');
  }

  if (!existsSync(filePath) || !statSync(filePath).isFile()) {
    if (isSpaNavigation(request, requested)) {
      filePath = join(root, 'index.html');
    } else {
      response.writeHead(404, {
        'Content-Type': 'text/plain; charset=utf-8',
        'X-Content-Type-Options': 'nosniff',
        'Cache-Control': 'no-store'
      });
      response.end('Not Found');
      return;
    }
  }

  const extension = extname(filePath).toLowerCase();
  const headers = {
    'Content-Type': mimeTypes[extension] ?? 'application/octet-stream',
    'X-Content-Type-Options': 'nosniff',
    'Referrer-Policy': 'strict-origin-when-cross-origin',
    'X-Frame-Options': 'SAMEORIGIN',
    'Permissions-Policy': 'camera=(self), microphone=(), geolocation=(), payment=()',
    'Cross-Origin-Opener-Policy': 'same-origin',
    'Cross-Origin-Resource-Policy': 'same-origin',
    'Content-Security-Policy': "default-src 'self'; img-src 'self' blob: data:; media-src 'self' blob:; connect-src 'self' https:; script-src 'self'; style-src 'self' 'unsafe-inline'; object-src 'none'; base-uri 'self'; form-action 'self'; frame-src 'self' blob:; worker-src 'self' blob:; manifest-src 'self'",
    'Cache-Control': cacheControlFor(filePath)
  };

  response.writeHead(200, headers);
  if (request.method === 'HEAD') {
    response.end();
    return;
  }
  const stream = createReadStream(filePath);
  stream.on('error', () => {
    if (!response.headersSent) response.writeHead(500, { 'Content-Type': 'text/plain; charset=utf-8' });
    response.end('Internal Server Error');
  });
  stream.pipe(response);
});

server.on('clientError', (_error, socket) => {
  socket.end('HTTP/1.1 400 Bad Request\r\n\r\n');
});

server.listen(port, host, () => {
  const displayHost = host === '0.0.0.0' ? 'localhost' : host;
  console.log(`Fahmo AI is running at http://${displayHost}:${port}`);
});
