import test from 'node:test';
import assert from 'node:assert/strict';
import { splitBudget, formatRawMessages, estimateTokens, capSummary } from '../src/worker/ai/budget.js';

const msg = (id, text, extra = {}) => ({
  id,
  sender: 'Rafi',
  isMe: false,
  text,
  ts: 1000 + Number(id) * 10,
  isGroup: false,
  mentionsMe: false,
  ...extra,
});

const conversation = (n) => Array.from({ length: n }, (_, i) => msg(String(i + 1), `message ${i + 1}`));

test('an empty conversation splits into nothing', () => {
  assert.deepEqual(splitBudget([], null), { rawMessages: [], olderMessages: [] });
});

test('recent messages are kept verbatim and older ones set aside', () => {
  const messages = conversation(20);
  const { rawMessages, olderMessages } = splitBudget(messages, null);
  assert.equal(rawMessages.length, 12);
  assert.equal(olderMessages.length, 8);
  assert.equal(rawMessages.at(-1).id, '20');
  assert.equal(olderMessages[0].id, '1');
});

test('an older root message is pulled into the raw window', () => {
  const messages = conversation(20);
  const { rawMessages, olderMessages } = splitBudget(messages, messages[0]);
  assert.equal(rawMessages[0].id, '1');
  assert.ok(!olderMessages.some(m => m.id === '1'));
});

test('a root message that crossed the worker boundary is not duplicated', () => {
  // The content script sends the root through chrome.runtime.sendMessage, which
  // structured-clones it. An identity check never matches the clone, so the root
  // used to be prepended a second time on every single generate.
  const messages = conversation(20);
  const cloned = structuredClone(messages.at(-1));

  const { rawMessages } = splitBudget(messages, cloned);

  const occurrences = rawMessages.filter(m => m.id === cloned.id).length;
  assert.equal(occurrences, 1);
});

test('a cloned root from outside the raw window is added exactly once', () => {
  const messages = conversation(20);
  const cloned = structuredClone(messages[0]);

  const { rawMessages, olderMessages } = splitBudget(messages, cloned);

  assert.equal(rawMessages.filter(m => m.id === '1').length, 1);
  assert.equal(olderMessages.filter(m => m.id === '1').length, 0);
});

test('the raw window is capped by the token budget, not just by count', () => {
  const messages = Array.from({ length: 12 }, (_, i) => msg(String(i + 1), 'x'.repeat(4000)));
  const { rawMessages, olderMessages } = splitBudget(messages, null);
  assert.ok(rawMessages.length < 12, `kept ${rawMessages.length} oversized messages`);
  assert.equal(rawMessages.length + olderMessages.length, 12);
});

test('formatRawMessages tags direction and quotes', () => {
  const lines = formatRawMessages([
    msg('1', 'hello'),
    msg('2', 'replying', { isMe: true, quotedText: 'hello' }),
  ]).split('\n');

  assert.equal(lines[0], '[Rafi]: hello');
  assert.match(lines[1], /^\[Me\] \(quoting: "hello…"\): replying$/);
});

test('estimateTokens handles empty input', () => {
  assert.equal(estimateTokens(''), 0);
  assert.equal(estimateTokens(undefined), 0);
});

test('capSummary leaves a normal summary alone', () => {
  const summary = 'Rafi asked about the meeting time. You said four works.';
  assert.equal(capSummary(summary), summary);
});

test('capSummary handles empty input', () => {
  assert.equal(capSummary(''), '');
  assert.equal(capSummary(undefined), '');
});

test('capSummary bounds a runaway summary', () => {
  // The constant existed but was never applied, so the raw-transcript fallback
  // used when the Summarizer API is unavailable could crowd out the recent
  // messages the summary is meant to give context for.
  const long = 'x'.repeat(10_000);
  const capped = capSummary(long);

  assert.ok(capped.length < long.length);
  assert.ok(capped.length <= 400 * 4 + 1, `capped to ${capped.length} chars`);
  assert.ok(capped.endsWith('\u2026'), 'marked as truncated');
});

test('capSummary prefers to cut at a sentence end', () => {
  const sentence = 'This is a complete sentence that ends here. ';
  const capped = capSummary(sentence.repeat(60));

  assert.ok(capped.endsWith('here.\u2026'), `cut mid-sentence: ${capped.slice(-40)}`);
});
