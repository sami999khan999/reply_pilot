import test from 'node:test';
import assert from 'node:assert/strict';
import { createMessageCache } from '../src/content/logic/messageCache.js';

/**
 * A stand-in for an adapter. `read()` needs no DOM at all — only `start()`
 * touches MutationObserver — so the merge, dedup, capacity and chat-switch
 * behaviour is testable directly.
 */
function fakeAdapter({ stableTimestamps = true } = {}) {
  return {
    hasStableTimestamps: stableTimestamps,
    rendered: [],
    signature: 'chat-a',
    scrapeCalls: 0,
    getMessageList: () => null,
    chatSignature() { return this.signature; },
    scrapeSync(limit) {
      this.scrapeCalls++;
      return this.rendered.slice(-limit);
    },
  };
}

const msg = (id, ts, text = 'msg ' + id) => ({
  id, sender: 'Rafi', isMe: false, text, ts, isGroup: false, mentionsMe: false,
});

test('reads straight through when nothing has been banked yet', () => {
  const adapter = fakeAdapter();
  adapter.rendered = [msg('1', 10), msg('2', 20)];
  const cache = createMessageCache({ adapter, capacity: 60 });

  const { messages, available, requested } = cache.read(10);
  assert.deepEqual(messages.map(m => m.id), ['1', '2']);
  assert.equal(available, 2);
  assert.equal(requested, 10);
});

test('history the app has since unmounted is still available', () => {
  // This is the whole point: the app virtualizes older rows away, and the cache
  // remembers them so nothing has to scroll to bring them back.
  const adapter = fakeAdapter();
  const cache = createMessageCache({ adapter, capacity: 60 });

  adapter.rendered = [msg('1', 10), msg('2', 20), msg('3', 30)];
  cache.read(10);

  adapter.rendered = [msg('4', 40)]; // older rows unmounted
  const { messages, available } = cache.read(10);

  assert.deepEqual(messages.map(m => m.id), ['1', '2', '3', '4']);
  assert.equal(available, 4);
});

test('merged history comes back in timestamp order', () => {
  const adapter = fakeAdapter();
  const cache = createMessageCache({ adapter, capacity: 60 });

  adapter.rendered = [msg('3', 30)];
  cache.read(10);
  adapter.rendered = [msg('1', 10), msg('2', 20)];

  const { messages } = cache.read(10);
  assert.deepEqual(messages.map(m => m.id), ['1', '2', '3']);
});

test('repeated sightings of the same message are not duplicated', () => {
  const adapter = fakeAdapter();
  adapter.rendered = [msg('1', 10), msg('2', 20)];
  const cache = createMessageCache({ adapter, capacity: 60 });

  cache.read(10);
  cache.read(10);
  const { available } = cache.read(10);

  assert.equal(available, 2);
});

test('the limit trims to the most recent messages', () => {
  const adapter = fakeAdapter();
  adapter.rendered = Array.from({ length: 10 }, (_, i) => msg(String(i), i * 10));
  const cache = createMessageCache({ adapter, capacity: 60 });

  const { messages, available } = cache.read(3);
  assert.deepEqual(messages.map(m => m.id), ['7', '8', '9']);
  assert.equal(available, 10, 'available reports everything known, not just what was returned');
});

test('a shortfall is only reported when the history really is short', () => {
  // Drives the panel's "Read N of the M requested" note, so it must not fire
  // just because the caller asked for fewer messages than are rendered.
  const adapter = fakeAdapter();
  const cache = createMessageCache({ adapter, capacity: 60 });

  adapter.rendered = Array.from({ length: 40 }, (_, i) => msg(String(i), i * 10));
  assert.equal(cache.read(20).available, 40, 'plenty rendered: no shortfall');

  cache.reset();
  adapter.rendered = Array.from({ length: 6 }, (_, i) => msg('s' + i, i * 10));
  assert.equal(cache.read(20).available, 6, 'genuinely short history is reported as such');
});

test('the buffer stays within capacity, keeping the newest', () => {
  const adapter = fakeAdapter();
  const cache = createMessageCache({ adapter, capacity: 5 });

  for (let i = 0; i < 20; i++) {
    adapter.rendered = [msg(String(i), i * 10)];
    cache.read(5);
  }

  const { messages, available } = cache.read(5);
  assert.equal(available, 5);
  assert.deepEqual(messages.map(m => m.id), ['15', '16', '17', '18', '19']);
});

test('switching chats discards the previous conversation', () => {
  // One chat's history must never end up in another chat's prompt.
  const adapter = fakeAdapter();
  const cache = createMessageCache({ adapter, capacity: 60 });

  adapter.rendered = [msg('a1', 10), msg('a2', 20)];
  cache.read(10);

  adapter.signature = 'chat-b';
  adapter.rendered = [msg('b1', 30)];
  const { messages, available } = cache.read(10);

  assert.deepEqual(messages.map(m => m.id), ['b1']);
  assert.equal(available, 1);
});

test('reset clears everything', () => {
  const adapter = fakeAdapter();
  const cache = createMessageCache({ adapter, capacity: 60 });
  adapter.rendered = [msg('1', 10)];
  cache.read(10);

  cache.reset();
  adapter.rendered = [];
  assert.equal(cache.read(10).available, 0);
});

test('platforms without real timestamps read through without merging', () => {
  // Messenger orders positionally, so merging separate scrapes would interleave
  // messages wrongly. The cache must not pretend otherwise.
  const adapter = fakeAdapter({ stableTimestamps: false });
  const cache = createMessageCache({ adapter, capacity: 60 });

  adapter.rendered = [msg('1', 10), msg('2', 20)];
  cache.read(10);

  adapter.rendered = [msg('3', 30)];
  const { messages, available } = cache.read(10);

  assert.deepEqual(messages.map(m => m.id), ['3']);
  assert.equal(available, 1);
  assert.equal(cache.size, 0, 'nothing is banked on a non-mergeable platform');
});

test('start() is inert when there is no message list to watch', () => {
  const adapter = fakeAdapter();
  const cache = createMessageCache({ adapter, capacity: 60 });
  assert.doesNotThrow(() => { cache.start(); cache.stop(); });
});
