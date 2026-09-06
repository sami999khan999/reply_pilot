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
    import('../src/content/adapters/platforms.js'),
    import('../src/content/adapters/generic.js'),
    import('../src/content/adapters/whatsapp.js'),
    import('../src/shared/color.js'),
    import('../src/content/ui/theme.js'),
  ]);
  assert.equal(modules.length, 12);
});

test('every platform builds an adapter meeting the base contract', async () => {
  const { BaseAdapter } = await import('../src/content/adapters/base.js');
  const { GenericAdapter } = await import('../src/content/adapters/generic.js');
  const { WhatsAppAdapter } = await import('../src/content/adapters/whatsapp.js');
  const { PLATFORMS } = await import('../src/content/adapters/platforms.js');

  const required = [
    'isChatOpen', 'isGroupChat', 'getComposerBox', 'getMessageList',
    'scrapeMessages', 'scrapeSync', 'chatSignature', 'invalidate',
  ];

  for (const config of PLATFORMS) {
    const Adapter = config.id === 'whatsapp' ? WhatsAppAdapter : GenericAdapter;
    const adapter = new Adapter(config);
    assert.ok(adapter instanceof BaseAdapter, `${config.id} extends BaseAdapter`);
    assert.equal(adapter.name, config.id);
    assert.equal(typeof adapter.hasStableTimestamps, 'boolean');
    for (const method of required) {
      assert.equal(typeof adapter[method], 'function', `${config.id}#${method}`);
    }
  }
});

test('every platform config is complete and internally consistent', async () => {
  const { PLATFORMS, GENERIC, selectorsFor } = await import('../src/content/adapters/platforms.js');

  const seen = new Set();
  for (const config of PLATFORMS) {
    assert.ok(!seen.has(config.id), `duplicate platform id: ${config.id}`);
    seen.add(config.id);

    assert.equal(typeof config.label, 'string');
    assert.match(config.accent, /^#[0-9a-f]{6}$/i, `${config.id} accent must be a hex colour`);
    assert.equal(typeof config.matches, 'function');

    for (const slot of ['list', 'composer', 'row', 'text']) {
      assert.ok(Array.isArray(config[slot]) && config[slot].length > 0, `${config.id}.${slot}`);
      // Every slot must end up with the structural fallback appended.
      const resolved = selectorsFor(config, slot);
      for (const fallback of GENERIC[slot]) {
        assert.ok(resolved.includes(fallback), `${config.id}.${slot} keeps fallback ${fallback}`);
      }
    }

    assert.ok(Array.isArray(config.direction) && config.direction.length > 0, `${config.id}.direction`);
    for (const strategy of config.direction) {
      assert.ok(['class', 'aria', 'sender', 'align'].includes(strategy),
        `${config.id} unknown direction strategy: ${strategy}`);
    }
    if (config.direction.includes('class')) {
      assert.ok(config.directionClass?.out?.length, `${config.id} needs directionClass.out`);
    }
    if (config.direction.includes('aria')) {
      assert.ok(config.outgoingAria instanceof RegExp, `${config.id} needs outgoingAria`);
    }
    if (config.direction.includes('sender')) {
      assert.ok(config.sender?.length && config.myName?.length,
        `${config.id} sender-based direction needs both sender and myName selectors`);
    }
    if (config.stableTimestamps && !config.ownParser) {
      assert.ok(config.timestamp?.selector?.length && config.timestamp.attr,
        `${config.id} claims stable timestamps but has no timestamp source`);
    }
  }
});

test('platform matching is unambiguous for the URLs we inject on', async () => {
  const { findPlatform } = await import('../src/content/adapters/platforms.js');

  const expected = {
    'https://web.whatsapp.com/': 'whatsapp',
    'https://www.messenger.com/t/123': 'messenger',
    'https://www.facebook.com/messages/t/123': 'messenger',
    'https://www.instagram.com/direct/inbox/': 'instagram',
    'https://web.telegram.org/k/': 'telegram',
    'https://discord.com/channels/1/2': 'discord',
    'https://app.slack.com/client/T1/C1': 'slack',
    'https://x.com/messages/1': 'x',
    'https://twitter.com/messages/1': 'x',
    'https://www.linkedin.com/messaging/thread/1': 'linkedin',
    'https://chat.google.com/room/1': 'google-chat',
    'https://mail.google.com/chat/u/0/': 'google-chat',
  };

  for (const [url, id] of Object.entries(expected)) {
    assert.equal(findPlatform(new URL(url))?.id, id, url);
  }

  // Pages on a supported host that are not chat surfaces must not match.
  for (const url of ['https://www.facebook.com/feed', 'https://x.com/home',
                     'https://www.instagram.com/explore/', 'https://www.linkedin.com/feed/']) {
    assert.equal(findPlatform(new URL(url)), null, url);
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
