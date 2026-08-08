import assert from 'node:assert/strict';
import test from 'node:test';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { applyCors, isTrustedRequestOrigin } from '../../src/http/cors';

const allowedOrigins = ['https://fahmo-ai.vercel.app'];

test('trusted CORS origin receives credentialed PATCH support', () => {
  const headers = new Map<string, string>();
  const req = { headers: { origin: allowedOrigins[0] } } as IncomingMessage;
  const res = { setHeader: (name: string, value: string) => headers.set(name, value) } as unknown as ServerResponse;

  applyCors(req, res, { allowedOrigins });

  assert.equal(headers.get('Access-Control-Allow-Origin'), allowedOrigins[0]);
  assert.match(headers.get('Access-Control-Allow-Methods') ?? '', /PATCH/u);
  assert.match(headers.get('Access-Control-Allow-Headers') ?? '', /If-Match/u);
  assert.equal(headers.get('Access-Control-Allow-Credentials'), 'true');
});

test('cross-site mutation without an Origin is rejected', () => {
  const req = { headers: { 'sec-fetch-site': 'cross-site' } } as IncomingMessage;
  assert.equal(isTrustedRequestOrigin(req, { allowedOrigins }), false);
});

test('same-site request without an Origin remains available to CLI and health checks', () => {
  const req = { headers: { 'sec-fetch-site': 'same-site' } } as IncomingMessage;
  assert.equal(isTrustedRequestOrigin(req, { allowedOrigins }), true);
});
