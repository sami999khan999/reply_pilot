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

/**
 * Generates a stable ID for a message based on sender + timestamp + text content.
 * @param {string} sender
 * @param {number} ts
 * @param {string} text
 * @returns {string}
 */
export function makeMessageId(sender, ts, text) {
  const raw = `${sender}|${ts}|${text.slice(0, 40)}`;
  let hash = 0;
  for (let i = 0; i < raw.length; i++) {
    const chr = raw.charCodeAt(i);
    hash = ((hash << 5) - hash) + chr;
    hash |= 0;
  }
  return String(hash >>> 0);
}

/**
 * Normalizes whitespace/punctuation for fuzzy-duplicate detection.
 * @param {string} text
 * @returns {string}
 */
export function normalizeText(text) {
  return text.trim().replace(/\s+/g, ' ').toLowerCase();
}

/**
 * Levenshtein-based similarity [0..1] for two short strings.
 * @param {string} a
 * @param {string} b
 * @returns {number}
 */
export function similarity(a, b) {
  if (!a || !b) return 0;
  if (a === b) return 1;
  const maxLen = Math.max(a.length, b.length);
  if (maxLen === 0) return 1;
  const dist = levenshtein(a, b);
  return 1 - dist / maxLen;
}

function levenshtein(a, b) {
  const m = a.length, n = b.length;
  const dp = Array.from({ length: m + 1 }, (_, i) => Array.from({ length: n + 1 }, (_, j) => i === 0 ? j : j === 0 ? i : 0));
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      if (a[i - 1] === b[j - 1]) dp[i][j] = dp[i - 1][j - 1];
      else dp[i][j] = 1 + Math.min(dp[i - 1][j], dp[i][j - 1], dp[i - 1][j - 1]);
    }
  }
  return dp[m][n];
}

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
   * Scrapes currently-rendered messages, optionally after scrolling up for history.
   * @returns {Promise<Message[]>}
   */
  async scrapeMessages() { throw new Error('scrapeMessages not implemented'); }
}
