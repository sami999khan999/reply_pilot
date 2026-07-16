/**
 * settings.js — Shared user-settings helpers.
 *
 * Used by both the content script (to decide how much history to read and how
 * many replies to draft) and the browser-action popup. Persisted in
 * chrome.storage.sync so it follows the user across devices.
 *
 * NOTE: never store message content here — only preferences.
 */

/** How many messages to scrape by default (own + others combined). */
export const MESSAGE_COUNT_DEFAULT = 20;
export const MESSAGE_COUNT_MIN = 6;
export const MESSAGE_COUNT_MAX = 60;

/** How many reply options to generate by default. */
export const REPLY_COUNT_DEFAULT = 3;
export const REPLY_COUNT_MIN = 1;
export const REPLY_COUNT_MAX = 6;

/** Max length of the free-text "reference" guidance for replies. */
export const REFERENCE_MAX_LEN = 200;

/** @typedef {{ messageCount: number, replyCount: number, referenceNote: string }} Settings */

/** @type {Settings} */
export const SETTINGS_DEFAULTS = {
  messageCount: MESSAGE_COUNT_DEFAULT,
  replyCount: REPLY_COUNT_DEFAULT,
  referenceNote: '',
};

/**
 * Constrains a raw value to a valid message count.
 * @param {unknown} value
 * @returns {number}
 */
export function clampMessageCount(value) {
  return clampInt(value, MESSAGE_COUNT_MIN, MESSAGE_COUNT_MAX, MESSAGE_COUNT_DEFAULT);
}

/**
 * Constrains a raw value to a valid reply count.
 * @param {unknown} value
 * @returns {number}
 */
export function clampReplyCount(value) {
  return clampInt(value, REPLY_COUNT_MIN, REPLY_COUNT_MAX, REPLY_COUNT_DEFAULT);
}

/**
 * Trims/caps the free-text reference note.
 * @param {unknown} value
 * @returns {string}
 */
export function sanitizeReference(value) {
  if (typeof value !== 'string') return '';
  return value.replace(/\s+/g, ' ').trim().slice(0, REFERENCE_MAX_LEN);
}

function clampInt(value, min, max, fallback) {
  const n = Math.round(Number(value));
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, n));
}

/**
 * Reads all settings, filling in defaults for anything unset.
 * @returns {Promise<Settings>}
 */
export function getSettings() {
  return new Promise(resolve => {
    try {
      chrome.storage.sync.get(SETTINGS_DEFAULTS, items => {
        if (chrome.runtime.lastError) {
          resolve({ ...SETTINGS_DEFAULTS });
          return;
        }
        resolve({
          messageCount: clampMessageCount(items?.messageCount),
          replyCount: clampReplyCount(items?.replyCount),
          referenceNote: sanitizeReference(items?.referenceNote),
        });
      });
    } catch {
      resolve({ ...SETTINGS_DEFAULTS });
    }
  });
}

/**
 * Persists a partial settings patch.
 * @param {Partial<Settings>} patch
 * @returns {Promise<void>}
 */
export function saveSettings(patch) {
  const clean = {};
  if (patch.messageCount != null) clean.messageCount = clampMessageCount(patch.messageCount);
  if (patch.replyCount != null) clean.replyCount = clampReplyCount(patch.replyCount);
  if (patch.referenceNote != null) clean.referenceNote = sanitizeReference(patch.referenceNote);
  return new Promise(resolve => {
    try {
      chrome.storage.sync.set(clean, () => resolve());
    } catch {
      resolve();
    }
  });
}

/**
 * Rough estimate of how long a generation will take, in seconds, based on how
 * much history is read and how many replies are drafted. On-device Gemini Nano
 * is roughly linear in input length and output count; these coefficients are
 * tuned to feel honest rather than precise.
 *
 * @param {number} messageCount
 * @param {number} replyCount
 * @returns {{ low: number, high: number }}
 */
export function estimateGenerationSeconds(messageCount, replyCount) {
  const m = clampMessageCount(messageCount);
  const r = clampReplyCount(replyCount);

  const base = 2.5;                          // session + prompt overhead
  const input = m * 0.09;                    // reading + feeding history
  const summarize = m > 12 ? 1.4 + (m - 12) * 0.1 : 0; // older history gets summarized
  const output = r * 1.6;                    // each drafted option

  const est = base + input + summarize + output;
  const low = Math.max(3, Math.round(est * 0.75));
  const high = Math.max(low + 1, Math.round(est * 1.5));
  return { low, high };
}

/**
 * Formats an estimate range as a compact label, e.g. "~6–12s".
 * @param {number} messageCount
 * @param {number} replyCount
 * @returns {string}
 */
export function formatEstimate(messageCount, replyCount) {
  const { low, high } = estimateGenerationSeconds(messageCount, replyCount);
  return `~${low}–${high}s`;
}
