import { escapeHtml } from '../core/utils.js';
import { icon } from './icons.js';

export function showToast({ title, message = '', type = 'info', duration = 4200, action = null }) {
  const region = document.getElementById('toast-region');
  if (!region) return;
  const toast = document.createElement('div');
  toast.className = 'toast';
  toast.setAttribute('role', type === 'error' ? 'alert' : 'status');
  const iconName = ({ success: 'success', warning: 'alert', error: 'alert', info: 'info' })[type] ?? 'info';
  toast.innerHTML = `
    ${icon(iconName)}
    <div class="toast__body">
      <strong>${escapeHtml(title)}</strong>
      ${message ? `<p>${escapeHtml(message)}</p>` : ''}
      ${action ? `<button class="button button--ghost button--small" type="button" data-toast-action>${escapeHtml(action.label)}</button>` : ''}
    </div>
    <button type="button" aria-label="Закрыть" data-toast-close>${icon('close', { size: 18 })}</button>
  `;
  const close = () => toast.remove();
  toast.querySelector('[data-toast-close]')?.addEventListener('click', close);
  if (action) toast.querySelector('[data-toast-action]')?.addEventListener('click', () => { action.onClick?.(); close(); });
  region.append(toast);
  if (duration > 0) setTimeout(close, duration);
  return close;
}
