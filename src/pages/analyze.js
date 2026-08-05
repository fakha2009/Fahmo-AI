import { getSettings } from '../core/settings.js';
import { t } from '../core/i18n.js';
import { deleteDraft, getDraft, saveAnalysis, saveDraft } from '../core/repository.js';
import { navigate } from '../core/router.js';
import { clamp, debounce, escapeAttribute, escapeHtml, formatBytes, uid } from '../core/utils.js';
import { estimatePdfPageCount } from '../domain/document-reader.js';
import { MAX_PAGES, validateFile, validatePageLimit, validateText } from '../domain/validators.js';
import { openDialog } from '../ui/dialogs.js';
import { icon } from '../ui/icons.js';
import { renderShell } from '../ui/shell.js';
import { showToast } from '../ui/toast.js';

const ACTIVE_DRAFT_ID = 'active-draft';
const objectUrls = new Map();
let draft;
let activeMode = 'files';
let cleanupPaste;
let initialModeHandled = false;

function defaultDraft() {
  const appSettings = getSettings();
  return {
    id: ACTIVE_DRAFT_ID,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    sourceMode: 'files',
    sources: [],
    pages: [],
    text: '',
    settings: {
      resultLanguage: appSettings.resultLanguage ?? 'ru',
      explanationLevel: appSettings.explanationLevel ?? 'standard',
      documentType: 'auto',
      provider: appSettings.analysisMode === 'remote' ? 'remote' : 'local'
    }
  };
}

function sourceById(sourceId) { return draft.sources.find((source) => source.id === sourceId); }

function urlForSource(source) {
  if (!source?.blob) return '';
  if (!objectUrls.has(source.id)) objectUrls.set(source.id, URL.createObjectURL(source.blob));
  return objectUrls.get(source.id);
}

function revokeSourceUrl(sourceId) {
  const url = objectUrls.get(sourceId);
  if (url) URL.revokeObjectURL(url);
  objectUrls.delete(sourceId);
}

function releaseAllUrls() {
  for (const url of objectUrls.values()) URL.revokeObjectURL(url);
  objectUrls.clear();
}

async function persistDraft() {
  draft.updatedAt = new Date().toISOString();
  await saveDraft(draft);
  const status = document.querySelector('[data-draft-status]');
  if (status) status.textContent = t('draftSaved');
}

const debouncedPersist = debounce(() => persistDraft().catch(console.error), 400);

function normalizeDraft(value) {
  const base = defaultDraft();
  const normalized = { ...base, ...(value ?? {}), settings: { ...base.settings, ...(value?.settings ?? {}) } };
  normalized.sources = Array.isArray(normalized.sources) ? normalized.sources : [];
  normalized.pages = Array.isArray(normalized.pages) ? normalized.pages : [];
  if (normalized.pages.length && normalized.sources.length === 1) {
    normalized.pages = normalized.pages.map((page) => ({ ...page, sourceId: page.sourceId ?? normalized.sources[0].id }));
  }
  normalized.pages.sort((a, b) => a.order - b.order).forEach((page, index) => { page.order = index; });
  return normalized;
}

function pagePreview(page) {
  const source = sourceById(page.sourceId);
  if (page.kind === 'image' && source?.blob) {
    return `<img src="${escapeAttribute(urlForSource(source))}" alt="${escapeAttribute(page.name || source.name)}" style="--rotation:${page.rotation ?? 0}deg">`;
  }
  if (page.kind === 'pdf') return icon('pdf');
  return icon('text');
}

function pageItem(page, index) {
  const source = sourceById(page.sourceId);
  const meta = page.kind === 'pdf'
    ? `PDF · ${t('sourcePage')} ${page.sourcePage}`
    : page.kind === 'image'
      ? `${source?.mimeType?.replace('image/', '').toUpperCase() ?? 'IMAGE'} · ${formatBytes(source?.size ?? 0)}`
      : `${t('sourceText')} · ${(source?.text ?? draft.text ?? '').length} ${t('characters')}`;
  return `
    <article class="page-item" draggable="true" data-page-id="${escapeAttribute(page.id)}">
      <div class="page-item__preview">${pagePreview(page)}</div>
      <div class="page-item__body">
        <div class="page-item__name">${escapeHtml(page.name || source?.name || `${t('sourcePage')} ${index + 1}`)}</div>
        <div class="page-item__meta">${escapeHtml(meta)}</div>
      </div>
      <div class="page-item__actions">
        <span class="icon-button page-item__drag" aria-hidden="true">${icon('grip')}</span>
        <button class="icon-button" type="button" data-action="up" data-page="${escapeAttribute(page.id)}" aria-label="${escapeAttribute(t('moveUp'))}" ${index === 0 ? 'disabled' : ''}>${icon('chevronUp')}</button>
        <button class="icon-button" type="button" data-action="down" data-page="${escapeAttribute(page.id)}" aria-label="${escapeAttribute(t('moveDown'))}" ${index === draft.pages.length - 1 ? 'disabled' : ''}>${icon('chevronDown')}</button>
        <button class="icon-button" type="button" data-action="preview" data-page="${escapeAttribute(page.id)}" aria-label="${escapeAttribute(t('preview'))}">${icon('zoomIn')}</button>
        ${page.kind === 'image' ? `<button class="icon-button" type="button" data-action="rotate" data-page="${escapeAttribute(page.id)}" aria-label="${escapeAttribute(t('rotate'))}">${icon('rotate')}</button><button class="icon-button" type="button" data-action="crop" data-page="${escapeAttribute(page.id)}" aria-label="${escapeAttribute(t('crop'))}">${icon('crop')}</button><button class="icon-button" type="button" data-action="replace" data-page="${escapeAttribute(page.id)}" aria-label="${escapeAttribute(t('replace'))}">${icon('refresh')}</button>` : ''}
        <button class="icon-button" type="button" data-action="delete" data-page="${escapeAttribute(page.id)}" aria-label="${escapeAttribute(t('delete'))}">${icon('trash')}</button>
      </div>
    </article>`;
}

function settingsPanel() {
  const settings = draft.settings;
  return `
    <div class="settings-stack">
      <section class="card settings-card">
        <h3>${escapeHtml(t('resultLanguage'))}</h3>
        <div class="option-list">
          <label class="radio-option"><input type="radio" name="resultLanguage" value="ru" ${settings.resultLanguage === 'ru' ? 'checked' : ''}><span><strong>Русский</strong></span></label>
          <label class="radio-option"><input type="radio" name="resultLanguage" value="tg" ${settings.resultLanguage === 'tg' ? 'checked' : ''}><span><strong>Тоҷикӣ</strong></span></label>
          <label class="radio-option"><input type="radio" name="resultLanguage" value="en" ${settings.resultLanguage === 'en' ? 'checked' : ''}><span><strong>English</strong></span></label>
        </div>
      </section>
      <section class="card settings-card">
        <h3>${escapeHtml(t('explanationLevel'))}</h3>
        <div class="option-list">
          <label class="radio-option"><input type="radio" name="explanationLevel" value="standard" ${settings.explanationLevel === 'standard' ? 'checked' : ''}><span><strong>${escapeHtml(t('standard'))}</strong></span></label>
          <label class="radio-option"><input type="radio" name="explanationLevel" value="simple" ${settings.explanationLevel === 'simple' ? 'checked' : ''}><span><strong>${escapeHtml(t('verySimple'))}</strong><span>${escapeHtml(t('verySimpleDesc'))}</span></span></label>
        </div>
      </section>
      <section class="card settings-card">
        <h3>${escapeHtml(t('documentType'))}</h3>
        <div class="field">
          <select class="select" name="documentType" aria-label="${escapeAttribute(t('documentType'))}">
            <option value="auto" ${settings.documentType === 'auto' ? 'selected' : ''}>${escapeHtml(t('autoDetect'))}</option>
            <option value="announcement" ${settings.documentType === 'announcement' ? 'selected' : ''}>${escapeHtml(t('announcement'))}</option>
            <option value="work-order" ${settings.documentType === 'work-order' ? 'selected' : ''}>${escapeHtml(t('workOrder'))}</option>
            <option value="handwritten" ${settings.documentType === 'handwritten' ? 'selected' : ''}>${escapeHtml(t('handwritten'))}</option>
            <option value="other" ${settings.documentType === 'other' ? 'selected' : ''}>${escapeHtml(t('other'))}</option>
          </select>
        </div>
      </section>
      <section class="card settings-card">
        <h3>${escapeHtml(t('provider'))}</h3>
        <div class="option-list">
          <label class="radio-option"><input type="radio" name="provider" value="local" ${settings.provider === 'local' ? 'checked' : ''}><span><strong>${escapeHtml(t('localProvider'))}</strong><span>${escapeHtml(t('localProviderDesc'))}</span></span></label>
          <label class="radio-option"><input type="radio" name="provider" value="remote" ${settings.provider === 'remote' ? 'checked' : ''}><span><strong>${escapeHtml(t('remoteProvider'))}</strong><span>${escapeHtml(getSettings().apiBaseUrl || t('apiUrlHint'))}</span></span></label>
        </div>
      </section>
      <div class="analyze-submit">
        <button class="button button--primary button--wide" type="button" data-create-plan>${icon('sparkles')} ${escapeHtml(t('createPlan'))}</button>
      </div>
    </div>`;
}

function sourceContent() {
  if (activeMode === 'text') {
    return `
      <div class="text-source">
        <div class="field">
          <label for="document-text">${escapeHtml(t('pasteText'))}</label>
          <textarea id="document-text" class="textarea" maxlength="120000" placeholder="${escapeAttribute(t('textPlaceholder'))}">${escapeHtml(draft.text ?? '')}</textarea>
          <div class="field-hint"><span data-character-count>${(draft.text ?? '').length}</span> / 120000 ${escapeHtml(t('characters'))}</div>
        </div>
        <div><button class="button button--ghost button--small" type="button" data-clear-text>${icon('trash')} ${escapeHtml(t('clear'))}</button></div>
      </div>`;
  }
  return `
    <div class="dropzone" data-dropzone data-dragover="false">
      <div>
        <div class="dropzone__icon">${icon('upload')}</div>
        <h2>${escapeHtml(t('dropTitle'))}</h2>
        <p>${escapeHtml(t('dropText'))}</p>
        <div class="dropzone__actions">
          <button class="button button--primary" type="button" data-choose-file>${icon('upload')} ${escapeHtml(t('chooseFile'))}</button>
          <button class="button button--secondary" type="button" data-take-photo>${icon('camera')} ${escapeHtml(t('takePhoto'))}</button>
          <button class="button button--ghost" type="button" data-paste-hint>${icon('clipboard')} ${escapeHtml(t('pasteImage'))}</button>
        </div>
        <div class="dropzone__hint">${escapeHtml(t('uploadHint'))}</div>
      </div>
    </div>`;
}

function contentTemplate() {
  const hasContent = draft.pages.length > 0 || Boolean(draft.text?.trim());
  return `
    <header class="page-header">
      <div class="page-header__copy">
        <h1 class="page-title">${escapeHtml(t('analyzeTitle'))}</h1>
        <p class="page-subtitle">${escapeHtml(t('analyzeSubtitle'))}</p>
      </div>
      <span class="save-status" data-draft-status>${icon('save', { size: 16 })}${escapeHtml(t('draftSaved'))}</span>
    </header>
    <div class="stepper" aria-label="Этапы">
      <div class="stepper__item" data-state="complete"><span class="stepper__number">${icon('check', { size: 16 })}</span><span>${escapeHtml(t('stepAdd'))}</span></div>
      <div class="stepper__item" data-state="${hasContent ? 'active' : ''}"><span class="stepper__number">2</span><span>${escapeHtml(t('stepReview'))}</span></div>
      <div class="stepper__item" data-state="${hasContent ? 'active' : ''}"><span class="stepper__number">3</span><span>${escapeHtml(t('stepConfigure'))}</span></div>
    </div>
    <div class="analyze-layout">
      <div>
        <section class="card upload-card">
          <div class="source-tabs">
            <div class="segmented" role="group" aria-label="Источник">
              <button type="button" data-source-mode="files" aria-pressed="${activeMode === 'files'}">${escapeHtml(t('sourceFiles'))}</button>
              <button type="button" data-source-mode="text" aria-pressed="${activeMode === 'text'}">${escapeHtml(t('sourceText'))}</button>
            </div>
          </div>
          ${sourceContent()}
          <input type="file" hidden data-file-input accept="application/pdf,image/jpeg,image/png,image/webp,text/plain,.pdf,.jpg,.jpeg,.png,.webp,.txt" multiple>
          <input type="file" hidden data-camera-input accept="image/*" capture="environment">
          <input type="file" hidden data-replace-input accept="image/jpeg,image/png,image/webp">
        </section>
        ${draft.settings.provider === 'local' ? `<div class="alert alert--info" style="margin-top:14px">${icon('info')}<div><strong>${escapeHtml(t('localProvider'))}</strong><p>${escapeHtml(t('localAnalysisNotice'))}</p></div></div>` : ''}
        <section class="pages-panel">
          <div class="section-heading"><h2 class="section-title">${escapeHtml(t('pages'))} <span class="badge badge--neutral">${draft.pages.length}/${MAX_PAGES}</span></h2>${activeMode === 'files' ? `<button class="button button--secondary button--small" type="button" data-choose-file>${icon('plus')} ${escapeHtml(t('addPage'))}</button>` : ''}</div>
          ${draft.pages.length ? `<div class="pages-list">${draft.pages.map(pageItem).join('')}</div>` : `<div class="card empty-state"><h3>${escapeHtml(t('noPages'))}</h3><p>${escapeHtml(t('uploadHint'))}</p></div>`}
        </section>
      </div>
      <aside>${settingsPanel()}</aside>
    </div>`;
}

function render() {
  renderShell({ title: t('navAnalyze'), currentPath: '/analyze', content: contentTemplate() });
  bindEvents();
}

async function addFiles(fileList) {
  const files = [...fileList];
  for (const file of files) {
    const validation = validateFile(file);
    if (!validation.ok) {
      showToast({ title: t('errorTitle'), message: t(validation.messageKey), type: 'error' });
      continue;
    }
    const mimeType = validation.mime;
    let pageCount = 1;
    if (mimeType === 'application/pdf') pageCount = await estimatePdfPageCount(file);
    const limit = validatePageLimit(draft.pages.length, pageCount);
    if (!limit.ok) {
      showToast({ title: t('errorTitle'), message: t(limit.messageKey), type: 'error' });
      continue;
    }
    const sourceId = uid('source');
    const source = { id: sourceId, kind: mimeType.startsWith('image/') ? 'image' : mimeType === 'application/pdf' ? 'pdf' : 'text', mimeType, name: file.name, size: file.size, blob: file };
    if (mimeType === 'text/plain') {
      source.text = await file.text();
      draft.text = [draft.text, source.text].filter(Boolean).join('\n\n');
    }
    draft.sources.push(source);
    for (let pageIndex = 0; pageIndex < pageCount; pageIndex += 1) {
      draft.pages.push({
        id: uid('page'), sourceId, kind: source.kind, order: draft.pages.length, sourcePage: pageIndex + 1,
        rotation: 0, included: true, name: pageCount > 1 ? `${file.name} · ${t('sourcePage')} ${pageIndex + 1}` : file.name
      });
    }
  }
  await persistDraft();
  render();
}

function updateText(value) {
  draft.text = value;
  let source = draft.sources.find((item) => item.kind === 'text' && item.id === 'inline-text');
  if (!source) {
    source = { id: 'inline-text', kind: 'text', mimeType: 'text/plain', name: t('sourceText'), size: 0, text: value };
    draft.sources.push(source);
  }
  source.text = value;
  source.size = new Blob([value]).size;
  if (!draft.pages.some((page) => page.sourceId === source.id)) {
    draft.pages.push({ id: uid('page'), sourceId: source.id, kind: 'text', order: draft.pages.length, sourcePage: 1, rotation: 0, included: true, name: t('sourceText') });
  }
  if (!value.trim()) {
    draft.pages = draft.pages.filter((page) => page.sourceId !== source.id);
    draft.sources = draft.sources.filter((item) => item.id !== source.id);
  }
  debouncedPersist();
}

function reorderPage(pageId, direction) {
  const index = draft.pages.findIndex((page) => page.id === pageId);
  const target = index + direction;
  if (index < 0 || target < 0 || target >= draft.pages.length) return;
  [draft.pages[index], draft.pages[target]] = [draft.pages[target], draft.pages[index]];
  draft.pages.forEach((page, pageIndex) => { page.order = pageIndex; });
  persistDraft().then(render);
}

function deletePage(pageId) {
  const page = draft.pages.find((item) => item.id === pageId);
  if (!page) return;
  draft.pages = draft.pages.filter((item) => item.id !== pageId);
  draft.pages.forEach((item, index) => { item.order = index; });
  if (!draft.pages.some((item) => item.sourceId === page.sourceId)) {
    revokeSourceUrl(page.sourceId);
    draft.sources = draft.sources.filter((source) => source.id !== page.sourceId);
  }
  persistDraft().then(render);
}

function rotatePage(pageId) {
  const page = draft.pages.find((item) => item.id === pageId);
  if (!page) return;
  page.rotation = ((page.rotation ?? 0) + 90) % 360;
  persistDraft().then(render);
}

function previewPage(pageId) {
  const page = draft.pages.find((item) => item.id === pageId);
  const source = sourceById(page?.sourceId);
  if (!page || !source) return;
  let media = '';
  if (page.kind === 'image') media = `<img src="${escapeAttribute(urlForSource(source))}" alt="${escapeAttribute(page.name)}" style="transform:rotate(${page.rotation ?? 0}deg)">`;
  else if (page.kind === 'pdf') media = `<iframe title="${escapeAttribute(page.name)}" src="${escapeAttribute(urlForSource(source))}#page=${page.sourcePage}"></iframe>`;
  else media = `<pre style="white-space:pre-wrap;padding:20px;margin:0">${escapeHtml(source.text ?? draft.text)}</pre>`;
  openDialog({ title: page.name, body: `<div class="source-preview__media">${media}</div>` });
}

function openCrop(pageId) {
  const page = draft.pages.find((item) => item.id === pageId);
  const source = sourceById(page?.sourceId);
  if (!page || !source?.blob || page.kind !== 'image') return;
  const imageUrl = urlForSource(source);
  openDialog({
    id: 'crop-dialog',
    title: t('cropTitle'),
    body: `<p class="field-hint">${escapeHtml(t('cropHint'))}</p><div class="crop-stage" data-crop-stage><img src="${escapeAttribute(imageUrl)}" alt=""><div class="crop-box" data-crop-box><span class="crop-handle" data-crop-handle></span></div></div>`,
    footer: `<button class="button button--ghost" type="button" data-crop-cancel>${escapeHtml(t('cancel'))}</button><button class="button button--primary" type="button" data-crop-apply>${escapeHtml(t('apply'))}</button>`,
    onOpen(dialog) {
      const stage = dialog.querySelector('[data-crop-stage]');
      const image = stage.querySelector('img');
      const box = stage.querySelector('[data-crop-box]');
      let state = { x: 40, y: 40, width: 200, height: 200 };
      const applyState = () => Object.assign(box.style, { left: `${state.x}px`, top: `${state.y}px`, width: `${state.width}px`, height: `${state.height}px` });
      const initialize = () => {
        const stageRect = stage.getBoundingClientRect();
        const imageRect = image.getBoundingClientRect();
        state = {
          x: imageRect.left - stageRect.left + imageRect.width * 0.08,
          y: imageRect.top - stageRect.top + imageRect.height * 0.08,
          width: imageRect.width * 0.84,
          height: imageRect.height * 0.84
        };
        applyState();
      };
      if (image.complete) requestAnimationFrame(initialize); else image.addEventListener('load', initialize, { once: true });

      let interaction = null;
      const begin = (event, mode) => {
        event.preventDefault();
        box.setPointerCapture(event.pointerId);
        interaction = { mode, startX: event.clientX, startY: event.clientY, initial: { ...state }, pointerId: event.pointerId };
      };
      box.addEventListener('pointerdown', (event) => {
        if (event.target.matches('[data-crop-handle]')) begin(event, 'resize');
        else begin(event, 'move');
      });
      box.addEventListener('pointermove', (event) => {
        if (!interaction || event.pointerId !== interaction.pointerId) return;
        const dx = event.clientX - interaction.startX;
        const dy = event.clientY - interaction.startY;
        const stageRect = stage.getBoundingClientRect();
        const imageRect = image.getBoundingClientRect();
        const minX = imageRect.left - stageRect.left;
        const minY = imageRect.top - stageRect.top;
        const maxX = minX + imageRect.width;
        const maxY = minY + imageRect.height;
        if (interaction.mode === 'move') {
          state.x = clamp(interaction.initial.x + dx, minX, maxX - state.width);
          state.y = clamp(interaction.initial.y + dy, minY, maxY - state.height);
        } else {
          state.width = clamp(interaction.initial.width + dx, 48, maxX - state.x);
          state.height = clamp(interaction.initial.height + dy, 48, maxY - state.y);
        }
        applyState();
      });
      box.addEventListener('pointerup', () => { interaction = null; });
      box.addEventListener('pointercancel', () => { interaction = null; });
      dialog.querySelector('[data-crop-cancel]').addEventListener('click', () => dialog.close('cancel'));
      dialog.querySelector('[data-crop-apply]').addEventListener('click', async () => {
        const stageRect = stage.getBoundingClientRect();
        const imageRect = image.getBoundingClientRect();
        const sx = (state.x - (imageRect.left - stageRect.left)) / imageRect.width * image.naturalWidth;
        const sy = (state.y - (imageRect.top - stageRect.top)) / imageRect.height * image.naturalHeight;
        const sw = state.width / imageRect.width * image.naturalWidth;
        const sh = state.height / imageRect.height * image.naturalHeight;
        const canvas = document.createElement('canvas');
        canvas.width = Math.max(1, Math.round(sw));
        canvas.height = Math.max(1, Math.round(sh));
        canvas.getContext('2d').drawImage(image, sx, sy, sw, sh, 0, 0, canvas.width, canvas.height);
        const blob = await new Promise((resolve) => canvas.toBlob(resolve, source.mimeType === 'image/jpeg' ? 'image/jpeg' : 'image/png', 0.94));
        if (blob) {
          revokeSourceUrl(source.id);
          source.blob = blob;
          source.size = blob.size;
          source.mimeType = blob.type;
          page.rotation = 0;
          await persistDraft();
          dialog.close('applied');
          render();
        }
      });
    }
  });
}

function replacePage(pageId) {
  const input = document.querySelector('[data-replace-input]');
  input.dataset.pageId = pageId;
  input.value = '';
  input.click();
}

async function handleReplace(file) {
  const pageId = document.querySelector('[data-replace-input]')?.dataset.pageId;
  const page = draft.pages.find((item) => item.id === pageId);
  const source = sourceById(page?.sourceId);
  if (!page || !source || !file) return;
  const validation = validateFile(file);
  if (!validation.ok || !validation.mime.startsWith('image/')) {
    showToast({ title: t('errorTitle'), message: t('invalidFormat'), type: 'error' });
    return;
  }
  revokeSourceUrl(source.id);
  source.blob = file;
  source.name = file.name;
  source.size = file.size;
  source.mimeType = validation.mime;
  page.name = file.name;
  page.rotation = 0;
  await persistDraft();
  render();
}

function bindDragReorder() {
  let draggingId = null;
  document.querySelectorAll('.page-item[draggable="true"]').forEach((item) => {
    item.addEventListener('dragstart', (event) => {
      draggingId = item.dataset.pageId;
      item.dataset.dragging = 'true';
      event.dataTransfer.effectAllowed = 'move';
      event.dataTransfer.setData('text/plain', draggingId);
    });
    item.addEventListener('dragend', () => { delete item.dataset.dragging; draggingId = null; });
    item.addEventListener('dragover', (event) => { event.preventDefault(); event.dataTransfer.dropEffect = 'move'; });
    item.addEventListener('drop', (event) => {
      event.preventDefault();
      const targetId = item.dataset.pageId;
      const sourceId = draggingId || event.dataTransfer.getData('text/plain');
      if (!sourceId || sourceId === targetId) return;
      const from = draft.pages.findIndex((page) => page.id === sourceId);
      const to = draft.pages.findIndex((page) => page.id === targetId);
      const [moved] = draft.pages.splice(from, 1);
      draft.pages.splice(to, 0, moved);
      draft.pages.forEach((page, index) => { page.order = index; });
      persistDraft().then(render);
    });
  });
}

async function createPlan() {
  const hasText = Boolean(draft.text?.trim()) || draft.sources.some((source) => source.text?.trim());
  if (!draft.pages.length && !hasText) {
    showToast({ title: t('errorTitle'), message: t('emptyText'), type: 'error' });
    return;
  }
  const hasNonTextSource = draft.pages.some((page) => page.kind !== 'text')
    || draft.sources.some((source) => source.kind !== 'text' && source.mimeType !== 'text/plain');
  if (draft.settings.provider === 'local' && activeMode === 'text' && !hasNonTextSource) {
    const validation = validateText(draft.text);
    if (!validation.ok) {
      showToast({ title: t('errorTitle'), message: validation.message ?? t(validation.messageKey), type: 'error' });
      return;
    }
  }
  const appSettings = getSettings();
  if (draft.settings.provider === 'remote' && !appSettings.apiBaseUrl) {
    showToast({ title: t('errorTitle'), message: t('remoteUnavailable'), type: 'error' });
    return;
  }
  const button = document.querySelector('[data-create-plan]');
  if (button) button.disabled = true;
  const id = uid('analysis');
  const analysis = {
    id,
    title: draft.sources[0]?.name || t('document'),
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    status: 'queued',
    progress: 0,
    progressStep: 'read',
    idempotencyKey: uid('idem'),
    settings: structuredClone(draft.settings),
    sources: draft.sources.map((source) => ({ ...source })),
    pages: draft.pages.map((page) => ({ ...page })),
    demo: Boolean(draft.demo)
  };
  await saveAnalysis(analysis);
  await deleteDraft(ACTIVE_DRAFT_ID);
  navigate(`/analyze/${id}`);
}

function bindEvents() {
  document.querySelectorAll('[data-source-mode]').forEach((button) => button.addEventListener('click', () => {
    activeMode = button.dataset.sourceMode;
    draft.sourceMode = activeMode;
    persistDraft().then(render);
  }));
  document.querySelectorAll('[data-choose-file]').forEach((button) => button.addEventListener('click', () => document.querySelector('[data-file-input]')?.click()));
  document.querySelector('[data-take-photo]')?.addEventListener('click', () => document.querySelector('[data-camera-input]')?.click());
  document.querySelector('[data-file-input]')?.addEventListener('change', (event) => addFiles(event.target.files));
  document.querySelector('[data-camera-input]')?.addEventListener('change', (event) => addFiles(event.target.files));
  document.querySelector('[data-replace-input]')?.addEventListener('change', (event) => handleReplace(event.target.files?.[0]));
  document.querySelector('[data-paste-hint]')?.addEventListener('click', () => {
    showToast({ title: t('pasteImage'), message: 'Нажмите Ctrl+V или Cmd+V, пока открыта эта страница.', type: 'info' });
  });
  const dropzone = document.querySelector('[data-dropzone]');
  if (dropzone) {
    for (const eventName of ['dragenter', 'dragover']) dropzone.addEventListener(eventName, (event) => { event.preventDefault(); dropzone.dataset.dragover = 'true'; });
    for (const eventName of ['dragleave', 'drop']) dropzone.addEventListener(eventName, (event) => { event.preventDefault(); dropzone.dataset.dragover = 'false'; });
    dropzone.addEventListener('drop', (event) => addFiles(event.dataTransfer.files));
  }
  const textarea = document.querySelector('#document-text');
  textarea?.addEventListener('input', (event) => {
    updateText(event.target.value);
    const counter = document.querySelector('[data-character-count]');
    if (counter) counter.textContent = String(event.target.value.length);
  });
  document.querySelector('[data-clear-text]')?.addEventListener('click', () => {
    updateText('');
    render();
  });
  document.querySelectorAll('[name="resultLanguage"], [name="explanationLevel"], [name="provider"]').forEach((input) => input.addEventListener('change', () => {
    draft.settings[input.name] = input.value;
    persistDraft().then(() => input.name === 'provider' ? render() : undefined);
  }));
  document.querySelector('[name="documentType"]')?.addEventListener('change', (event) => { draft.settings.documentType = event.target.value; persistDraft(); });
  document.querySelector('[data-create-plan]')?.addEventListener('click', createPlan);
  document.querySelectorAll('[data-action]').forEach((button) => button.addEventListener('click', () => {
    const pageId = button.dataset.page;
    ({ up: () => reorderPage(pageId, -1), down: () => reorderPage(pageId, 1), delete: () => deletePage(pageId), rotate: () => rotatePage(pageId), crop: () => openCrop(pageId), preview: () => previewPage(pageId), replace: () => replacePage(pageId) })[button.dataset.action]?.();
  }));
  bindDragReorder();
}

function bindPaste() {
  const handler = (event) => {
    const files = [...(event.clipboardData?.items ?? [])]
      .filter((item) => item.kind === 'file' && item.type.startsWith('image/'))
      .map((item) => item.getAsFile())
      .filter(Boolean);
    if (files.length) {
      event.preventDefault();
      activeMode = 'files';
      addFiles(files);
    }
  };
  document.addEventListener('paste', handler);
  cleanupPaste = () => document.removeEventListener('paste', handler);
}

function handleInitialMode(search) {
  if (initialModeHandled) return;
  initialModeHandled = true;
  const mode = search.get('mode');
  if (mode === 'text') {
    activeMode = 'text';
    render();
    setTimeout(() => document.querySelector('#document-text')?.focus(), 0);
  } else if (mode === 'camera') {
    activeMode = 'files';
    render();
    setTimeout(() => document.querySelector('[data-camera-input]')?.click(), 80);
  } else if (mode === 'files') {
    activeMode = 'files';
    render();
    setTimeout(() => document.querySelector('[data-file-input]')?.click(), 80);
  } else if (mode === 'paste') {
    activeMode = 'files';
    render();
    showToast({ title: t('pasteImage'), message: 'Нажмите Ctrl+V или Cmd+V.', type: 'info' });
  }
}

export async function analyzePage({ search }) {
  draft = normalizeDraft(await getDraft(ACTIVE_DRAFT_ID));
  activeMode = search.get('mode') === 'text' ? 'text' : draft.sourceMode || 'files';
  render();
  bindPaste();
  handleInitialMode(search);
  return {
    title: t('navAnalyze'),
    cleanup() {
      cleanupPaste?.();
      cleanupPaste = null;
      releaseAllUrls();
      initialModeHandled = false;
    }
  };
}
