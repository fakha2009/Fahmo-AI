import test from 'node:test';
import assert from 'node:assert/strict';
import { createIcsBlob } from '../src/domain/exporters.js';

test('creates a valid calendar event from an ISO task date', async () => {
  const blob = createIcsBlob({
    title: 'Подать документы',
    description: 'Проверить комплект',
    dueDate: '2026-08-10',
    dueTime: '09:30',
    reminderMinutes: 60,
    location: 'Душанбе'
  });
  const text = await blob.text();
  assert.match(text, /BEGIN:VCALENDAR/);
  assert.match(text, /DTSTART:20260810T093000/);
  assert.match(text, /SUMMARY:Подать документы/);
  assert.match(text, /BEGIN:VALARM/);
});

test('rejects a calendar event without a parseable date', () => {
  assert.throws(() => createIcsBlob({ title: 'Задача', dueDate: 'когда-нибудь' }));
});
