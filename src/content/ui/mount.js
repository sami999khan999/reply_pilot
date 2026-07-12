import { PANEL_CSS } from './panel.css.js';

/**
 * Creates the Shadow DOM host element and attaches a shadow root with styles.
 * Returns references to the shadow root and the host element.
 *
 * @returns {{ shadow: ShadowRoot, host: HTMLElement }}
 */
export function mountShadowHost() {
  const host = document.createElement('div');
  host.id = 'reply-pilot-host';
  // Make the host itself invisible to layout
  host.style.cssText = 'all: initial; position: fixed; z-index: 2147483646; top: 0; left: 0;';
  document.body.appendChild(host);

  const shadow = host.attachShadow({ mode: 'open' });

  // Inject styles into the shadow root
  const styleEl = document.createElement('style');
  styleEl.textContent = PANEL_CSS;
  shadow.appendChild(styleEl);

  return { shadow, host };
}
