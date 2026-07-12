import { BaseAdapter, makeMessageId } from './base.js';

/**
 * Facebook Messenger adapter.
 * More fragile than WhatsApp — no `data-pre-plain-text` gift.
 * Anchors on ARIA roles and structural layout for sender/direction inference.
 */
export class MessengerAdapter extends BaseAdapter {
  get name() { return 'messenger'; }

  /** @type {Map<string, boolean>} dedup cache */
  #seen = new Map();

  #getMessageList() {
    return (
      document.querySelector('[role="main"] [role="grid"]') ||
      document.querySelector('[role="main"] [role="log"]') ||
      document.querySelector('[data-testid="messenger_thread_container"]') ||
      null
    );
  }

  isChatOpen() {
    return !!(this.#getMessageList() && this.getComposerBox());
  }

  isGroupChat() {
    // Messenger group chats show multiple avatars in the header
    const header = document.querySelector('[role="banner"]') || document.querySelector('div[data-pagelet="MWThreadList"]');
    if (!header) return false;
    const avatars = header.querySelectorAll('img[aria-label]');
    return avatars.length > 2;
  }

  getComposerBox() {
    return (
      document.querySelector('[contenteditable="true"][aria-label*="message"]') ||
      document.querySelector('[contenteditable="true"][aria-placeholder]') ||
      null
    );
  }

  async scrapeMessages({ maxMessages = 80, scrollForHistory = true } = {}) {
    const list = this.#getMessageList();
    if (!list) return [];

    if (scrollForHistory) {
      await this.#scrollUpToLoad(list, maxMessages);
    }

    return this.#extractVisibleMessages(list);
  }

  async #scrollUpToLoad(list, targetCount) {
    const MAX_SCROLLS = 15;
    for (let i = 0; i < MAX_SCROLLS; i++) {
      const rows = list.querySelectorAll('[role="row"]');
      if (rows.length >= targetCount) break;
      const before = list.scrollTop;
      list.scrollTop = 0;
      await new Promise(r => setTimeout(r, 500));
      if (list.scrollTop === before) break;
    }
    list.scrollTop = list.scrollHeight;
    await new Promise(r => setTimeout(r, 200));
  }

  #extractVisibleMessages(list) {
    const isGroup = this.isGroupChat();
    const messages = [];
    this.#seen.clear();

    // In Messenger, message rows contain either role="row" or aria-label
    const rows = list.querySelectorAll('[role="row"]');
    let rowIndex = 0;

    rows.forEach(row => {
      // Find message text (usually inside a span or div with dir="auto")
      const textEl = row.querySelector('div[dir="auto"] > span') ||
        row.querySelector('[dir="auto"]');
      if (!textEl) return;

      const text = textEl.textContent?.trim();
      if (!text) return;

      // Determine sender by looking at avatar and aria-label on the row
      const ariaLabel = row.getAttribute('aria-label') || '';
      let sender = 'Unknown';
      const labelMatch = ariaLabel.match(/^([^,]+),/);
      if (labelMatch) sender = labelMatch[1].trim();

      // Infer direction from layout: outgoing messages are right-aligned
      // Check if the row has a right-side avatar or text alignment
      const rowRect = row.getBoundingClientRect();
      const textRect = textEl.getBoundingClientRect();
      const isMe = textRect.left > (rowRect.left + rowRect.width * 0.4);

      // Check for quoted messages
      let quotedText;
      const quoteEl = row.querySelector('[aria-label*="replied"]') ||
        row.querySelector('div[style*="border-left"]');
      if (quoteEl) quotedText = quoteEl.textContent?.trim();

      const ts = Date.now() - (rows.length - rowIndex) * 60000; // rough ordering
      rowIndex++;

      const id = makeMessageId(sender, ts, text);
      if (this.#seen.has(id)) return;
      this.#seen.set(id, true);

      messages.push({
        id,
        sender,
        isMe,
        text,
        ts,
        isGroup,
        mentionsMe: false, // Messenger mentions are complex; skip for v1
        quotedText,
      });
    });

    return messages;
  }
}
