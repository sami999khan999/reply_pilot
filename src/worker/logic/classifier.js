import { normalizeText, similarity } from '../../shared/text.js';

/**
 * classifier.js
 * Pure-JS heuristics that decide whether a reply is needed.
 * No AI involved — fast, deterministic, and testable.
 *
 * @param {import('../adapters/base.js').Message[]} messages
 * @param {{ myName: string }} opts
 * @returns {{ needsReply: boolean, confidence: 'high'|'medium'|'low', reason: string }}
 */
export function classify(messages, { myName = 'Me' } = {}) {
  if (!messages || messages.length === 0) {
    return { needsReply: false, confidence: 'high', reason: 'No messages found in the conversation.' };
  }

  const last = messages[messages.length - 1];
  const isGroup = last.isGroup;

  // Rule 1: Direct question / @mention / reply-quote to my message → highest priority
  const recentFromOthers = messages.filter(m => !m.isMe).slice(-5);
  const myTexts = messages.filter(m => m.isMe).map(m => normalizeText(m.text));

  const addressedToMe = recentFromOthers.some(m => (
    m.mentionsMe ||
    quotesMe(m.quotedText, myTexts) ||
    namesMe(m.text, myName) ||
    m.text.includes('?') // a question was asked
  ));

  if (addressedToMe) {
    return {
      needsReply: true,
      confidence: 'high',
      reason: 'You were directly addressed or a question was asked.',
    };
  }

  // Rule 2: I sent the last message → usually no reply needed
  if (last.isMe) {
    // Exception: my last message was itself a question
    if (last.text.includes('?')) {
      return {
        needsReply: false,
        confidence: 'medium',
        reason: 'You sent the last message (a question). Waiting for a reply.',
      };
    }
    return {
      needsReply: false,
      confidence: 'high',
      reason: 'You sent the last message — no reply needed.',
    };
  }

  // Rule 3: 1:1 chat, last message is from them → reply needed
  if (!isGroup) {
    return {
      needsReply: true,
      confidence: 'high',
      reason: 'Direct message from the other person.',
    };
  }

  // Rule 4: Group chat checks
  // Sub-rule 4a: strictly others talking, no mention/quote of me, no broadcast pattern
  const myMessages = messages.filter(m => m.isMe);
  const hasIBeenMentioned = messages.some(m => m.mentionsMe);
  const hasIBeenQuoted = messages.some(m => quotesMe(m.quotedText, myTexts));

  if (!hasIBeenMentioned && !hasIBeenQuoted && myMessages.length === 0) {
    // Check if this looks like a broadcast (many short acks from different senders)
    const recentSenders = new Set(messages.slice(-10).filter(m => !m.isMe).map(m => m.sender));
    const shortReplies = messages.slice(-10).filter(m => !m.isMe && m.text.length < 80);

    if (recentSenders.size >= 3 && shortReplies.length >= 3) {
      // Looks like a broadcast — optional acknowledgement
      return {
        needsReply: true, // Soft yes — we offer drafts but show a soft prompt in the UI
        confidence: 'low',
        reason: 'Group announcement — a short acknowledgement is optional.',
      };
    }

    return {
      needsReply: false,
      confidence: 'high',
      reason: 'Group conversation between others — you\'re not addressed here.',
    };
  }

  // Sub-rule 4b: broadcast with me mentioned or it's a general group message
  return {
    needsReply: true,
    confidence: 'medium',
    reason: 'Group message that may include you.',
  };
}

// ── Helpers ──────────────────────────────────────────────────────────────────

/** A quote has to resemble one of my messages this closely to count as mine. */
const QUOTE_MATCH_THRESHOLD = 0.7;

/**
 * Whether a quoted block is quoting something the user actually said.
 *
 * This used to be `quotedText.includes('Me')` — a case-sensitive substring, so
 * it matched *Me*eting, *Me*ssage, *Me*mber and *Me*et. Since rule 1
 * short-circuits everything after it, any quoted mention of a meeting made the
 * whole conversation read as directly addressing the user.
 *
 * The quote is compared against what the user actually wrote instead. Quotes are
 * usually truncated with an ellipsis, so a fuzzy match is the right instrument.
 *
 * @param {string|undefined} quotedText
 * @param {string[]} myTexts normalized text of the user's own messages
 */
function quotesMe(quotedText, myTexts) {
  if (!quotedText || myTexts.length === 0) return false;

  const quoted = normalizeText(quotedText);
  if (quoted.length === 0) return false;

  return myTexts.some(mine => mine.startsWith(quoted) || similarity(quoted, mine) > QUOTE_MATCH_THRESHOLD);
}

/**
 * Whether a message addresses the user by name.
 *
 * Matched on word boundaries: a plain substring test meant a user called "Sam"
 * was addressed by the word "sample".
 *
 * @param {string} text
 * @param {string} myName
 */
function namesMe(text, myName) {
  const name = (myName || '').trim();
  if (name.length < 2 || name.toLowerCase() === 'me') return false;

  return wordBoundaryPattern(name).test(text);
}

/** Cache: the same name is tested against every recent message. */
const PATTERN_CACHE = new Map();

/** @param {string} name */
function wordBoundaryPattern(name) {
  let pattern = PATTERN_CACHE.get(name);
  if (pattern === undefined) {
    // A display name can hold regex metacharacters, so escape before compiling.
    const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    pattern = new RegExp(`(^|[^\\p{L}\\p{N}])${escaped}($|[^\\p{L}\\p{N}])`, 'iu');
    if (PATTERN_CACHE.size > 32) PATTERN_CACHE.clear();
    PATTERN_CACHE.set(name, pattern);
  }
  return pattern;
}
