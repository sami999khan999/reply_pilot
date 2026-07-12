# Reply Pilot — Chrome Extension

> On-device AI reply assistant for WhatsApp Web and Messenger, powered by Chrome's built-in **Gemini Nano**. No server, no API key, no libraries.

---

## What it does

Opens a slide-in panel on any WhatsApp Web or Messenger tab that:
- **Reads** the visible conversation (scrolling up for history)
- **Decides** whether you even need to reply (with a reason)
- **Drafts** 3 reply options matched to the conversation's tone and language
- Handles **broadcast/announcement** chats where the last message is just an acknowledgement — drafts reply to the *original* announcement instead
- Lets you **Insert** directly into the composer or **Copy** to clipboard
- Generates **3 more** alternatives on demand

Everything runs locally — no data leaves your device.

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

- Open **WhatsApp Web** (`web.whatsapp.com`) or **Messenger** (`messenger.com`)
- Open a chat — a **purple floating button** (✈) appears in the bottom-right corner
- Click it to open the Reply Pilot panel
- Click **Insert** to put the reply into the compose box, or **Copy** to copy it

---

## Architecture

```
Content Script (chat page)
  ├── detector.js         — match hostname → pick adapter
  ├── adapters/
  │   ├── whatsapp.js     — DOM scraping anchored on data-pre-plain-text
  │   └── messenger.js    — DOM scraping via ARIA roles + layout
  ├── logic/
  │   ├── classifier.js   — heuristic "do I need to reply?" rules
  │   ├── rootFinder.js   — find broadcast root in group announcement threads
  │   └── composerInsert.js — fire real InputEvents into contenteditable boxes
  ├── ui/ (Shadow DOM)
  │   ├── fab.js          — floating button
  │   ├── panel.js        — slide-in panel with all states
  │   └── panel.css.js    — CSS injected into shadow root
  └── orchestrator.js     — wires all the above together

Service Worker
  ├── ai/
  │   ├── availability.js — check LanguageModel / Summarizer availability
  │   ├── promptSession.js — reusable LanguageModel session
  │   ├── summarizer.js   — compress old history with Summarizer API
  │   ├── budget.js       — token counting + windowing
  │   └── prompts.js      — system prompt, schema, payload builder
  └── service-worker.js   — message router
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

---

## Known limitations & edge cases

- **DOM changes break scraping** — adapters are isolated; breakage shows "couldn't read messages" rather than failing silently. Update the adapter selectors if WhatsApp/Messenger updates their markup.
- **Language mixing** — Gemini Nano has limited multilingual support (primarily English). Bangla or mixed-language replies may be weak. Test early.
- **First-run friction** — 2 GB model download + Chrome flags. Document and direct users to `chrome://on-device-internals`.
- **No cloud fallback** — intentional. Everything is on-device.
- **Messenger adapter** — more fragile than WhatsApp (no `data-pre-plain-text`). Ship WhatsApp first and treat Messenger as beta.

---

## Privacy

- **Nothing is sent to any server.** Scraping happens in-page, inference on-device via Gemini Nano.
- **Only settings** (display name preferences, if added) are stored in `chrome.storage` — never message content.
- No analytics, no telemetry, no network requests.
