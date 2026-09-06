import test from 'node:test';
import assert from 'node:assert/strict';
import { classify } from '../src/worker/logic/classifier.js';

const msg = (sender, text, extra = {}) => ({
  id: `${sender}-${text}`,
  sender,
  isMe: sender === 'Me',
  text,
  ts: Date.now(),
  isGroup: false,
  mentionsMe: false,
  ...extra,
});

test('no messages means no reply needed', () => {
  const result = classify([], { myName: 'Sami' });
  assert.equal(result.needsReply, false);
  assert.equal(result.confidence, 'high');
});

test('a question from someone else needs a reply', () => {
  const result = classify([msg('Rafi', 'are you coming tonight?')], { myName: 'Sami' });
  assert.equal(result.needsReply, true);
  assert.equal(result.confidence, 'high');
});

test('being named needs a reply', () => {
  const result = classify([msg('Rafi', 'sami can handle that one')], { myName: 'Sami' });
  assert.equal(result.needsReply, true);
  assert.equal(result.confidence, 'high');
});

test('an @mention needs a reply', () => {
  const result = classify([msg('Rafi', 'handled', { mentionsMe: true, isGroup: true })], { myName: 'Sami' });
  assert.equal(result.needsReply, true);
});

test('my own last message means no reply needed', () => {
  const result = classify([msg('Rafi', 'ok'), msg('Me', 'sounds good')], { myName: 'Sami' });
  assert.equal(result.needsReply, false);
  assert.equal(result.confidence, 'high');
});

test('my own last message being a question means we are waiting on them', () => {
  const result = classify([msg('Rafi', 'ok'), msg('Me', 'what time?')], { myName: 'Sami' });
  assert.equal(result.needsReply, false);
  assert.equal(result.confidence, 'medium');
  assert.match(result.reason, /waiting/i);
});

test('a plain statement in a 1:1 chat needs a reply', () => {
  const result = classify([msg('Rafi', 'i will be there at seven')], { myName: 'Sami' });
  assert.equal(result.needsReply, true);
  assert.equal(result.confidence, 'high');
});

test('a group conversation between others does not need a reply', () => {
  const messages = [
    msg('A', 'the venue changed to the annex building', { isGroup: true }),
    msg('B', 'thanks for letting us know', { isGroup: true }),
  ];
  const result = classify(messages, { myName: 'Sami' });
  assert.equal(result.needsReply, false);
  assert.equal(result.confidence, 'high');
});

test('a group broadcast offers an optional acknowledgement', () => {
  const messages = [
    msg('Boss', 'the venue changed to the annex building', { isGroup: true }),
    msg('A', 'noted', { isGroup: true }),
    msg('B', 'okay', { isGroup: true }),
    msg('C', 'thanks', { isGroup: true }),
  ];
  const result = classify(messages, { myName: 'Sami' });
  assert.equal(result.needsReply, true);
  assert.equal(result.confidence, 'low');
});

test('a group I have taken part in needs a reply', () => {
  const messages = [
    msg('Me', 'i can bring the projector', { isGroup: true }),
    msg('A', 'the venue changed to the annex building', { isGroup: true }),
  ];
  const result = classify(messages, { myName: 'Sami' });
  assert.equal(result.needsReply, true);
  assert.equal(result.confidence, 'medium');
});

test('a name of "Me" is not matched against message text', () => {
  // Otherwise any message containing "me" would read as addressing the user.
  const result = classify([msg('Rafi', 'let me think about it')], { myName: 'Me' });
  assert.equal(result.reason, 'Direct message from the other person.');
});
