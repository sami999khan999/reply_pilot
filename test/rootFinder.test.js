import test from 'node:test';
import assert from 'node:assert/strict';
import { findRoot } from '../src/worker/logic/rootFinder.js';

const NOTICE =
  'Please submit your timesheets before Friday 6pm, no exceptions this month as payroll ' +
  'closes early and finance need the numbers reconciled before the weekend.';

const msg = (id, sender, text, extra = {}) => ({
  id,
  sender,
  isMe: sender === 'Me',
  text,
  ts: 1000 + Number(String(id).replace(/\D/g, '') || 0) * 10,
  isGroup: false,
  mentionsMe: false,
  ...extra,
});

test('returns nothing for an empty conversation', () => {
  assert.deepEqual(findRoot([]), { rootMessage: null, ackSamples: [], others: [] });
});

test('picks the announcement everyone is quoting as the root', () => {
  const messages = [
    msg('1', 'Boss', NOTICE, { isGroup: true }),
    ...['Noted', 'Okay boss', 'Done', 'Will do'].map((t, i) =>
      msg(String(i + 2), 'P' + i, t, { isGroup: true, quotedText: NOTICE })),
  ];
  assert.equal(findRoot(messages).rootMessage.id, '1');
});

test('matches a quote against the original even when the quote is truncated', () => {
  // The quote is a prefix of the original, which is how the apps render them.
  const messages = [
    msg('1', 'Boss', NOTICE, { isGroup: true }),
    msg('2', 'A', 'Noted', { isGroup: true, quotedText: NOTICE.slice(0, 90) }),
    msg('3', 'B', 'Okay', { isGroup: true, quotedText: NOTICE.slice(0, 90) }),
  ];
  assert.equal(findRoot(messages).rootMessage.id, '1');
});

test('falls back to the earliest substantive message from someone else', () => {
  const messages = [
    msg('1', 'Me', 'a message of mine that is quite long indeed'),
    msg('2', 'Rafi', 'so about the thing we discussed at lunch yesterday'),
    msg('3', 'Rafi', 'ok'),
  ];
  assert.equal(findRoot(messages).rootMessage.id, '2');
});

test('returns no root when every message is mine', () => {
  const messages = [msg('1', 'Me', 'first'), msg('2', 'Me', 'second')];
  assert.equal(findRoot(messages).rootMessage, null);
});

test('the root is never one of its own acknowledgement samples', () => {
  const messages = [
    msg('1', 'Boss', NOTICE, { isGroup: true }),
    ...['Noted', 'Okay boss'].map((t, i) =>
      msg(String(i + 2), 'P' + i, t, { isGroup: true, quotedText: NOTICE })),
  ];
  const { rootMessage, ackSamples } = findRoot(messages);
  assert.ok(!ackSamples.includes(rootMessage.text));
  assert.deepEqual(ackSamples, ['Noted', 'Okay boss']);
});

test('acknowledgement samples exclude my own messages and long ones', () => {
  const messages = [
    msg('1', 'Boss', NOTICE, { isGroup: true }),
    msg('2', 'Me', 'noted', { isGroup: true, quotedText: NOTICE }),
    msg('3', 'A', 'ok', { isGroup: true, quotedText: NOTICE }),
    msg('4', 'B', 'x'.repeat(200), { isGroup: true, quotedText: NOTICE }),
  ];
  assert.deepEqual(findRoot(messages).ackSamples, ['ok']);
});

test('caps acknowledgement samples at six, keeping the most recent', () => {
  const messages = [
    msg('1', 'Boss', NOTICE, { isGroup: true }),
    ...Array.from({ length: 10 }, (_, i) =>
      msg(String(i + 2), 'P' + i, 'ack ' + i, { isGroup: true, quotedText: NOTICE })),
  ];
  const { ackSamples } = findRoot(messages);
  assert.equal(ackSamples.length, 6);
  assert.equal(ackSamples.at(-1), 'ack 9');
});

test('stays well under 20ms on the worst-case burst', () => {
  // The shape that used to block the page for over half a second: a full burst
  // of long messages, every one of them a candidate for clustering.
  const messages = Array.from({ length: 30 }, (_, i) =>
    msg(String(i + 1), 'P' + (i % 8), `${NOTICE} variation ${i}`, {
      isGroup: true,
      quotedText: i % 2 ? NOTICE : undefined,
    }));

  findRoot(messages); // warm
  const started = performance.now();
  for (let i = 0; i < 10; i++) findRoot(messages);
  const perCall = (performance.now() - started) / 10;

  assert.ok(perCall < 20, `findRoot took ${perCall.toFixed(2)}ms per call`);
});
