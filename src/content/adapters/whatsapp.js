import { BaseAdapter, makeMessageId, normalizeText } from './base.js';

/**
 * WhatsApp Web adapter.
 * Anchors on `data-pre-plain-text` for sender + timestamp (stable across class churn),
 * `message-in` / `message-out` for direction, and `role="row"` for message rows.
 */
export class WhatsAppAdapter extends BaseAdapter {
  get name() { return 'whatsapp'; }

  /** @type {Map<string, boolean>} dedup cache */
  #seen = new Map();

  /**
   * Returns the main message-list container.
   * @returns {Element|null}
   */
  #getMessageList() {
    // The message list has role="application" and contains role="row" items.
    // Falls back to looking for the first large scrollable div inside the chat panel.
    return (
      document.querySelector('[data-tab="8"]') ||
      document.querySelector('div[role="application"]') ||
      document.querySelector('#main') ||
      null
    );
  }

  /**
   * Finds the actual scrollable element that holds message rows —
   * the list container itself often isn't the scroller.
   * @param {Element} list
   * @returns {Element}
   */
  #getScroller(list) {
    let el = list.querySelector('[data-pre-plain-text]') || list;
    while (el && el !== document.body) {
      if (el.scrollHeight > el.clientHeight + 50) return el;
      el = el.parentElement;
    }
    return list;
  }

  isChatOpen() {
    const list = this.#getMessageList();
    const composer = this.getComposerBox();
    return !!(list && composer);
  }

  isGroupChat() {
    // Group header shows multiple participants in the subtitle / context
    // Also: in group chats, message bubbles from others include a sender-name div above the text
    const headerInfo = document.querySelector('header [data-testid="conversation-info-header"]') ||
      document.querySelector('header span[dir="auto"]');
    // Look for the "participants" label in the subtitle
    const subtitle = document.querySelector('header span[data-testid="subtitle-description"]') ||
      document.querySelector('header div._21S-L') ||
      document.querySelector('header div[class*="subtitle"]');
    if (subtitle) {
      const txt = subtitle.textContent || '';
      // Group subtitles list participant names separated by commas
      if ((txt.match(/,/g) || []).length >= 1) return true;
    }
    return false;
  }

  getMyName() {
    // WhatsApp doesn't expose "my name" easily; profile page is separate.
    // Best effort: look at profile button aria-label
    const profile = document.querySelector('[data-testid="menu-bar-profile"] img');
    if (profile && profile.alt && profile.alt !== '') return profile.alt;
    return 'Me';
  }

  getComposerBox() {
    return (
      document.querySelector('[data-testid="conversation-compose-box-input"]') ||
      document.querySelector('div[contenteditable="true"][data-tab="10"]') ||
      document.querySelector('#main footer div[contenteditable="true"]') ||
      document.querySelector('div[contenteditable="true"][role="textbox"]') ||
      null
    );
  }

  /**
   * Parses a `data-pre-plain-text` attribute like "[12:01 PM, 7/12/2026] Shohan Sir: "
   * @param {string} pre
   * @returns {{ time: string, date: string, sender: string } | null}
   */
  #parsePrePlainText(pre) {
    // Format: "[H:MM AM, M/D/YYYY] Name: "  OR  "[HH:MM, DD/MM/YYYY] Name: "
    const m = pre.match(/^\[(.+?),\s*(.+?)\]\s*(.*?):\s*$/);
    if (!m) return null;
    return { time: m[1].trim(), date: m[2].trim(), sender: m[3].trim() };
  }

  /**
   * Converts time+date strings to a unix timestamp (best effort).
   * @param {string} time e.g. "12:01 PM"
   * @param {string} date e.g. "7/12/2026"
   * @returns {number}
   */
  #toTimestamp(time, date) {
    try {
      return new Date(`${date} ${time}`).getTime() || Date.now();
    } catch {
      return Date.now();
    }
  }

  /**
   * Scrapes all currently-visible message rows and optionally scrolls up to gather history.
   * @param {{ maxMessages?: number, scrollForHistory?: boolean }} [opts]
   * @returns {Promise<import('./base.js').Message[]>}
   */
  async scrapeMessages({ maxMessages = 80, scrollForHistory = true } = {}) {
    const list = this.#getMessageList();
    if (!list) return [];

    if (scrollForHistory) {
      await this.#scrollUpToLoad(list, maxMessages);
    }

    return this.#extractVisibleMessages(list, maxMessages);
  }

  /**
   * Programmatically scrolls the message list up to load older messages.
   * @param {Element} list
   * @param {number} targetCount
   */
  async #scrollUpToLoad(list, targetCount) {
    const scroller = this.#getScroller(list);
    const MAX_SCROLLS = 15;
    for (let i = 0; i < MAX_SCROLLS; i++) {
      const rows = list.querySelectorAll('[data-pre-plain-text]');
      if (rows.length >= targetCount) break;
      const before = scroller.scrollTop;
      scroller.scrollTop = 0;
      await new Promise(r => setTimeout(r, 400));
      if (scroller.scrollTop === before) break; // hit the top
    }
    // Scroll back to bottom
    scroller.scrollTop = scroller.scrollHeight;
    await new Promise(r => setTimeout(r, 200));
  }

  /**
   * Extracts normalized messages from currently rendered rows, keeping only
   * the most recent `maxMessages` (your own messages and others' both count
   * toward the total).
   * @param {Element} list
   * @param {number} [maxMessages]
   * @returns {import('./base.js').Message[]}
   */
  #extractVisibleMessages(list, maxMessages = Infinity) {
    const isGroup = this.isGroupChat();
    const messages = [];
    this.#seen.clear();

    const rows = list.querySelectorAll('div[role="row"]');
    rows.forEach(row => {
      // Find the element with data-pre-plain-text (present on copyable-text spans)
      const copyable = row.querySelector('[data-pre-plain-text]');
      if (!copyable) return; // system messages, date dividers, etc.

      const pre = copyable.getAttribute('data-pre-plain-text') || '';
      const parsed = this.#parsePrePlainText(pre);
      if (!parsed) return;

      // Determine direction
      // WhatsApp uses "message-in" / "message-out" on an ancestor container
      const isOut = row.querySelector('[class*="message-out"]') !== null ||
        !!row.closest('[class*="message-out"]');
      const isIn = row.querySelector('[class*="message-in"]') !== null ||
        !!row.closest('[class*="message-in"]');
      const isMe = isOut && !isIn;

      // Extract text content from the copyable element
      let text = copyable.querySelector('span.selectable-text')?.innerText ||
        copyable.innerText ||
        copyable.textContent ||
        '';
      text = text.trim();
      if (!text) return;

      // Check for quoted / replied-to text
      let quotedText;
      const quoteBlock = row.querySelector('[data-testid="quoted-message"]') ||
        row.querySelector('div[role="button"] span[dir="ltr"]');
      if (quoteBlock) {
        quotedText = quoteBlock.textContent?.trim();
      }

      // Check for @mention of me (WhatsApp marks mentions as spans with data-mention)
      const mentionSpans = row.querySelectorAll('[data-mention]');
      const myName = this.getMyName();
      let mentionsMe = false;
      mentionSpans.forEach(s => {
        const txt = (s.getAttribute('data-mention') || s.textContent || '').toLowerCase();
        if (txt.includes(myName.toLowerCase()) || txt.includes('@you')) mentionsMe = true;
      });

      const ts = this.#toTimestamp(parsed.time, parsed.date);
      const id = makeMessageId(parsed.sender, ts, text);

      if (this.#seen.has(id)) return; // deduplicate
      this.#seen.set(id, true);

      messages.push({
        id,
        sender: parsed.sender,
        isMe,
        text,
        ts,
        isGroup,
        mentionsMe,
        quotedText,
      });
    });

    // Rows are in chronological order (oldest first), so the tail is the most
    // recent conversation — keep the last N, interleaving mine and others'.
    return Number.isFinite(maxMessages) ? messages.slice(-maxMessages) : messages;
  }
}
