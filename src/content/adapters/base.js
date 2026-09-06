/**
 * @typedef {{
 *   id: string,
 *   sender: string,
 *   isMe: boolean,
 *   text: string,
 *   ts: number,
 *   isGroup: boolean,
 *   mentionsMe: boolean,
 *   quotedText?: string
 * }} Message
 */

// Text utilities live in shared/, because the worker needs them too and a
// service worker has no business importing from the content script.
export { makeMessageId, normalizeText, similarity } from '../../shared/text.js';

/**
 * Base class all adapters must extend.
 */
export class BaseAdapter {
  /** @returns {string} */
  get name() { throw new Error('name getter not implemented'); }

  /**
   * Returns true if the current page shows an open chat.
   * @returns {boolean}
   */
  isChatOpen() { throw new Error('isChatOpen not implemented'); }

  /**
   * Returns true if a group chat is open (vs 1:1).
   * @returns {boolean}
   */
  isGroupChat() { throw new Error('isGroupChat not implemented'); }

  /**
   * Returns the display name of the current user (best-effort).
   * @returns {string}
   */
  getMyName() { return 'Me'; }

  /**
   * Returns the message composer element.
   * @returns {Element|null}
   */
  getComposerBox() { throw new Error('getComposerBox not implemented'); }

  /**
   * Returns the scrollable message-list container, for observers to scope to.
   * @returns {Element|null}
   */
  getMessageList() { throw new Error('getMessageList not implemented'); }

  /**
   * Whether the platform exposes a real per-message timestamp. When false,
   * ordering is positional and only valid within a single scrape, so history
   * from separate scrapes cannot be merged.
   * @returns {boolean}
   */
  get hasStableTimestamps() { return false; }

  /**
   * A stable identifier for the open chat, used to keep cached history from one
   * conversation out of another. Null when it cannot be determined.
   * @returns {string|null}
   */
  chatSignature() { return null; }

  /** Drops cached elements and per-chat invariants. */
  invalidate() {}

  /**
   * Reads the most recent rendered messages. Never scrolls the host app: see
   * `logic/messageCache.js` for how older history is accumulated instead.
   * @param {{ maxMessages?: number }} [opts]
   * @returns {Promise<Message[]>}
   */
  async scrapeMessages() { throw new Error('scrapeMessages not implemented'); }

  /**
   * Synchronous form of `scrapeMessages`, for callers already inside an idle
   * callback that must not yield.
   * @param {number} _maxMessages
   * @returns {Message[]}
   */
  scrapeSync(_maxMessages) { throw new Error('scrapeSync not implemented'); }
}
