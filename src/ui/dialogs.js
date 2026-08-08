import { escapeAttribute, escapeHtml } from '../core/utils.js';
import { icon } from './icons.js';

function ensureDialog(id) {
  let dialog = document.getElementById(id);
  if (!dialog) {
    dialog = document.createElement('dialog');
    dialog.id = id;
    dialog.className = 'dialog';
    document.body.append(dialog);
  }
  return dialog;
}

export function openDialog({ id = 'app-dialog', title, body, footer = '', onOpen, onClose, closeLabel = 'Закрыть' }) {
  const dialog = ensureDialog(id);
  const titleId = `${id}-title`;
  dialog.setAttribute('aria-labelledby', titleId);
  dialog.innerHTML = `
    <div class="dialog__header">
      <h2 id="${escapeAttribute(titleId)}">${escapeHtml(title)}</h2>
      <button class="icon-button" type="button" aria-label="${escapeHtml(closeLabel)}" data-dialog-close>${icon('close')}</button>
    </div>
    <div class="dialog__body">${body}</div>
    ${footer ? `<div class="dialog__footer">${footer}</div>` : ''}
  `;
  const close = (value = '') => { dialog.close(value); };
  dialog.querySelector('[data-dialog-close]')?.addEventListener('click', () => close('cancel'));
  dialog.onclick = (event) => {
    if (event.target === dialog) close('backdrop');
  };
  const closeHandler = () => {
    onClose?.(dialog.returnValue, dialog);
    dialog.removeEventListener('close', closeHandler);
  };
  dialog.addEventListener('close', closeHandler);
  if (!dialog.open) dialog.showModal();
  onOpen?.(dialog, close);
  return { dialog, close };
}

export function confirmDialog({ title, message, confirmLabel, cancelLabel, danger = false }) {
  return new Promise((resolve) => {
    const { dialog } = openDialog({
      id: 'confirm-dialog',
      title,
      body: `<p>${escapeHtml(message)}</p>`,
      footer: `
        <button class="button button--ghost" type="button" data-cancel>${escapeHtml(cancelLabel)}</button>
        <button class="button ${danger ? 'button--danger' : 'button--primary'}" type="button" data-confirm>${escapeHtml(confirmLabel)}</button>
      `,
      onOpen(instance) {
        instance.querySelector('[data-cancel]')?.addEventListener('click', () => instance.close('cancel'));
        instance.querySelector('[data-confirm]')?.addEventListener('click', () => instance.close('confirm'));
      },
      onClose(value) { resolve(value === 'confirm'); }
    });
    dialog.querySelector('[data-confirm]')?.focus();
  });
}
