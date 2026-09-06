import test from 'node:test';
import assert from 'node:assert/strict';

/**
 * Import-graph smoke tests. The extension has no build step, so a mistyped
 * relative path fails only at runtime in the browser — these catch it here.
 */

test('the content-script graph resolves', async () => {
  const modules = await Promise.all([
    import('../src/content/detector.js'),
    import('../src/content/lifecycle.js'),
    import('../src/content/dom/query.js'),
    import('../src/content/logic/scrape.js'),
    import('../src/content/logic/messageCache.js'),
    import('../src/content/logic/composerInsert.js'),
    import('../src/content/adapters/base.js'),
    import('../src/content/adapters/whatsapp.js'),
    import('../src/content/adapters/messenger.js'),
  ]);
  assert.equal(modules.length, 9);
});

test('both adapters implement the base contract', async () => {
  const { BaseAdapter } = await import('../src/content/adapters/base.js');
  const { WhatsAppAdapter } = await import('../src/content/adapters/whatsapp.js');
  const { MessengerAdapter } = await import('../src/content/adapters/messenger.js');

  const required = [
    'isChatOpen', 'isGroupChat', 'getComposerBox', 'getMessageList',
    'scrapeMessages', 'scrapeSync', 'chatSignature', 'invalidate',
  ];

  for (const Adapter of [WhatsAppAdapter, MessengerAdapter]) {
    const adapter = new Adapter();
    assert.ok(adapter instanceof BaseAdapter, `${Adapter.name} extends BaseAdapter`);
    assert.equal(typeof adapter.name, 'string');
    assert.equal(typeof adapter.hasStableTimestamps, 'boolean');
    for (const method of required) {
      assert.equal(typeof adapter[method], 'function', `${Adapter.name}#${method}`);
    }
  }
});

test('base.js still re-exports the text helpers adapters rely on', async () => {
  const base = await import('../src/content/adapters/base.js');
  for (const name of ['makeMessageId', 'normalizeText', 'similarity']) {
    assert.equal(typeof base[name], 'function', name);
  }
});

test('the service worker registers a message listener on load', async () => {
  const listeners = [];
  globalThis.chrome = {
    runtime: {
      onMessage: { addListener: (fn) => listeners.push(fn) },
      getPlatformInfo: () => {},
    },
  };

  await import('../src/worker/service-worker.js');

  assert.equal(listeners.length, 1);
  delete globalThis.chrome;
});

test('the popup and content script agree on the settings contract', async () => {
  const settings = await import('../src/shared/settings.js');
  for (const name of ['getSettings', 'saveSettings', 'clampMessageCount', 'clampReplyCount',
                      'sanitizeReference', 'formatEstimate']) {
    assert.equal(typeof settings[name], 'function', name);
  }
  assert.ok(settings.MESSAGE_COUNT_MAX >= settings.MESSAGE_COUNT_MIN);
});
