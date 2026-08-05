import { getLanguage, t } from '../core/i18n.js';
import { deleteAnalysis, listAnalyses, saveAnalysis } from '../core/repository.js';
import { navigate } from '../core/router.js';
import { escapeAttribute, escapeHtml, formatDate } from '../core/utils.js';
import { confirmDialog, openDialog } from '../ui/dialogs.js';
import { icon } from '../ui/icons.js';
import { renderShell } from '../ui/shell.js';
import { showToast } from '../ui/toast.js';

let analyses = [];
let query = '';
let filter = 'all';
let visibleCount = 10;

function statusLabel(status) {
  return ({ draft: t('statusDraft'), queued: t('statusProcessing'), processing: t('statusProcessing'), completed: t('statusCompleted'), failed: t('statusFailed'), cancelled: t('statusCancelled') })[status] ?? status;
}

function filteredItems() {
  const normalized = query.trim().toLowerCase();
  return analyses.filter((analysis) => {
    const title = (analysis.result?.title || analysis.title || '').toLowerCase();
    const type = (analysis.result?.documentType || analysis.settings?.documentType || '').toLowerCase();
    const matchesQuery = !normalized || title.includes(normalized) || type.includes(normalized);
    const tasks = analysis.result?.tasks ?? [];
    const warnings = analysis.result?.warnings ?? [];
    const matchesFilter = filter === 'all'
      || (filter === 'open-tasks' && tasks.some((task) => !task.completed))
      || (filter === 'warnings' && warnings.length > 0)
      || (filter === 'announcement' && analysis.result?.documentType === 'announcement')
      || (filter === 'work-order' && analysis.result?.documentType === 'work-order');
    return matchesQuery && matchesFilter;
  });
}

function historyRow(analysis) {
  const tasks = analysis.result?.tasks ?? [];
  const openTasks = tasks.filter((task) => !task.completed).length;
  const warnings = analysis.result?.warnings?.length ?? 0;
  return `
    <article class="card history-row" data-analysis-id="${escapeAttribute(analysis.id)}">
      <div class="history-row__icon">${icon(analysis.status === 'completed' ? 'file' : analysis.status === 'failed' ? 'alert' : 'clock')}</div>
      <div class="history-row__body">
        <div class="history-row__title">${escapeHtml(analysis.result?.title || analysis.title || t('document'))}</div>
        <div class="history-row__meta">${escapeHtml(statusLabel(analysis.status))} · ${escapeHtml(formatDate(analysis.updatedAt || analysis.createdAt, getLanguage()))} · ${openTasks}/${tasks.length} ${escapeHtml(t('taskCount'))}${warnings ? ` · ${warnings} ${escapeHtml(t('warningCount'))}` : ''}</div>
      </div>
      <div class="history-row__actions">
        <button class="button button--secondary button--small" type="button" data-open>${escapeHtml(t('open'))}</button>
        <button class="icon-button" type="button" data-rename aria-label="${escapeAttribute(t('rename'))}">${icon('edit')}</button>
        <button class="icon-button" type="button" data-delete aria-label="${escapeAttribute(t('delete'))}">${icon('trash')}</button>
      </div>
    </article>`;
}

function render() {
  const allFiltered = filteredItems();
  const visible = allFiltered.slice(0, visibleCount);
  renderShell({
    title: t('navHistory'),
    currentPath: '/history',
    content: `
      <header class="page-header">
        <div class="page-header__copy"><h1 class="page-title">${escapeHtml(t('historyTitle'))}</h1><p class="page-subtitle">${escapeHtml(t('historySubtitle'))}</p></div>
        <div class="page-actions"><a class="button button--primary" href="/analyze" data-router>${icon('filePlus')} ${escapeHtml(t('addDocument'))}</a></div>
      </header>
      <div class="history-toolbar">
        <div class="field"><label class="field-label" for="history-search">${escapeHtml(t('search'))}</label><div style="position:relative"><span style="position:absolute;left:13px;top:14px;color:var(--text-tertiary)">${icon('search', { size: 19 })}</span><input id="history-search" class="input" style="padding-left:42px" value="${escapeAttribute(query)}" placeholder="${escapeAttribute(t('search'))}"></div></div>
        <div></div>
      </div>
      <div class="filters" role="group" aria-label="Фильтры">
        <button class="filter-chip" type="button" data-filter="all" aria-pressed="${filter === 'all'}">${escapeHtml(t('all'))}</button>
        <button class="filter-chip" type="button" data-filter="open-tasks" aria-pressed="${filter === 'open-tasks'}">${escapeHtml(t('withOpenTasks'))}</button>
        <button class="filter-chip" type="button" data-filter="warnings" aria-pressed="${filter === 'warnings'}">${escapeHtml(t('withWarnings'))}</button>
        <button class="filter-chip" type="button" data-filter="announcement" aria-pressed="${filter === 'announcement'}">${escapeHtml(t('announcement'))}</button>
        <button class="filter-chip" type="button" data-filter="work-order" aria-pressed="${filter === 'work-order'}">${escapeHtml(t('workOrder'))}</button>
      </div>
      <section class="section">
        ${visible.length ? `<div class="history-list">${visible.map(historyRow).join('')}</div>` : `<div class="card empty-state"><img class="empty-state__image theme-image--light" src="/public/assets/mascot-light.webp" alt=""><img class="empty-state__image theme-image--dark" src="/public/assets/mascot-dark.webp" alt=""><h3>${escapeHtml(t('noResults'))}</h3><p>${escapeHtml(t('noHistoryText'))}</p><a class="button button--primary" href="/analyze" data-router>${escapeHtml(t('addDocument'))}</a></div>`}
        ${allFiltered.length > visible.length ? `<div style="margin-top:16px;text-align:center"><button class="button button--secondary" type="button" data-load-more>${escapeHtml(t('loadMore'))}</button></div>` : ''}
      </section>`
  });
  bindEvents();
}

function openAnalysis(id) {
  const analysis = analyses.find((item) => item.id === id);
  if (!analysis) return;
  navigate(analysis.status === 'completed' ? `/result/${id}` : `/analyze/${id}`);
}

function renameAnalysis(id) {
  const analysis = analyses.find((item) => item.id === id);
  if (!analysis) return;
  const current = analysis.result?.title || analysis.title || t('document');
  openDialog({
    id: 'rename-dialog',
    title: t('rename'),
    body: `<div class="field"><label for="rename-input">${escapeHtml(t('taskName'))}</label><input id="rename-input" class="input" maxlength="120" value="${escapeAttribute(current)}"></div>`,
    footer: `<button class="button button--ghost" type="button" data-cancel>${escapeHtml(t('cancel'))}</button><button class="button button--primary" type="button" data-save>${escapeHtml(t('saveChanges'))}</button>`,
    onOpen(dialog) {
      dialog.querySelector('[data-cancel]').addEventListener('click', () => dialog.close('cancel'));
      dialog.querySelector('[data-save]').addEventListener('click', async () => {
        const value = dialog.querySelector('#rename-input').value.trim();
        if (!value) return;
        analysis.title = value;
        if (analysis.result) analysis.result.title = value;
        await saveAnalysis(analysis);
        dialog.close('saved');
        render();
      });
    }
  });
}

async function removeAnalysis(id) {
  const confirmed = await confirmDialog({ title: t('confirmDelete'), message: t('confirmDeleteText'), confirmLabel: t('delete'), cancelLabel: t('cancel'), danger: true });
  if (!confirmed) return;
  await deleteAnalysis(id);
  analyses = analyses.filter((item) => item.id !== id);
  render();
  showToast({ title: t('historyDeleted'), type: 'success' });
}

function bindEvents() {
  const input = document.querySelector('#history-search');
  input?.addEventListener('input', (event) => { query = event.target.value; visibleCount = 10; render(); document.querySelector('#history-search')?.focus(); });
  document.querySelectorAll('[data-filter]').forEach((button) => button.addEventListener('click', () => { filter = button.dataset.filter; visibleCount = 10; render(); }));
  document.querySelector('[data-load-more]')?.addEventListener('click', () => { visibleCount += 10; render(); });
  document.querySelectorAll('[data-analysis-id]').forEach((row) => {
    const id = row.dataset.analysisId;
    row.querySelector('[data-open]')?.addEventListener('click', () => openAnalysis(id));
    row.querySelector('[data-rename]')?.addEventListener('click', () => renameAnalysis(id));
    row.querySelector('[data-delete]')?.addEventListener('click', () => removeAnalysis(id));
  });
}

export async function historyPage() {
  analyses = await listAnalyses();
  query = '';
  filter = 'all';
  visibleCount = 10;
  render();
  return { title: t('historyTitle') };
}
