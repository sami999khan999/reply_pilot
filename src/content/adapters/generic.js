import { BaseAdapter, makeMessageId } from './base.js';
import { cachedResolver, cachedValue, queryFirst, queryAllFirst } from '../dom/query.js';
import { readText, findAncestorToken, batchedRightAligned, collectTail } from '../logic/scrape.js';
import { selectorsFor } from './platforms.js';

/**
 * generic.js — one scraping engine, driven by a platform config.
 *
 * Adding a chat app is a config entry in `platforms.js`, not a new class. The
 * engine keeps the same performance rules for every platform it drives:
 * elements are resolved once and cached until they detach, per-chat invariants
 * are hoisted out of the row loop, rows are walked from the newest and parsing
 * stops at the limit, parsed rows are memoized, text is read from the node tree
 * rather than through `innerText`, and nothing ever scrolls the conversation.
 *
 * The one layout-dependent strategy — deciding direction from where a bubble
 * sits — is batched into a single read pass, and only used where a platform
 * gives us nothing better.
 */
export class GenericAdapter extends BaseAdapter {
  /** @param {import('./platforms.js').PlatformConfig} config */
  constructor(config) {
    super();
    this.config = config;

    this._list = cachedResolver(() => queryFirst(selectorsFor(config, 'list')));
    this._composer = cachedResolver(() => queryFirst(selectorsFor(config, 'composer')));
    this._header = cachedResolver(() => queryFirst(selectorsFor(config, 'header')));

    this._myName = cachedValue(() => this.readMyName());
    this._isGroup = cachedValue(() => this.readIsGroup());

    /**
     * Parsed rows keyed by the element they came from. Rows are immutable once
     * rendered, so re-scrapes and the cache's idle harvest never re-parse.
     * @type {WeakMap<Element, object|null>}
     */
    this._parsed = new WeakMap();
  }

  get name() { return this.config.id; }
  get label() { return this.config.label; }
  get accent() { return this.config.accent; }

  /** Only platforms exposing a real per-message date can have scrapes merged. */
  get hasStableTimestamps() { return this.config.stableTimestamps === true; }

  getMessageList() { return this._list(); }
  getComposerBox() { return this._composer(); }
  getHeader() { return this._header(); }

  isChatOpen() {
    return this._list() !== null && this._composer() !== null;
  }

  isGroupChat() { return this._isGroup(); }
  getMyName() { return this._myName(); }

  invalidate() {
    this._list.reset();
    this._composer.reset();
    this._header.reset();
    this._myName.reset();
    this._isGroup.reset();
  }

  /** Identifies the open chat so one conversation's history never leaks into another's. */
  chatSignature() {
    const header = this._header();
    if (!header) return null;

    const el = queryFirst(selectorsFor(this.config, 'title'), header);
    const name = el?.getAttribute('title') || readText(el) || '';
    return name ? `${this.config.id}:${name.slice(0, 80)}` : null;
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
    const list = this._list();
    if (!list) return [];

    // Hoisted: one lookup per scrape rather than one per message row.
    const ctx = {
      isGroup: this._isGroup(),
      myName: this._myName(),
      rowSelectors: selectorsFor(this.config, 'row'),
      textSelectors: selectorsFor(this.config, 'text'),
      quoteSelectors: selectorsFor(this.config, 'quote'),
      senderSelectors: this.config.sender,
      timestamp: this.config.timestamp,
      // Resolved once, alongside the other per-chat invariants: reading it in
      // assemble() meant a header query and a text walk for every row on a
      // platform that names no senders.
      unknownSender: this.unknownSender(),
    };

    // First selector that finds anything wins — never the union of all of them.
    const rows = queryAllFirst(ctx.rowSelectors, list);
    const parsed = collectTail(rows, maxMessages, (row) => {
      const item = this.parseRow(row, ctx);
      return item === null ? null : { row, ...item };
    });
    if (parsed.length === 0) return [];

    const directions = this.resolveDirections(parsed, ctx, list);
    return this.assemble(parsed, directions, ctx);
  }

  // ── Row parsing ────────────────────────────────────────────────────────────

  /**
   * Memoized wrapper. Only the layout-independent part of a row is cached;
   * direction may depend on a batched measurement taken later.
   *
   * @param {Element} row
   * @param {object} ctx
   */
  parseRow(row, ctx) {
    const cached = this._parsed.get(row);
    if (cached !== undefined) return cached;

    const item = this.buildRow(row, ctx);
    this._parsed.set(row, item);
    return item;
  }

  /**
   * @param {Element} row
   * @param {object} ctx
   * @returns {object|null} null skips the row (dividers, system notices, media)
   */
  buildRow(row, ctx) {
    // Resolve the quote first: it renders above the message and sits inside the
    // same row, so a text selector would otherwise match the quoted text and
    // report it as the message.
    const quoteEl = ctx.quoteSelectors.length > 0 ? queryFirst(ctx.quoteSelectors, row) : null;
    const quotedText = quoteEl ? readText(quoteEl) || undefined : undefined;

    const textEl = findTextElement(row, ctx.textSelectors, quoteEl);
    if (!textEl) return null;

    let text = readText(textEl);
    // Belt and braces for platforms whose quote block we could not identify.
    if (quotedText && text.startsWith(quotedText)) {
      text = text.slice(quotedText.length).trim();
    }
    if (!text) return null;

    return {
      textEl,
      text,
      quotedText,
      sender: this.readSender(row, ctx),
      directionClass: this.readDirectionClass(row),
      outgoingAria: this.readOutgoingAria(row),
      ts: this.readTimestamp(row, ctx),
    };
  }

  /** @param {Element} row */
  readDirectionClass(row) {
    const tokens = this.config.directionClass;
    if (!tokens) return null;

    const found = findAncestorToken(row, [...tokens.out, ...tokens.in]);
    if (!found) return null;
    return tokens.out.includes(found.token) ? 'out' : 'in';
  }

  /** @param {Element} row */
  readOutgoingAria(row) {
    if (!this.config.outgoingAria) return null;
    const label = row.getAttribute('aria-label');
    return label ? this.config.outgoingAria.test(label) : null;
  }

  /**
   * @param {Element} row
   * @param {object} ctx
   * @returns {string|null} null when this row does not name its sender, which is
   *   normal for the second and later messages in a run from one person.
   */
  readSender(row, ctx) {
    if (ctx.senderSelectors) {
      const el = queryFirst(ctx.senderSelectors, row);
      const name = el ? readText(el) : '';
      if (name) return name.trim();
    }

    if (this.config.senderAria) {
      const label = row.getAttribute('aria-label') || '';
      const match = label.match(this.config.senderAria);
      if (match) return match[1].trim();
    }

    return null;
  }

  /**
   * @param {Element} row
   * @param {object} ctx
   * @returns {number|null}
   */
  readTimestamp(row, ctx) {
    if (!ctx.timestamp) return null;

    const el = queryFirst(ctx.timestamp.selector, row);
    if (!el) return null;

    const raw = el.getAttribute(ctx.timestamp.attr);
    if (!raw) return null;

    // Slack stores an epoch-seconds float carrying sub-millisecond precision;
    // everyone else uses a date string. Both land on whole milliseconds.
    const epoch = Number(raw);
    const parsed = Number.isFinite(epoch) && epoch > 1e8 ? Math.round(epoch * 1000) : Date.parse(raw);
    return Number.isNaN(parsed) ? null : parsed;
  }

  // ── Direction ──────────────────────────────────────────────────────────────

  /**
   * Applies the platform's direction strategies in order and stops at the first
   * that produces an answer for any row. Only 'align' costs a layout read, and
   * it reads every row in one batch with no interleaved writes.
   *
   * @param {object[]} parsed
   * @param {object} ctx
   * @param {Element} list the message-list container, used as the align datum
   * @returns {boolean[]}
   */
  resolveDirections(parsed, ctx, list) {
    for (const strategy of this.config.direction) {
      if (strategy === 'class' && parsed.some(p => p.directionClass !== null)) {
        return parsed.map(p => p.directionClass === 'out');
      }
      if (strategy === 'aria' && parsed.some(p => p.outgoingAria !== null)) {
        return parsed.map(p => p.outgoingAria === true);
      }
      if (strategy === 'sender' && ctx.myName && ctx.myName !== 'Me') {
        const mine = ctx.myName.toLowerCase();
        if (parsed.some(p => p.sender && p.sender.toLowerCase() === mine)) {
          return parsed.map(p => (p.sender || '').toLowerCase() === mine);
        }
      }
      if (strategy === 'align') {
        return batchedRightAligned(parsed.map(p => p.textEl), list);
      }
    }
    return parsed.map(() => false);
  }

  // ── Assembly ───────────────────────────────────────────────────────────────

  /**
   * @param {object[]} parsed chronological
   * @param {boolean[]} directions
   * @param {object} ctx
   * @returns {import('./base.js').Message[]}
   */
  assemble(parsed, directions, ctx) {
    const now = Date.now();
    const n = parsed.length;
    const messages = [];
    const seen = new Set();

    // Most apps name the sender only on the first message of a run, so carry
    // the last known name forward rather than reporting "Unknown" repeatedly.
    let lastSender = null;

    for (let i = 0; i < n; i++) {
      const p = parsed[i];
      const isMe = directions[i] === true;

      if (p.sender) lastSender = p.sender;
      const sender = p.sender || (isMe ? 'Me' : lastSender) || ctx.unknownSender;

      // Where the platform gives no real timestamp, order positionally: correct
      // within this scrape, which is all the prompt builder needs. Such scrapes
      // are never merged across time (see hasStableTimestamps).
      const ts = p.ts ?? (now - (n - 1 - i) * 60_000);

      const id = makeMessageId(sender, p.ts ?? 0, `${p.text}|${p.quotedText || ''}`);
      if (seen.has(id)) continue;
      seen.add(id);

      messages.push({
        id,
        sender,
        isMe,
        text: p.text,
        ts,
        isGroup: ctx.isGroup,
        mentionsMe: this.readMentionsMe(p, ctx, isMe),
        quotedText: p.quotedText,
      });
    }

    return messages;
  }

  /**
   * What to call the other party when no row names them — the chat's own title,
   * which is who you are talking to in a direct conversation.
   * @returns {string}
   */
  unknownSender() {
    const signature = this.chatSignature();
    return signature ? signature.slice(signature.indexOf(':') + 1) : 'Them';
  }

  /**
   * Only meaningful in a group, and never on your own message.
   * @param {object} row
   * @param {object} ctx
   * @param {boolean} isMe
   */
  readMentionsMe(row, ctx, isMe) {
    if (isMe || !ctx.isGroup || !ctx.myName || ctx.myName === 'Me') return false;
    return row.text.toLowerCase().includes('@' + ctx.myName.toLowerCase());
  }

  // ── Per-chat invariants ────────────────────────────────────────────────────

  readMyName() {
    if (!this.config.myName) return 'Me';

    const el = queryFirst(this.config.myName);
    if (!el) return 'Me';

    const raw = el.getAttribute('alt')
      || el.getAttribute('title')
      || el.getAttribute('aria-label')
      || readText(el)
      || '';

    // Some apps only expose the name inside a longer label, e.g. Google's
    // "Google Account: Sami Khan (sami@example.com)".
    const pattern = this.config.myNamePattern;
    if (pattern) {
      const match = raw.match(pattern);
      return match ? match[1].trim() || 'Me' : 'Me';
    }

    return raw.trim() || 'Me';
  }

  readIsGroup() {
    const header = this._header();
    if (!header) return false;

    if (this.config.groupHint) {
      const hint = queryFirst(this.config.groupHint, document);
      // A participant list reads as comma-separated names.
      if (hint) return (readText(hint).match(/,/g) || []).length >= 1;
    }

    const threshold = this.config.groupAvatarThreshold;
    if (typeof threshold === 'number') {
      return header.querySelectorAll('img[aria-label], img[alt]').length > threshold;
    }

    return false;
  }
}

/**
 * First element matching the text selectors that is not part of the quote block.
 *
 * Stops at the first usable hit, so the common case costs one selector pass.
 *
 * @param {Element} row
 * @param {string[]} selectors
 * @param {Element|null} quoteEl
 * @returns {Element|null}
 */
function findTextElement(row, selectors, quoteEl) {
  for (let i = 0; i < selectors.length; i++) {
    const matches = row.querySelectorAll(selectors[i]);
    for (let j = 0; j < matches.length; j++) {
      if (quoteEl !== null && quoteEl.contains(matches[j])) continue;
      return matches[j];
    }
  }
  return null;
}
