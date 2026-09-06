import { PANEL_CSS } from './panel.css.js';

/**
 * Creates the Shadow DOM host and attaches the stylesheet.
 *
 * Only the host and its styles are created here. The panel itself — a
 * 384px x 100dvh element with a layered gradient background — is built lazily on
 * first open (see `index.js`). Previously it was appended at page load and merely
 * translated off-screen, so it took part in style, layout and paint on every page
 * view whether or not the user ever opened it.
 *
 * @returns {{ shadow: ShadowRoot, host: HTMLElement }}
 */
export function mountShadowHost() {
  const host = document.createElement('div');
  host.id = 'reply-pilot-host';
  // The host must not affect the page: zero-size, out of flow, no paint of its own.
  host.style.cssText = 'all: initial; position: fixed; z-index: 2147483646; top: 0; left: 0; width: 0; height: 0;';
  document.body.appendChild(host);

  const shadow = host.attachShadow({ mode: 'open' });
  adoptStyles(shadow);

  return { shadow, host };
}

/**
 * Prefers a constructable stylesheet — parsed once and shared — over a `<style>`
 * element, falling back where the page's environment does not support it.
 * @param {ShadowRoot} shadow
 */
function adoptStyles(shadow) {
  try {
    const sheet = new CSSStyleSheet();
    sheet.replaceSync(PANEL_CSS);
    shadow.adoptedStyleSheets = [sheet];
    return;
  } catch {
    // Fall through to the <style> path.
  }

  const styleEl = document.createElement('style');
  styleEl.textContent = PANEL_CSS;
  shadow.appendChild(styleEl);
}
