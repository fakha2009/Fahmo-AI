import { t, getLanguage } from '../core/i18n.js';
import { saveDraft, listAnalyses } from '../core/repository.js';
import { navigate } from '../core/router.js';
import { escapeHtml, formatDate, uid } from '../core/utils.js';
import { icon } from '../ui/icons.js';
import { renderShell } from '../ui/shell.js';

const SAMPLE_TEXT = `Объявление о регистрации на студенческое мероприятие

Регистрация участников открыта до 10 августа 2026 года.
Необходимо заполнить регистрационную форму, предоставить копию паспорта и оплатить организационный взнос 150 сомони.
Мероприятие состоится 18 августа 2026 года с 09:00 до 18:00.
Место: Freedom IT Hub, Душанбе.
По вопросам обращайтесь по телефону +992 900 00 00 00.`;

function typeLabel(type) {
  return ({ announcement: t('announcement'), 'work-order': t('workOrder'), handwritten: t('handwritten'), other: t('other') })[type] ?? t('document');
}

function statusLabel(status) {
  return ({ draft: t('statusDraft'), processing: t('statusProcessing'), completed: t('statusCompleted'), failed: t('statusFailed'), cancelled: t('statusCancelled') })[status] ?? status;
}

function recentCard(analysis) {
  const tasks = analysis.result?.tasks?.length ?? 0;
  const warnings = analysis.result?.warnings?.length ?? 0;
  return `
    <a class="card history-card" href="${analysis.status === 'completed' ? `/result/${analysis.id}` : `/analyze/${analysis.id}`}" data-router>
      <div class="history-card__top">
        <div class="history-card__file">${icon('file')}</div>
        <span class="badge ${analysis.status === 'completed' ? 'badge--success' : 'badge--neutral'}">${escapeHtml(statusLabel(analysis.status))}</span>
      </div>
      <h3>${escapeHtml(analysis.result?.title || analysis.title || t('document'))}</h3>
      <p>${escapeHtml(typeLabel(analysis.result?.documentType || analysis.settings?.documentType))} · ${escapeHtml(formatDate(analysis.updatedAt || analysis.createdAt, getLanguage()))}</p>
      <div class="history-card__meta">
        <span class="badge badge--primary">${tasks} ${escapeHtml(t('taskCount'))}</span>
        ${warnings ? `<span class="badge badge--warning">${warnings} ${escapeHtml(t('warningCount'))}</span>` : ''}
      </div>
    </a>`;
}

function emptyHistory() {
  return `
    <div class="card empty-state">
      <img class="empty-state__image theme-image--light" src="/public/assets/mascot-light.webp" alt="">
      <img class="empty-state__image theme-image--dark" src="/public/assets/mascot-dark.webp" alt="">
      <h3>${escapeHtml(t('noHistoryTitle'))}</h3>
      <p>${escapeHtml(t('noHistoryText'))}</p>
      <button class="button button--secondary" type="button" data-example>${icon('sparkles')} ${escapeHtml(t('tryExample'))}</button>
    </div>`;
}

async function createExample() {
  const sourceId = uid('source');
  await saveDraft({
    id: 'active-draft',
    createdAt: new Date().toISOString(),
    sourceMode: 'text',
    sources: [{ id: sourceId, kind: 'text', mimeType: 'text/plain', name: t('sampleName'), text: SAMPLE_TEXT, size: new Blob([SAMPLE_TEXT]).size }],
    pages: [{ id: uid('page'), sourceId, kind: 'text', order: 0, sourcePage: 1, rotation: 0, included: true, name: t('sampleName') }],
    text: SAMPLE_TEXT,
    settings: { resultLanguage: 'ru', explanationLevel: 'standard', documentType: 'announcement', provider: 'local' },
    demo: true
  });
  navigate('/analyze?mode=text');
}

export async function homePage() {
  const analyses = (await listAnalyses()).slice(0, 3);
  renderShell({
    title: t('navHome'),
    currentPath: '/',
    content: `
      <section class="hero" aria-labelledby="home-title">
        <div class="hero__content">
          <div class="hero__eyebrow">
            <img class="theme-image--light" src="/public/assets/mascot-light.webp" alt="">
            <img class="theme-image--dark" src="/public/assets/mascot-dark.webp" alt="">
            <span>${escapeHtml(t('appName'))}</span>
          </div>
          <h1 id="home-title">${escapeHtml(t('tagline'))}</h1>
          <p>${escapeHtml(t('heroDescription'))}</p>
          <div class="hero__actions">
            <button class="button button--primary" type="button" data-add>${icon('filePlus')} ${escapeHtml(t('addDocument'))}</button>
            <button class="button button--secondary" type="button" data-example>${icon('sparkles')} ${escapeHtml(t('tryExample'))}</button>
          </div>
          <div class="hero__formats">${escapeHtml(t('supported'))}</div>
        </div>
        <div class="hero__visual" aria-hidden="true">
          <img class="theme-image--light" src="/public/assets/hero-documents-light.webp" alt="">
          <img class="theme-image--dark" src="/public/assets/hero-documents-dark.webp" alt="">
        </div>
      </section>
      <section class="value-flow" aria-label="${escapeHtml(t('tagline'))}">
        <div class="value-step"><div class="value-step__icon">${icon('file')}</div><strong>${escapeHtml(t('flowShort'))}</strong><span>${escapeHtml(t('flowShortDesc'))}</span></div>
        <div class="value-step"><div class="value-step__icon">${icon('list')}</div><strong>${escapeHtml(t('flowTasks'))}</strong><span>${escapeHtml(t('flowTasksDesc'))}</span></div>
        <div class="value-step"><div class="value-step__icon">${icon('calendar')}</div><strong>${escapeHtml(t('flowData'))}</strong><span>${escapeHtml(t('flowDataDesc'))}</span></div>
        <div class="value-step"><div class="value-step__icon">${icon('search')}</div><strong>${escapeHtml(t('flowSource'))}</strong><span>${escapeHtml(t('flowSourceDesc'))}</span></div>
      </section>
      <section class="section">
        <div class="section-heading">
          <h2 class="section-title">${escapeHtml(t('recent'))}</h2>
          ${analyses.length ? `<a class="section-link" href="/history" data-router>${escapeHtml(t('viewAll'))}</a>` : ''}
        </div>
        ${analyses.length ? `<div class="recent-grid">${analyses.map(recentCard).join('')}</div>` : emptyHistory()}
      </section>`
  });

  document.querySelectorAll('[data-add]').forEach((button) => button.addEventListener('click', () => navigate('/analyze')));
  document.querySelectorAll('[data-example]').forEach((button) => button.addEventListener('click', createExample));
  return { title: t('navHome') };
}
