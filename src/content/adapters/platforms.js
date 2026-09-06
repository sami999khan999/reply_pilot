/**
 * platforms.js — declarative descriptions of the chat apps we support.
 *
 * Every platform used to mean a hand-written adapter class. That does not scale
 * past two, and the second one was already mostly a copy of the first with
 * different selectors. A platform is now a config object; `generic.js` is the
 * single engine that reads it.
 *
 * Selectors are ordered most-specific first and the engine takes the first that
 * matches, so a stale entry costs nothing but a failed lookup. Anything a config
 * cannot resolve falls back to GENERIC below, which anchors on ARIA roles rather
 * than class names — that is what keeps a platform working when it ships a
 * redesign, and what lets an unlisted app work at all.
 *
 * DIRECTION STRATEGIES — how "is this message mine?" is decided:
 *   'class'  the bubble carries an outgoing/incoming class token (WhatsApp,
 *            Telegram). Exact and free.
 *   'aria'   the row's aria-label names the sender (Messenger's "You sent ...").
 *   'sender' everything is left-aligned and identity comes from the displayed
 *            name (Discord, Slack, LinkedIn, Google Chat).
 *   'align'  last resort: compare the bubble's horizontal position to its row.
 *            Costs a layout read, so it is batched across all rows at once.
 */

/**
 * @typedef {object} PlatformConfig
 * @property {string} id
 * @property {string} label
 * @property {string} accent brand colour, used when the page offers none
 * @property {(url: URL) => boolean} matches
 * @property {string[]} list message-list container
 * @property {string[]} composer
 * @property {string[]} [header]
 * @property {string[]} row message rows within the list
 * @property {string[]} text message text within a row
 * @property {string[]} [quote]
 * @property {string[]} [title] chat title, for the per-chat cache key
 * @property {('class'|'aria'|'sender'|'align')[]} direction strategies, in order
 * @property {{ out: string[], in: string[] }} [directionClass]
 * @property {RegExp} [outgoingAria]
 * @property {string[]} [sender]
 * @property {RegExp} [senderAria] capture group 1 is the sender name
 * @property {string[]} [myName] where the page shows the signed-in user's name
 * @property {RegExp} [myNamePattern] capture group 1 extracts it from a longer label
 * @property {{ selector: string[], attr: string }} [timestamp]
 * @property {boolean} [stableTimestamps] true when a real per-message date is available
 * @property {boolean} [ownParser] a subclass supplies sender/time/direction itself
 * @property {string[]} [groupHint] presence implies a group conversation
 * @property {number} [groupAvatarThreshold] more header avatars than this = group
 */

const host = (...suffixes) => (url) =>
  suffixes.some(s => url.hostname === s || url.hostname.endsWith('.' + s));

const hostPath = (suffix, prefix) => (url) =>
  (url.hostname === suffix || url.hostname.endsWith('.' + suffix)) &&
  url.pathname.startsWith(prefix);

/**
 * Structural fallback. Every selector list a platform config leaves out — or
 * that stops matching after a redesign — falls through to these, which describe
 * a chat surface in terms of the accessibility tree rather than markup details.
 * @type {PlatformConfig}
 */
export const GENERIC = {
  id: 'generic',
  label: 'Chat',
  accent: '#5b7cfa',
  matches: () => false, // never selected directly; only used as a fallback
  list: [
    '[role="log"]',
    '[role="main"] [role="grid"]',
    '[role="main"] [role="list"]',
    '[role="grid"]',
    'main [role="feed"]',
  ],
  composer: [
    '[contenteditable="true"][role="textbox"]',
    '[role="textbox"][contenteditable="true"]',
    'form [contenteditable="true"]',
    '[contenteditable="true"]',
    'textarea[placeholder]',
  ],
  header: ['[role="banner"]', 'header'],
  row: ['[role="row"]', '[role="listitem"]', 'li'],
  text: ['[dir="auto"]', 'p', 'span'],
  quote: ['blockquote', '[class*="quote" i]', '[class*="reply" i]'],
  title: ['h1', '[role="heading"]', 'header span[title]'],
  direction: ['align'],
  timestamp: { selector: ['time[datetime]'], attr: 'datetime' },
  groupAvatarThreshold: 2,
};

/** @type {PlatformConfig[]} */
export const PLATFORMS = [
  {
    id: 'whatsapp',
    label: 'WhatsApp',
    accent: '#25d366',
    matches: host('web.whatsapp.com'),
    list: ['[data-tab="8"]', 'div[role="application"]', '#main'],
    composer: [
      '[data-testid="conversation-compose-box-input"]',
      'div[contenteditable="true"][data-tab="10"]',
      '#main footer div[contenteditable="true"]',
    ],
    header: ['#main header', 'header'],
    row: ['[data-pre-plain-text]'],
    text: ['span.selectable-text'],
    quote: ['[data-testid="quoted-message"]', '.quoted-mention'],
    title: ['span[title]'],
    // WhatsApp churns class names; its bubbles are genuinely left/right
    // aligned, so align is a real second chance rather than a guess. Without it,
    // a renamed marker makes every message — your own included — read as theirs.
    direction: ['class', 'align'],
    directionClass: { out: ['message-out'], in: ['message-in'] },
    myName: ['[data-testid="menu-bar-profile"] img'],
    // Sender, timestamp and direction all come out of data-pre-plain-text,
    // which is why WhatsApp keeps a dedicated parser (see whatsapp.js).
    ownParser: true,
    stableTimestamps: true,
    groupHint: [
      'header span[data-testid="subtitle-description"]',
      'header div[class*="subtitle"]',
    ],
  },

  {
    id: 'messenger',
    label: 'Messenger',
    accent: '#0084ff',
    matches: (url) =>
      host('messenger.com')(url) || hostPath('facebook.com', '/messages')(url),
    list: [
      '[role="main"] [role="grid"]',
      '[role="main"] [role="log"]',
      '[data-testid="messenger_thread_container"]',
    ],
    composer: [
      '[contenteditable="true"][aria-label*="message" i]',
      '[contenteditable="true"][aria-placeholder]',
    ],
    header: ['[role="banner"]', '[role="main"] [role="heading"]'],
    row: ['[role="row"]'],
    text: ['div[dir="auto"] > span', '[dir="auto"]'],
    quote: ['[aria-label*="replied" i]'],
    title: ['[role="heading"]', 'h1'],
    direction: ['aria', 'align'],
    outgoingAria: /^you\b/i,
    senderAria: /^([^,]+),/,
    groupAvatarThreshold: 2,
  },

  {
    id: 'instagram',
    label: 'Instagram',
    accent: '#e1306c',
    matches: hostPath('instagram.com', '/direct'),
    list: ['[role="main"] [role="grid"]', 'div[aria-label*="Messages" i]', '[role="grid"]'],
    composer: [
      'div[role="textbox"][contenteditable="true"]',
      'textarea[placeholder*="Message" i]',
    ],
    header: ['[role="main"] header', 'header'],
    row: ['[role="row"]', '[role="listitem"]'],
    text: ['div[dir="auto"] span', '[dir="auto"]'],
    title: ['header [role="heading"]', 'header h1', 'header span[dir="auto"]'],
    direction: ['aria', 'align'],
    outgoingAria: /^you sent\b/i,
    groupAvatarThreshold: 2,
  },

  {
    id: 'telegram',
    label: 'Telegram',
    accent: '#3390ec',
    matches: host('web.telegram.org'),
    list: ['.bubbles-inner', '.messages-container', '#column-center .scrollable-y'],
    composer: [
      '.input-message-input[contenteditable="true"]',
      '#editable-message-text',
      'div[contenteditable="true"][role="textbox"]',
    ],
    header: ['.chat-info', '.topbar', '#MiddleHeader'],
    row: ['.bubble', '.Message', '[data-mid]'],
    text: ['.translatable-message', '.text-content', '.message .text'],
    quote: ['.reply-wrapper', '.EmbeddedMessage'],
    title: ['.peer-title', '.chat-info .title', '.ChatInfo .title'],
    direction: ['class', 'align'],
    directionClass: { out: ['is-out', 'own'], in: ['is-in'] },
    sender: ['.peer-title', '.message-title-name', '.sender-title'],
    timestamp: { selector: ['.time[title]', 'time[datetime]'], attr: 'title' },
    stableTimestamps: false, // the title format is locale-dependent
    groupHint: ['.chat-info .subtitle .online-count', '.ChatInfo .status .group'],
  },

  {
    id: 'discord',
    label: 'Discord',
    accent: '#5865f2',
    matches: host('discord.com', 'discordapp.com'),
    // Discord's class names are content-hashed, so anchor on ids and data attrs.
    list: ['[data-list-id="chat-messages"]', 'main[class*="chatContent"] ol'],
    composer: ['div[role="textbox"][data-slate-editor="true"]', 'div[role="textbox"][contenteditable="true"]'],
    header: ['section[aria-label*="channel header" i]', 'section[class*="title"]'],
    row: ['li[id^="chat-messages-"]', '[class*="messageListItem"]'],
    text: ['div[id^="message-content-"]', '[class*="messageContent"]'],
    quote: ['[id^="message-reply-context-"]', '[class*="repliedMessage"]'],
    title: ['[class*="title"] h1', 'section[aria-label] h1'],
    // Everyone's messages are left-aligned; identity is the displayed name.
    direction: ['sender'],
    sender: ['span[id^="message-username-"]', '[class*="username"]'],
    myName: ['section[aria-label*="User area" i] [class*="nameTag"]', '[class*="panelTitle"]'],
    timestamp: { selector: ['time[datetime]'], attr: 'datetime' },
    stableTimestamps: true,
    groupAvatarThreshold: 2,
  },

  {
    id: 'slack',
    label: 'Slack',
    accent: '#611f69',
    matches: host('slack.com'),
    list: ['.c-virtual_list__scroll_container', '[data-qa="slack_kit_list"]', '[role="log"]'],
    composer: ['[data-qa="message_input"] .ql-editor', 'div[role="textbox"][contenteditable="true"]'],
    header: ['[data-qa="channel_header"]', '.p-view_header'],
    row: ['[data-qa="virtual-list-item"]', '.c-message_kit__background'],
    text: ['[data-qa="message-text"]', '.p-rich_text_section'],
    quote: ['.c-message_attachment', '[data-qa="message_attachment"]'],
    title: ['[data-qa="channel_name"]', '.p-view_header__text'],
    direction: ['sender'],
    sender: ['[data-qa="message_sender_name"]', '.c-message__sender_button'],
    myName: ['[data-qa="user-button"] img[alt]', '.p-ia__nav__user__button'],
    timestamp: { selector: ['.c-timestamp[data-ts]'], attr: 'data-ts' },
    stableTimestamps: true,
    groupHint: ['[data-qa="channel_header"] [data-qa="channel_member_count"]'],
  },

  {
    id: 'x',
    label: 'X',
    accent: '#1d9bf0',
    matches: (url) =>
      (host('x.com', 'twitter.com')(url)) && url.pathname.startsWith('/messages'),
    list: ['[data-testid="DmActivityViewport"]', 'section[aria-label*="Messages" i]'],
    composer: ['[data-testid="dmComposerTextInput"]', 'div[role="textbox"][contenteditable="true"]'],
    header: ['[data-testid="DmActivityHeader"]', 'header'],
    row: ['[data-testid="messageEntry"]', '[data-testid="cellInnerDiv"]'],
    text: ['[data-testid="tweetText"]', 'span[dir="auto"]'],
    title: ['[data-testid="DmActivityHeader"] span', 'header span'],
    direction: ['align'],
    timestamp: { selector: ['time[datetime]'], attr: 'datetime' },
    stableTimestamps: true,
    groupAvatarThreshold: 2,
  },

  {
    id: 'linkedin',
    label: 'LinkedIn',
    accent: '#0a66c2',
    matches: hostPath('linkedin.com', '/messaging'),
    list: ['.msg-s-message-list-content', '.msg-s-message-list', '[role="log"]'],
    composer: ['.msg-form__contenteditable', 'div[role="textbox"][contenteditable="true"]'],
    header: ['.msg-thread__link-to-profile', '.msg-entity-lockup', 'header'],
    row: ['.msg-s-message-list__event', 'li.msg-s-event-listitem'],
    text: ['.msg-s-event-listitem__body', '.msg-s-event__content'],
    title: ['.msg-thread__link-to-profile', '.msg-entity-lockup__entity-title'],
    direction: ['sender'],
    sender: ['.msg-s-message-group__name', '.msg-s-message-group__profile-link'],
    myName: ['.global-nav__me-photo[alt]', 'img.global-nav__me-photo'],
    timestamp: { selector: ['time[datetime]'], attr: 'datetime' },
    stableTimestamps: true,
    groupAvatarThreshold: 2,
  },

  {
    id: 'google-chat',
    label: 'Google Chat',
    accent: '#1a73e8',
    matches: (url) =>
      host('chat.google.com')(url) ||
      (host('mail.google.com')(url) && url.pathname.includes('/chat')),
    list: ['[role="log"]', 'div[role="list"]', '[role="main"] [role="list"]'],
    composer: ['div[role="textbox"][contenteditable="true"]', 'textarea[aria-label*="message" i]'],
    header: ['[role="main"] [role="heading"]', 'header'],
    row: ['div[role="listitem"]', 'div[data-topic-id]'],
    text: ['[role="listitem"] [jsname]', '[dir="auto"]'],
    title: ['[role="main"] [role="heading"]', 'h1'],
    direction: ['sender', 'align'],
    sender: ['[data-member-id] [role="button"]', '[class*="sender"]'],
    myName: ['a[aria-label*="Google Account" i]', 'a[href*="SignOutOptions"]'],
    myNamePattern: /Google Account:\s*([^(]+)/i,
    timestamp: { selector: ['time[datetime]', '[data-absolute-timestamp]'], attr: 'datetime' },
    stableTimestamps: true,
    groupAvatarThreshold: 2,
  },
];

/**
 * Finds the config describing the page at `url`.
 * @param {URL|Location} url
 * @returns {PlatformConfig|null}
 */
export function findPlatform(url) {
  const parsed = url instanceof URL ? url : new URL(String(url.href ?? url));
  for (let i = 0; i < PLATFORMS.length; i++) {
    if (PLATFORMS[i].matches(parsed)) return PLATFORMS[i];
  }
  return null;
}

/**
 * Selector list for one slot, with the structural fallback appended. A config
 * that has gone stale degrades to ARIA-based detection rather than failing.
 *
 * @param {PlatformConfig} config
 * @param {keyof PlatformConfig} slot
 * @returns {string[]}
 */
export function selectorsFor(config, slot) {
  const own = config[slot];
  const fallback = GENERIC[slot];
  if (!Array.isArray(own)) return Array.isArray(fallback) ? fallback : [];
  if (!Array.isArray(fallback)) return own;
  return [...own, ...fallback.filter(sel => !own.includes(sel))];
}
