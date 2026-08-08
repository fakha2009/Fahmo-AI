import { listRemoteTasks } from './api.js';
import { dbGet, dbPut } from './db.js';
import { t } from './i18n.js';
import { listLocalTasks } from './repository.js';
import { getSettings } from './settings.js';
import { showToast } from '../ui/toast.js';

const NOTIFIED_RECORD_ID = 'notified-reminders';
const MAX_TIMER_DELAY = 2_147_000_000;
let timers = [];
let refreshPromise = null;

function reminderKey(task, reminder) {
  return reminder.id ?? `${task.id}:${reminder.scheduledAt}`;
}

async function loadNotificationState() {
  const record = await dbGet('device', NOTIFIED_RECORD_ID).catch(() => null);
  return record?.items && typeof record.items === 'object' ? record.items : {};
}

async function markNotified(key) {
  const items = await loadNotificationState();
  items[key] = new Date().toISOString();
  const recent = Object.entries(items)
    .sort((a, b) => new Date(b[1]).getTime() - new Date(a[1]).getTime())
    .slice(0, 300);
  await dbPut('device', { id: NOTIFIED_RECORD_ID, items: Object.fromEntries(recent), updatedAt: new Date().toISOString() });
}

async function deliver(task, reminder, key) {
  const current = await loadNotificationState();
  if (current[key]) return;
  await markNotified(key);
  const title = task.title || t('navTasks');
  const body = task.dueAt
    ? `${t('startsAt')}: ${new Date(task.dueAt).toLocaleString()}`
    : t('reminder');
  showToast({ title, message: body, type: 'info', duration: 8_000 });

  if (!('Notification' in globalThis) || Notification.permission !== 'granted') return;
  const options = {
    body,
    icon: '/public/assets/icon-192-v2.png',
    badge: '/public/assets/favicon-32-v2.png',
    tag: key,
    data: { url: '/tasks', taskId: task.id },
  };
  try {
    const registration = await navigator.serviceWorker?.getRegistration?.();
    if (registration) await registration.showNotification(title, options);
    else new Notification(title, options);
  } catch (error) {
    console.warn('Task notification could not be displayed', error);
  }
}

function schedule(task, reminder, notified) {
  if (!reminder?.scheduledAt || reminder.status === 'cancelled') return;
  const key = reminderKey(task, reminder);
  if (notified[key]) return;
  const delay = new Date(reminder.scheduledAt).getTime() - Date.now();
  if (!Number.isFinite(delay)) return;
  if (delay <= 0) {
    // Do not surface stale reminders from an old session.
    if (delay >= -24 * 60 * 60 * 1000) void deliver(task, reminder, key);
    return;
  }
  const timer = setTimeout(() => {
    if (delay > MAX_TIMER_DELAY) {
      void refreshReminderScheduler();
    } else {
      void deliver(task, reminder, key);
    }
  }, Math.min(delay, MAX_TIMER_DELAY));
  timers.push(timer);
}

async function loadTasks() {
  const settings = getSettings();
  if (settings.analysisMode === 'remote' && settings.apiBaseUrl) {
    const payload = await listRemoteTasks(settings.apiBaseUrl, undefined, 100);
    return payload.items ?? [];
  }
  return listLocalTasks();
}

export async function refreshReminderScheduler(tasks) {
  if (refreshPromise) return refreshPromise;
  refreshPromise = (async () => {
    timers.forEach(clearTimeout);
    timers = [];
    const [items, notified] = await Promise.all([tasks ?? loadTasks(), loadNotificationState()]);
    for (const task of items) {
      if (task.status === 'completed' || task.status === 'cancelled' || task.completed) continue;
      for (const reminder of task.reminders ?? []) schedule(task, reminder, notified);
    }
  })().catch((error) => {
    console.warn('Task reminders could not be scheduled', error);
  }).finally(() => {
    refreshPromise = null;
  });
  return refreshPromise;
}

export function startReminderScheduler() {
  window.addEventListener('fahmo:tasks-change', () => void refreshReminderScheduler());
  window.addEventListener('online', () => void refreshReminderScheduler());
  void refreshReminderScheduler();
}
