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

function renderProcess(analysis, options = {}) {
  const activeIndex = stageOrder.indexOf(analysis.progressStep ?? 'read');
  const progress = Math.max(0, Math.min(100, analysis.progress ?? 0));
  const failed = analysis.status === 'failed';
  const completed = analysis.status === 'completed' || analysis.status === 'needs_clarification';
  const cancelled = analysis.status === 'cancelled';
  renderShell({
    title: t('processTitle'),
    currentPath: `/analyze/${analysis.id}`,
    content: `
      <div class="process-shell">
        <section class="card process-card">
          <img class="process-mascot theme-image--light" src="/public/assets/mascot-light.webp" alt="">
          <img class="process-mascot theme-image--dark" src="/public/assets/mascot-dark.webp" alt="">
          <h1>${escapeHtml(failed ? t('errorTitle') : cancelled ? t('statusCancelled') : completed ? t('statusCompleted') : t('processTitle'))}</h1>
          <p>${escapeHtml(failed ? (analysis.error?.message || t('genericError')) : cancelled ? t('statusCancelled') : completed ? t('saved') : t('processSubtitle'))}</p>
          <div class="progress-track" aria-label="${progress}%"><div class="progress-bar" style="--progress:${progress}%"></div></div>
          <div class="progress-value">${progress}%</div>
          <div class="progress-steps">
            ${stageOrder.map((stage, index) => {
              const state = completed || index < activeIndex ? 'complete' : index === activeIndex && !failed && !cancelled ? 'active' : '';
              return `<div class="progress-step" data-state="${state}"><span class="progress-step__state">${state === 'complete' ? icon('check', { size: 16 }) : index + 1}</span><span>${escapeHtml(t(stageLabels[stage]))}</span></div>`;
            }).join('')}
          </div>
          ${analysis.error?.requestId ? `<p class="field-hint">Request ID: ${escapeHtml(analysis.error.requestId)}</p>` : ''}
          <div class="process-actions">
            ${completed ? `<button class="button button--primary" type="button" data-open-result>${icon('arrowRight')} ${escapeHtml(t('openResult'))}</button>` : ''}
            ${failed ? `<button class="button button--primary" type="button" data-retry>${icon('refresh')} ${escapeHtml(t('retry'))}</button>` : ''}
            ${!completed && !failed && !cancelled ? `<button class="button button--ghost" type="button" data-cancel-analysis>${escapeHtml(t('cancel'))}</button>` : ''}
            <a class="button button--secondary" href="/" data-router>${escapeHtml(t('backHome'))}</a>
          </div>
        </section>
      </div>`
  });
  document.querySelector('[data-open-result]')?.addEventListener('click', () => navigate(`/result/${analysis.id}`));
  document.querySelector('[data-retry]')?.addEventListener('click', () => retryAnalysis(analysis));
  document.querySelector('[data-cancel-analysis]')?.addEventListener('click', () => cancelAnalysis(analysis));
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

async function cancelAnalysis(analysis) {
  controller?.abort();
  if (analysis.settings?.provider === 'remote' && analysis.remoteId) {
    try {
      await cancelRemoteAnalysis(getSettings().apiBaseUrl, analysis.remoteId, analysis.idempotencyKey);
    } catch { /* cancellation remains local if backend is unreachable */ }
  }
  analysis.status = 'cancelled';
  analysis.progress = analysis.progress ?? 0;
  await saveAnalysis(analysis);
  renderProcess(analysis);
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
