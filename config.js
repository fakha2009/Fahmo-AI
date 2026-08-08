/**
 * Public runtime configuration for Fahmo AI.
 *
 * This file is safe to expose to the browser. Never place API keys, service
 * account credentials, access tokens, or any other secret in this object.
 */
window.__FAHMO_CONFIG__ = Object.freeze({
  apiBaseUrl: 'http://localhost:8787',
  apiPrefix: '/api/v1',
  apiMode: 'http',
  appUrl: 'http://127.0.0.1:4173',
  environment: 'development',
  allowApiSettings: true,
  appVersion: '1.1.2'
});
