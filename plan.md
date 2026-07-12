# Reply Assistant — Browser Extension Plan

An on-device AI reply assistant for web messaging apps (WhatsApp Web first, Messenger second). It reads the visible conversation, decides whether a reply is even needed, and if so drafts 3 options in your voice using Chrome's built-in Gemini Nano — no server, no API key, no libraries.

---

## 1. One-line spec

> On a messaging tab, a floating button opens a right-side panel that summarizes the chat, tells you whether you need to reply, and gives 3 draftable replies (with "generate 3 more") — using Chrome's built-in `LanguageModel` API.

---

## 2. Hard constraints and what they force on us

| Constraint | Consequence for the design |
|---|---|
| **No libraries** — vanilla HTML/CSS/JS only | UI is built with template strings + DOM APIs. State is plain objects. No React, so composer insertion is manual (section 6.7). |
| **Chrome built-in AI** (`LanguageModel`, Gemini Nano) | Desktop Chrome 138+ only, ~2 GB model download, requires a user gesture to first create a session. Must handle `availability()` states: `available / downloadable / downloading / unavailable`. |
| **~4K input / ~1K output token window** (soft ~8K) | We **cannot** dump 100 messages in. We budget tokens: keep the last N raw, compress everything older with the **Summarizer API**. This is the core reason for the two-pass pipeline. |
| **No tool-calling on stable channel** | All logic (who-am-I, group detection, root-message finding) is done in our JS, not delegated to the model. The model only summarizes + drafts. |
| **Messaging apps have obfuscated, changing DOM class names** | We never rely on random hashed classes. We anchor on stable things: ARIA roles, `data-*` attributes, and structural relationships. Each app gets its own adapter so breakage is isolated. |

---

## 3. Architecture overview

Everything runs in **two contexts** that talk over `chrome.runtime` messaging:

```
┌─────────────────────────── CONTENT SCRIPT (runs on chat page) ──────────────────────────┐
│                                                                                          │
│  detector ──► adapter (whatsapp.js / messenger.js) ──► normalized Message[]              │
│                                                          │                               │
│  UI (Shadow DOM): FAB  ──click──►  Panel                 │                               │
│                                     │                    ▼                               │
│                                     └──► orchestrator ──► classifier (reply needed?)      │
│                                                          └► rootFinder (WayWise case)     │
│                                                          └► composerInsert (put text in)  │
│                                                                                          │
└──────────────────────────────────────────┬───────────────────────────────────────────┘
                                            │ runtime.sendMessage
                                            ▼
┌────────────────────── SERVICE WORKER (or offscreen doc) ────────────────────────────────┐
│  ai/promptSession.js   → LanguageModel.create/prompt   (draft replies, JSON out)         │
│  ai/summarizer.js      → Summarizer.create/summarize   (compress old history)            │
│  ai/budget.js          → token counting + windowing                                      │
└──────────────────────────────────────────────────────────────────────────────────────┘
```

**Why the AI calls live in the service worker, not the content script:** content scripts run in an isolated world and app CSPs can interfere; the service worker is a clean, page-independent context where the model session can be reused across chats. The content script sends it a normalized transcript; it returns structured JSON. (If you hit a "requires user activation" issue for the *first* model download, create the session on the FAB click, which is a user gesture, then keep it warm.)

---

## 4. File structure

```
reply-assistant/
├── manifest.json
├── icons/ (16, 48, 128)
├── src/
│   ├── content/
│   │   ├── index.js            # entry: detect app, mount UI, wire orchestrator
│   │   ├── orchestrator.js     # the "on Generate click" flow controller
│   │   ├── detector.js         # which app is this? is a chat open?
│   │   ├── adapters/
│   │   │   ├── base.js         # shared normalized-message shape + helpers
│   │   │   ├── whatsapp.js     # WhatsApp Web DOM scraping
│   │   │   └── messenger.js    # Messenger DOM scraping
│   │   ├── logic/
│   │   │   ├── classifier.js   # do I need to reply? (heuristics)
│   │   │   ├── rootFinder.js   # find the announcement/thread root (WayWise)
│   │   │   └── composerInsert.js
│   │   └── ui/
│   │       ├── mount.js        # creates the shadow root + host element
│   │       ├── fab.js          # floating button
│   │       ├── panel.js        # slide-in panel + render states
│   │       └── panel.css.js    # css as a string injected into shadow root
│   └── worker/
│       ├── service-worker.js   # message router
│       └── ai/
│           ├── availability.js
│           ├── promptSession.js
│           ├── summarizer.js
│           ├── budget.js       # token estimate + windowing
│           └── prompts.js      # system prompt + schema + payload builder
└── README.md
```

---

## 5. manifest.json (sketch)

```jsonc
{
  "manifest_version": 3,
  "name": "Reply Assistant",
  "version": "0.1.0",
  "minimum_chrome_version": "138",
  "background": { "service_worker": "src/worker/service-worker.js", "type": "module" },
  "content_scripts": [
    {
      "matches": ["https://web.whatsapp.com/*", "https://www.messenger.com/*", "https://www.facebook.com/messages/*"],
      "js": ["src/content/index.js"],
      "run_at": "document_idle"
    }
  ],
  "permissions": ["storage"],
  "host_permissions": ["https://web.whatsapp.com/*", "https://www.messenger.com/*"]
}
```

Because content scripts only inject on those hosts, the FAB automatically appears **only** when a messaging tab is open — no tab-querying needed. That satisfies "if the active tab has a messaging tab open, show a button."

---

## 6. Component deep-dives

### 6.1 Detector
- Match `location.hostname` to pick the adapter.
- Confirm a chat is actually open (not just the app shell) by checking for the message-list container and a composer. If no open chat, the FAB stays hidden/disabled.

### 6.2 Adapters — the genuinely hard part (DOM scraping)

Class names are hashed and change often, so **anchor on stable signals**:

**WhatsApp Web:**
- Message rows: `div[role="row"]` inside the main conversation panel.
- Text + metadata: the `span.copyable-text` / element carrying **`data-pre-plain-text`**. That attribute literally contains `"[12:01 PM, 7/12/2026] Shohan Sir: "` — free sender + timestamp, exactly the format in your example. Parse it with one regex:
  ```js
  // "[H:MM AM, M/D/YYYY] Name: "  →  { time, date, sender }
  const m = pre.match(/^\[(.+?),\s*(.+?)\]\s*(.*?):\s*$/);
  ```
- **Incoming vs outgoing (who am I):** rows carry `message-in` vs `message-out` on a stable-ish ancestor; outgoing = "me". Cross-check by alignment if the class shifts.
- **Group vs 1:1:** in a group, incoming messages render a sender-name element above the bubble and the header subtitle lists multiple participants. In 1:1 there's a single contact. Store `isGroup` on the conversation.
- **@mentions of me:** WhatsApp marks mentions as links/spans referencing your number/name — used later by the classifier.

**Messenger:** no `data-pre-plain-text` gift. Use `[role="row"]`, `aria-label`s on rows/avatars for sender, and horizontal alignment / avatar-side to infer in vs out. Expect this adapter to be more fragile — ship WhatsApp first.

**Output of every adapter → one normalized shape** (defined in `base.js`):
```js
/** @typedef {{
 *   id: string, sender: string, isMe: boolean,
 *   text: string, ts: number, isGroup: boolean,
 *   mentionsMe: boolean, quotedText?: string
 * }} Message */
```

> **Scrolling for history:** the DOM only holds what's rendered. To "read lots of previous messages," programmatically scroll the message list up in steps, collect rows, dedupe by a stable key (sender+ts+text hash), until you have your target window or hit the top. Keep this bounded (e.g. up to ~80 messages) so it stays fast.

### 6.3 rootFinder — the WayWise broadcast case

Your example is the important one: **the last message is NOT the thing to reply to.** Shohan Sir posted a long announcement, then a dozen people posted short acks (many quoting the whole announcement back). If we naively read the last message we'd "reply" to *"Appreciate the reminder. Stay safe!"* — nonsense.

Heuristic resolution, in order:

1. **Cluster the recent messages into a time burst** (messages close together forming one topic — here 12:01 PM–1:43 PM around one subject).
2. **Detect the dominant repeated block.** Normalize text (trim, collapse whitespace) and count near-duplicates. The announcement body appears many times because people quoted it → that repeated block is the **root**. (Simple approach: group by normalized-text similarity; the largest cluster's canonical text = the announcement.)
3. **Fallback:** if no repetition, the root is the earliest *substantive* (long, non-ack) message in the burst from a sender who isn't me.
4. **Classify the acks:** collect the short trailing phrases others appended ("Thanks for the reminder", "Noted, thank you", "will plan accordingly") — this gives the model the *register* to match.

The finder returns:
```js
{ rootMessage, ackSamples: string[], others: Message[] }
```
The model is then asked to reply **to the root**, in the same register as the acks — so it produces "Thank you for the heads-up, I'll plan accordingly," not a reply to someone else's thank-you.

### 6.4 classifier — "do I even need to reply?"

Pure JS rules, evaluated on the normalized transcript. Returns `{ needsReply: boolean, reason: string }`. The panel shows the reason when `needsReply` is false ("You're not addressed here — no reply needed").

Rules (first match wins):
- **I sent the last message** → usually no reply needed (I already responded). *Exception:* if my last message was itself a question, keep it open.
- **Group + I'm not @mentioned, not quoted, and the burst is a broadcast others are acking** → *optional*. Surface a soft prompt: "Group announcement — a short acknowledgement is optional," and still offer drafts (since in your example you DID want to ack). This is a nudge, not a hard block.
- **Group + conversation is strictly between other people, no mention/quote of me, no announcement directed at all** → **no reply needed** popup.
- **1:1, last message from them** → reply needed.
- **Direct question / @mention / reply-quote to my message** → reply needed (highest priority).

Keep this rule-based (not AI) so it's fast, deterministic, and testable.

### 6.5 AI layer — Prompt API + Summarizer

**Availability gate** (run once, cache): call `LanguageModel.availability()`. If `downloadable/downloading`, show a one-time "Setting up on-device AI…" state with a `downloadprogress` monitor on first `create()`; that first create must happen inside the FAB click (user gesture).

**Two-pass context budgeting** (`budget.js`) to respect the ~4K input window:
1. Estimate tokens (`session.countPromptTokens()` / `session.inputQuota` where available; else ~4 chars/token).
2. Keep the **last K raw messages** (e.g. 12) + the **root message** verbatim.
3. Everything older → feed to **Summarizer API** to get a 2–3 line context summary ("summary of summaries" if even that overflows).
4. Final prompt = system prompt + `[summary] + [rootMessage] + [ackSamples] + [last K raw]`.

**One session, reused.** Create with a system prompt via `initialPrompts` (system must be the first message). Reuse across chats; `.destroy()` on unload.

**Structured output.** Ask for JSON and enforce it with the Prompt API's response constraint (JSON schema) so parsing is safe:
```js
const schema = {
  type: "object",
  properties: {
    needsReply: { type: "boolean" },
    reason:     { type: "string" },
    summary:    { type: "string" },
    replies:    { type: "array", items: { type: "string" }, minItems: 3, maxItems: 3 }
  },
  required: ["needsReply", "reason", "summary", "replies"]
};
// session.prompt(payload, { responseConstraint: schema })
```
(Confirm the exact `responseConstraint` option name against the current docs when you wire it — the API surface still shifts.)

**"Generate 3 more":** don't rebuild context. Keep the session warm and send a short follow-up turn: *"Give 3 different alternatives, varied in tone, no repeats."* → parse another 3-item array. Cheap because history is already in the session.

### 6.6 UI — FAB + slide-in panel (Shadow DOM)

**Mount everything inside a Shadow DOM** attached to a single host `<div>` appended to `document.body`. This is non-negotiable: it stops WhatsApp's CSS from wrecking our panel and stops our CSS from leaking into theirs. Inject `panel.css.js` as a `<style>` inside the shadow root.

- **FAB:** `position: fixed; bottom/right`, high `z-index`, ~48px circle. Hidden when no chat is open.
- **Panel:** fixed to the right, `transform: translateX(100%)` → `translateX(0)` transition for the slide-in. Width ~360px, full height, scrollable.
- **Panel states:**
  1. *Loading* — "Reading conversation…" → "Thinking…"
  2. *No-reply-needed* — the popup case: big check, the `reason`, a "Draft anyway" link.
  3. *Results* — **Summary** block at top, then **3 reply cards**. Each card: text + "Insert" + "Copy". Bottom: **"Generate 3 more"** button (appends, doesn't replace).
  4. *Error / unavailable* — model not ready, unsupported device, or scrape failed.

### 6.7 composerInsert — putting a reply into the box

The compose field is a **contenteditable** (React-controlled in both apps), so setting `.textContent` won't register. Focus it, then dispatch a real `InputEvent`:
```js
box.focus();
document.execCommand("insertText", false, text); // simplest path that fires input events
// fallback: set text + dispatch new InputEvent("input", { bubbles: true, inputType: "insertText", data: text })
```
Insert (don't auto-send) so the user reviews first. Test both apps — this is the most breakage-prone line in the project after scraping.

---

## 7. The AI prompt (design, not final wording)

**System prompt (set once):**
- You draft short, natural chat replies *as the user*. Match the conversation's language, tone, and formality. Prefer 1–2 sentences. Never invent facts. Output only the requested JSON.

**User payload per Generate:**
```
CONVERSATION TYPE: group | direct
MY NAME: <me>
OLDER CONTEXT (summarized): <summarizer output>
MESSAGE TO RESPOND TO (root): <rootMessage.text>
HOW OTHERS ACKNOWLEDGED IT: <ackSamples joined>
RECENT MESSAGES:
<last K, "Sender: text" lines>

TASK: Decide needsReply. Write a 1–2 sentence summary. Produce exactly 3 reply options
I could send, varied in tone, matching the register above.
```

For the WayWise example this yields drafts like the register you actually used — "Thank you for the heads-up, I'll plan ahead" — because the root + ack samples steer it, not the trailing message.

---

## 8. "Generate" click — end-to-end flow

1. User clicks FAB → panel slides in, shows *Loading*. (This click is the user gesture that can trigger first model download.)
2. `orchestrator` asks the adapter to scrape (scrolling up to gather up to ~80 msgs), producing normalized `Message[]`.
3. `classifier` computes `needsReply` heuristically. If clearly *no* → render *No-reply-needed* state (still offer "Draft anyway").
4. `rootFinder` resolves `{ rootMessage, ackSamples }`.
5. `budget` splits into summary-target vs raw window; content script sends both to the worker.
6. Worker: Summarizer compresses old history → Prompt session gets full payload + schema → returns `{ needsReply, reason, summary, replies[3] }`.
7. Panel renders Summary + 3 cards.
8. "Generate 3 more" → warm session follow-up → append 3 cards.
9. "Insert" → `composerInsert`. "Copy" → clipboard.

---

## 9. Build phases

**Phase 1 — skeleton (get pixels on screen).** Manifest, content script, Shadow-DOM FAB + empty slide-in panel on WhatsApp. No AI.

**Phase 2 — scraping.** WhatsApp adapter: normalized messages via `data-pre-plain-text`, in/out detection, group detection, scroll-to-load history. Log the transcript to verify.

**Phase 3 — AI, happy path.** Worker + `LanguageModel` availability/session; feed last-K raw only (skip summarizer); render summary + 3 replies + "generate more". Insert into composer.

**Phase 4 — the smart logic.** `classifier` (no-reply-needed popup) + `rootFinder` (WayWise broadcast) + Summarizer two-pass budgeting for long histories.

**Phase 5 — Messenger adapter + polish.** Second adapter behind the same interface; loading/error states; settings (your display name, reply length, tone) in `chrome.storage`.

---

## 10. Edge cases & risks

- **DOM changes break scraping.** Mitigation: adapters are isolated, anchor on ARIA/`data-*`, add a self-check that warns "couldn't read messages" instead of failing silently.
- **Model unavailable / not downloaded / non-desktop.** Gate every AI path on `availability()`; show a clear setup state. No cloud fallback here (no libraries / on-device only).
- **Context overflow** on very long chats — handled by the summarizer pass; hard-cap the raw window.
- **Language mixing** (English + Bangla, common in your groups). Gemini Nano's supported languages are limited (en/es/ja/de/fr); Bangla replies may be weak. Test early; you may need to constrain drafts to English or note the limitation.
- **Wrong "who am I"** if in/out detection fails → drafts address the wrong person. Cross-validate with two signals (class + alignment).
- **First-run friction:** 2 GB model download + flags on some channels. Document setup in the README.

---

## 11. Privacy

Everything is local: scraping happens in-page, inference happens on-device via Gemini Nano, nothing is sent to any server. Worth stating plainly in the store listing — it's a real selling point over cloud reply tools. Only store user *settings* in `chrome.storage`, never message content.
