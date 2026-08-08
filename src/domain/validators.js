export const MAX_FILE_SIZE = 10 * 1024 * 1024;
export const MAX_PAGES = 10;
export const MAX_TEXT_LENGTH = 50_000;
export const ACCEPTED_TYPES = new Set([
  'application/pdf',
  'image/jpeg',
  'image/png',
  'image/webp',
  'text/plain'
]);

const acceptedExtensions = new Set(['pdf', 'jpg', 'jpeg', 'png', 'webp', 'txt']);

export function getExtension(filename = '') {
  const index = filename.lastIndexOf('.');
  return index === -1 ? '' : filename.slice(index + 1).toLowerCase();
}

export function inferMimeType(file) {
  if (file.type) return file.type.toLowerCase();
  const extension = getExtension(file.name);
  return ({ pdf: 'application/pdf', jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', webp: 'image/webp', txt: 'text/plain' })[extension] ?? '';
}

export function validateFile(file) {
  const mime = inferMimeType(file);
  const extension = getExtension(file.name);
  if (!ACCEPTED_TYPES.has(mime) && !acceptedExtensions.has(extension)) {
    return { ok: false, code: 'INVALID_FORMAT', messageKey: 'invalidFormat' };
  }
  if (file.size > MAX_FILE_SIZE) {
    return { ok: false, code: 'FILE_TOO_LARGE', messageKey: 'fileTooLarge' };
  }
  return { ok: true, mime };
}

export function validateText(text) {
  const normalized = String(text ?? '').trim();
  if (!normalized) return { ok: false, code: 'EMPTY_TEXT', messageKey: 'emptyText' };
  if (normalized.length > MAX_TEXT_LENGTH) {
    return { ok: false, code: 'TEXT_TOO_LONG', message: `Текст содержит ${normalized.length} символов. Максимум — ${MAX_TEXT_LENGTH}.` };
  }
  return { ok: true };
}

export function validatePageLimit(currentCount, incomingCount) {
  if (currentCount + incomingCount > MAX_PAGES) {
    return { ok: false, code: 'TOO_MANY_PAGES', messageKey: 'tooManyPages' };
  }
  return { ok: true };
}
