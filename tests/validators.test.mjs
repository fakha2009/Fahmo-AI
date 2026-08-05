import test from 'node:test';
import assert from 'node:assert/strict';
import { MAX_FILE_SIZE, validateFile, validatePageLimit, validateText } from '../src/domain/validators.js';

test('accepts supported image file', () => {
  const file = { name: 'page.png', type: 'image/png', size: 1024 };
  assert.deepEqual(validateFile(file), { ok: true, mime: 'image/png' });
});

test('rejects unsupported and oversized files', () => {
  assert.equal(validateFile({ name: 'archive.exe', type: 'application/octet-stream', size: 10 }).code, 'INVALID_FORMAT');
  assert.equal(validateFile({ name: 'big.pdf', type: 'application/pdf', size: MAX_FILE_SIZE + 1 }).code, 'FILE_TOO_LARGE');
});

test('validates page and text limits', () => {
  assert.equal(validatePageLimit(9, 1).ok, true);
  assert.equal(validatePageLimit(9, 2).ok, false);
  assert.equal(validateText('  ').ok, false);
  assert.equal(validateText('Нужно оплатить счёт.').ok, true);
});
