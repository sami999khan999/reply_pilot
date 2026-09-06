/**
 * budget.js — Token counting and context windowing.
 *
 * The LanguageModel has a soft ~4K input token window (may be up to 8K but we stay safe).
 * Strategy:
 *   1. Keep the last K raw messages verbatim.
 *   2. Everything older goes to the Summarizer.
 *   3. Always keep the rootMessage verbatim regardless of its position.
 */

const CHARS_PER_TOKEN = 4; // conservative estimate
const MAX_RAW_TOKENS = 1800; // budget for raw recent messages
const MAX_SUMMARY_TOKENS = 400; // budget for the summary of older messages
const HARD_RAW_WINDOW = 12; // max number of raw messages regardless

/**
 * @typedef {{
 *   rawMessages: import('../../content/adapters/base.js').Message[],
 *   olderMessages: import('../../content/adapters/base.js').Message[],
 * }} BudgetSplit
 */

/**
 * Estimates token count for a string.
 * @param {string} text
 * @returns {number}
 */
export function estimateTokens(text) {
  return Math.ceil((text || '').length / CHARS_PER_TOKEN);
}

/**
 * Splits messages into raw (for verbatim inclusion) and older (for summarization).
 *
 * @param {import('../../content/adapters/base.js').Message[]} messages - all messages, oldest first
 * @param {import('../../content/adapters/base.js').Message|null} rootMessage - always kept verbatim
 * @returns {BudgetSplit}
 */
export function splitBudget(messages, rootMessage) {
  if (!messages || messages.length === 0) {
    return { rawMessages: [], olderMessages: [] };
  }

  // Always keep at most HARD_RAW_WINDOW recent messages
  const recentCandidates = messages.slice(-HARD_RAW_WINDOW);
  const olderCandidates = messages.slice(0, -HARD_RAW_WINDOW);

  // Check token budget for recent candidates
  let tokenCount = 0;
  let cutoff = recentCandidates.length;
  for (let i = recentCandidates.length - 1; i >= 0; i--) {
    const t = estimateTokens(`${recentCandidates[i].sender}: ${recentCandidates[i].text}`);
    if (tokenCount + t > MAX_RAW_TOKENS) {
      cutoff = i + 1;
      break;
    }
    tokenCount += t;
  }

  let rawMessages = recentCandidates.slice(cutoff);
  let olderMessages = [...olderCandidates, ...recentCandidates.slice(0, cutoff)];

  // Ensure rootMessage is always in raw (move it if needed).
  // Match on id, not identity: rootMessage may have been structured-cloned on
  // its way here, in which case an identity check never matches and the root
  // gets prepended a second time on every single generate.
  if (rootMessage && !rawMessages.some(m => m.id === rootMessage.id)) {
    rawMessages = [rootMessage, ...rawMessages];
    olderMessages = olderMessages.filter(m => m.id !== rootMessage.id);
  }

  return { rawMessages, olderMessages };
}

/**
 * Formats raw messages into the plain-text lines sent to the model.
 * @param {import('../../content/adapters/base.js').Message[]} msgs
 * @returns {string}
 */
export function formatRawMessages(msgs) {
  return msgs.map(m => {
    const tag = m.isMe ? '[Me]' : `[${m.sender}]`;
    const quote = m.quotedText ? ` (quoting: "${m.quotedText.slice(0, 60)}…")` : '';
    return `${tag}${quote}: ${m.text}`;
  }).join('\n');
}
