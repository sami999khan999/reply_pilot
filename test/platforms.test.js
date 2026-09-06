import test from 'node:test';
import assert from 'node:assert/strict';
import { chromium } from '/opt/node22/lib/node_modules/playwright/index.mjs';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { FIXTURES } from './fixtures/platforms.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

/**
 * The adapters are DOM code, so they are exercised in a real browser against
 * fixtures shaped like each app's markup. A stub DOM would only prove the stub
 * matches our assumptions.
 */
let browser;
let page;

test.before(async () => {
  browser = await chromium.launch({ args: ['--no-sandbox'] });
  page = await browser.newPage();

  // Serve the extension's own modules at whatever origin the fixture needs, so
  // relative imports resolve exactly as they do in the packaged extension.
  await page.route('**/src/**', async (route, req) => {
    const path = new URL(req.url()).pathname;
    route.fulfill({ contentType: 'text/javascript', body: await readFile(join(ROOT, path), 'utf8') });
  });
});

test.after(async () => { await browser?.close(); });

/**
 * Loads a fixture at its real URL and scrapes it through the detector, exactly
 * as the content script would.
 */
async function scrape(key) {
  const fixture = FIXTURES[key];
  await page.route(fixture.url, route =>
    route.fulfill({ contentType: 'text/html', body: `<!doctype html><html><body>${fixture.html}</body></html>` }));
  await page.goto(fixture.url);

  return page.evaluate(async () => {
    const { detect } = await import('/src/content/detector.js');
    const detected = detect(window.location);
    if (!detected) return { detected: false };

    const { adapter, platform } = detected;
    const scrollBefore = document.scrollingElement.scrollTop;
    const messages = await adapter.scrapeMessages({ maxMessages: 50 });

    return {
      detected: true,
      platform: platform.id,
      accent: platform.accent,
      chatOpen: adapter.isChatOpen(),
      isGroup: adapter.isGroupChat(),
      myName: adapter.getMyName(),
      signature: adapter.chatSignature(),
      stableTimestamps: adapter.hasStableTimestamps,
      composer: !!adapter.getComposerBox(),
      messages,
      scrollUnchanged: document.scrollingElement.scrollTop === scrollBefore,
    };
  });
}

for (const [key, fixture] of Object.entries(FIXTURES)) {
  test(`${key}: reads the conversation`, async () => {
    const result = await scrape(key);

    assert.ok(result.detected, `${key} was not detected`);
    assert.ok(result.chatOpen, `${key} did not report an open chat`);
    assert.ok(result.composer, `${key} did not find a composer`);
    assert.ok(result.scrollUnchanged, `${key} scrolled the conversation`);

    const { expect } = fixture;
    assert.equal(result.messages.length, expect.count, `${key} message count`);

    if (expect.senders) {
      assert.deepEqual(result.messages.map(m => m.sender), expect.senders, `${key} senders`);
    }
    if (expect.mine) {
      assert.deepEqual(result.messages.map(m => m.isMe), expect.mine, `${key} direction`);
    }
    if (expect.myName) {
      assert.equal(result.myName, expect.myName, `${key} my name`);
    }
    if (expect.isGroup !== undefined) {
      assert.equal(result.isGroup, expect.isGroup, `${key} group detection`);
    }
    if (expect.stableTimestamps !== undefined) {
      assert.equal(result.stableTimestamps, expect.stableTimestamps, `${key} timestamp stability`);
    }
    if (expect.firstTs !== undefined) {
      assert.equal(result.messages[0].ts, expect.firstTs, `${key} first timestamp`);
    }
    if (expect.lastText) {
      assert.equal(result.messages.at(-1).text, expect.lastText, `${key} last message text`);
    }
    if (expect.lastQuote) {
      assert.equal(result.messages.at(-1).quotedText, expect.lastQuote, `${key} quoted text`);
    }
  });
}

test('every message carries the fields the pipeline needs', async () => {
  const { messages } = await scrape('whatsapp');
  for (const m of messages) {
    assert.equal(typeof m.id, 'string');
    assert.ok(m.id.length > 0);
    assert.equal(typeof m.sender, 'string');
    assert.equal(typeof m.isMe, 'boolean');
    assert.equal(typeof m.text, 'string');
    assert.ok(Number.isFinite(m.ts), 'timestamp is a number');
    assert.equal(typeof m.isGroup, 'boolean');
    assert.equal(typeof m.mentionsMe, 'boolean');
  }
});

test('message ids are stable across repeated scrapes', async () => {
  // The cache dedupes on id, so an unstable id would multiply history.
  const first = await scrape('whatsapp');
  const second = await scrape('whatsapp');
  assert.deepEqual(first.messages.map(m => m.id), second.messages.map(m => m.id));
});

test('an unsupported site is not detected at all', async () => {
  await page.route('https://example.com/', route =>
    route.fulfill({ contentType: 'text/html', body: '<!doctype html><body><p>hello</p>' }));
  await page.goto('https://example.com/');

  const detected = await page.evaluate(async () => {
    const { detect } = await import('/src/content/detector.js');
    return detect(window.location) !== null;
  });
  assert.equal(detected, false);
});

test('a message is never paired with its own wrapper row', async () => {
  // WhatsApp wraps every message in div[role="row"], which is also one of the
  // structural fallbacks. Pooling the two selectors matched both and walked
  // twice the nodes; on other platforms it can yield the same message twice.
  const result = await scrape('whatsapp');

  const texts = result.messages.map(m => m.text);
  assert.equal(new Set(texts).size, texts.length, 'no duplicated messages');
  assert.equal(result.messages.length, 3);
});

test('a redesign falls through to structural detection rather than breaking', async () => {
  // The `redesigned` fixture is Telegram's URL with none of Telegram's markup.
  // Every selector slot has to degrade to the ARIA-based fallback.
  const result = await scrape('redesigned');
  assert.equal(result.platform, 'telegram');
  assert.ok(result.chatOpen);
  assert.equal(result.messages.length, 2);
});
