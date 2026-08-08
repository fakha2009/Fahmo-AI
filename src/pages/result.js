import { answerRemoteClarification, completeRemoteTask, createRemoteExport, createRemoteReminder, createRemoteShare, downloadRemoteExport, getRemoteExport, getRemoteSourcePreview, patchRemoteTask, revokeRemoteShare } from '../core/api.js';
import { getLanguage, t } from '../core/i18n.js';
import { deleteShare, getAnalysis, saveAnalysis, saveDraft, saveShare } from '../core/repository.js';
import { navigate } from '../core/router.js';
import { getSettings } from '../core/settings.js';
import { copyText, downloadBlob, escapeAttribute, escapeHtml, formatDate, uid, wait } from '../core/utils.js';
import { createResultPdf, downloadTaskCalendar } from '../domain/exporters.js';
import { normalizeRemoteResult, normalizeSourceReference } from './process.js';
import { confirmDialog, openDialog } from '../ui/dialogs.js';
import { icon } from '../ui/icons.js';
import { renderShell } from '../ui/shell.js';
import { showToast } from '../ui/toast.js';

let analysis;
let mode = 'standard';
const objectUrls = new Map();

function sourceById(id) { return analysis.sources?.find((source) => source.id === id); }
function pageByClientId(id) { return analysis.pages?.find((page) => page.id === id); }
function sourceUrl(source) {
  if (!source?.blob) return '';
  if (!objectUrls.has(source.id)) objectUrls.set(source.id, URL.createObjectURL(source.blob));
  return objectUrls.get(source.id);
}
function blobUrl(key, blob) {
  if (!objectUrls.has(key)) objectUrls.set(key, URL.createObjectURL(blob));
  return objectUrls.get(key);
}
function releaseUrls() { for (const url of objectUrls.values()) URL.revokeObjectURL(url); objectUrls.clear(); }

function typeLabel(type) {
  return ({ announcement: t('announcement'), 'work-order': t('workOrder'), handwritten: t('handwritten'), other: t('other'), date: t('dateLabel'), time: t('timeLabel'), amount: t('amount'), address: t('address'), contact: t('contact'), link: t('link'), deadline: t('deadline'), document: t('document') })[type] ?? type;
}
function typeIcon(type) { return ({ date: 'calendar', time: 'clock', amount: 'money', address: 'mapPin', contact: 'phone', link: 'link', deadline: 'calendar', document: 'file' })[type] ?? 'info'; }
function priorityLabel(priority) { return ({ high: t('high'), medium: t('medium'), low: t('low') })[priority] ?? priority; }
function confidenceLabel(level) { return ({ high: t('confidenceHigh'), medium: t('confidenceMedium'), low: t('confidenceLow') })[level] ?? level; }

async function persist(patch = {}) {
  Object.assign(analysis, patch);
  analysis.updatedAt = new Date().toISOString();
  await saveAnalysis(analysis);
  const status = document.querySelector('[data-save-status]');
  if (status) status.innerHTML = `${icon('check', { size: 15 })}${escapeHtml(t('saved'))}`;
}

function summaryText(result) {
  return mode === 'simple' ? (result.summary?.simple || result.summary?.standard) : (result.summary?.standard || result.summary?.simple);
}

function taskItem(task) {
  const title = mode === 'simple' ? (task.simpleTitle || task.title) : task.title;
  return `
    <article class="task-item" data-task-id="${escapeAttribute(task.id)}" data-completed="${Boolean(task.completed)}">
      <button class="task-check" type="button" role="checkbox" aria-checked="${Boolean(task.completed)}" aria-label="${escapeAttribute(task.completed ? t('completed') : t('notCompleted'))}" data-toggle-task>${task.completed ? icon('check', { size: 17 }) : ''}</button>
      <div>
        <h3 class="task-item__title">${escapeHtml(title)}</h3>
        ${task.description ? `<p class="task-item__description">${escapeHtml(task.description)}</p>` : ''}
        <div class="task-item__meta">
          <span class="badge priority-${escapeAttribute(task.priority || 'low')}">${escapeHtml(priorityLabel(task.priority || 'low'))}</span>
          ${task.dueDate ? `<span class="badge badge--neutral">${icon('calendar', { size: 14 })}${escapeHtml(task.dueDate)}</span>` : ''}
          ${task.dueTime ? `<span class="badge badge--neutral">${icon('clock', { size: 14 })}${escapeHtml(task.dueTime)}</span>` : ''}
          ${task.source ? `<button class="filter-chip" type="button" data-source-task="${escapeAttribute(task.id)}">${icon('search', { size: 14 })}${escapeHtml(t('showSource'))}</button>` : ''}
        </div>
      </div>
      <div class="task-item__actions">
        <button class="icon-button" type="button" data-edit-task="${escapeAttribute(task.id)}" aria-label="${escapeAttribute(t('editTask'))}">${icon('edit')}</button>
      </div>
    </article>`;
}

function dataItem(item) {
  return `
    <article class="data-item" data-data-id="${escapeAttribute(item.id)}">
      <div class="data-item__type"><span>${icon(typeIcon(item.type), { size: 16 })}${escapeHtml(typeLabel(item.type))}</span><button class="icon-button" type="button" data-copy-data="${escapeAttribute(item.id)}" aria-label="${escapeAttribute(t('copyAll'))}">${icon('copy', { size: 17 })}</button></div>
      <div class="data-item__value">${escapeHtml(item.value)}</div>
      <div class="data-item__meta">
        <span class="confidence" data-level="${escapeAttribute(item.confidence || 'medium')}">${escapeHtml(confidenceLabel(item.confidence || 'medium'))}${item.userEdited ? ` · ${escapeHtml(t('confirmed'))}` : ''}</span>
        <span>
          ${item.source ? `<button class="icon-button" type="button" data-source-data="${escapeAttribute(item.id)}" aria-label="${escapeAttribute(t('showSource'))}">${icon('search', { size: 17 })}</button>` : ''}
          <button class="icon-button" type="button" data-edit-data="${escapeAttribute(item.id)}" aria-label="${escapeAttribute(t('saveChanges'))}">${icon('edit', { size: 17 })}</button>
        </span>
      </div>
    </article>`;
}

function clarificationCard(item) {
  return `
    <div class="clarification" data-clarification-id="${escapeAttribute(item.id)}">
      <h4>${escapeHtml(t('clarifications'))}</h4>
      <p>${escapeHtml(item.question)}</p>
      ${item.answered
        ? `<span class="badge badge--success">${icon('check', { size: 14 })}${escapeHtml(String(item.answer))}</span>`
        : `<div class="field-row"><input class="input" type="number" min="1900" max="2200" inputmode="numeric" placeholder="2026" data-clarification-answer><button class="button button--primary" type="button" data-submit-clarification>${escapeHtml(t('confirm'))}</button></div>`}
    </div>`;
}

function actionMenu() {
  return `
    <section class="card card--padded">
      <div class="card__header"><div><h2 class="card__title">${escapeHtml(t('save'))}</h2><p class="card__description">${escapeHtml(isRemoteAnalysis() ? t('remoteProvider') : t('createdLocally'))}</p></div><span class="save-status" data-save-status>${icon('check', { size: 15 })}${escapeHtml(t('saved'))}</span></div>
      <div class="action-menu">
        <button class="button button--secondary" type="button" data-copy-all>${icon('copy')} ${escapeHtml(t('copyAll'))}</button>
        <button class="button button--secondary" type="button" data-download-pdf>${icon('download')} ${escapeHtml(t('downloadPdf'))}</button>
        <button class="button button--secondary" type="button" data-calendar>${icon('calendar')} ${escapeHtml(t('addCalendar'))}</button>
        <button class="button button--secondary" type="button" data-share>${icon('share')} ${escapeHtml(t('share'))}</button>
        ${analysis.localShareId || analysis.remoteShare?.id ? `<button class="button button--ghost" type="button" data-disable-share>${icon('linkOff')} ${escapeHtml(t('disableShare'))}</button>` : ''}
        <button class="button button--ghost" type="button" data-reanalyze>${icon('refresh')} ${escapeHtml(t('reanalyze'))}</button>
      </div>
    </section>`;
}

function resultTemplate() {
  const result = analysis.result;
  const openTasks = result.tasks?.filter((task) => !task.completed).length ?? 0;
  return `
    <header class="page-header">
      <div class="page-header__copy">
        <h1 class="page-title">${escapeHtml(result.title || t('resultTitleFallback'))}</h1>
        <p class="page-subtitle">${escapeHtml(typeLabel(result.documentType))} · ${escapeHtml(result.resultLanguage?.toUpperCase() || 'RU')} · ${escapeHtml(t('analyzed'))} ${escapeHtml(formatDate(result.createdAt, getLanguage()))}</p>
      </div>
      <div class="page-actions"><span class="badge badge--primary">${openTasks} ${escapeHtml(t('taskCount'))}</span></div>
    </header>
    <div class="result-grid">
      <div class="result-main">
        <section class="card result-hero">
          <div class="card__header">
            <div><h2 class="card__title">${escapeHtml(t('summary'))}</h2></div>
            <div class="segmented" role="group" aria-label="${escapeAttribute(t('explanationLevel'))}">
              <button type="button" data-result-mode="standard" aria-pressed="${mode === 'standard'}">${escapeHtml(t('standard'))}</button>
              <button type="button" data-result-mode="simple" aria-pressed="${mode === 'simple'}">${escapeHtml(t('verySimple'))}</button>
            </div>
          </div>
          <div class="result-summary">${escapeHtml(summaryText(result) || '—').replaceAll('\n', '<br>')}</div>
          <div class="result-toolbar">
            <button class="button button--ghost button--small" type="button" data-copy-summary>${icon('copy')} ${escapeHtml(t('copySummary'))}</button>
            <button class="button button--ghost button--small" type="button" data-copy-tasks>${icon('list')} ${escapeHtml(t('copyTasks'))}</button>
          </div>
        </section>

        <section class="card card--padded">
          <div class="card__header"><div><h2 class="card__title">${escapeHtml(t('tasks'))}</h2><p class="card__description">${result.tasks?.length ?? 0} ${escapeHtml(t('taskCount'))}</p></div></div>
          ${result.tasks?.length ? `<div class="task-list">${result.tasks.map(taskItem).join('')}</div>` : `<div class="empty-state"><h3>${escapeHtml(t('noTasks'))}</h3></div>`}
        </section>

        <section class="card card--padded">
          <div class="card__header"><div><h2 class="card__title">${escapeHtml(t('importantData'))}</h2></div></div>
          ${result.importantData?.length ? `<div class="data-grid">${result.importantData.map(dataItem).join('')}</div>` : `<div class="empty-state"><h3>${escapeHtml(t('noData'))}</h3></div>`}
        </section>

        ${result.clarifications?.length ? `<section class="card card--padded"><div class="card__header"><h2 class="card__title">${escapeHtml(t('clarifications'))}</h2></div><div class="settings-stack">${result.clarifications.map(clarificationCard).join('')}</div></section>` : ''}

        <section class="card card--padded">
          <div class="card__header"><div><h2 class="card__title">${escapeHtml(t('warnings'))}</h2></div></div>
          ${result.warnings?.length ? `<div class="settings-stack">${result.warnings.map((warning) => `<div class="alert alert--warning">${icon('alert')}<div class="alert__content"><strong>${escapeHtml(warning.title)}</strong><p>${escapeHtml(warning.message)}</p>${warning.source ? `<button class="filter-chip alert__source" type="button" data-source-warning="${escapeAttribute(warning.id)}">${icon('search', { size: 14 })}${escapeHtml(t('showSource'))}</button>` : ''}</div></div>`).join('')}</div>` : `<div class="alert alert--success">${icon('success')}<div><strong>${escapeHtml(t('noWarnings'))}</strong></div></div>`}
        </section>
      </div>
      <aside class="result-aside">
        ${actionMenu()}
        <section class="card card--padded"><h2 class="card__title">${escapeHtml(t('source'))}</h2><p class="card__description">${escapeHtml(t('sourceUnavailable'))}</p><div style="margin-top:14px"><button class="button button--secondary button--wide" type="button" data-open-document>${icon('file')} ${escapeHtml(t('document'))}</button></div></section>
      </aside>
    </div>`;
}

function render() {
  renderShell({ title: t('resultTitleFallback'), currentPath: `/result/${analysis.id}`, content: resultTemplate() });
  bindEvents();
}

function tasksAsText() {
  return (analysis.result.tasks ?? []).map((task, index) => `${task.completed ? '✓' : '○'} ${index + 1}. ${mode === 'simple' ? (task.simpleTitle || task.title) : task.title}${task.dueDate ? ` — ${t('dueDate')}: ${task.dueDate}` : ''}`).join('\n');
}

function allAsText() {
  const result = analysis.result;
  const data = (result.importantData ?? []).map((item) => `${typeLabel(item.type)}: ${item.value}`).join('\n');
  const warnings = (result.warnings ?? []).map((warning) => `${warning.title}: ${warning.message}`).join('\n');
  return [result.title, '', t('summary'), summaryText(result), '', t('tasks'), tasksAsText(), '', t('importantData'), data, warnings ? `\n${t('warnings')}\n${warnings}` : ''].filter(Boolean).join('\n');
}

async function toggleTask(taskId) {
  const task = analysis.result.tasks.find((item) => item.id === taskId);
  if (!task) return;
  const previous = task.completed;
  try {
    if (isRemoteAnalysis()) {
      const response = previous
        ? await patchRemoteTask(getSettings().apiBaseUrl, task.id, task.revision ?? 1, { status: 'pending' })
        : await completeRemoteTask(getSettings().apiBaseUrl, task.id, task.revision ?? 1);
      applyRemoteTask(task, response);
    } else {
      task.completed = !previous;
    }
    await persist();
    render();
  } catch (error) {
    task.completed = previous;
    render();
    showToast({ title: t('saveFailed'), message: error.message, type: 'error' });
  }
}

function editTask(taskId) {
  const task = analysis.result.tasks.find((item) => item.id === taskId);
  if (!task) return;
  openDialog({
    id: 'edit-task-dialog',
    title: t('editTask'),
    body: `
      <form class="settings-stack" data-task-form>
        <div class="field"><label for="task-title">${escapeHtml(t('taskName'))}</label><input id="task-title" class="input" name="title" required maxlength="180" value="${escapeAttribute(task.title)}"></div>
        <div class="field"><label for="task-description">${escapeHtml(t('description'))}</label><textarea id="task-description" class="textarea" name="description">${escapeHtml(task.description || '')}</textarea></div>
        <div class="field-row">
          <div class="field"><label for="task-priority">${escapeHtml(t('priority'))}</label><select id="task-priority" class="select" name="priority"><option value="high" ${task.priority === 'high' ? 'selected' : ''}>${escapeHtml(t('high'))}</option><option value="medium" ${task.priority === 'medium' ? 'selected' : ''}>${escapeHtml(t('medium'))}</option><option value="low" ${task.priority === 'low' ? 'selected' : ''}>${escapeHtml(t('low'))}</option></select></div>
          <div class="field"><label for="task-date">${escapeHtml(t('date'))}</label><input id="task-date" class="input" name="dueDate" value="${escapeAttribute(task.dueDate || '')}" placeholder="2026-08-10"></div>
        </div>
        <div class="field-row">
          <div class="field"><label for="task-time">${escapeHtml(t('time'))}</label><input id="task-time" class="input" type="time" name="dueTime" value="${escapeAttribute(task.dueTime || '')}"></div>
          <div class="field"><label for="task-location">${escapeHtml(t('location'))}</label><input id="task-location" class="input" name="location" value="${escapeAttribute(task.location || '')}"></div>
        </div>
        <div class="field"><label for="task-reminder">${escapeHtml(t('reminder'))}</label><select id="task-reminder" class="select" name="reminderMinutes"><option value="">—</option><option value="15" ${task.reminderMinutes === 15 ? 'selected' : ''}>15 мин</option><option value="60" ${task.reminderMinutes === 60 ? 'selected' : ''}>1 час</option><option value="1440" ${task.reminderMinutes === 1440 ? 'selected' : ''}>1 день</option></select></div>
      </form>`,
    footer: `<button class="button button--ghost" type="button" data-cancel>${escapeHtml(t('cancel'))}</button><button class="button button--primary" type="button" data-save-task>${escapeHtml(t('saveChanges'))}</button>`,
    onOpen(dialog) {
      dialog.querySelector('[data-cancel]').addEventListener('click', () => dialog.close('cancel'));
      dialog.querySelector('[data-save-task]').addEventListener('click', async () => {
        const form = dialog.querySelector('[data-task-form]');
        if (!form.reportValidity()) return;
        const values = Object.fromEntries(new FormData(form));
        const patch = {
          title: values.title.trim(),
          simpleTitle: values.title.trim(),
          description: values.description.trim() || null,
          priority: values.priority,
          dueDate: values.dueDate.trim() || null,
          dueTime: values.dueTime || null,
          location: values.location.trim() || null,
          reminderMinutes: values.reminderMinutes ? Number(values.reminderMinutes) : null,
          userEdited: true
        };
        const saveButton = dialog.querySelector('[data-save-task]');
        saveButton.disabled = true;
        try {
          if (isRemoteAnalysis()) {
            const dueAt = toDueAt(patch.dueDate, patch.dueTime);
            const response = await patchRemoteTask(getSettings().apiBaseUrl, task.id, task.revision ?? 1, {
              title: patch.title,
              simpleTitle: patch.simpleTitle,
              description: patch.description,
              priority: patch.priority,
              dueAt,
              timezone: dueAt ? Intl.DateTimeFormat().resolvedOptions().timeZone : null,
            });
            applyRemoteTask(task, response);
            task.location = patch.location;
            task.reminderMinutes = patch.reminderMinutes;
            if (patch.reminderMinutes && dueAt) {
              const scheduledAt = new Date(new Date(dueAt).getTime() - patch.reminderMinutes * 60_000);
              if (scheduledAt.getTime() > Date.now()) {
                await createRemoteReminder(getSettings().apiBaseUrl, task.id, {
                  scheduledAt: scheduledAt.toISOString(),
                  timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
                  channel: 'in_app',
                  idempotencyKey: `reminder.${task.id}.${scheduledAt.getTime()}`,
                });
              }
            }
          } else {
            Object.assign(task, patch);
          }
          task.userEdited = true;
          await persist();
          dialog.close('saved');
          render();
        } catch (error) {
          saveButton.disabled = false;
          showToast({ title: t('saveFailed'), message: error.message, type: 'error' });
        }
      });
    }
  });
}

function editData(dataId) {
  const item = analysis.result.importantData.find((entry) => entry.id === dataId);
  if (!item) return;
  openDialog({
    id: 'edit-data-dialog',
    title: typeLabel(item.type),
    body: `<div class="field"><label for="data-value">${escapeHtml(typeLabel(item.type))}</label><input id="data-value" class="input" value="${escapeAttribute(item.value)}"></div>`,
    footer: `<button class="button button--ghost" type="button" data-cancel>${escapeHtml(t('cancel'))}</button><button class="button button--primary" type="button" data-save>${escapeHtml(t('saveChanges'))}</button>`,
    onOpen(dialog) {
      dialog.querySelector('[data-cancel]').addEventListener('click', () => dialog.close('cancel'));
      dialog.querySelector('[data-save]').addEventListener('click', async () => {
        const value = dialog.querySelector('#data-value').value.trim();
        if (!value) return;
        item.value = value;
        item.confidence = 'high';
        item.userEdited = true;
        analysis.result.userCorrections ??= [];
        analysis.result.userCorrections.push({ id: uid('correction'), targetId: item.id, value, createdAt: new Date().toISOString() });
        await persist();
        dialog.close('saved');
        render();
      });
    }
  });
}

function imageSourceMarkup(url, label, boundingBox) {
  const box = boundingBox && boundingBox.width > 0 && boundingBox.height > 0
    ? {
        x: Math.min(boundingBox.x, 1),
        y: Math.min(boundingBox.y, 1),
        width: Math.min(boundingBox.width, 1 - Math.min(boundingBox.x, 1)),
        height: Math.min(boundingBox.height, 1 - Math.min(boundingBox.y, 1)),
      }
    : null;
  const highlight = box
    ? `<span class="source-highlight" style="--source-x:${(box.x * 100).toFixed(3)}%;--source-y:${(box.y * 100).toFixed(3)}%;--source-width:${(box.width * 100).toFixed(3)}%;--source-height:${(box.height * 100).toFixed(3)}%" aria-label="${escapeAttribute(t('sourceExcerpt'))}"></span>`
    : '';
  return `<div class="source-preview__image"><img src="${escapeAttribute(url)}" alt="${escapeAttribute(label)}">${highlight}</div>`;
}

function textSourceMarkup(text, excerpt) {
  if (!text) return '';
  if (!excerpt) return `<pre>${escapeHtml(text)}</pre>`;
  const index = text.toLocaleLowerCase().indexOf(excerpt.toLocaleLowerCase());
  if (index < 0) return `<pre>${escapeHtml(text)}</pre>`;
  const before = text.slice(0, index);
  const match = text.slice(index, index + excerpt.length);
  const after = text.slice(index + excerpt.length);
  return `<pre>${escapeHtml(before)}<mark data-source-mark>${escapeHtml(match)}</mark>${escapeHtml(after)}</pre>`;
}

function sourcePreviewBody(media, source, showCoordinatesNote = false) {
  return `<div class="source-preview"><div class="source-preview__media">${media || `<p>${escapeHtml(t('sourceUnavailable'))}</p>`}</div>${showCoordinatesNote ? `<p class="source-location-note">${escapeHtml(t('sourceCoordinatesUnavailable'))}</p>` : ''}<div class="source-quote"><strong>${escapeHtml(t('sourceExcerpt'))}</strong><div>${escapeHtml(source.excerpt || t('sourceUnavailable'))}</div></div></div>`;
}

async function showSource(value) {
  const source = normalizeSourceReference(value);
  if (!source) {
    showToast({ title: t('source'), message: t('sourceUnavailable'), type: 'info' });
    return;
  }
  const page = pageByClientId(source.clientPageId || source.sourceId);
  const original = sourceById(page?.sourceId || source.sourceId);
  const { dialog } = openDialog({
    id: 'source-dialog',
    title: `${t('sourcePage')} ${source.page}`,
    body: `<div class="source-preview source-preview--loading"><div class="source-preview__media"><div class="source-loader" role="status">${escapeHtml(t('sourceLoading'))}</div></div></div>`,
  });
  const body = dialog.querySelector('.dialog__body');
  try {
    let media = '';
    let isImage = false;
    if (original?.kind === 'image') {
      isImage = true;
      media = imageSourceMarkup(sourceUrl(original), original.name, source.boundingBox);
    } else if (original?.kind === 'pdf') {
      media = `<iframe title="${escapeAttribute(original.name)}" src="${escapeAttribute(sourceUrl(original))}#page=${source.page}"></iframe>`;
    } else if (source.sourceAssetId && isRemoteAnalysis()) {
      const blob = await getRemoteSourcePreview(getSettings().apiBaseUrl, analysis.remoteId, source.sourceAssetId);
      isImage = true;
      media = imageSourceMarkup(blobUrl(`remote-source:${source.sourceAssetId}`, blob), t('source'), source.boundingBox);
    } else {
      const pageText = analysis.result.pageTexts?.find((entry) => entry.sourceId === original?.id || entry.sourceId === source.sourceId)?.text
        || analysis.result.sourceText
        || original?.text
        || '';
      media = textSourceMarkup(pageText, source.excerpt);
    }
    body.innerHTML = sourcePreviewBody(media, source, isImage && !source.boundingBox);
    body.querySelector('[data-source-mark]')?.scrollIntoView({ block: 'center' });
  } catch (error) {
    body.innerHTML = sourcePreviewBody(`<p>${escapeHtml(t('sourceLoadFailed'))}</p>`, source);
    showToast({ title: t('errorTitle'), message: error.message || t('sourceLoadFailed'), type: 'error' });
  }
}

async function submitClarification(card) {
  const id = card.dataset.clarificationId;
  const clarification = analysis.result.clarifications.find((item) => item.id === id);
  const year = Number(card.querySelector('[data-clarification-answer]').value);
  if (!clarification || year < 1900 || year > 2200) return;
  if (isRemoteAnalysis()) {
    try {
      const response = await answerRemoteClarification(getSettings().apiBaseUrl, analysis.remoteId, clarification.id, String(year));
      analysis.result = normalizeRemoteResult(response, analysis);
      analysis.status = 'completed';
      analysis.completedAt = new Date().toISOString();
      await persist();
      render();
      return;
    } catch (error) {
      showToast({ title: t('errorTitle'), message: error.message, type: 'error' });
      return;
    }
  }
  clarification.answered = true;
  clarification.answer = year;
  const data = analysis.result.importantData.find((item) => item.id === clarification.targetDataId);
  if (data && !/\b(?:19|20)\d{2}\b/.test(data.value)) {
    data.value = `${data.value} ${year}`;
    data.userEdited = true;
    data.confidence = 'high';
  }
  await persist();
  render();
}

async function downloadPdf() {
  const button = document.querySelector('[data-download-pdf]');
  button.disabled = true;
  try {
    const blob = isRemoteAnalysis()
      ? await createAndDownloadRemoteExport('pdf', { analysisId: analysis.remoteId })
      : await createResultPdf(analysis.result, {
        locale: getLanguage(), analyzedLabel: t('analyzed'), summaryLabel: t('summary'), tasksLabel: t('tasks'), dataLabel: t('importantData'), warningsLabel: t('warnings'), dueLabel: t('dueDate'), priorityLabel: t('priority')
      });
    const filename = `${(analysis.result.title || 'fahmo-result').replace(/[\\/:*?"<>|]+/g, '-').slice(0, 80)}.pdf`;
    downloadBlob(blob, filename);
    showToast({ title: t('pdfCreated'), type: 'success' });
  } catch (error) {
    showToast({ title: t('errorTitle'), message: error.message, type: 'error' });
  } finally { button.disabled = false; }
}

function calendarDialog() {
  const tasks = analysis.result.tasks?.filter((task) => task.dueDate) ?? [];
  if (!tasks.length) {
    showToast({ title: t('errorTitle'), message: `${t('date')} — ${t('noData')}`, type: 'warning' });
    return;
  }
  openDialog({
    id: 'calendar-dialog',
    title: t('addCalendar'),
    body: `<div class="action-sheet-list">${tasks.map((task) => `<button class="action-sheet-item" type="button" data-calendar-task="${escapeAttribute(task.id)}">${icon('calendar')}<span><strong>${escapeHtml(task.title)}</strong><span>${escapeHtml(task.dueDate)}</span></span></button>`).join('')}</div>`,
    onOpen(dialog) {
      dialog.querySelectorAll('[data-calendar-task]').forEach((button) => button.addEventListener('click', async () => {
        const task = tasks.find((item) => item.id === button.dataset.calendarTask);
        try {
          const filename = `${task.title.replace(/[\\/:*?"<>|]+/g, '-').slice(0, 70)}.ics`;
          if (isRemoteAnalysis()) {
            const blob = await createAndDownloadRemoteExport('ics', { taskIds: [task.id] });
            downloadBlob(blob, filename);
          } else {
            downloadTaskCalendar(task, filename);
          }
          dialog.close('created');
          showToast({ title: t('calendarCreated'), type: 'success' });
        } catch (error) {
          showToast({ title: t('errorTitle'), message: error.message, type: 'error' });
        }
      }));
    }
  });
}

function isRemoteAnalysis() {
  return analysis.settings?.provider === 'remote' && Boolean(analysis.remoteId && getSettings().apiBaseUrl);
}

function applyRemoteTask(task, response) {
  task.title = response.title ?? task.title;
  task.simpleTitle = response.simpleTitle ?? task.simpleTitle ?? task.title;
  task.description = response.description ?? '';
  task.priority = response.priority ?? task.priority;
  task.completed = response.completed ?? response.status === 'completed';
  task.dueDate = response.dueDate ?? response.dueAt?.slice(0, 10) ?? null;
  task.dueTime = response.dueTime ?? response.dueAt?.slice(11, 16) ?? null;
  task.revision = Number.isInteger(response.revision) ? response.revision : task.revision;
}

function toDueAt(dueDate, dueTime) {
  if (!dueDate) return null;
  const value = new Date(`${dueDate}T${dueTime || '00:00'}:00`);
  return Number.isNaN(value.getTime()) ? null : value.toISOString();
}

async function createAndDownloadRemoteExport(kind, input) {
  const baseUrl = getSettings().apiBaseUrl;
  const created = await createRemoteExport(baseUrl, { kind, ...input });
  for (let attempt = 0; attempt < 30; attempt += 1) {
    const job = attempt === 0 ? created : await getRemoteExport(baseUrl, created.id);
    if (job.status === 'done') return downloadRemoteExport(baseUrl, job.id);
    if (job.status === 'failed') throw new Error(job.errorCode || t('genericError'));
    await wait(700);
  }
  throw new Error(t('genericError'));
}

async function shareResult() {
  const approved = await confirmDialog({
    title: t('publicShareTitle'),
    message: t('publicShareText'),
    confirmLabel: t('confirm'),
    cancelLabel: t('cancel')
  });
  if (!approved) return;

  const settings = getSettings();
  if (analysis.settings?.provider === 'remote' && settings.apiBaseUrl && analysis.remoteId) {
    try {
      const remote = analysis.remoteShare ?? await createRemoteShare(settings.apiBaseUrl, analysis.remoteId);
      const shareId = remote.id || remote.shareId || null;
      const url = remote.url || `${location.origin}/shared/${shareId}`;
      analysis.remoteShare = { id: shareId, url };
      await persist();
      await copyText(url);
      if (navigator.share) await navigator.share({ title: analysis.result.title, text: summaryText(analysis.result), url }).catch(() => {});
      showToast({ title: t('copied'), message: url, type: 'success' });
      render();
      return;
    } catch (error) {
      showToast({ title: t('errorTitle'), message: error.message, type: 'error' });
      return;
    }
  }

  const shareId = analysis.localShareId || uid('share');
  await saveShare({ id: shareId, analysisId: analysis.id, result: structuredClone(analysis.result), createdAt: new Date().toISOString(), localOnly: true });
  analysis.localShareId = shareId;
  await persist();
  const url = `${location.origin}/shared/${shareId}`;
  await copyText(url);
  if (navigator.share) await navigator.share({ title: analysis.result.title, text: summaryText(analysis.result), url }).catch(() => {});
  showToast({ title: t('copied'), message: t('publicLinkRequiresBackend'), type: 'info', duration: 6000 });
  render();
}

async function disableShare() {
  const approved = await confirmDialog({
    title: t('disableShare'),
    message: t('disableShareText'),
    confirmLabel: t('disableShare'),
    cancelLabel: t('cancel'),
    danger: true
  });
  if (!approved) return;
  const settings = getSettings();
  try {
    if (analysis.remoteShare?.id && analysis.remoteId && settings.apiBaseUrl) {
      await revokeRemoteShare(settings.apiBaseUrl, analysis.remoteId, analysis.remoteShare.id);
      analysis.remoteShare = null;
    }
    if (analysis.localShareId) {
      await deleteShare(analysis.localShareId);
      analysis.localShareId = null;
    }
    await persist();
    showToast({ title: t('shareDisabled'), type: 'success' });
    render();
  } catch (error) {
    showToast({ title: t('errorTitle'), message: error.message, type: 'error' });
  }
}

async function reanalyze() {
  await saveDraft({
    id: 'active-draft',
    createdAt: new Date().toISOString(),
    sourceMode: analysis.sources?.some((source) => source.kind !== 'text') ? 'files' : 'text',
    sources: analysis.sources?.map((source) => ({ ...source })) ?? [],
    pages: analysis.pages?.map((page) => ({ ...page })) ?? [],
    text: analysis.sources?.filter((source) => source.text).map((source) => source.text).join('\n\n') || analysis.result.sourceText || '',
    settings: { ...analysis.settings }
  });
  navigate('/analyze');
}

function openDocument() {
  const first = analysis.sources?.[0];
  if (!first) return;
  showSource({ sourceId: first.id, page: 1, excerpt: analysis.result.sourceText?.slice(0, 260) || '' });
}

function bindEvents() {
  document.querySelectorAll('[data-result-mode]').forEach((button) => button.addEventListener('click', () => { mode = button.dataset.resultMode; render(); }));
  document.querySelectorAll('[data-toggle-task]').forEach((button) => button.addEventListener('click', () => toggleTask(button.closest('[data-task-id]').dataset.taskId)));
  document.querySelectorAll('[data-edit-task]').forEach((button) => button.addEventListener('click', () => editTask(button.dataset.editTask)));
  document.querySelectorAll('[data-source-task]').forEach((button) => button.addEventListener('click', () => showSource(analysis.result.tasks.find((task) => task.id === button.dataset.sourceTask)?.source)));
  document.querySelectorAll('[data-source-data]').forEach((button) => button.addEventListener('click', () => showSource(analysis.result.importantData.find((item) => item.id === button.dataset.sourceData)?.source)));
  document.querySelectorAll('[data-source-warning]').forEach((button) => button.addEventListener('click', () => showSource(analysis.result.warnings.find((item) => item.id === button.dataset.sourceWarning)?.source)));
  document.querySelectorAll('[data-edit-data]').forEach((button) => button.addEventListener('click', () => editData(button.dataset.editData)));
  document.querySelectorAll('[data-copy-data]').forEach((button) => button.addEventListener('click', async () => { const item = analysis.result.importantData.find((entry) => entry.id === button.dataset.copyData); await copyText(item?.value ?? ''); showToast({ title: t('copied'), type: 'success' }); }));
  document.querySelectorAll('[data-submit-clarification]').forEach((button) => button.addEventListener('click', () => submitClarification(button.closest('[data-clarification-id]'))));
  document.querySelector('[data-copy-summary]')?.addEventListener('click', async () => { await copyText(summaryText(analysis.result)); showToast({ title: t('copied'), type: 'success' }); });
  document.querySelector('[data-copy-tasks]')?.addEventListener('click', async () => { await copyText(tasksAsText()); showToast({ title: t('copied'), type: 'success' }); });
  document.querySelector('[data-copy-all]')?.addEventListener('click', async () => { await copyText(allAsText()); showToast({ title: t('copied'), type: 'success' }); });
  document.querySelector('[data-download-pdf]')?.addEventListener('click', downloadPdf);
  document.querySelector('[data-calendar]')?.addEventListener('click', calendarDialog);
  document.querySelector('[data-share]')?.addEventListener('click', shareResult);
  document.querySelector('[data-disable-share]')?.addEventListener('click', disableShare);
  document.querySelector('[data-reanalyze]')?.addEventListener('click', reanalyze);
  document.querySelector('[data-open-document]')?.addEventListener('click', openDocument);
}

export async function resultPage({ params }) {
  analysis = await getAnalysis(params.analysisId);
  if (!analysis) {
    renderShell({ title: t('errorTitle'), currentPath: location.pathname, content: `<div class="card empty-state"><h1>${escapeHtml(t('errorTitle'))}</h1><p>${escapeHtml(t('genericError'))}</p><a class="button button--primary" href="/history" data-router>${escapeHtml(t('navHistory'))}</a></div>` });
    return { title: t('errorTitle') };
  }
  if (!analysis.result || analysis.status !== 'completed') {
    navigate(`/analyze/${analysis.id}`, { replace: true });
    return { title: t('processTitle') };
  }
  mode = analysis.settings?.explanationLevel === 'simple' ? 'simple' : 'standard';
  render();
  return { title: analysis.result.title, cleanup: releaseUrls };
}
