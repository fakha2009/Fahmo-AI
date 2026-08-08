import { t } from '../core/i18n.js';
import { escapeHtml } from '../core/utils.js';
import { icon } from './icons.js';

function navItem(path, label, iconName, currentPath) {
  const active = path === '/' ? currentPath === '/' : currentPath.startsWith(path);
  return `<a class="nav-link" href="${path}" data-router ${active ? 'aria-current="page"' : ''}>${icon(iconName)}<span>${escapeHtml(label)}</span></a>`;
}

function mobileNavItem(path, label, iconName, currentPath) {
  const active = path === '/' ? currentPath === '/' : currentPath.startsWith(path);
  return `<a class="mobile-nav__link" href="${path}" data-router ${active ? 'aria-current="page"' : ''}>${icon(iconName)}<span>${escapeHtml(label)}</span></a>`;
}

export function renderShell({ title = '', content = '', actions = '', currentPath = location.pathname, wide = false }) {
  const app = document.getElementById('app');
  app.innerHTML = `
    <div class="app-shell">
      <aside class="sidebar" aria-label="Основная навигация">
        <a class="brand" href="/" data-router aria-label="${escapeHtml(t('appName'))}">
          <img class="brand__mark theme-image--light" src="/public/assets/mascot-light.webp" alt="">
          <img class="brand__mark theme-image--dark" src="/public/assets/mascot-dark.webp" alt="">
          <span>${escapeHtml(t('appName'))}</span>
        </a>
        <nav class="nav-list">
          ${navItem('/', t('navHome'), 'home', currentPath)}
          ${navItem('/analyze', t('navAnalyze'), 'filePlus', currentPath)}
          ${navItem('/history', t('navHistory'), 'history', currentPath)}
          ${navItem('/settings', t('navSettings'), 'settings', currentPath)}
        </nav>
        <div class="sidebar__footer">${escapeHtml(t('tagline'))}</div>
      </aside>
      <main class="app-main">
        <header class="topbar">
          <div class="topbar__title">${escapeHtml(title || t('appName'))}</div>
          <div class="topbar__actions">
            ${actions}
          </div>
        </header>
        <div id="main-content" tabindex="-1" class="page-container ${wide ? 'page-container--wide' : ''}">${content}</div>
      </main>
      <nav class="mobile-nav" aria-label="Мобильная навигация">
        ${mobileNavItem('/', t('navHome'), 'home', currentPath)}
        ${mobileNavItem('/history', t('navHistory'), 'history', currentPath)}
        ${mobileNavItem('/settings', t('navSettings'), 'settings', currentPath)}
      </nav>
    </div>
  `;
  document.getElementById('main-content')?.focus({ preventScroll: true });
}
