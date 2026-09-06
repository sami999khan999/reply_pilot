import { BaseAdapter, makeMessageId } from './base.js';
import { cachedResolver, cachedValue, queryFirst } from '../dom/query.js';
import { readText, findAncestorToken, collectTail } from '../logic/scrape.js';

const LIST_SELECTORS = [
  '[data-tab="8"]',
  'div[role="application"]',
  '#main',
];

const COMPOSER_SELECTORS = [
  '[data-testid="conversation-compose-box-input"]',
  'div[contenteditable="true"][data-tab="10"]',
  '#main footer div[contenteditable="true"]',
  'div[contenteditable="true"][role="textbox"]',
];

const HEADER_SELECTORS = ['#main header', 'header'];

const QUOTE_SELECTORS = ['[data-testid="quoted-message"]', '.quoted-mention'];

/** Direction markers WhatsApp puts on the message bubble container. */
const DIRECTION_TOKENS = ['message-out', 'message-in'];

/**
 * WhatsApp Web adapter.
 *
 * Anchors on `data-pre-plain-text` for sender + timestamp (stable across the
 * app's class churn) and the `message-out` / `message-in` bubble markers for
 * direction.
 *
 * Never scrolls. See `logic/messageCache.js` for how history is accumulated.
 */
export class WhatsAppAdapter extends BaseAdapter {
  get name() { return 'whatsapp'; }

  /** WhatsApp exposes a real per-message timestamp, so scrapes can be merged. */
  get hasStableTimestamps() { return true; }

  #list = cachedResolver(() => queryFirst(LIST_SELECTORS));
  #composer = cachedResolver(() => queryFirst(COMPOSER_SELECTORS));
  #header = cachedResolver(() => queryFirst(HEADER_SELECTORS));

  // Per-chat invariants. The old scrape resolved `getMyName()` inside the row
  // loop — one document.querySelector per message — and re-derived group-ness on
  // every pass.
  #myName = cachedValue(() => this.#readMyName());
  #isGroup = cachedValue(() => this.#readIsGroup());

  /**
   * Parsed rows, keyed by the element they came from. Rows are immutable once
   * rendered, so a re-scrape (or the passive cache's idle harvest) never re-parses.
   * @type {WeakMap<Element, import('./base.js').Message|null>}
   */
  #parsed = new WeakMap();

  getMessageList() { return this.#list(); }
  getComposerBox() { return this.#composer(); }

  isChatOpen() {
    return this.#list() !== null && this.#composer() !== null;
  }

  isGroupChat() { return this.#isGroup(); }
  getMyName() { return this.#myName(); }

  /** Drops per-chat caches. Called on SPA navigation and chat switches. */
  invalidate() {
    this.#list.reset();
    this.#composer.reset();
    this.#header.reset();
    this.#myName.reset();
    this.#isGroup.reset();
  }

  /**
   * Identifies the open chat, so cached history from a different chat is never
   * mixed in. Derived from the header title, which is what the user sees.
   * @returns {string|null}
   */
  chatSignature() {
    const header = this.#header();
    if (!header) return null;
    const title = header.querySelector('span[title]');
    const name = title?.getAttribute('title') || readText(title) || '';
    return name ? `whatsapp:${name}` : null;
  }

  /**
   * Reads the most recent `maxMessages` rendered messages.
   *
   * Walks the rendered rows backwards and stops as soon as it has enough, so the
   * cost tracks what was asked for rather than how much history the app happens
   * to have rendered.
   *
   * @param {{ maxMessages?: number }} [opts]
   * @returns {Promise<import('./base.js').Message[]>}
   */
  async scrapeMessages({ maxMessages = 80 } = {}) {
    return this.scrapeSync(maxMessages);
  }

  /** @param {number} maxMessages */
  scrapeSync(maxMessages) {
    const list = this.#list();
    if (!list) return [];

    // Hoisted out of the row loop: one lookup per scrape, not one per message.
    const ctx = { isGroup: this.#isGroup(), myName: this.#myName() };
    const seen = new Set();

    // `[data-pre-plain-text]` marks exactly the rows that carry a message, so we
    // skip the outer role="row" pass over dividers and system notices entirely.
    const rows = list.querySelectorAll('[data-pre-plain-text]');

    return collectTail(rows, maxMessages, (row) => {
      const msg = this.#parseRow(row, ctx);
      if (msg === null || seen.has(msg.id)) return null;
      seen.add(msg.id);
      return msg;
    });
  }

  // ── Row parsing ────────────────────────────────────────────────────────────

  /**
   * @param {Element} row the `[data-pre-plain-text]` element
   * @param {{ isGroup: boolean, myName: string }} ctx
   * @returns {import('./base.js').Message|null}
   */
  #parseRow(row, ctx) {
    const cached = this.#parsed.get(row);
    if (cached !== undefined) return cached;

    const msg = this.#buildMessage(row, ctx);
    this.#parsed.set(row, msg);
    return msg;
  }

  /**
   * @param {Element} row
   * @param {{ isGroup: boolean, myName: string }} ctx
   * @returns {import('./base.js').Message|null}
   */
  #buildMessage(row, ctx) {
    const parsed = parsePrePlainText(row.getAttribute('data-pre-plain-text') || '');
    if (!parsed) return null;

    const text = readText(row.querySelector('span.selectable-text') || row);
    if (!text) return null;

    // Bounded ancestor walk for direction, which also gives us the bubble to
    // scope the quote and mention lookups to.
    const bubble = findAncestorToken(row, DIRECTION_TOKENS);
    const isMe = bubble?.token === 'message-out';
    const scope = bubble?.node || row;

    const quoteEl = queryFirst(QUOTE_SELECTORS, scope);
    const quotedText = quoteEl ? readText(quoteEl) : undefined;

    const ts = toTimestamp(parsed.time, parsed.date);

    return {
      id: makeMessageId(parsed.sender, ts, text),
      sender: parsed.sender,
      isMe,
      text,
      ts,
      isGroup: ctx.isGroup,
      // Mentions only carry meaning in a group, and never on your own message.
      mentionsMe: ctx.isGroup && !isMe && mentionsName(scope, ctx.myName),
      quotedText,
    };
  }

  // ── Per-chat invariants ────────────────────────────────────────────────────

  #readMyName() {
    const profile = document.querySelector('[data-testid="menu-bar-profile"] img');
    const alt = profile?.getAttribute('alt');
    return alt || 'Me';
  }

  #readIsGroup() {
    const header = this.#header();
    if (!header) return false;

    const subtitle =
      header.querySelector('span[data-testid="subtitle-description"]') ||
      header.querySelector('div[class*="subtitle"]');
    if (!subtitle) return false;

    // Group subtitles list participant names separated by commas.
    const txt = subtitle.textContent || '';
    return txt.indexOf(',') !== -1;
  }
}

// ── Pure helpers ─────────────────────────────────────────────────────────────

/**
 * Parses a `data-pre-plain-text` value like "[12:01 PM, 7/12/2026] Shohan Sir: ".
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
