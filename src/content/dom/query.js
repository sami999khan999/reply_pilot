/**
 * query.js — cached DOM element resolution.
 *
 * The idle path ("is a chat open?") used to run up to six `document.querySelector`
 * calls every two seconds, some of them with slow attribute selectors. The host
 * apps keep the same list/composer/header elements alive for as long as a chat is
 * open, so we resolve once and re-run the selector list only when the cached node
 * has actually left the document. A steady-state check becomes an `isConnected`
 * boolean read.
 */

/**
 * Returns the first element matching any selector in `selectors`.
 * Ordered by preference — the earliest match wins.
 *
 * @param {string[]} selectors
 * @param {ParentNode} [root]
 * @returns {Element|null}
 */
export function queryFirst(selectors, root = document) {
  for (let i = 0; i < selectors.length; i++) {
    const el = root.querySelector(selectors[i]);
    if (el) return el;
  }
  return null;
}

/**
 * Returns the matches of the first selector that finds anything.
 *
 * This is the multi-element counterpart to `queryFirst`, and the distinction
 * matters: joining the selectors into one query would return their *union*, so
 * a platform's own row selector would be pooled with the structural fallbacks
 * meant to stand in only when it fails. On WhatsApp that pools every message
 * with its own enclosing `[role="row"]`; elsewhere a bubble and its wrapper can
 * both parse, yielding the same message twice under different senders.
 *
 * @param {string[]} selectors ordered most-specific first
 * @param {ParentNode} [root]
 * @returns {ArrayLike<Element>} empty when nothing matches
 */
export function queryAllFirst(selectors, root = document) {
  for (let i = 0; i < selectors.length; i++) {
    const found = root.querySelectorAll(selectors[i]);
    if (found.length > 0) return found;
  }
  return EMPTY;
}

/** Shared empty result, so callers never allocate for a miss. */
const EMPTY = Object.freeze([]);

/**
 * Wraps a finder so its result is cached until the element is detached.
 * The returned function carries a `.reset()` for cases where the element stays
 * connected but is no longer the right one (e.g. the app reuses one container
 * across chat switches).
 *
 * @param {() => Element|null} find
 * @returns {(() => Element|null) & { reset: () => void }}
 */
export function cachedResolver(find) {
  /** @type {Element|null} */
  let cached = null;

  const resolve = () => {
    if (cached !== null && cached.isConnected) return cached;
    cached = find();
    return cached;
  };

  resolve.reset = () => { cached = null; };
  return resolve;
}

/**
 * Wraps a pure-ish computation so it runs once and is reused until reset.
 * Used for per-chat invariants (my display name, group-vs-direct) that the old
 * scrape loop recomputed once per message row.
 *
 * @template T
 * @param {() => T} compute
 * @returns {(() => T) & { reset: () => void }}
 */
export function cachedValue(compute) {
  let has = false;
  /** @type {T} */
  let value;

  const read = () => {
    if (!has) { value = compute(); has = true; }
    return value;
  };

  read.reset = () => { has = false; };
  return read;
}
