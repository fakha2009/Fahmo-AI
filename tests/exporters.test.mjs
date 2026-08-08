import test from 'node:test';
import assert from 'node:assert/strict';
import { calendarTaskStatus, createIcsBlob } from '../src/domain/exporters.js';

test('creates a valid calendar event from an ISO task date', async () => {
  const blob = createIcsBlob({
    title: 'Подать документы',
    description: 'Проверить комплект',
    dueDate: '2026-08-10',
    dueTime: '09:30',
    reminderMinutes: 60,
    location: 'Душанбе'
  }, { now: new Date('2026-08-08T10:00:00.000Z') });
  const text = await blob.text();
  assert.match(text, /BEGIN:VCALENDAR/);
  assert.match(text, /DTSTART:20260810T093000/);
  assert.match(text, /SUMMARY:Подать документы/);
  assert.match(text, /BEGIN:VALARM/);
});

test('rejects a calendar event without a parseable date', () => {
  assert.throws(() => createIcsBlob({ title: 'Задача', dueDate: 'когда-нибудь' }));
});

test('creates an all-day calendar event when time is absent', async () => {
  const blob = createIcsBlob(
    { title: 'Подать документы', dueDate: '2026-08-10', reminderMinutes: null },
    { now: new Date('2026-08-08T10:00:00.000Z') }
  );
  const text = await blob.text();
  assert.match(text, /DTSTART;VALUE=DATE:20260810/);
  assert.match(text, /DTEND;VALUE=DATE:20260811/);
  assert.doesNotMatch(text, /20260810T090000/);
});

test('rejects past calendar dates and keeps missing dates untouched', () => {
  const now = new Date('2026-08-08T10:00:00.000Z');
  assert.equal(calendarTaskStatus({ dueDate: null }, now), 'missing');
  assert.equal(calendarTaskStatus({ dueDate: '2026-08-07' }, now), 'past');
  assert.throws(() => createIcsBlob({ title: 'Старая задача', dueDate: '2026-08-07' }, { now }));
});
