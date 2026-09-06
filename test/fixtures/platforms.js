/**
 * DOM fixtures approximating each supported chat app's markup.
 *
 * These verify the scraping *engine*: that a platform config drives element
 * resolution, row parsing, each direction strategy, sender carry-forward,
 * timestamps and quote handling correctly. They are not a claim that the
 * selectors still match the live sites — see README for that caveat.
 */

export const FIXTURES = {
  whatsapp: {
    url: 'https://web.whatsapp.com/',
    html: `
      <header><span title="Ops Team"></span>
        <span data-testid="subtitle-description">Ayaan, Rafi, Nadia</span></header>
      <div id="main" data-tab="8" role="application">
        <div role="row"><div class="message-in focusable">
          <div class="copyable-text" data-pre-plain-text="[10:01 AM, 3/4/2026] Rafi: ">
            <span class="selectable-text"><span>are we still on for four?</span></span>
          </div></div></div>
        <div role="row"><div class="message-out focusable">
          <div class="copyable-text" data-pre-plain-text="[10:03 AM, 3/4/2026] Me: ">
            <span class="selectable-text"><span>yes, see you then</span></span>
          </div></div></div>
        <div role="row"><div class="message-in focusable">
          <div class="copyable-text" data-pre-plain-text="[10:05 AM, 3/4/2026] Nadia: ">
            <span class="quoted-mention">are we still on for four?</span>
            <span class="selectable-text"><span>I will be ten minutes late</span></span>
          </div></div></div>
      </div>
      <footer><div contenteditable="true" role="textbox" data-tab="10"></div></footer>`,
    expect: {
      count: 3,
      senders: ['Rafi', 'Me', 'Nadia'],
      mine: [false, true, false],
      isGroup: true,
      lastQuote: 'are we still on for four?',
      lastText: 'I will be ten minutes late',
      stableTimestamps: true,
    },
  },

  messenger: {
    url: 'https://www.messenger.com/t/123',
    html: `
      <div role="banner"><h1 role="heading">Rafi Ahmed</h1></div>
      <div role="main"><div role="grid">
        <div role="row" aria-label="Rafi Ahmed, 10:01"><div dir="auto"><span>lunch tomorrow?</span></div></div>
        <div role="row" aria-label="You sent, 10:02"><div dir="auto"><span>works for me</span></div></div>
        <div role="row" aria-label="Rafi Ahmed, 10:04"><div dir="auto"><span>great, one o'clock</span></div></div>
      </div></div>
      <div contenteditable="true" aria-label="Message"></div>`,
    expect: {
      count: 3,
      senders: ['Rafi Ahmed', 'You sent', 'Rafi Ahmed'],
      mine: [false, true, false],
      stableTimestamps: false,
    },
  },

  discord: {
    url: 'https://discord.com/channels/1/2',
    html: `
      <section aria-label="channel header"><h1>general</h1></section>
      <ol data-list-id="chat-messages">
        <li id="chat-messages-1">
          <span id="message-username-1">rafi</span>
          <time datetime="2026-03-04T10:01:00.000Z"></time>
          <div id="message-content-1">deploy is green</div>
        </li>
        <li id="chat-messages-2">
          <time datetime="2026-03-04T10:02:00.000Z"></time>
          <div id="message-content-2">nice, shipping it</div>
        </li>
        <li id="chat-messages-3">
          <span id="message-username-3">sami</span>
          <time datetime="2026-03-04T10:03:00.000Z"></time>
          <div id="message-content-3">thanks both</div>
        </li>
      </ol>
      <section aria-label="User area"><div class="nameTag-x">sami</div></section>
      <div role="textbox" data-slate-editor="true" contenteditable="true"></div>`,
    expect: {
      count: 3,
      // The second row has no username: Discord only labels the first of a run.
      senders: ['rafi', 'rafi', 'sami'],
      mine: [false, false, true],
      myName: 'sami',
      stableTimestamps: true,
      firstTs: Date.parse('2026-03-04T10:01:00.000Z'),
    },
  },

  slack: {
    url: 'https://app.slack.com/client/T1/C1',
    html: `
      <div data-qa="channel_header"><div data-qa="channel_name">#release</div></div>
      <div class="c-virtual_list__scroll_container">
        <div data-qa="virtual-list-item">
          <button data-qa="message_sender_name">Nadia</button>
          <span class="c-timestamp" data-ts="1772618460.000100"></span>
          <div data-qa="message-text">cutting the release now</div>
        </div>
        <div data-qa="virtual-list-item">
          <button data-qa="message_sender_name">Sami Khan</button>
          <span class="c-timestamp" data-ts="1772618520.000200"></span>
          <div data-qa="message-text">ack, watching the dashboard</div>
        </div>
      </div>
      <div data-qa="user-button"><img alt="Sami Khan"></div>
      <div data-qa="message_input"><div class="ql-editor" role="textbox" contenteditable="true"></div></div>`,
    expect: {
      count: 2,
      senders: ['Nadia', 'Sami Khan'],
      mine: [false, true],
      myName: 'Sami Khan',
      stableTimestamps: true,
      firstTs: 1772618460000,
    },
  },

  telegram: {
    url: 'https://web.telegram.org/k/',
    html: `
      <div class="chat-info"><div class="peer-title">Study Group</div></div>
      <div class="bubbles-inner">
        <div class="bubble is-in"><div class="translatable-message">notes are uploaded</div></div>
        <div class="bubble is-out"><div class="translatable-message">got them, thanks</div></div>
      </div>
      <div class="input-message-input" contenteditable="true"></div>`,
    expect: {
      count: 2,
      mine: [false, true],
      stableTimestamps: false,
    },
  },

  linkedin: {
    url: 'https://www.linkedin.com/messaging/thread/1',
    html: `
      <header><a class="msg-thread__link-to-profile">Priya Nair</a></header>
      <ul class="msg-s-message-list-content">
        <li class="msg-s-message-list__event">
          <span class="msg-s-message-group__name">Priya Nair</span>
          <time datetime="2026-03-04T09:00:00.000Z"></time>
          <p class="msg-s-event-listitem__body">are you open to a chat this week?</p>
        </li>
        <li class="msg-s-message-list__event">
          <span class="msg-s-message-group__name">Sami Khan</span>
          <time datetime="2026-03-04T09:30:00.000Z"></time>
          <p class="msg-s-event-listitem__body">happy to, Thursday suits me</p>
        </li>
      </ul>
      <img class="global-nav__me-photo" alt="Sami Khan">
      <div class="msg-form__contenteditable" contenteditable="true" role="textbox"></div>`,
    expect: {
      count: 2,
      senders: ['Priya Nair', 'Sami Khan'],
      mine: [false, true],
      myName: 'Sami Khan',
      stableTimestamps: true,
    },
  },

  // Telegram after a hypothetical redesign: not one of its configured selectors
  // matches, so every slot has to fall through to the structural fallback.
  redesigned: {
    url: 'https://web.telegram.org/a/',
    html: `
      <div class="topbar"><h1 role="heading">Support</h1></div>
      <div role="log">
        <div role="row"><time datetime="2026-03-04T08:00:00.000Z"></time><p dir="auto">is anyone there?</p></div>
        <div role="row"><time datetime="2026-03-04T08:01:00.000Z"></time><p dir="auto">yes, how can I help</p></div>
      </div>
      <div role="textbox" contenteditable="true"></div>`,
    expect: {
      count: 2,
      lastText: 'yes, how can I help',
    },
  },
};
