import { BaseAdapter, makeMessageId } from './base.js';
import { cachedResolver, cachedValue, queryFirst } from '../dom/query.js';
import { readText, batchedRightAligned, collectTail } from '../logic/scrape.js';

const LIST_SELECTORS = [
  '[role="main"] [role="grid"]',
  '[role="main"] [role="log"]',
  '[data-testid="messenger_thread_container"]',
];

const COMPOSER_SELECTORS = [
  '[contenteditable="true"][aria-label*="message"]',
  '[contenteditable="true"][aria-placeholder]',
];

const HEADER_SELECTORS = ['[role="banner"]', 'div[data-pagelet="MWThreadList"]'];

const TEXT_SELECTORS = ['div[dir="auto"] > span', '[dir="auto"]'];

const QUOTE_SELECTORS = ['[aria-label*="replied"]', 'div[style*="border-left"]'];

/** Messenger's own label for the viewer's outgoing rows. */
const OUTGOING_LABEL = /^you\b/i;

/** Rows are spaced this far apart in the synthetic timeline (see #assemble). */
const SYNTHETIC_GAP_MS = 60_000;

/**
 * Facebook Messenger adapter.
 *
 * More fragile than WhatsApp — there is no `data-pre-plain-text` equivalent, so
 * sender and direction are inferred. Direction is read from the row's own
 * aria-label where Messenger provides one, and only falls back to geometry when
 * it does not; that fallback reads every rect in one batch rather than
 * interleaving reads and writes per row.
 *
 * Never scrolls. See `logic/messageCache.js`.
 */
export class MessengerAdapter extends BaseAdapter {
  get name() { return 'messenger'; }

  /**
   * Messenger does not expose a per-message timestamp in the DOM, so ordering is
   * positional and only meaningful within a single scrape. Scrapes therefore
   * cannot be merged across time.
   */
  get hasStableTimestamps() { return false; }

  #list = cachedResolver(() => queryFirst(LIST_SELECTORS));
  #composer = cachedResolver(() => queryFirst(COMPOSER_SELECTORS));
  #header = cachedResolver(() => queryFirst(HEADER_SELECTORS));
  #isGroup = cachedValue(() => this.#readIsGroup());

  /**
   * Layout-independent part of a parsed row, keyed by the row element.
   * @type {WeakMap<Element, { sender: string, text: string, quotedText: string|undefined, labelSaysMe: boolean|null, textEl: Element }|null>}
   */
  #parsed = new WeakMap();

  getMessageList() { return this.#list(); }
  getComposerBox() { return this.#composer(); }

  isChatOpen() {
    return this.#list() !== null && this.#composer() !== null;
  }

  isGroupChat() { return this.#isGroup(); }

  invalidate() {
    this.#list.reset();
    this.#composer.reset();
    this.#header.reset();
    this.#isGroup.reset();
  }

  chatSignature() {
    const header = this.#header();
    if (!header) return null;
    const heading = header.querySelector('h1, [role="heading"]');
    const name = heading ? readText(heading) : '';
    return name ? `messenger:${name}` : null;
  }

  /**
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

    const rows = list.querySelectorAll('[role="row"]');

    // Phase 1 — pure DOM-tree reads, no layout. Walks backwards and stops early.
    const parsed = collectTail(rows, maxMessages, (row) => {
      const item = this.#parseRow(row);
      return item === null ? null : { row, ...item };
    });
    if (parsed.length === 0) return [];

    // Phase 2 — direction. Prefer Messenger's own labelling; fall back to a
    // single batched geometry pass only when no row was labelled.
    const directions = this.#resolveDirections(parsed);

    return this.#assemble(parsed, directions);
  }

  // ── Row parsing ────────────────────────────────────────────────────────────

  /** @param {Element} row */
  #parseRow(row) {
    const cached = this.#parsed.get(row);
    if (cached !== undefined) return cached;

    const item = this.#buildStatic(row);
    this.#parsed.set(row, item);
    return item;
  }

  /** @param {Element} row */
  #buildStatic(row) {
    const textEl = queryFirst(TEXT_SELECTORS, row);
    if (!textEl) return null;

    const text = readText(textEl);
    if (!text) return null;

    const ariaLabel = row.getAttribute('aria-label') || '';
    const labelMatch = ariaLabel.match(/^([^,]+),/);
    const sender = labelMatch ? labelMatch[1].trim() : 'Unknown';

    // Messenger labels the viewer's own rows "You sent ...". Where that is
    // present it is far cheaper and more reliable than measuring the bubble.
    const labelSaysMe = ariaLabel === '' ? null : OUTGOING_LABEL.test(ariaLabel);

    const quoteEl = queryFirst(QUOTE_SELECTORS, row);

    return {
      sender,
      text,
      quotedText: quoteEl ? readText(quoteEl) : undefined,
      labelSaysMe,
      textEl,
    };
  }

  /**
   * @param {{ row: Element, textEl: Element, labelSaysMe: boolean|null }[]} parsed
   * @returns {boolean[]}
   */
  #resolveDirections(parsed) {
    const labelled = parsed.some(p => p.labelSaysMe !== null);
    if (labelled) return parsed.map(p => p.labelSaysMe === true);

    // No labels to go on. One batched read phase, with no writes in between, so
    // layout is flushed once instead of twice per row.
    return batchedRightAligned(parsed);
  }

  /**
   * @param {{ sender: string, text: string, quotedText: string|undefined }[]} parsed
   * @param {boolean[]} directions
   * @returns {import('./base.js').Message[]}
   */
  #assemble(parsed, directions) {
    const isGroup = this.#isGroup();
    const now = Date.now();
    const n = parsed.length;
    const messages = [];
    const seen = new Set();

    for (let i = 0; i < n; i++) {
      const p = parsed[i];
      // Positional stand-in for a real timestamp: monotonic and correctly
      // ordered within this scrape, which is all the prompt builder needs.
      const ts = now - (n - 1 - i) * SYNTHETIC_GAP_MS;

      // Ids are built from content, not the synthetic ts, so they stay stable
      // across scrapes. Exact repeats from the same sender therefore collapse;
      // that is a fair trade for ids that mean something.
      let id = makeMessageId(p.sender, 0, `${p.text}|${p.quotedText || ''}`);
      if (seen.has(id)) continue;
      seen.add(id);

      messages.push({
        id,
        sender: p.sender,
        isMe: directions[i] === true,
        text: p.text,
        ts,
        isGroup,
        mentionsMe: false, // Messenger mentions are not exposed structurally
        quotedText: p.quotedText,
      });
    }

    return messages;
  }

  #readIsGroup() {
    const header = this.#header();
    if (!header) return false;
    // Group threads show more than one participant avatar in the header.
    return header.querySelectorAll('img[aria-label]').length > 2;
  }
}
