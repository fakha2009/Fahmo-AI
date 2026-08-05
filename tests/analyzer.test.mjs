import test from 'node:test';
import assert from 'node:assert/strict';
import { analyzeTextDocument } from '../src/domain/analyzer.js';

const text = `Объявление о регистрации\nРегистрация открыта до 10 августа 2026 года.\nНеобходимо заполнить форму и оплатить 150 сомони.\nМесто: Freedom IT Hub, Душанбе.\nТелефон +992 900 00 00 00.`;

test('local analyzer derives facts and actions from supplied text', () => {
  const result = analyzeTextDocument({
    analysisId: 'analysis_test',
    settings: { documentType: 'auto', resultLanguage: 'ru' },
    pageTexts: [{ page: 1, sourceId: 'source_1', text, confidence: 'high' }]
  });
  assert.equal(result.documentType, 'announcement');
  assert.ok(result.summary.standard.includes('Регистрация'));
  assert.equal(result.tasks.length, 2);
  assert.ok(result.tasks.some((task) => /заполнить/i.test(task.title)));
  assert.ok(result.tasks.some((task) => /оплатить/i.test(task.title)));
  assert.ok(!result.summary.standard.startsWith('Объявление о регистрации '));
  assert.ok(result.importantData.some((item) => item.type === 'amount' && item.value.includes('150')));
  assert.ok(result.importantData.some((item) => item.type === 'date' && item.value.includes('2026')));
  assert.ok(result.importantData.some((item) => item.type === 'address' && item.value.includes('Freedom IT Hub')));
});

test('analyzer does not invent a task when no action cue exists', () => {
  const result = analyzeTextDocument({
    analysisId: 'analysis_no_task',
    settings: { documentType: 'auto' },
    pageTexts: [{ page: 1, sourceId: 'source_1', text: 'Сегодня солнечная погода. Документ содержит справочную информацию.', confidence: 'high' }]
  });
  assert.equal(result.tasks.length, 0);
});
