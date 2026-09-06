# Reply Pilot — Chrome Extension

> On-device AI reply assistant for nine chat platforms, powered by Chrome's built-in **Gemini Nano**. No server, no API key, no libraries.

---

## What it does

Opens a slide-in panel on any supported chat tab that:
- **Reads** the conversation without ever scrolling it — history is banked passively as the chat app renders it
- **Decides** whether you even need to reply (with a reason)
- **Drafts** 3 reply options matched to the conversation's tone and language
- Handles **broadcast/announcement** chats where the last message is just an acknowledgement — drafts reply to the *original* announcement instead
- Lets you **Insert** directly into the composer or **Copy** to clipboard
- Generates **3 more** alternatives on demand
- **Looks like the site it is on** — the panel takes its colours from the chat app, in whichever theme you have it set to

Everything runs locally — no data leaves your device.

---

## Supported platforms

| Platform | Where |
|---|---|
| WhatsApp | `web.whatsapp.com` |
| Messenger | `messenger.com`, `facebook.com/messages` |
| Instagram DMs | `instagram.com/direct` |
| Telegram | `web.telegram.org` |
| Discord | `discord.com/channels` |
| Slack | `app.slack.com` |
| X | `x.com/messages`, `twitter.com/messages` |
| LinkedIn | `linkedin.com/messaging` |
| Google Chat | `chat.google.com`, `mail.google.com/chat` |

Adding one is a config entry in `src/content/adapters/platforms.js` — selectors
plus a direction strategy — not a new adapter class. See **Adding a platform**
below.

**A caveat worth stating plainly:** WhatsApp and Messenger are the two that have
been exercised most. The other configs are written from each app's known markup
but have not been verified against the live sites, and these apps change their
DOM without notice. When one drifts, the panel degrades rather than breaking —
see **Resilience** — and the fix is a one-line selector change in that config.

---

## Requirements

| Requirement | Detail |
|---|---|
| Browser | Chrome 138+ (desktop: Windows, macOS, Linux) |
| Hardware | 4+ GB VRAM *or* 16+ GB RAM with 4+ CPU cores |
| Disk | ~22 GB free space for the browser profile volume |
| Model | Gemini Nano — downloads automatically (~2 GB, one-time) |

---

## Setup

### 1. Enable the required Chrome flags

Open `chrome://flags` and enable:

- `#prompt-api-for-gemini-nano` → **Enabled**
- `#optimization-guide-on-device-model` → **Enabled BypassPerfRequirement** (if hardware check fails)
- `#summarization-api-for-gemini-nano` → **Enabled**

Restart Chrome after changing flags.

### 2. Verify Gemini Nano is available

Go to `chrome://on-device-internals` and check the model status. Or open DevTools on any page and run:

```js
(await LanguageModel.capabilities()).available
// Should print: "readily"
```

If it prints `"after-download"`, the model will download on first use (this may take a few minutes on first run — the panel shows a progress indicator).

### 3. Load the extension

1. Open `chrome://extensions/`
2. Enable **Developer mode** (top right toggle)
3. Click **Load unpacked**
4. Select the root of this project folder (`reply_pilot-chrome-ext/`)

### 4. Use it

- Open any of the supported platforms above
- Open a chat — a **floating button** (✈), in that site's accent colour, appears in the bottom-right corner
- Click it to open the Reply Pilot panel
- Click **Insert** to put the reply into the compose box, or **Copy** to copy it

---

## Architecture

```
Content Script (chat page)
  ├── loader.js           — classic-script stub that imports the module graph
  ├── detector.js         — match the URL to a platform, build its adapter
  ├── lifecycle.js        — the only recurring timer; stops when the tab hides
  ├── dom/query.js        — element resolution cached until the node detaches
  ├── adapters/
  │   ├── platforms.js    — one config per chat app, plus a structural fallback
  │   ├── generic.js      — the scraping engine every platform is driven by
  │   └── whatsapp.js     — the one subclass, for data-pre-plain-text
  ├── logic/
  │   ├── scrape.js       — layout-free text reading and bounded tree walks
  │   ├── messageCache.js — banks history as the app renders it, so nothing scrolls
  │   └── composerInsert.js — fire real InputEvents into contenteditable boxes
  ├── ui/ (Shadow DOM)
  │   ├── mount.js        — shadow host; the panel is built on first open
  │   ├── theme.js        — read the host site's colours, derive the palette
  │   ├── fab.js          — floating button
  │   ├── panel.js        — slide-in panel, delegated events, all states
  │   └── panel.css.js    — token-driven CSS adopted into the shadow root
  └── orchestrator.js     — wires all the above together

Service Worker
  ├── logic/
  │   ├── classifier.js   — heuristic "do I need to reply?" rules
  │   └── rootFinder.js   — find broadcast root in group announcement threads
  ├── ai/
  │   ├── availability.js — check LanguageModel / Summarizer availability
  │   ├── promptSession.js — reusable LanguageModel session
  │   ├── summarizer.js   — compress old history with Summarizer API
  │   ├── budget.js       — token counting + windowing
  │   └── prompts.js      — system prompt, schema, payload builder
  └── service-worker.js   — message router, abort handling, retained context

Shared
  ├── settings.js         — user preferences (chrome.storage.sync)
  ├── text.js             — message-text normalization and similarity
  └── color.js            — colour maths behind the theme matching
```

Classification and root-finding run in the service worker, not the content
script: they are pure functions over the message array that crosses to the
worker anyway, and running them on the chat page's main thread only blocked it.

---

## Adding a platform

Add a config to `src/content/adapters/platforms.js` and a match to
`manifest.json`. No new class — `generic.js` is the engine for all of them.

```js
{
  id: 'example',
  label: 'Example',
  accent: '#5b7cfa',            // the site's brand colour; the panel picks it up
  matches: (url) => url.hostname === 'chat.example.com',
  list: ['.message-scroller'],  // ordered most-specific first
  composer: ['.composer[contenteditable="true"]'],
  header: ['.thread-header'],
  row: ['.message'],
  text: ['.message-body'],
  direction: ['class'],
  directionClass: { out: ['is-mine'], in: ['is-theirs'] },
}
```

**Direction strategies** decide "is this message mine?", and a config lists them
in preference order:

| Strategy | How | Used by |
|---|---|---|
| `class` | an outgoing/incoming class token on the bubble | WhatsApp, Telegram |
| `aria` | the row's own label, e.g. "You sent …" | Messenger, Instagram |
| `sender` | compare the displayed name to the signed-in user | Discord, Slack, LinkedIn |
| `align` | where the bubble sits in its row | X, and as a last resort |

`align` is the only one that reads layout, and it is batched across every row in
a single pass rather than measured per row.

### Resilience

Every selector list falls through to a structural fallback built on ARIA roles
(`GENERIC` in the same file). A config that goes stale after a redesign degrades
to that rather than breaking outright — there is a test covering exactly this
case. So the first thing to try when a platform misbehaves is tightening its
selectors; the fallback is what keeps it partly working meanwhile.

---

## Theming

The panel has no palette of its own. On mount it reads the background behind the
message list and the text colour drawn on it, and derives everything —
surfaces, borders, muted text, shadows — from those two colours plus the
platform's brand accent. Dark surfaces elevate toward white and light surfaces
toward black, which is the same relationship these apps use for their own cards
and hover states.

Legibility is enforced rather than hoped for. A brand colour is usually chosen
to sit on white and can vanish on a dark surface — Slack's aubergine is 1.7:1 on
black — so accents are walked toward contrast in small steps and stop at the
first shade that clears the bar, keeping the hue. Body, muted and dim text all
hold to 4.5:1 against whatever background the host turns out to have.

It follows the host when the user switches theme, via the OS colour-scheme media
query plus an attribute-filtered observer on `<html>`. Computed styles are read
on mount, on chat open, and on an actual theme change — never on a timer.

Classification and root-finding run in the service worker, not the content
script: they are pure functions over the message array that crosses to the
worker anyway, and running them on the chat page's main thread only blocked it.

---

## Performance notes

The extension is built to cost nothing while you are not using it, and to keep
its work off the chat page's main thread when you are.

- **No DOM observers on the page body.** SPA navigation and chat-open state are
  covered by one 1.5s ticker that stops while the tab is in the background.
- **Nothing forces layout during a scrape.** No `innerText`, and no per-row
  `getBoundingClientRect()`; message text is read from the node tree instead.
- **Scraping is proportional to what you asked for**, not to how much history
  the app has rendered — rows are walked from the newest and parsing stops at
  the limit. A 20-message read of a 40-row thread measures around 2ms.
- **The conversation is never scrolled.** Older history is banked passively as
  the app renders it. If there still isn't enough, the panel says so rather than
  scrolling to close the gap.
- **Generation can be cancelled.** Closing the panel aborts the model call and
  releases the worker's keep-alive.
- **Theme detection is not a loop.** Computed styles are read on mount and on an
  actual theme change, behind an attribute-filtered observer on `<html>` that
  never descends into the document.

---

## Development

No build step and no dependencies.

```sh
npm test    # node --test — covers the pure logic
```

---

## Build Phases

The project is structured in phases matching the plan:

| Phase | Status | Description |
|---|---|---|
| 1 | ✅ | Shadow DOM skeleton — FAB + empty panel on WhatsApp |
| 2 | ✅ | WhatsApp adapter — scraping, in/out detection, group detection |
| 3 | ✅ | AI happy path — LanguageModel session, summary + 3 replies, Insert |
| 4 | ✅ | Smart logic — classifier, rootFinder, Summarizer two-pass budgeting |
| 5 | ✅ | Messenger adapter + settings |
| 6 | ✅ | Performance pass — idle cost, layout-free scraping, no scroll-back |
| 7 | ✅ | Platform registry (9 apps) + panel themed from the host site |

---

## Known limitations & edge cases

- **DOM changes break scraping** — adapters are isolated; breakage shows "couldn't read messages" rather than failing silently. Update the adapter selectors if WhatsApp/Messenger updates their markup.
- **Language mixing** — Gemini Nano has limited multilingual support (primarily English). Bangla or mixed-language replies may be weak. Test early.
- **First-run friction** — 2 GB model download + Chrome flags. Document and direct users to `chrome://on-device-internals`.
- **No cloud fallback** — intentional. Everything is on-device.
- **Selector drift** — WhatsApp and Messenger are the best-exercised. The other seven configs are written from each app's known markup but unverified against the live sites, and these apps change their DOM without notice. Failures degrade to structural detection rather than breaking; the fix is a selector in `platforms.js`.
- **Left-aligned platforms need to know your name** — Discord, Slack, LinkedIn and Google Chat have no visual in/out distinction, so "is this mine?" comes from comparing the displayed sender to the signed-in user. If the app hides that name, direction falls back to layout position, which those apps do not vary.
- **History depth is bounded by what the app renders.** Neither platform exposes an API for messages that have scrolled out of the DOM, and Reply Pilot will not scroll your conversation to force them back. Scroll up yourself and it will pick them up.

---

## Privacy

- **Nothing is sent to any server.** Scraping happens in-page, inference on-device via Gemini Nano.
- **Only settings** (e.g. how many messages to read, set from the toolbar popup) are stored in `chrome.storage` — never message content.
- No analytics, no telemetry, no network requests.
