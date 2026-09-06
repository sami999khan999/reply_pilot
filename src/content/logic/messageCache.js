/**
 * messageCache.js — passive, per-chat message accumulation.
 *
 * Both host apps virtualize their message lists: only a window of rows is in the
 * DOM, and there is no supported API for history that has scrolled out of it.
 * The previous approach forced that history back by driving `scrollTop` to 0 up
 * to fifteen times per generate, which made the app tear down and rebuild
 * thousands of nodes and yanked the user's viewport around.
 *
 * So we stop asking for history and start noticing it. A scoped observer on the
 * message list banks rows as the app renders them naturally — on open, on scroll,
 * on receive — into a per-chat buffer. Over a session that buffer holds far more
 * than any single scrape asks for, and Generate never has to scroll.
 *
 * Everything here is arranged so the observer callback is O(1): it sets a flag
 * and schedules an idle harvest. No work happens on the app's critical path.
 */

/** How long to wait for quiet before harvesting, once something has changed. */
const HARVEST_DELAY_MS = 250;

/** Upper bound on an idle callback's wait, so a busy page still gets harvested. */
const HARVEST_TIMEOUT_MS = 2000;

const requestIdle = typeof requestIdleCallback === 'function'
  ? requestIdleCallback
  : (fn) => setTimeout(fn, HARVEST_DELAY_MS);

const cancelIdle = typeof cancelIdleCallback === 'function'
  ? cancelIdleCallback
  : clearTimeout;

/**
 * @param {{
 *   adapter: import('../adapters/base.js').BaseAdapter,
 *   capacity: number,
 * }} deps
 */
export function createMessageCache({ adapter, capacity }) {
  /** @type {MutationObserver|null} */
  let observer = null;
  /** @type {Element|null} */
  let observed = null;
  /** @type {string|null} */
  let signature = null;
  /** @type {Map<string, import('../adapters/base.js').Message>} */
  const store = new Map();

  let idleHandle = null;
  let timerHandle = null;
  let paused = false;

  /**
   * Only platforms with a real per-message timestamp can have separate scrapes
   * merged into one timeline. Where ordering is positional (Messenger), the
   * cache degrades to a straight read of what is on screen.
   */
  const mergeable = adapter.hasStableTimestamps === true;

  // ── Harvesting ─────────────────────────────────────────────────────────────

  /** Drops everything when the open chat changes underneath us. */
  function syncSignature() {
    const current = adapter.chatSignature();
    if (current === signature) return;
    signature = current;
    store.clear();
  }

  function absorb(messages) {
    for (let i = 0; i < messages.length; i++) {
      const msg = messages[i];
      // Re-inserting would not refresh insertion order, and the row is
      // immutable anyway, so first sighting wins.
      if (!store.has(msg.id)) store.set(msg.id, msg);
    }
    if (store.size <= capacity) return;

    // Over capacity: keep the newest, since that is what a scrape asks for.
    const kept = [...store.values()].sort(byTimestamp).slice(-capacity);
    store.clear();
    for (let i = 0; i < kept.length; i++) store.set(kept[i].id, kept[i]);
  }

  function harvest() {
    idleHandle = null;
    if (paused || !mergeable) return;

    try {
      syncSignature();
      absorb(adapter.scrapeSync(capacity));
    } catch {
      // The host DOM was mid-render. The next mutation reschedules us.
    }
  }

  /** Coalesces any number of mutations into one idle harvest. */
  function schedule() {
    if (idleHandle !== null || timerHandle !== null) return;
    timerHandle = setTimeout(() => {
      timerHandle = null;
      idleHandle = requestIdle(harvest, { timeout: HARVEST_TIMEOUT_MS });
    }, HARVEST_DELAY_MS);
  }

  // ── Observation ────────────────────────────────────────────────────────────

  /**
   * Attaches to the message list. Scoped to that container rather than
   * document.body, and with a callback that does nothing but set a flag.
   */
  function start() {
    if (!mergeable) return;

    const list = adapter.getMessageList();
    if (!list) return;
    if (observer !== null && observed === list) return;

    stop();
    observed = list;
    observer = new MutationObserver(schedule);
    observer.observe(list, { childList: true, subtree: true });
    schedule(); // bank whatever is already rendered
  }

  function stop() {
    if (observer !== null) {
      observer.disconnect();
      observer = null;
    }
    observed = null;
    if (idleHandle !== null) { cancelIdle(idleHandle); idleHandle = null; }
    if (timerHandle !== null) { clearTimeout(timerHandle); timerHandle = null; }
  }

  /** Stops harvesting without losing what is banked (used during generation). */
  function pause() { paused = true; }
  function resume() { paused = false; }

  function reset() {
    store.clear();
    signature = null;
  }

  // ── Reading ────────────────────────────────────────────────────────────────

  /**
   * Returns the most recent `limit` messages known for the open chat, combining
   * what is banked with a fresh read of what is rendered right now.
   *
   * `available` is how many we could actually find. When it falls short of
   * `limit`, the caller tells the user rather than scrolling to close the gap.
   *
   * @param {number} limit
   * @returns {{ messages: import('../adapters/base.js').Message[], available: number, requested: number }}
   */
  function read(limit) {
    const fresh = adapter.scrapeSync(limit);

    if (!mergeable) {
      return { messages: fresh, available: fresh.length, requested: limit };
    }

    syncSignature();
    absorb(fresh);

    const merged = [...store.values()].sort(byTimestamp);
    return {
      messages: merged.slice(-limit),
      available: merged.length,
      requested: limit,
    };
  }

  return { start, stop, pause, resume, reset, read, get size() { return store.size; } };
}

/**
 * @param {import('../adapters/base.js').Message} a
 * @param {import('../adapters/base.js').Message} b
 */
function byTimestamp(a, b) {
  return a.ts - b.ts;
}
