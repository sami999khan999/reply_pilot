/**
 * fab.js — Floating Action Button
 *
 * @param {ShadowRoot} shadow
 * @param {{ onClick: () => void }} opts
 * @returns {{ fab: HTMLElement, setVisible: (v: boolean) => void }}
 */
export function createFAB(shadow, { onClick }) {
  const fab = document.createElement('button');
  fab.id = 'rp-fab';
  fab.setAttribute('aria-label', 'Open Reply Pilot');
  fab.setAttribute('title', 'Reply Pilot – AI reply assistant');

  fab.innerHTML = `
    <span class="rp-fab-pulse"></span>
    <svg viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
      <!-- Stylised paper plane / send icon -->
      <path d="M22 2L11 13M22 2L15 22l-4-9-9-4 20-7z"/>
    </svg>
  `;

  fab.addEventListener('click', onClick);

  shadow.appendChild(fab);

  return {
    fab,
    setVisible(visible) {
      if (visible) {
        fab.classList.remove('hidden');
      } else {
        fab.classList.add('hidden');
      }
    },
  };
}
