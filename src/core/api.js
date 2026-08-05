import { uid, wait } from './utils.js';

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

function normalizeBaseUrl(baseUrl) {
  return String(baseUrl ?? '').trim().replace(/\/+$/, '');
}

export async function apiRequest(path, options = {}) {
  const baseUrl = normalizeBaseUrl(options.baseUrl);
  if (!baseUrl) throw new ApiError('Backend API is not configured', { code: 'NOT_CONFIGURED' });
  const method = (options.method ?? 'GET').toUpperCase();
  const requestId = options.requestId ?? uid('req');
  const idempotencyKey = options.idempotencyKey;
  const headers = new Headers(options.headers ?? {});
  headers.set('Accept', 'application/json');
  headers.set('X-Request-ID', requestId);
  if (idempotencyKey) headers.set('Idempotency-Key', idempotencyKey);
  if (options.body && !(options.body instanceof FormData) && !headers.has('Content-Type')) headers.set('Content-Type', 'application/json');
  const body = options.body && !(options.body instanceof FormData) && typeof options.body !== 'string'
    ? JSON.stringify(options.body)
    : options.body;
  const canRetry = ['GET', 'HEAD'].includes(method) || Boolean(idempotencyKey);
  const attempts = canRetry ? Math.min(options.retries ?? 2, 3) + 1 : 1;
  let lastError;

  for (let attempt = 0; attempt < attempts; attempt += 1) {
    try {
      const response = await fetch(`${baseUrl}${path}`, {
        method,
        headers,
        body,
        credentials: 'include',
        signal: options.signal
      });
      const contentType = response.headers.get('content-type') ?? '';
      const payload = contentType.includes('application/json') ? await response.json().catch(() => null) : await response.text().catch(() => '');
      if (!response.ok) {
        const error = new ApiError(payload?.message ?? `Request failed with status ${response.status}`, {
          status: response.status,
          code: payload?.code ?? 'HTTP_ERROR',
          requestId: response.headers.get('x-request-id') ?? requestId,
          retryable: [408, 425, 429, 500, 502, 503, 504].includes(response.status),
          details: payload?.details ?? null
        });
        if (!error.retryable || attempt === attempts - 1) throw error;
        lastError = error;
      } else {
        return payload;
      }
    } catch (error) {
      if (error?.name === 'AbortError') throw error;
      const normalized = error instanceof ApiError ? error : new ApiError(error?.message ?? 'Network error', { code: 'NETWORK_ERROR', retryable: true, requestId });
      if (!normalized.retryable || attempt === attempts - 1) throw normalized;
      lastError = normalized;
    }
    await wait(350 * 2 ** attempt + Math.round(Math.random() * 150), options.signal);
  }
  throw lastError ?? new ApiError('Request failed', { requestId });
}

export async function createRemoteAnalysis({ baseUrl, analysis, signal }) {
  const form = new FormData();
  form.set('clientAnalysisId', analysis.id);
  form.set('settings', JSON.stringify(analysis.settings));
  form.set('pages', JSON.stringify(analysis.pages.map(({ id, order, rotation, kind, sourcePage }) => ({ id, order, rotation, kind, sourcePage }))));
  for (const source of analysis.sources ?? []) {
    if (source.blob) form.append('files', source.blob, source.name);
    else if (source.text) form.append('texts', new Blob([source.text], { type: 'text/plain' }), source.name || 'document.txt');
  }
  return apiRequest('/v1/analyses', {
    baseUrl,
    method: 'POST',
    body: form,
    idempotencyKey: analysis.idempotencyKey,
    signal
  });
}

export function getRemoteAnalysis(baseUrl, remoteId, signal) {
  return apiRequest(`/v1/analyses/${encodeURIComponent(remoteId)}`, { baseUrl, signal, retries: 2 });
}

export function cancelRemoteAnalysis(baseUrl, remoteId, idempotencyKey, signal) {
  return apiRequest(`/v1/analyses/${encodeURIComponent(remoteId)}/cancel`, {
    baseUrl,
    method: 'POST',
    idempotencyKey,
    signal
  });
}

export function createRemoteShare(baseUrl, analysisId, signal) {
  return apiRequest(`/v1/analyses/${encodeURIComponent(analysisId)}/shares`, {
    baseUrl,
    method: 'POST',
    body: {},
    idempotencyKey: uid('share'),
    signal
  });
}

export function revokeRemoteShare(baseUrl, analysisId, shareId, signal) {
  return apiRequest(`/v1/analyses/${encodeURIComponent(analysisId)}/shares/${encodeURIComponent(shareId)}`, {
    baseUrl,
    method: 'DELETE',
    idempotencyKey: uid('share-revoke'),
    signal
  });
}
