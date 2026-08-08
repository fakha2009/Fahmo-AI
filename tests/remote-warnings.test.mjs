import assert from 'node:assert/strict';
import test from 'node:test';

globalThis.localStorage = {
  getItem() { return null; },
  setItem() {},
  removeItem() {},
};
globalThis.matchMedia = () => ({
  matches: false,
  addEventListener() {},
  removeEventListener() {},
});

const { normalizeRemoteResult, normalizeRemoteWarning, normalizeSourceReference } = await import('../src/pages/process.js');

test('backend warning message keys are replaced with readable localized text', () => {
  const warning = normalizeRemoteWarning({
    code: 'LOW_CONFIDENCE',
    title: 'errors.low_confidence_handwriting',
    message: 'errors.low_confidence_handwriting',
    severity: 'warning',
  }, 0);

  assert.equal(warning.title, 'Проверьте распознанный текст');
  assert.match(warning.message, /низкой уверенностью/u);
  assert.doesNotMatch(`${warning.title} ${warning.message}`, /errors\./u);
});

test('human-readable backend warning copy is preserved', () => {
  const warning = normalizeRemoteWarning({
    code: 'LOW_CONFIDENCE',
    title: 'Проверьте подпись',
    message: 'Подпись внизу страницы читается не полностью.',
  }, 2);

  assert.equal(warning.id, 'remote_warning_2');
  assert.equal(warning.title, 'Проверьте подпись');
  assert.equal(warning.message, 'Подпись внизу страницы читается не полностью.');
});

test('remote source references preserve page, preview asset, excerpt, and highlight box', () => {
  const source = normalizeSourceReference({
    clientPageId: 'client-page-1',
    sourceAssetId: 'asset-1',
    pageNumber: 2,
    excerpt: 'Важный фрагмент',
    boundingBox: { x: 0.1, y: 0.2, width: 0.3, height: 0.1 },
  });
  assert.deepEqual(source, {
    sourceId: 'client-page-1',
    clientPageId: 'client-page-1',
    sourceAssetId: 'asset-1',
    inputIndex: 1,
    page: 2,
    excerpt: 'Важный фрагмент',
    boundingBox: { x: 0.1, y: 0.2, width: 0.3, height: 0.1 },
  });
});

test('remote result keeps normalized sources for tasks, important data, and warnings', () => {
  const source = { clientPageId: 'page-1', sourceAssetId: 'asset-1', pageNumber: 1, excerpt: 'до 20 августа', boundingBox: null };
  const result = normalizeRemoteResult({
    title: 'Поручение',
    tasks: [{ id: 'task-1', title: 'Подготовить отчёт', source }],
    importantData: [{ id: 'date-1', type: 'deadline', value: '20 августа', source }],
    warnings: [{ id: 'warning-1', code: 'LOW_CONFIDENCE', title: 'errors.low', message: 'errors.low', source }],
  }, { id: 'analysis-1', title: 'Документ', settings: { documentType: 'other', resultLanguage: 'ru' } });
  assert.equal(result.tasks[0].source.sourceAssetId, 'asset-1');
  assert.equal(result.importantData[0].source.excerpt, 'до 20 августа');
  assert.equal(result.warnings[0].source.page, 1);
});
