/**
 * lifecycle.js — the extension's only recurring timer.
 *
 * This replaces two things that ran unconditionally for the lifetime of the tab:
 *
 *   1. `new MutationObserver(...).observe(document.body, { childList: true, subtree: true })`,
 *      which fired for every DOM mutation the host app made — typing indicators,
 *      presence dots, message ticks, virtualized rows, thousands per second — in
 *      order to do nothing but compare `location.href`.
 *   2. A separate 2s `setInterval` that re-queried the DOM to decide whether to
 *      show the FAB, and kept running in background tabs.
 *
 * One ticker now covers both. It reports only on *change*, and it stops entirely
 * while the tab is hidden, so a backgrounded chat tab costs nothing at all.
 */

const TICK_MS = 1500;

/**
 * @param {{
 *   isChatOpen: () => boolean,
 *   onChatStateChange: (open: boolean) => void,
 *   onNavigate: () => void,
 *   onVisibilityChange?: (visible: boolean) => void,
 * }} handlers
 */
export function createLifecycle({ isChatOpen, onChatStateChange, onNavigate, onVisibilityChange }) {
  /** @type {number|null} */
  let timer = null;
  let lastUrl = location.href;
  /** @type {boolean|null} */
  let lastOpen = null;

  function tick() {
    // SPA navigation: a string compare, versus a body-wide MutationObserver.
    if (location.href !== lastUrl) {
      lastUrl = location.href;
      lastOpen = null; // re-report chat state for the new route
      onNavigate();
    }

    let open = false;
    try {
      open = isChatOpen();
    } catch {
      open = false; // host DOM mid-render — treat as closed, retry next tick
    }

    if (open !== lastOpen) {
      lastOpen = open;
      onChatStateChange(open);
    }
  }

  function start() {
    if (timer !== null) return;
    tick();
    timer = setInterval(tick, TICK_MS);
  }

  function stop() {
    if (timer === null) return;
    clearInterval(timer);
    timer = null;
  }

  function syncToVisibility() {
    const visible = document.visibilityState === 'visible';
    if (visible) start(); else stop();
    onVisibilityChange?.(visible);
  }

  document.addEventListener('visibilitychange', syncToVisibility);
  // Back/forward within the SPA — react immediately instead of waiting a tick.
  window.addEventListener('popstate', tick);
  window.addEventListener('pageshow', syncToVisibility);

  syncToVisibility();

  return {
    start,
    stop,
    tick,
    isVisible: () => document.visibilityState === 'visible',
    destroy() {
      stop();
      document.removeEventListener('visibilitychange', syncToVisibility);
      window.removeEventListener('popstate', tick);
      window.removeEventListener('pageshow', syncToVisibility);
    },
  };
}
