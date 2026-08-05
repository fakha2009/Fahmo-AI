import { getShare } from '../core/repository.js';
import { t } from '../core/i18n.js';
import { escapeHtml } from '../core/utils.js';
import { icon } from '../ui/icons.js';
import { renderShell } from '../ui/shell.js';

function taskRows(tasks = []) {
  if (!tasks.length) return `<div class="empty-state"><h3>${escapeHtml(t('noTasks'))}</h3></div>`;
  return `<div class="task-list">${tasks.map((task) => `<div class="task-item" data-completed="${Boolean(task.completed)}"><span class="task-check" aria-hidden="true">${task.completed ? icon('check', { size: 16 }) : ''}</span><div><h3 class="task-item__title">${escapeHtml(task.title)}</h3>${task.dueDate ? `<div class="task-item__meta"><span class="badge badge--neutral">${escapeHtml(task.dueDate)}</span></div>` : ''}</div></div>`).join('')}</div>`;
}

export async function offlinePage() {
  renderShell({
    title: t('offlineTitle'),
    currentPath: '/offline',
    content: `<div class="process-shell"><section class="card process-card"><div class="dropzone__icon" style="margin-inline:auto">${icon('wifiOff')}</div><h1>${escapeHtml(t('offlineTitle'))}</h1><p>${escapeHtml(t('offlineText'))}</p><div class="process-actions"><a class="button button--primary" href="/analyze" data-router>${escapeHtml(t('addDocument'))}</a><a class="button button--secondary" href="/history" data-router>${escapeHtml(t('navHistory'))}</a></div></section></div>`
  });
  return { title: t('offlineTitle') };
}

export async function installPage() {
  renderShell({
    title: t('installTitle'),
    currentPath: '/install',
    content: `<header class="page-header"><div class="page-header__copy"><h1 class="page-title">${escapeHtml(t('installTitle'))}</h1><p class="page-subtitle">${escapeHtml(t('installSubtitle'))}</p></div></header>
      <div class="card install-card">
        <h2>Android · Windows · macOS</h2>
        <ol class="install-steps"><li>${escapeHtml(t('installAndroid1'))}</li><li>${escapeHtml(t('installAndroid2'))}</li><li>${escapeHtml(t('installAndroid3'))}</li></ol>
        <h2 style="margin-top:30px">iPhone · iPad</h2>
        <ol class="install-steps"><li>${escapeHtml(t('installIos1'))}</li><li>${escapeHtml(t('installIos2'))}</li><li>${escapeHtml(t('installIos3'))}</li></ol>
        <div style="margin-top:24px"><a class="button button--primary" href="/settings" data-router>${escapeHtml(t('navSettings'))}</a></div>
      </div>`
  });
  return { title: t('installTitle') };
}

export async function sharedPage({ params }) {
  const share = await getShare(params.shareId);
  if (!share?.result) return notFoundPage();
  const result = share.result;
  renderShell({
    title: t('sharedTitle'),
    currentPath: location.pathname,
    content: `<header class="page-header"><div class="page-header__copy"><h1 class="page-title">${escapeHtml(result.title || t('sharedTitle'))}</h1><p class="page-subtitle">${escapeHtml(t('sharedTitle'))}</p></div></header>
      ${share.localOnly ? `<div class="alert alert--warning" style="margin-bottom:16px">${icon('alert')}<div><strong>${escapeHtml(t('sharedLocalWarning'))}</strong></div></div>` : ''}
      <div class="result-grid">
        <div class="result-main">
          <section class="card card--padded"><h2 class="card__title">${escapeHtml(t('summary'))}</h2><div class="result-summary" style="margin-top:14px">${escapeHtml(result.summary?.standard || result.summary?.simple || '—').replaceAll('\n', '<br>')}</div></section>
          <section class="card card--padded"><h2 class="card__title">${escapeHtml(t('tasks'))}</h2><div style="margin-top:14px">${taskRows(result.tasks)}</div></section>
          ${result.warnings?.length ? `<section class="card card--padded"><h2 class="card__title">${escapeHtml(t('warnings'))}</h2><div class="settings-stack" style="margin-top:14px">${result.warnings.map((warning) => `<div class="alert alert--warning">${icon('alert')}<div><strong>${escapeHtml(warning.title)}</strong><p>${escapeHtml(warning.message)}</p></div></div>`).join('')}</div></section>` : ''}
        </div>
        <aside class="result-aside"><section class="card card--padded"><a class="button button--primary button--wide" href="/" data-router>${escapeHtml(t('appName'))}</a></section></aside>
      </div>`
  });
  return { title: result.title || t('sharedTitle') };
}

export async function notFoundPage() {
  renderShell({
    title: '404',
    currentPath: location.pathname,
    content: `<div class="process-shell"><section class="card process-card"><div class="dropzone__icon" style="margin-inline:auto">${icon('search')}</div><h1>404</h1><p>${escapeHtml(t('noResults'))}</p><div class="process-actions"><a class="button button--primary" href="/" data-router>${escapeHtml(t('backHome'))}</a></div></section></div>`
  });
  return { title: '404' };
}
