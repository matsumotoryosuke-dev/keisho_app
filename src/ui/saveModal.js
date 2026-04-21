/**
 * Save Modal — "Name this project" dialog.
 * Mounts/unmounts itself in document.body.
 * Usage:
 *   openSaveModal({ defaultName, onSave(name, duplicate), onCancel })
 */

export function openSaveModal({ defaultName = '', onSave, onCancel, showDuplicate = false }) {
  // Backdrop
  const backdrop = document.createElement('div');
  backdrop.className = 'save-modal-backdrop';

  const modal = document.createElement('div');
  modal.className = 'save-modal';

  modal.innerHTML = `
    <div class="save-modal-header">
      <span class="save-modal-title">Save project</span>
      <button class="save-modal-close" aria-label="Close">×</button>
    </div>
    <div class="save-modal-body">
      <label class="save-modal-label" for="save-modal-input">Project name</label>
      <input
        id="save-modal-input"
        class="save-modal-input"
        type="text"
        placeholder="My Cool Effect"
        maxlength="80"
        autocomplete="off"
        spellcheck="false"
      />
    </div>
    <div class="save-modal-footer">
      ${showDuplicate ? '<button class="save-modal-btn save-modal-btn--secondary" id="save-modal-dup">Duplicate as new</button>' : '<span></span>'}
      <div class="save-modal-actions">
        <button class="save-modal-btn save-modal-btn--ghost" id="save-modal-cancel">Cancel</button>
        <button class="save-modal-btn save-modal-btn--primary" id="save-modal-confirm">Save</button>
      </div>
    </div>
  `;

  backdrop.appendChild(modal);
  document.body.appendChild(backdrop);

  const input = modal.querySelector('#save-modal-input');
  input.value = defaultName; // set value via property — no HTML parsing, no XSS
  input.focus();
  input.select();

  function close() {
    backdrop.remove();
  }

  function doSave(isDuplicate = false) {
    const name = input.value.trim() || 'Untitled';
    try {
      if (typeof onSave === 'function') onSave(name, isDuplicate);
    } catch (err) {
      // Show error inline rather than swallowing — don't close on error
      console.error('[saveModal] onSave threw:', err);
      const existing = modal.querySelector('.save-modal-error');
      const errEl = existing || document.createElement('p');
      errEl.className = 'save-modal-error';
      errEl.style.color = '#ff4444';
      errEl.textContent = err.message || 'Failed to save.';
      if (!existing) modal.appendChild(errEl);
      return;
    }
    close();
  }

  modal.querySelector('.save-modal-close').addEventListener('click', () => { close(); onCancel?.(); });
  modal.querySelector('#save-modal-cancel').addEventListener('click', () => { close(); onCancel?.(); });
  modal.querySelector('#save-modal-confirm').addEventListener('click', () => doSave(false));

  if (showDuplicate) {
    modal.querySelector('#save-modal-dup').addEventListener('click', () => doSave(true));
  }

  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') doSave(false);
    if (e.key === 'Escape') { close(); onCancel?.(); }
  });

  backdrop.addEventListener('click', (e) => {
    if (e.target === backdrop) { close(); onCancel?.(); }
  });
}
