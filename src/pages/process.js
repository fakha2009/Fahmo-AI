import { createRemoteAnalysis, getRemoteAnalysis, cancelRemoteAnalysis } from '../core/api.js';
import { t } from '../core/i18n.js';
import { getAnalysis, saveAnalysis } from '../core/repository.js';
import { navigate } from '../core/router.js';
import { getSettings } from '../core/settings.js';
import { escapeHtml, wait } from '../core/utils.js';
import { analyzeTextDocument } from '../domain/analyzer.js';
import { collectDocumentText } from '../domain/document-reader.js';
import { icon } from '../ui/icons.js';
import { renderShell } from '../ui/shell.js';

let controller;
let activeAnalysisId;
let cancellingAnalysisId;

const stageOrder = ['read', 'find', 'verify', 'tasks'];
const stageLabels = { read: 'processRead', find: 'processFind', verify: 'processVerify', tasks: 'processTasks' };
const warningTranslations = {
  UNCLEAR_TEXT: 'warningUnclearText',
  AMBIGUOUS_DATE: 'warningAmbiguousDate',
  AMBIGUOUS_AMOUNT: 'warningAmbiguousAmount',
  CONFLICTING_INFORMATION: 'warningConflictingInfo',
  MISSING_INFORMATION: 'warningMissingInfo',
  LOW_CONFIDENCE: 'warningLowConfidence',
  UNSUPPORTED_CONTENT: 'warningUnsupportedContent',
};

function isMessageKey(value) {
  return typeof value === 'string' && /^errors(?:\.|$)/u.test(value.trim());
}

export function normalizeSourceReference(value) {
  if (typeof value === 'string') {
    const page = value.match(/^p\.(\d+)$/u)?.[1];
    return page ? { sourceId: null, clientPageId: null, sourceAssetId: null, inputIndex: Number(page) - 1, page: Number(page), excerpt: '', boundingBox: null } : null;
  }
  if (!value || typeof value !== 'object') return null;
  const sourceId = value.sourceId || value.clientPageId || null;
  const sourceAssetId = value.sourceAssetId || value.assetId || null;
  const inputIndexValue = Number(value.inputIndex ?? Math.max(0, Number(value.pageNumber ?? value.page ?? 1) - 1));
  const inputIndex = Number.isInteger(inputIndexValue) && inputIndexValue >= 0 ? inputIndexValue : 0;
  const pageValue = Number(value.pageNumber ?? value.page ?? 1);
  const page = Number.isInteger(pageValue) && pageValue > 0 ? pageValue : 1;
  const excerpt = typeof value.excerpt === 'string' ? value.excerpt.trim() : '';
  const box = value.boundingBox ?? value.coordinates;
  const boundingBox = box && typeof box === 'object'
    && ['x', 'y', 'width', 'height'].every((key) => Number.isFinite(Number(box[key])))
    ? {
        x: Math.max(0, Math.min(1, Number(box.x))),
        y: Math.max(0, Math.min(1, Number(box.y))),
        width: Math.max(0, Math.min(1, Number(box.width))),
        height: Math.max(0, Math.min(1, Number(box.height))),
      }
    : null;
  if (!sourceId && !sourceAssetId && !excerpt) return null;
  return { sourceId, clientPageId: value.clientPageId || sourceId, sourceAssetId, inputIndex, page, excerpt, boundingBox };
}

export function normalizeRemoteWarning(item, index) {
  const warning = item && typeof item === 'object' ? item : {};
  const translation = warningTranslations[String(warning.code ?? '').toUpperCase()] ?? 'warningNeedsReview';
  const title = warning.title && !isMessageKey(warning.title) ? warning.title : t(`${translation}Title`);
  const message = warning.message && !isMessageKey(warning.message) ? warning.message : t(`${translation}Message`);
  return {
    ...warning,
    id: warning.id || `remote_warning_${index}`,
    title,
    message,
    severity: warning.severity || 'warning',
    source: normalizeSourceReference(warning.source ?? warning.sourceRefs?.[0]),
  };
}

function processView(analysis) {
  const activeIndex = stageOrder.indexOf(analysis.progressStep ?? 'read');
  const progress = Math.max(0, Math.min(100, analysis.progress ?? 0));
  const failed = analysis.status === 'failed';
  const completed = analysis.status === 'completed' || analysis.status === 'needs_clarification';
  const cancelled = analysis.status === 'cancelled';
  const cancelling = cancellingAnalysisId === analysis.id;
  return {
    activeIndex,
    progress,
    failed,
    completed,
    cancelled,
    cancelling,
    title: failed ? t('errorTitle') : cancelled ? t('statusCancelled') : completed ? t('statusCompleted') : t('processTitle'),
    subtitle: failed ? (analysis.error?.message || t('genericError')) : cancelled ? t('statusCancelled') : completed ? t('saved') : t('processSubtitle'),
    actionState: `${analysis.status}:${cancelling}`,
  };
}

function processStepState(view, index) {
  if (view.completed || index < view.activeIndex) return 'complete';
  if (index === view.activeIndex && !view.failed && !view.cancelled) return 'active';
  return '';
}

function processActions(analysis, view) {
  return `
    ${view.completed ? `<button class="button button--primary" type="button" data-open-result>${icon('arrowRight')} ${escapeHtml(t('openResult'))}</button>` : ''}
    ${view.failed ? `<button class="button button--primary" type="button" data-retry>${icon('refresh')} ${escapeHtml(t('retry'))}</button>` : ''}
    ${!view.completed && !view.failed && !view.cancelled ? `<button class="button button--ghost" type="button" data-cancel-analysis ${view.cancelling ? 'disabled aria-busy="true"' : ''}>${escapeHtml(t(view.cancelling ? 'cancelling' : 'cancel'))}</button>` : ''}
    <a class="button button--secondary" href="/" data-router>${escapeHtml(t('backHome'))}</a>`;
}

function bindProcessActions(analysis, root = document) {
  root.querySelector('[data-open-result]')?.addEventListener('click', () => navigate(`/result/${analysis.id}`));
  root.querySelector('[data-retry]')?.addEventListener('click', () => retryAnalysis(analysis));
  root.querySelector('[data-cancel-analysis]')?.addEventListener('click', () => cancelAnalysis(analysis));
}

function updateProcessView(analysis) {
  const root = document.querySelector('[data-process-root]');
  if (!root || root.dataset.analysisId !== analysis.id) return false;
  const view = processView(analysis);
  root.querySelector('.process-mascot-wrap')?.setAttribute('data-active', String(!view.completed && !view.failed && !view.cancelled));
  const title = root.querySelector('[data-process-title]');
  const subtitle = root.querySelector('[data-process-subtitle]');
  const track = root.querySelector('[data-process-track]');
  const bar = root.querySelector('[data-process-bar]');
  const value = root.querySelector('[data-process-value]');
  if (title) title.textContent = view.title;
  if (subtitle) subtitle.textContent = view.subtitle;
  track?.setAttribute('aria-label', `${view.progress}%`);
  bar?.style.setProperty('--progress', `${view.progress}%`);
  if (value) value.textContent = `${view.progress}%`;
  root.querySelectorAll('[data-process-step]').forEach((step, index) => {
    const state = processStepState(view, index);
    if (step.dataset.state === state) return;
    step.dataset.state = state;
    const marker = step.querySelector('.progress-step__state');
    if (marker) marker.innerHTML = state === 'complete' ? icon('check', { size: 16 }) : String(index + 1);
  });
  const request = root.querySelector('[data-process-request]');
  if (request) {
    request.hidden = !analysis.error?.requestId;
    request.textContent = analysis.error?.requestId ? `Request ID: ${analysis.error.requestId}` : '';
  }
  const actions = root.querySelector('[data-process-actions]');
  if (actions && actions.dataset.state !== view.actionState) {
    actions.dataset.state = view.actionState;
    actions.innerHTML = processActions(analysis, view);
    bindProcessActions(analysis, actions);
  }
  return true;
}

function renderProcess(analysis, options = {}) {
  if (updateProcessView(analysis)) {
    options.onRendered?.();
    return;
  }
  const view = processView(analysis);
  renderShell({
    title: t('processTitle'),
    currentPath: `/analyze/${analysis.id}`,
    content: `
      <div class="process-shell" data-process-root data-analysis-id="${escapeHtml(analysis.id)}">
        <section class="card process-card">
          <div class="process-mascot-wrap" data-active="${!view.completed && !view.failed && !view.cancelled}" aria-hidden="true">
            <picture>
              <source srcset="/public/assets/mascot-analyzing.webp" type="image/webp">
              <img class="process-mascot process-mascot--gif" src="/public/assets/mascot-analyzing.gif" alt="">
            </picture>
            <img class="process-mascot process-mascot--still" src="/public/assets/icon-192-v2.png" alt="">
          </div>
          <h1 data-process-title>${escapeHtml(view.title)}</h1>
          <p data-process-subtitle>${escapeHtml(view.subtitle)}</p>
          <div class="progress-track" data-process-track aria-label="${view.progress}%"><div class="progress-bar" data-process-bar style="--progress:${view.progress}%"></div></div>
          <div class="progress-value" data-process-value>${view.progress}%</div>
          <div class="progress-steps">
            ${stageOrder.map((stage, index) => {
              const state = processStepState(view, index);
              return `<div class="progress-step" data-process-step data-state="${state}"><span class="progress-step__state">${state === 'complete' ? icon('check', { size: 16 }) : index + 1}</span><span>${escapeHtml(t(stageLabels[stage]))}</span></div>`;
            }).join('')}
          </div>
          <p class="field-hint" data-process-request ${analysis.error?.requestId ? '' : 'hidden'}>${analysis.error?.requestId ? `Request ID: ${escapeHtml(analysis.error.requestId)}` : ''}</p>
          <div class="process-actions" data-process-actions data-state="${view.actionState}">${processActions(analysis, view)}</div>
        </section>
      </div>`
  });
  bindProcessActions(analysis, document.querySelector('[data-process-root]') ?? document);
  options.onRendered?.();
}

async function updateProgress(analysis, patch) {
  Object.assign(analysis, patch, { updatedAt: new Date().toISOString() });
  await saveAnalysis(analysis);
  if (activeAnalysisId === analysis.id) renderProcess(analysis);
}

export function normalizeRemoteResult(payload, analysis) {
  const result = payload.result ?? payload.data?.result ?? payload;
  if (!result || typeof result !== 'object') throw new Error('Backend returned an invalid analysis result');
  return {
    analysisId: analysis.id,
    title: result.title || analysis.title || t('resultTitleFallback'),
    documentType: result.documentType || analysis.settings.documentType || 'other',
    resultLanguage: result.resultLanguage || analysis.settings.resultLanguage || 'ru',
    createdAt: result.createdAt || new Date().toISOString(),
    summary: typeof result.summary === 'string' ? { standard: result.summary, simple: result.simpleSummary || result.summary } : (result.summary || { standard: '', simple: '' }),
    tasks: Array.isArray(result.tasks) ? result.tasks.map((task, index) => ({ id: task.id || `remote_task_${index}`, title: task.title || task.name || '', simpleTitle: task.simpleTitle || task.simple_title || task.title || task.name || '', description: task.description || '', completed: Boolean(task.completed), priority: task.priority || 'medium', dueDate: task.dueDate || task.due_date || null, dueTime: task.dueTime || task.due_time || null, location: task.location || null, reminderMinutes: task.reminderMinutes ?? task.reminder_minutes ?? null, source: normalizeSourceReference(task.source ?? task.sourceRefs?.[0]), userEdited: Boolean(task.userEdited), revision: Number.isInteger(task.revision) ? task.revision : 1 })) : [],
    importantData: Array.isArray(result.importantData) ? result.importantData.map((item, index) => ({ id: item.id || `remote_data_${index}`, type: item.type || 'other', value: item.value == null ? '' : String(item.value), confidence: item.confidence || 'medium', source: normalizeSourceReference(item.source ?? item.sourceRefs?.[0]), userEdited: Boolean(item.userEdited) })) : [],
    clarifications: Array.isArray(result.clarifications) ? result.clarifications.map((item, index) => ({ id: item.id || `remote_clarification_${index}`, ...item })) : [],
    warnings: Array.isArray(result.warnings) ? result.warnings.map(normalizeRemoteWarning) : [],
    sourceText: result.sourceText || '',
    pageTexts: Array.isArray(result.pageTexts) ? result.pageTexts : [],
    provider: 'remote',
    userCorrections: Array.isArray(result.userCorrections) ? result.userCorrections : []
  };
}

async function runLocal(analysis, signal) {
  await updateProgress(analysis, { status: 'processing', progressStep: 'read', progress: 8, error: null });
  const pageTexts = await collectDocumentText(analysis, ({ current, total }) => {
    analysis.progress = 8 + Math.round((current / Math.max(total, 1)) * 26);
    analysis.progressStep = 'read';
    if (activeAnalysisId === analysis.id) renderProcess(analysis);
  }, signal);
  await saveAnalysis(analysis);
  if (signal.aborted) throw new DOMException('Aborted', 'AbortError');
  await updateProgress(analysis, { progressStep: 'find', progress: 45 });
  await wait(120, signal);
  const preliminary = analyzeTextDocument({ pageTexts, settings: analysis.settings, analysisId: analysis.id });
  await updateProgress(analysis, { progressStep: 'verify', progress: 68 });
  await wait(120, signal);
  await updateProgress(analysis, { progressStep: 'tasks', progress: 86 });
  await wait(120, signal);
  analysis.result = preliminary;
  analysis.title = preliminary.title;
  await updateProgress(analysis, { status: 'completed', progressStep: 'tasks', progress: 100, completedAt: new Date().toISOString() });
}

async function runRemote(analysis, signal) {
  const settings = getSettings();
  const baseUrl = settings.apiBaseUrl;
  if (!baseUrl) throw Object.assign(new Error(t('remoteUnavailable')), { code: 'NOT_CONFIGURED' });
  await updateProgress(analysis, { status: 'processing', progressStep: 'read', progress: 5, error: null });
  let remoteId = analysis.remoteId;
  if (!remoteId) {
    const created = await createRemoteAnalysis({ baseUrl, analysis, signal });
    remoteId = created.id || created.analysisId;
    if (!remoteId) throw new Error('Backend did not return analysis id');
    analysis.remoteId = remoteId;
    await saveAnalysis(analysis);
  }
  let attempts = 0;
  while (!signal.aborted) {
    const payload = await getRemoteAnalysis(baseUrl, remoteId, signal);
    const status = payload.status ?? payload.data?.status;
    const progress = Number(payload.progress ?? payload.data?.progress ?? Math.min(92, 12 + attempts * 4));
    const stage = payload.stage ?? payload.data?.stage ?? (progress < 35 ? 'read' : progress < 60 ? 'find' : progress < 80 ? 'verify' : 'tasks');
    if (status === 'completed' || status === 'succeeded') {
      analysis.result = normalizeRemoteResult(payload, analysis);
      analysis.title = analysis.result.title;
      await updateProgress(analysis, { status: 'completed', progressStep: 'tasks', progress: 100, completedAt: new Date().toISOString() });
      return;
    }
    if (status === 'needs_clarification') {
      analysis.result = normalizeRemoteResult(payload, analysis);
      analysis.title = analysis.result.title;
      await updateProgress(analysis, { status: 'needs_clarification', progressStep: 'verify', progress: Math.max(70, progress) });
      return;
    }
    if (status === 'failed' || status === 'cancelled') {
      const knownMessage = ({
        'errors.unsupportedFileType': 'invalidFormat',
        'errors.fileTooLarge': 'fileTooLarge',
        'errors.tooManyPages': 'tooManyPages',
      })[payload.messageKey];
      throw Object.assign(new Error(payload.message || payload.error?.message || t(knownMessage || 'genericError')), {
        code: payload.error?.code || payload.messageKey || status.toUpperCase(),
        requestId: payload.requestId,
      });
    }
    await updateProgress(analysis, { status: 'processing', progressStep: stageOrder.includes(stage) ? stage : 'read', progress: Math.max(5, Math.min(95, progress)) });
    attempts += 1;
    await wait(Math.min(5000, 1200 + attempts * 250), signal);
  }
}

async function runAnalysis(analysis) {
  if (activeAnalysisId === analysis.id && controller && !controller.signal.aborted) return;
  activeAnalysisId = analysis.id;
  controller = new AbortController();
  try {
    if (analysis.settings?.provider === 'remote') await runRemote(analysis, controller.signal);
    else await runLocal(analysis, controller.signal);
    if (activeAnalysisId === analysis.id) {
      renderProcess(analysis);
      setTimeout(() => {
        if (location.pathname === `/analyze/${analysis.id}`) navigate(`/result/${analysis.id}`, { replace: true });
      }, 450);
    }
  } catch (error) {
    if (error?.name === 'AbortError') return;
    analysis.status = 'failed';
    analysis.error = { message: error?.message || t('genericError'), code: error?.code || 'PROCESSING_ERROR', requestId: error?.requestId || null };
    analysis.progress = Math.max(analysis.progress ?? 0, 5);
    await saveAnalysis(analysis);
    if (activeAnalysisId === analysis.id) renderProcess(analysis);
  }
}

async function applyCancellationStatus(analysis, payload) {
  const status = payload?.status ?? payload?.data?.status;
  if (status === 'completed' || status === 'succeeded') {
    analysis.result = normalizeRemoteResult(payload, analysis);
    analysis.title = analysis.result.title;
    await updateProgress(analysis, { status: 'completed', progressStep: 'tasks', progress: 100, completedAt: new Date().toISOString() });
    return true;
  }
  if (status === 'needs_clarification') {
    analysis.result = normalizeRemoteResult(payload, analysis);
    analysis.title = analysis.result.title;
    await updateProgress(analysis, { status: 'needs_clarification', progressStep: 'verify', progress: Math.max(70, Number(payload.progress) || 70) });
    return true;
  }
  if (status === 'cancelled') {
    analysis.status = 'cancelled';
    analysis.progress = Number(payload.progress) || analysis.progress || 0;
    await saveAnalysis(analysis);
    return true;
  }
  return false;
}

async function cancelAnalysis(analysis) {
  if (cancellingAnalysisId === analysis.id) return;
  cancellingAnalysisId = analysis.id;
  renderProcess(analysis);

  try {
    let payload = null;
    if (analysis.settings?.provider === 'remote' && analysis.remoteId) {
      const baseUrl = getSettings().apiBaseUrl;
      try {
        payload = await cancelRemoteAnalysis(baseUrl, analysis.remoteId, analysis.idempotencyKey);
      } catch {
        try {
          payload = await getRemoteAnalysis(baseUrl, analysis.remoteId);
        } catch { /* cancellation remains local if the backend is unreachable */ }
      }
    }

    controller?.abort();
    if (await applyCancellationStatus(analysis, payload)) return;

    analysis.status = 'cancelled';
    analysis.progress = analysis.progress ?? 0;
    await saveAnalysis(analysis);
  } finally {
    if (cancellingAnalysisId === analysis.id) cancellingAnalysisId = null;
    if (activeAnalysisId === analysis.id) renderProcess(analysis);
  }
}

async function retryAnalysis(analysis) {
  analysis.status = 'queued';
  analysis.progress = 0;
  analysis.progressStep = 'read';
  analysis.error = null;
  if (analysis.settings?.provider === 'local') analysis.result = null;
  await saveAnalysis(analysis);
  renderProcess(analysis);
  runAnalysis(analysis);
}

export async function processPage({ params }) {
  const analysis = await getAnalysis(params.analysisId);
  if (!analysis) {
    renderShell({ title: t('errorTitle'), currentPath: location.pathname, content: `<div class="card empty-state"><h1>${escapeHtml(t('errorTitle'))}</h1><p>${escapeHtml(t('genericError'))}</p><a class="button button--primary" href="/" data-router>${escapeHtml(t('backHome'))}</a></div>` });
    return { title: t('errorTitle') };
  }
  renderProcess(analysis);
  if (analysis.status === 'completed' || analysis.status === 'needs_clarification') return { title: t('statusCompleted') };
  if (!['failed', 'cancelled'].includes(analysis.status)) runAnalysis(analysis);
  return {
    title: t('processTitle'),
    cleanup() {
      if (activeAnalysisId === analysis.id) {
        controller?.abort();
        controller = null;
        activeAnalysisId = null;
      }
    }
  };
}
