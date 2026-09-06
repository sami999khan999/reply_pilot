import test from 'node:test';
import assert from 'node:assert/strict';
import { queryAllFirst, queryFirst, cachedResolver, cachedValue } from '../src/content/dom/query.js';

/** Minimal stand-in for the ParentNode surface these helpers use. */
function fakeRoot(map) {
  return { querySelectorAll: (sel) => map[sel] || [], querySelector: (sel) => (map[sel] || [])[0] || null };
}

test('queryAllFirst returns the first selector that finds anything', () => {
  const root = fakeRoot({ '.specific': ['a'], '[role="row"]': ['x', 'y', 'z'] });
  assert.deepEqual(queryAllFirst(['.specific', '[role="row"]'], root), ['a']);
});

test('queryAllFirst falls through selectors that find nothing', () => {
  const root = fakeRoot({ '[role="row"]': ['x', 'y'] });
  assert.deepEqual(queryAllFirst(['.gone', '.also-gone', '[role="row"]'], root), ['x', 'y']);
});

test('queryAllFirst does not union its selectors', () => {
  // The bug it replaces: joining these into one query returned every match of
  // both, pooling a platform's rows with the fallbacks meant to stand in for
  // them — and pairing each message with its own wrapper.
  const root = fakeRoot({ '[data-pre-plain-text]': ['msg1', 'msg2'], '[role="row"]': ['row1', 'row2'] });
  const result = queryAllFirst(['[data-pre-plain-text]', '[role="row"]'], root);

  assert.equal(result.length, 2);
  assert.ok(!Array.from(result).includes('row1'), 'wrappers are not pooled with messages');
});

test('queryAllFirst returns an empty result when nothing matches', () => {
  const result = queryAllFirst(['.a', '.b'], fakeRoot({}));
  assert.equal(result.length, 0);
});

test('queryFirst returns the first match across selectors, in order', () => {
  const root = fakeRoot({ '.second': ['b'], '.third': ['c'] });
  assert.equal(queryFirst(['.first', '.second', '.third'], root), 'b');
  assert.equal(queryFirst(['.nope'], root), null);
});

test('cachedResolver re-queries only once the element detaches', () => {
  let calls = 0;
  const el = { isConnected: true };
  const resolve = cachedResolver(() => { calls++; return el; });

  resolve(); resolve(); resolve();
  assert.equal(calls, 1, 'a connected element is not looked up again');

  el.isConnected = false;
  resolve();
  assert.equal(calls, 2, 'a detached element triggers a fresh lookup');
});

test('cachedResolver retries after a miss', () => {
  let found = null;
  let calls = 0;
  const resolve = cachedResolver(() => { calls++; return found; });

  assert.equal(resolve(), null);
  found = { isConnected: true };
  assert.equal(resolve(), found, 'a null result is not cached as an answer');
  assert.equal(calls, 2);
});

test('cachedResolver.reset forces the next lookup', () => {
  let calls = 0;
  const el = { isConnected: true };
  const resolve = cachedResolver(() => { calls++; return el; });

  resolve();
  resolve.reset();
  resolve();
  assert.equal(calls, 2);
});

test('cachedValue computes once and caches falsy results too', () => {
  let calls = 0;
  const read = cachedValue(() => { calls++; return false; });

  assert.equal(read(), false);
  assert.equal(read(), false);
  assert.equal(calls, 1, 'false is a real answer, not a cache miss');

  read.reset();
  assert.equal(read(), false);
  assert.equal(calls, 2);
});
