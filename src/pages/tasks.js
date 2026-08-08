import {
  completeRemoteTask,
  createRemoteReminder,
  createRemoteTask,
  deleteRemoteReminder,
  deleteRemoteTask,
  listRemoteTasks,
  patchRemoteReminder,
  patchRemoteTask,
} from '../core/api.js';
import { getLanguage, t } from '../core/i18n.js';
import {
  deleteLocalTask,
  listAnalyses,
  listLocalTasks,
  saveAnalysis,
  saveLocalTask,
} from '../core/repository.js';
import { refreshReminderScheduler } from '../core/reminder-scheduler.js';
import { getSettings } from '../core/settings.js';
import { escapeAttribute, escapeHtml, formatDate, todayIso, uid } from '../core/utils.js';
import { calendarTaskStatus } from '../domain/exporters.js';
import { confirmDialog, openDialog } from '../ui/dialogs.js';
import { icon } from '../ui/icons.js';
import { renderShell } from '../ui/shell.js';
import { showToast } from '../ui/toast.js';

let tasks = [];
let filter = 'open';
let loadError = '';
let busyIds = new Set();

function isRemote() {
  const settings = getSettings();
  return settings.analysisMode === 'remote' && Boolean(settings.apiBaseUrl);
}

function isCompleted(task) {
  return task.completed === true || task.status === 'completed';
}

function normalizeTask(task, origin) {
  const dueAt = task.dueAt ?? toDueAt(task.dueDate, task.dueTime);
  return {
    ...task,
    origin: task.origin ?? origin ?? (task.analysisId ? 'ai' : 'user'),
    status: task.status ?? (task.completed ? 'completed' : 'pending'),
    completed: isCompleted(task),
    dueAt,
    reminders: Array.isArray(task.reminders) ? task.reminders.filter((item) => item.status !== 'cancelled') : [],
    revision: Number.isInteger(task.revision) ? task.revision : 1,
  };
}

async function localTaskCollection() {
  const [saved, analyses] = await Promise.all([listLocalTasks(), listAnalyses()]);
  const byId = new Map();
  for (const analysis of analyses) {
    for (const task of analysis.result?.tasks ?? []) {
      byId.set(task.id, normalizeTask({ ...task, analysisId: task.analysisId ?? analysis.remoteId ?? analysis.id, resultAnalysisId: analysis.id }, 'ai'));
    }
  }
  for (const task of saved) byId.set(task.id, normalizeTask(task));
  return [...byId.values()];
}

function sortTasks(items) {
  return [...items].sort((a, b) => {
    if (isCompleted(a) !== isCompleted(b)) return isCompleted(a) ? 1 : -1;
    const aDue = a.dueAt ? new Date(a.dueAt).getTime() : Number.MAX_SAFE_INTEGER;
    const bDue = b.dueAt ? new Date(b.dueAt).getTime() : Number.MAX_SAFE_INTEGER;
    if (aDue !== bDue) return aDue - bDue;
    return new Date(b.createdAt ?? 0).getTime() - new Date(a.createdAt ?? 0).getTime();
  });
}

async function loadTaskCollection() {
  loadError = '';
  if (!isRemote()) return localTaskCollection();
  try {
    const [response, analyses] = await Promise.all([
      listRemoteTasks(getSettings().apiBaseUrl, undefined, 100),
      listAnalyses(),
    ]);
    const resultIdByRemoteId = new Map(analyses.filter((item) => item.remoteId).map((item) => [item.remoteId, item.id]));
    const remoteTasks = (response.items ?? []).map((task) => normalizeTask({ ...task, resultAnalysisId: task.analysisId ? resultIdByRemoteId.get(task.analysisId) : null }));
    await Promise.all(remoteTasks.map((task) => saveLocalTask({ ...task, syncState: 'synced' })));
    return remoteTasks;
  } catch (error) {
    loadError = error.message || t('genericError');
    return localTaskCollection();
  }
}

function filteredTasks() {
  if (filter === 'open') return tasks.filter((task) => !isCompleted(task));
  if (filter === 'completed') return tasks.filter(isCompleted);
  return tasks;
}

function dueBadge(task) {
  if (!task.dueAt) return `<span class="badge badge--neutral">${icon('calendar', { size: 14 })}${escapeHtml(t('noDueDate'))}</span>`;
  const due = new Date(task.dueAt);
  const now = new Date();
  const overdue = !isCompleted(task) && due.getTime() < now.getTime();
  const label = formatDate(due, getLanguage());
  return `<span class="badge ${overdue ? 'badge--warning' : 'badge--neutral'}">${icon('calendar', { size: 14 })}${escapeHtml(overdue ? `${t('overdue')} · ${label}` : `${t('startsAt')}: ${label}`)}</span>`;
}

function reminderBadge(task) {
  const reminder = activeReminder(task);
  if (!reminder) return '';
  return `<span class="badge badge--neutral">${icon('bell', { size: 14 })}${escapeHtml(formatDate(reminder.scheduledAt, getLanguage()))}</span>`;
}

function taskRow(task) {
  const disabled = busyIds.has(task.id);
  const completed = isCompleted(task);
  const originLabel = task.origin === 'ai' ? t('taskOriginAi') : t('taskOriginUser');
  return `
    <article class="task-item tasks-page__item" data-task-id="${escapeAttribute(task.id)}" data-completed="${completed}" data-busy="${disabled}">
      <button class="task-check" type="button" role="checkbox" aria-checked="${completed}" aria-busy="${disabled}" aria-label="${escapeAttribute(completed ? t('completed') : t('notCompleted'))}" data-task-toggle ${disabled ? 'disabled' : ''}><span class="task-check__mark" aria-hidden="true">${icon('check', { size: 18 })}</span></button>
      <div class="task-item__body">
        <div class="task-item__heading">
          <h2 class="task-item__title">${escapeHtml(task.title)}</h2>
          <span class="task-origin" data-origin="${escapeAttribute(task.origin)}">${task.origin === 'ai' ? icon('sparkles', { size: 13 }) : icon('edit', { size: 13 })}${escapeHtml(originLabel)}</span>
        </div>
        ${task.description ? `<p class="task-item__description">${escapeHtml(task.description)}</p>` : ''}
        <div class="task-item__meta">
          <span class="badge priority-${escapeAttribute(task.priority ?? 'medium')}">${escapeHtml(t(task.priority ?? 'medium'))}</span>
          ${dueBadge(task)}
          ${reminderBadge(task)}
          ${task.resultAnalysisId ? `<a class="task-source-link" href="/result/${encodeURIComponent(task.resultAnalysisId)}" data-router>${icon('file', { size: 14 })}${escapeHtml(t('showSource'))}</a>` : ''}
        </div>
      </div>
      <div class="task-item__actions">
        <button class="icon-button" type="button" data-task-edit aria-label="${escapeAttribute(t('editTask'))}" ${disabled ? 'disabled' : ''}>${icon('edit')}</button>
        <button class="icon-button" type="button" data-task-delete aria-label="${escapeAttribute(t('delete'))}" ${disabled ? 'disabled' : ''}>${icon('trash')}</button>
      </div>
    </article>`;
}

function render() {
  const visible = filteredTasks();
  const openCount = tasks.filter((task) => !isCompleted(task)).length;
  const completedCount = tasks.length - openCount;
  renderShell({
    title: t('navTasks'),
    currentPath: '/tasks',
    content: `
      <header class="page-header tasks-page__header">
        <div class="page-header__copy"><h1 class="page-title">${escapeHtml(t('tasksTitle'))}</h1><p class="page-subtitle">${escapeHtml(t('tasksSubtitle'))}</p></div>
        <div class="page-actions"><button class="button button--primary" type="button" data-add-task>${icon('plus')} ${escapeHtml(t('addTask'))}</button></div>
      </header>
      ${loadError ? `<div class="inline-alert" role="alert">${icon('alert')}<div><strong>${escapeHtml(t('errorTitle'))}</strong><p>${escapeHtml(loadError)}</p></div><button class="button button--small button--secondary" type="button" data-retry>${escapeHtml(t('retry'))}</button></div>` : ''}
      <section class="tasks-command-bar" aria-label="${escapeAttribute(t('tasksTitle'))}">
        <div class="tasks-summary">
          <div><strong>${tasks.length}</strong><span>${escapeHtml(t('allTasks'))}</span></div>
          <div><strong>${openCount}</strong><span>${escapeHtml(t('openTasks'))}</span></div>
          <div><strong>${completedCount}</strong><span>${escapeHtml(t('completedTasks'))}</span></div>
        </div>
        <div class="filters tasks-filters" role="group" aria-label="${escapeAttribute(t('tasksTitle'))}">
          <button class="filter-chip" type="button" data-task-filter="all" aria-pressed="${filter === 'all'}">${escapeHtml(t('allTasks'))}</button>
          <button class="filter-chip" type="button" data-task-filter="open" aria-pressed="${filter === 'open'}">${escapeHtml(t('openTasks'))}</button>
          <button class="filter-chip" type="button" data-task-filter="completed" aria-pressed="${filter === 'completed'}">${escapeHtml(t('completedTasks'))}</button>
        </div>
      </section>
      <section class="section tasks-page__list" aria-live="polite">
        ${visible.length ? `<div class="task-list">${visible.map(taskRow).join('')}</div>` : `<div class="card empty-state tasks-empty"><div class="tasks-empty__icon">${icon('tasks', { size: 36 })}</div><h3>${escapeHtml(t('noTaskItems'))}</h3><p>${escapeHtml(t('noTaskItemsText'))}</p><button class="button button--primary" type="button" data-add-task>${icon('plus')} ${escapeHtml(t('addTask'))}</button></div>`}
      </section>`,
  });
  bindEvents();
}

function bindEvents() {
  document.querySelectorAll('[data-add-task]').forEach((button) => button.addEventListener('click', () => openTaskEditor()));
  document.querySelector('[data-retry]')?.addEventListener('click', () => void reload());
  document.querySelectorAll('[data-task-filter]').forEach((button) => button.addEventListener('click', () => {
    filter = button.dataset.taskFilter;
    render();
  }));
  document.querySelectorAll('[data-task-id]').forEach((row) => {
    const task = tasks.find((item) => item.id === row.dataset.taskId);
    if (!task) return;
    row.querySelector('[data-task-toggle]')?.addEventListener('click', () => void toggleTask(task));
    row.querySelector('[data-task-edit]')?.addEventListener('click', () => openTaskEditor(task));
    row.querySelector('[data-task-delete]')?.addEventListener('click', () => void removeTask(task));
  });
}

function localDateParts(task) {
  if (!task?.dueAt) return { date: task?.dueDate ?? '', time: task?.dueTime ?? '' };
  if (task.timezone == null && /T00:00:00\.000Z$/u.test(task.dueAt)) {
    return { date: task.dueAt.slice(0, 10), time: '' };
  }
  const value = new Date(task.dueAt);
  if (Number.isNaN(value.getTime())) return { date: '', time: '' };
  const offsetValue = new Date(value.getTime() - value.getTimezoneOffset() * 60_000).toISOString();
  return { date: offsetValue.slice(0, 10), time: offsetValue.slice(11, 16) };
}

function reminderMinutesFor(task) {
  const reminder = activeReminder(task);
  if (!reminder || !task?.dueAt) return '';
  const minutes = Math.round((new Date(task.dueAt).getTime() - new Date(reminder.scheduledAt).getTime()) / 60_000);
  return minutes > 0 ? minutes : '';
}

function taskForm(task) {
  const parts = localDateParts(task);
  const minutes = reminderMinutesFor(task);
  const preset = [5, 10, 30, 60].includes(minutes) ? String(minutes) : minutes ? 'custom' : '';
  return `
    <form id="task-editor-form" class="task-form">
      <div class="field"><label for="task-title">${escapeHtml(t('taskName'))}</label><input id="task-title" class="input" name="title" maxlength="200" required autocomplete="off" value="${escapeAttribute(task?.title ?? '')}"></div>
      <div class="field"><label for="task-description">${escapeHtml(t('description'))}</label><textarea id="task-description" class="textarea" name="description" maxlength="5000" rows="4">${escapeHtml(task?.description ?? '')}</textarea></div>
      <div class="field-row">
        <div class="field"><label for="task-date">${escapeHtml(t('date'))}</label><input id="task-date" class="input" type="date" name="date" min="${todayIso()}" value="${escapeAttribute(parts.date)}"></div>
        <div class="field"><label for="task-time">${escapeHtml(t('time'))}</label><input id="task-time" class="input" type="time" name="time" value="${escapeAttribute(parts.time)}"></div>
      </div>
      <div class="field"><label for="task-priority">${escapeHtml(t('priority'))}</label><select id="task-priority" class="select" name="priority"><option value="high" ${task?.priority === 'high' ? 'selected' : ''}>${escapeHtml(t('high'))}</option><option value="medium" ${!task || task.priority === 'medium' ? 'selected' : ''}>${escapeHtml(t('medium'))}</option><option value="low" ${task?.priority === 'low' ? 'selected' : ''}>${escapeHtml(t('low'))}</option></select></div>
      <div class="field"><label for="task-reminder">${escapeHtml(t('remindBefore'))}</label><select id="task-reminder" class="select" name="reminder"><option value="" ${!preset ? 'selected' : ''}>${escapeHtml(t('noReminder'))}</option><option value="5" ${preset === '5' ? 'selected' : ''}>5 ${escapeHtml(t('minutesBefore'))}</option><option value="10" ${preset === '10' ? 'selected' : ''}>10 ${escapeHtml(t('minutesBefore'))}</option><option value="30" ${preset === '30' ? 'selected' : ''}>30 ${escapeHtml(t('minutesBefore'))}</option><option value="60" ${preset === '60' ? 'selected' : ''}>60 ${escapeHtml(t('minutesBefore'))}</option><option value="custom" ${preset === 'custom' ? 'selected' : ''}>${escapeHtml(t('customReminder'))}</option></select></div>
      <div class="field" data-custom-reminder ${preset === 'custom' ? '' : 'hidden'}><label for="task-reminder-minutes">${escapeHtml(t('reminderMinutesLabel'))}</label><input id="task-reminder-minutes" class="input" type="number" name="customMinutes" min="1" max="10080" step="1" value="${escapeAttribute(preset === 'custom' ? minutes : 10)}"></div>
      ${'Notification' in globalThis && Notification.permission !== 'granted' ? `<p class="field-hint task-notification-hint">${icon('bell', { size: 16 })}${escapeHtml(t('notificationPermissionHint'))}</p>` : ''}
    </form>`;
}

function openTaskEditor(task = null) {
  openDialog({
    id: 'task-editor-dialog',
    title: task ? t('editTask') : t('createTask'),
    body: taskForm(task),
    footer: `<button class="button button--ghost" type="button" data-task-cancel>${escapeHtml(t('cancel'))}</button><button class="button button--primary" type="submit" form="task-editor-form" data-task-save>${escapeHtml(task ? t('saveChanges') : t('addTask'))}</button>`,
    closeLabel: t('close'),
    onOpen(dialog) {
      const form = dialog.querySelector('#task-editor-form');
      const reminderSelect = form.elements.reminder;
      const customField = form.querySelector('[data-custom-reminder]');
      reminderSelect.addEventListener('change', () => { customField.hidden = reminderSelect.value !== 'custom'; });
      form.addEventListener('submit', async (event) => {
        event.preventDefault();
        const saveButton = dialog.querySelector('[data-task-save]');
        saveButton.disabled = true;
        try {
          const input = readTaskForm(form);
          const saved = task ? await updateTask(task, input) : await createTask(input);
          dialog.close('saved');
          showToast({ title: task ? t('taskUpdated') : t('taskCreated'), type: 'success' });
          await syncTaskIntoAnalysis(saved);
          await reload(false);
        } catch (error) {
          showToast({ title: t('errorTitle'), message: error.message || t('genericError'), type: 'error' });
          saveButton.disabled = false;
        }
      });
      dialog.querySelector('[data-task-cancel]').addEventListener('click', () => dialog.close('cancel'));
      form.elements.title.focus();
    },
  });
}

function readTaskForm(form) {
  const data = new FormData(form);
  const title = String(data.get('title') ?? '').trim();
  const description = String(data.get('description') ?? '').trim();
  const date = String(data.get('date') ?? '');
  const time = String(data.get('time') ?? '');
  if (!title) throw new Error(t('taskName'));
  if (time && !date) throw new Error(`${t('date')}: ${t('errorTitle')}`);
  if (date && calendarTaskStatus({ dueDate: date, dueTime: time || null }) === 'past') throw new Error(t('pastDateNotAllowed'));
  const dueAt = date ? toDueAt(date, time) : null;
  const reminderValue = String(data.get('reminder') ?? '');
  const reminderMinutes = reminderValue === 'custom' ? Number(data.get('customMinutes')) : Number(reminderValue || 0);
  if (reminderMinutes && (!Number.isInteger(reminderMinutes) || reminderMinutes < 1 || reminderMinutes > 10080)) throw new Error(t('reminderMinutesLabel'));
  if (reminderMinutes && (!dueAt || !time)) throw new Error(t('reminderNeedsTime'));
  const scheduledAt = reminderMinutes ? new Date(new Date(dueAt).getTime() - reminderMinutes * 60_000).toISOString() : null;
  if (scheduledAt && new Date(scheduledAt).getTime() <= Date.now()) throw new Error(`${t('reminder')}: ${t('overdue')}`);
  return { title, description: description || null, priority: String(data.get('priority') ?? 'medium'), dueAt, reminderMinutes, scheduledAt, timezone: dueAt && time ? (Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC') : null };
}

async function createTask(input) {
  const clientMutationId = uid('task');
  if (isRemote()) {
    let task = normalizeTask(await createRemoteTask(getSettings().apiBaseUrl, {
      title: input.title,
      description: input.description,
      simpleTitle: input.title,
      simpleDescription: input.description,
      priority: input.priority,
      status: 'pending',
      dueAt: input.dueAt,
      timezone: input.dueAt ? input.timezone : null,
      clientMutationId,
      idempotencyKey: clientMutationId,
    }));
    if (input.scheduledAt) {
      const reminder = await createRemoteReminder(getSettings().apiBaseUrl, task.id, {
        scheduledAt: input.scheduledAt,
        timezone: input.timezone,
        channel: 'in_app',
        idempotencyKey: uid('reminder'),
      });
      task = { ...task, reminders: [reminder] };
    }
    await saveLocalTask({ ...task, origin: 'user', syncState: 'synced' });
    return task;
  }
  const now = new Date().toISOString();
  const task = normalizeTask({ id: clientMutationId, title: input.title, description: input.description, priority: input.priority, status: 'pending', dueAt: input.dueAt, timezone: input.timezone, revision: 1, origin: 'user', createdAt: now, updatedAt: now, reminders: input.scheduledAt ? [{ id: uid('reminder'), taskId: clientMutationId, scheduledAt: input.scheduledAt, timezone: input.timezone, channel: 'in_app', status: 'scheduled', revision: 1 }] : [] });
  await saveLocalTask(task);
  return task;
}

async function updateTask(task, input) {
  if (isRemote()) {
    const response = await patchRemoteTask(getSettings().apiBaseUrl, task.id, task.revision, {
      title: input.title,
      description: input.description,
      simpleTitle: input.title,
      simpleDescription: input.description,
      priority: input.priority,
      dueAt: input.dueAt,
      timezone: input.dueAt ? input.timezone : null,
    });
    const reminders = [...(task.reminders ?? [])];
    const current = activeReminder(task);
    if (current && input.scheduledAt) {
      const changed = await patchRemoteReminder(getSettings().apiBaseUrl, current.id, current.revision, { scheduledAt: input.scheduledAt, timezone: input.timezone });
      reminders.splice(reminders.indexOf(current), 1, changed);
    } else if (current && !input.scheduledAt) {
      await deleteRemoteReminder(getSettings().apiBaseUrl, current.id, current.revision);
      reminders.splice(reminders.indexOf(current), 1);
    } else if (!current && input.scheduledAt) {
      reminders.push(await createRemoteReminder(getSettings().apiBaseUrl, task.id, { scheduledAt: input.scheduledAt, timezone: input.timezone, channel: 'in_app', idempotencyKey: uid('reminder') }));
    }
    const updated = normalizeTask({ ...response, reminders, origin: task.origin });
    await saveLocalTask({ ...updated, syncState: 'synced' });
    return updated;
  }
  const current = activeReminder(task);
  const reminder = input.scheduledAt ? { id: current?.id ?? uid('reminder'), taskId: task.id, scheduledAt: input.scheduledAt, timezone: input.timezone, channel: 'in_app', status: 'scheduled', revision: (current?.revision ?? 0) + 1 } : null;
  const updated = normalizeTask({ ...task, ...input, completed: isCompleted(task), revision: task.revision + 1, reminders: reminder ? [reminder] : [] });
  await saveLocalTask(updated);
  return updated;
}

async function toggleTask(task) {
  if (busyIds.has(task.id)) return;
  const wasCompleted = isCompleted(task);
  const nextCompleted = !wasCompleted;
  setBusy(task.id, true);
  setTaskVisualState(task.id, nextCompleted);
  try {
    let updated;
    if (isRemote()) {
      const response = wasCompleted
        ? await patchRemoteTask(getSettings().apiBaseUrl, task.id, task.revision, { status: 'pending' })
        : await completeRemoteTask(getSettings().apiBaseUrl, task.id, task.revision);
      updated = normalizeTask({ ...response, reminders: task.reminders, origin: task.origin });
    } else {
      updated = normalizeTask({ ...task, status: wasCompleted ? 'pending' : 'completed', completed: nextCompleted, revision: task.revision + 1, completedAt: wasCompleted ? null : new Date().toISOString() });
    }
    await saveLocalTask({ ...updated, syncState: isRemote() ? 'synced' : undefined });
    await syncTaskIntoAnalysis(updated);
    tasks = sortTasks(tasks.map((item) => item.id === task.id ? updated : item));
  } catch (error) {
    setTaskVisualState(task.id, wasCompleted);
    showToast({ title: t('errorTitle'), message: error.message || t('genericError'), type: 'error' });
  } finally {
    setBusy(task.id, false);
    render();
    await refreshReminderScheduler(tasks);
  }
}

async function removeTask(task) {
  const confirmed = await confirmDialog({ title: t('taskDeleteTitle'), message: t('taskDeleteText'), confirmLabel: t('delete'), cancelLabel: t('cancel'), danger: true });
  if (!confirmed) return;
  setBusy(task.id, true);
  try {
    if (isRemote()) await deleteRemoteTask(getSettings().apiBaseUrl, task.id, task.revision);
    await deleteLocalTask(task.id);
    tasks = tasks.filter((item) => item.id !== task.id);
    await removeTaskFromAnalysis(task.id);
    showToast({ title: t('taskDeleted'), type: 'success' });
  } catch (error) {
    showToast({ title: t('errorTitle'), message: error.message || t('genericError'), type: 'error' });
  } finally {
    setBusy(task.id, false);
    render();
    await refreshReminderScheduler(tasks);
  }
}

function activeReminder(task) {
  return (task?.reminders ?? []).find((reminder) => reminder.status !== 'cancelled') ?? null;
}

function setBusy(id, value) {
  if (value) busyIds.add(id);
  else busyIds.delete(id);
  const row = document.querySelector(`[data-task-id="${CSS.escape(id)}"]`);
  const button = row?.querySelector('[data-task-toggle]');
  if (row) row.dataset.busy = String(value);
  if (button) {
    button.disabled = value;
    button.setAttribute('aria-busy', String(value));
  }
}

function setTaskVisualState(id, completed) {
  const row = document.querySelector(`[data-task-id="${CSS.escape(id)}"]`);
  const button = row?.querySelector('[data-task-toggle]');
  if (row) row.dataset.completed = String(completed);
  if (button) {
    button.setAttribute('aria-checked', String(completed));
    button.setAttribute('aria-label', completed ? t('completed') : t('notCompleted'));
  }
}

async function syncTaskIntoAnalysis(task) {
  if (!task.analysisId) return;
  const analyses = await listAnalyses();
  const analysis = analyses.find((item) => item.id === task.analysisId || item.remoteId === task.analysisId);
  const target = analysis?.result?.tasks?.find((item) => item.id === task.id);
  if (!target) return;
  Object.assign(target, { title: task.title, description: task.description, priority: task.priority, completed: isCompleted(task), dueDate: task.dueAt?.slice(0, 10) ?? null, dueTime: task.dueAt?.slice(11, 16) ?? null, revision: task.revision });
  await saveAnalysis(analysis);
}

async function removeTaskFromAnalysis(taskId) {
  const analyses = await listAnalyses();
  await Promise.all(analyses.flatMap((analysis) => {
    if (!analysis.result?.tasks?.some((task) => task.id === taskId)) return [];
    analysis.result.tasks = analysis.result.tasks.filter((task) => task.id !== taskId);
    return [saveAnalysis(analysis)];
  }));
}

function toDueAt(date, time) {
  if (!date) return null;
  if (!time) {
    const value = new Date(`${date}T00:00:00.000Z`);
    return Number.isNaN(value.getTime()) ? null : value.toISOString();
  }
  const value = new Date(`${date}T${time}:00`);
  return Number.isNaN(value.getTime()) ? null : value.toISOString();
}

async function reload(showLoading = true) {
  if (showLoading) {
    renderShell({ title: t('navTasks'), currentPath: '/tasks', content: `<div class="card loading-state"><span class="spinner"></span><p>${escapeHtml(t('sourceLoading'))}</p></div>` });
  }
  tasks = sortTasks(await loadTaskCollection());
  render();
  await refreshReminderScheduler(tasks);
}

export async function tasksPage() {
  filter = 'open';
  busyIds = new Set();
  await reload();
  return { title: t('tasksTitle') };
}
