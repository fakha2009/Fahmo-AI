import test from 'node:test';
import assert from 'node:assert/strict';
import { MAX_FILE_SIZE, MAX_PAGES, validateFile, validatePageLimit, validateText } from '../src/domain/validators.js';
import { buildRemoteAnalysisForm, textUploadFilename } from '../src/core/api.js';

test('accepts supported image file', () => {
  const file = { name: 'page.png', type: 'image/png', size: 1024 };
  assert.deepEqual(validateFile(file), { ok: true, mime: 'image/png' });
});

test('rejects unsupported and oversized files', () => {
  assert.equal(validateFile({ name: 'archive.exe', type: 'application/octet-stream', size: 10 }).code, 'INVALID_FORMAT');
  assert.equal(validateFile({ name: 'big.pdf', type: 'application/pdf', size: MAX_FILE_SIZE + 1 }).code, 'FILE_TOO_LARGE');
});

test('validates page and text limits', () => {
  assert.equal(validatePageLimit(MAX_PAGES - 1, 1).ok, true);
  assert.equal(validatePageLimit(MAX_PAGES - 1, 2).ok, false);
  assert.equal(validateText('  ').ok, false);
  assert.equal(validateText('Нужно оплатить счёт.').ok, true);
});

test('normalizes generic browser MIME types from a supported extension', () => {
  const file = { name: 'mobile-photo.jpg', type: 'application/octet-stream', size: 1024 };
  assert.deepEqual(validateFile(file), { ok: true, mime: 'image/jpeg' });
});

test('text uploads always use an extension accepted by the backend', () => {
  assert.equal(textUploadFilename('Текст'), 'Текст.txt');
  assert.equal(textUploadFilename('notes.txt'), 'notes.txt');
  assert.equal(textUploadFilename(''), 'document.txt');
});

test('remote form keeps text files and explicit source mappings', () => {
  const form = buildRemoteAnalysisForm({
    id: 'analysis-1',
    settings: { resultLanguage: 'ru' },
    pages: [{ id: 'page-1', sourceId: 'source-1', order: 0, rotation: 0, kind: 'text', sourcePage: 1 }],
    sources: [{ id: 'source-1', kind: 'text', mimeType: 'text/plain', name: 'notes.txt', blob: new Blob(['hello'], { type: 'text/plain' }) }],
  });
  assert.equal(form.getAll('files').length, 0);
  assert.equal(form.getAll('texts').length, 1);
  assert.deepEqual(JSON.parse(form.get('sources')), [{ id: 'source-1', kind: 'text' }]);
  assert.equal(JSON.parse(form.get('pages'))[0].sourceId, 'source-1');
});
