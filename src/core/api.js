import { wait } from './utils.js';

const runtimeConfig = globalThis.__FAHMO_CONFIG__ ?? {};
const DEFAULT_PREFIX = normalizeApiPrefix(runtimeConfig.apiPrefix ?? '/api/v1');
const SESSION_TOKEN_KEY = 'fahmo:api-session';

export class ApiError extends Error {
  constructor(message, options = {}) {
    super(message);
    this.name = 'ApiError';
    this.status = options.status ?? 0;
    this.code = options.code ?? 'UNKNOWN';
    this.requestId = options.requestId ?? null;
    this.retryable = options.retryable ?? false;
    this.details = options.details ?? null;
  }
}

export function normalizeApiBaseUrl(baseUrl) {
  const raw = typeof baseUrl === 'string' ? baseUrl.trim() : '';
  if (!raw || !/^https?:\/\//i.test(raw)) return '';
  try {
    const parsed = new URL(raw);
    if (!['http:', 'https:'].includes(parsed.protocol) || parsed.username || parsed.password) return '';
    const pathname = parsed.pathname.replace(/\/+$/u, '');
    return `${parsed.origin}${pathname === '/' ? '' : pathname}`;
  } catch {
    return '';
  }
}

export function normalizeApiPrefix(prefix) {
  const value = typeof prefix === 'string' ? prefix.trim() : '';
  if (!value || !/^\/[A-Za-z0-9/_-]*$/u.test(value)) return '/api/v1';
  return `/${value.replace(/^\/+|\/+$/gu, '')}`;
}

export class HttpFahmoApiClient {
  constructor({ baseUrl, prefix = DEFAULT_PREFIX } = {}) {
    this.baseUrl = normalizeApiBaseUrl(baseUrl);
    this.prefix = normalizeApiPrefix(prefix);
  }

  async request(path, options = {}) {
    if (!this.baseUrl) {
      throw new ApiError('Backend API is not configured', { code: 'NOT_CONFIGURED' });
    }
    const method = (options.method ?? 'GET').toUpperCase();
    const requestId = options.requestId ?? crypto.randomUUID();
    const headers = new Headers(options.headers ?? {});
    headers.set('Accept', options.accept ?? 'application/json');
    headers.set('X-Request-ID', requestId);
    const sessionToken = sessionStorage.getItem(SESSION_TOKEN_KEY);
    if (sessionToken) headers.set('X-Session-Token', sessionToken);
    if (options.idempotencyKey) headers.set('Idempotency-Key', options.idempotencyKey);
    if (options.body && !(options.body instanceof FormData) && !headers.has('Content-Type')) {
      headers.set('Content-Type', 'application/json');
    }
    const body = options.body && !(options.body instanceof FormData) && typeof options.body !== 'string'
      ? JSON.stringify(options.body)
      : options.body;
    const canRetry = ['GET', 'HEAD'].includes(method) || Boolean(options.idempotencyKey);
    const attempts = canRetry ? Math.min(options.retries ?? 2, 3) + 1 : 1;
    let lastError;

    for (let attempt = 0; attempt < attempts; attempt += 1) {
      const timeout = createTimeoutSignal(options.signal, options.timeoutMs ?? 30_000);
      try {
        const response = await fetch(this.url(path), {
          method,
          headers,
          body,
          credentials: 'include',
          signal: timeout.signal,
          cache: 'no-store',
        });
        const receivedSessionToken = response.headers.get('x-session-token');
        if (receivedSessionToken) sessionStorage.setItem(SESSION_TOKEN_KEY, receivedSessionToken);
        if (options.responseType === 'blob' && response.ok) return await response.blob();
        const contentType = response.headers.get('content-type') ?? '';
        const payload = contentType.includes('application/json')
          ? await response.json().catch(() => null)
          : await response.text().catch(() => '');
        if (!response.ok) {
          const bodyError = payload?.error ?? payload;
          const error = new ApiError(bodyError?.message ?? `Request failed with status ${response.status}`, {
            status: response.status,
            code: bodyError?.code ?? 'HTTP_ERROR',
            requestId: response.headers.get('x-request-id') ?? bodyError?.requestId ?? requestId,
            retryable: Boolean(bodyError?.retryable) || [408, 425, 429, 500, 502, 503, 504].includes(response.status),
            details: bodyError?.details ?? null,
          });
          if (!error.retryable || attempt === attempts - 1) throw error;
          lastError = error;
        } else {
          return validateResponse(path, payload);
        }
      } catch (error) {
        if (options.signal?.aborted) throw new DOMException('Aborted', 'AbortError');
        const timedOut = timeout.signal.aborted && timeout.signal.reason?.name === 'TimeoutError';
        const normalized = error instanceof ApiError
          ? error
          : new ApiError(timedOut ? 'Request timed out' : 'Network request failed', {
            code: timedOut ? 'TIMEOUT' : 'NETWORK_ERROR',
            retryable: true,
            requestId,
          });
        if (!normalized.retryable || attempt === attempts - 1) throw normalized;
        lastError = normalized;
      } finally {
        timeout.cleanup();
      }
      await wait(350 * 2 ** attempt + Math.round(Math.random() * 150), options.signal);
    }
    throw lastError ?? new ApiError('Request failed', { requestId });
  }

  url(path) {
    const suffix = path.startsWith('/') ? path : `/${path}`;
    return `${this.baseUrl}${this.prefix}${suffix}`;
  }
}

export function fahmoApiClient(baseUrl) {
  return new HttpFahmoApiClient({ baseUrl, prefix: runtimeConfig.apiPrefix ?? DEFAULT_PREFIX });
}

export function ensureRemoteSession(baseUrl, signal) {
  return fahmoApiClient(baseUrl).request('/session', { signal, retries: 1 });
}

export function textUploadFilename(name) {
  const normalized = typeof name === 'string' ? name.trim() : '';
  if (!normalized) return 'document.txt';
  return /\.txt$/iu.test(normalized) ? normalized : `${normalized}.txt`;
}

export async function createRemoteAnalysis({ baseUrl, analysis, signal }) {
  const form = new FormData();
  form.set('clientAnalysisId', analysis.id);
  form.set('settings', JSON.stringify(analysis.settings));
  form.set('pages', JSON.stringify(analysis.pages.map(({ id, order, rotation, kind, sourcePage }) => ({ id, order, rotation, kind, sourcePage }))));
  for (const source of analysis.sources ?? []) {
    if (source.blob) form.append('files', source.blob, source.name);
    else if (source.text) form.append('texts', new Blob([source.text], { type: 'text/plain' }), textUploadFilename(source.name));
  }
  return fahmoApiClient(baseUrl).request('/analyses', {
    method: 'POST', body: form, idempotencyKey: analysis.idempotencyKey, signal, timeoutMs: 120_000,
  });
}

export function getRemoteAnalysis(baseUrl, remoteId, signal) {
  return fahmoApiClient(baseUrl).request(`/analyses/${encodeURIComponent(remoteId)}`, { signal, retries: 2 });
}

export function getRemoteSourcePreview(baseUrl, analysisId, sourceAssetId, signal) {
  return fahmoApiClient(baseUrl).request(`/analyses/${encodeURIComponent(analysisId)}/sources/${encodeURIComponent(sourceAssetId)}`, {
    signal,
    retries: 1,
    responseType: 'blob',
    timeoutMs: 30_000,
  });
}

export function listRemoteAnalyses(baseUrl, signal, limit = 50) {
  return fahmoApiClient(baseUrl).request(`/analyses?limit=${Math.min(Math.max(limit, 1), 50)}`, { signal, retries: 1 });
}

export function deleteRemoteAnalysis(baseUrl, remoteId, signal) {
  return fahmoApiClient(baseUrl).request(`/analyses/${encodeURIComponent(remoteId)}`, { method: 'DELETE', signal });
}

export function cancelRemoteAnalysis(baseUrl, remoteId, idempotencyKey, signal) {
  return fahmoApiClient(baseUrl).request(`/analyses/${encodeURIComponent(remoteId)}/cancel`, {
    method: 'POST', idempotencyKey, signal,
  });
}

export function patchRemoteTask(baseUrl, taskId, revision, patch, signal) {
  return fahmoApiClient(baseUrl).request(`/tasks/${encodeURIComponent(taskId)}`, {
    method: 'PATCH', headers: { 'If-Match': `revision-${revision}` }, body: { ...patch, expectedRevision: revision }, signal,
  });
}

export function completeRemoteTask(baseUrl, taskId, revision, signal) {
  return fahmoApiClient(baseUrl).request(`/tasks/${encodeURIComponent(taskId)}/complete`, {
    method: 'POST', headers: { 'If-Match': `revision-${revision}` }, body: { expectedRevision: revision }, signal,
  });
}

export function createRemoteReminder(baseUrl, taskId, input, signal) {
  return fahmoApiClient(baseUrl).request(`/tasks/${encodeURIComponent(taskId)}/reminders`, {
    method: 'POST', body: input, idempotencyKey: input.idempotencyKey, signal,
  });
}

export function answerRemoteClarification(baseUrl, analysisId, questionId, answer, signal) {
  return fahmoApiClient(baseUrl).request(`/analyses/${encodeURIComponent(analysisId)}/clarifications/${encodeURIComponent(questionId)}/answer`, {
    method: 'POST', body: { answer }, signal, timeoutMs: 120_000,
  });
}

export function createRemoteShare(baseUrl, analysisId, signal) {
  return fahmoApiClient(baseUrl).request(`/analyses/${encodeURIComponent(analysisId)}/shares`, {
    method: 'POST', body: {}, idempotencyKey: `share.${crypto.randomUUID()}`, signal,
  });
}

export function revokeRemoteShare(baseUrl, analysisId, shareId, signal) {
  return fahmoApiClient(baseUrl).request(`/analyses/${encodeURIComponent(analysisId)}/shares/${encodeURIComponent(shareId)}`, {
    method: 'DELETE', body: {}, idempotencyKey: `share-revoke.${crypto.randomUUID()}`, signal,
  });
}

export function getRemotePublicShare(baseUrl, token, signal) {
  return fahmoApiClient(baseUrl).request(`/public/shares/${encodeURIComponent(token)}`, { signal, retries: 1 });
}

export function createRemoteExport(baseUrl, input, signal) {
  return fahmoApiClient(baseUrl).request('/exports', { method: 'POST', body: input, signal });
}

export function getRemoteExport(baseUrl, exportId, signal) {
  return fahmoApiClient(baseUrl).request(`/exports/${encodeURIComponent(exportId)}`, { signal, retries: 2 });
}

export function downloadRemoteExport(baseUrl, exportId, signal) {
  return fahmoApiClient(baseUrl).request(`/exports/${encodeURIComponent(exportId)}/download`, { signal, responseType: 'blob', timeoutMs: 60_000 });
}

function validateResponse(path, payload) {
  if (payload === '' || payload === null) return payload;
  if (typeof payload !== 'object' || Array.isArray(payload)) {
    throw new ApiError('Backend returned an invalid response', { code: 'INVALID_RESPONSE' });
  }
  if (/\/analyses\/[^/]+$/u.test(path) && (typeof payload.status !== 'string' || typeof payload.analysisId !== 'string')) {
    throw new ApiError('Backend returned an invalid analysis response', { code: 'INVALID_RESPONSE' });
  }
  return payload;
}

function createTimeoutSignal(parentSignal, timeoutMs) {
  const controller = new AbortController();
  const onAbort = () => controller.abort(parentSignal?.reason);
  parentSignal?.addEventListener('abort', onAbort, { once: true });
  const timer = setTimeout(() => controller.abort(new DOMException('Timed out', 'TimeoutError')), timeoutMs);
  return {
    signal: controller.signal,
    cleanup() {
      clearTimeout(timer);
      parentSignal?.removeEventListener('abort', onAbort);
    },
  };
}
