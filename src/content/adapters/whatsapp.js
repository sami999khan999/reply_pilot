import { GenericAdapter } from './generic.js';
import { queryFirst } from '../dom/query.js';
import { readText, findAncestorToken } from '../logic/scrape.js';

/**
 * WhatsApp Web is the one platform worth a dedicated parser.
 *
 * `data-pre-plain-text` carries sender, time and date on every message row in a
 * single attribute that has survived years of the app's class-name churn. It
 * gives us a real timestamp — which is what lets the message cache merge scrapes
 * and accumulate history — so the generic row parser is overridden here rather
 * than approximated through config.
 *
 * Everything else — element resolution, the backwards tail walk, the row
 * memoization, the per-chat invariants — comes from GenericAdapter unchanged.
 */
export class WhatsAppAdapter extends GenericAdapter {
  /**
   * @param {Element} row the `[data-pre-plain-text]` element
   * @param {object} ctx
   * @returns {object|null}
   */
  buildRow(row, ctx) {
    const parsed = parsePrePlainText(row.getAttribute('data-pre-plain-text') || '');
    if (!parsed) return null;

    // The bubble carries the direction marker, and scopes the quote and mention
    // lookups so neither has to search the whole row.
    const bubble = findAncestorToken(row, ['message-out', 'message-in']);
    const scope = bubble?.node || row;

    const quoteEl = queryFirst(ctx.quoteSelectors, scope);
    const quotedText = quoteEl ? readText(quoteEl) || undefined : undefined;

    const text = readText(row.querySelector('span.selectable-text') || row);
    if (!text) return null;

    const ts = toTimestamp(parsed.time, parsed.date);
    const isMe = bubble?.token === 'message-out';

    return {
      textEl: row,
      text,
      quotedText,
      sender: parsed.sender,
      directionClass: bubble === null ? null : (isMe ? 'out' : 'in'),
      outgoingAria: null,
      ts,
      // WhatsApp marks mentions structurally, which beats scanning the text.
      mentionsMe: ctx.isGroup && !isMe && mentionsName(scope, ctx.myName),
    };
  }

  /** @param {object} row @param {object} ctx @param {boolean} isMe */
  readMentionsMe(row, ctx, isMe) {
    return isMe ? false : row.mentionsMe === true;
  }

}

// ── Pure helpers ─────────────────────────────────────────────────────────────

/**
 * Parses a value like "[12:01 PM, 7/12/2026] Shohan Sir: ".
 * @param {string} pre
 * @returns {{ time: string, date: string, sender: string }|null}
 */
function parsePrePlainText(pre) {
  const m = pre.match(/^\[(.+?),\s*(.+?)\]\s*(.*?):\s*$/);
  if (!m) return null;
  return { time: m[1].trim(), date: m[2].trim(), sender: m[3].trim() };
}

/**
 * @param {string} time e.g. "12:01 PM"
 * @param {string} date e.g. "7/12/2026"
 * @returns {number}
 */
function toTimestamp(time, date) {
  const parsed = Date.parse(`${date} ${time}`);
  return Number.isNaN(parsed) ? Date.now() : parsed;
}

/**
 * @param {Element} scope the message bubble
 * @param {string} myName
 * @returns {boolean}
 */
function mentionsName(scope, myName) {
  const spans = scope.querySelectorAll('[data-mention]');
  if (spans.length === 0) return false;

  const needle = myName.toLowerCase();
  for (let i = 0; i < spans.length; i++) {
    const txt = (spans[i].getAttribute('data-mention') || spans[i].textContent || '').toLowerCase();
    if (txt.includes('@you') || (needle !== 'me' && txt.includes(needle))) return true;
  }
  return false;
}
