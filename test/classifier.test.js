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

test('a quoted mention of a meeting is not read as quoting you', () => {
  // "Meeting" contains "Me". The old substring test made rule 1 — which
  // short-circuits everything after it — fire on ordinary vocabulary.
  const messages = [
    msg('Me', 'i will bring the slides'),
    msg('Rafi', 'sounds good', { quotedText: 'Can we move the Meeting to four' }),
  ];
  const result = classify(messages, { myName: 'Sami' });
  assert.doesNotMatch(result.reason, /directly addressed/);
});

test('a quote of something you actually said is recognised', () => {
  const messages = [
    msg('Me', 'i will bring the slides and the projector'),
    msg('Rafi', 'thanks', { quotedText: 'i will bring the slides and the projector' }),
  ];
  const result = classify(messages, { myName: 'Sami' });
  assert.equal(result.needsReply, true);
  assert.match(result.reason, /directly addressed/);
});

test('a truncated quote of your message still counts', () => {
  // Chat apps clip quoted text, so the match has to tolerate a prefix.
  const messages = [
    msg('Me', 'the deploy finished and everything looks green on the dashboard'),
    msg('Rafi', 'nice', { quotedText: 'the deploy finished and everything' }),
  ];
  assert.match(classify(messages, { myName: 'Sami' }).reason, /directly addressed/);
});

test('your name is matched on word boundaries, not as a substring', () => {
  // A user called "Sam" was addressed by the word "sample".
  const notAddressed = classify([msg('Rafi', 'here is a sample of the report')], { myName: 'Sam' });
  assert.doesNotMatch(notAddressed.reason, /directly addressed/);

  const addressed = classify([msg('Rafi', 'Sam can you take this one')], { myName: 'Sam' });
  assert.match(addressed.reason, /directly addressed/);
});

test('a name is matched regardless of case and adjacent punctuation', () => {
  for (const text of ['sami, can you look', 'Hey SAMI!', '(sami) please review']) {
    assert.match(classify([msg('Rafi', text)], { myName: 'Sami' }).reason, /directly addressed/, text);
  }
});

test('a name containing regex metacharacters does not break matching', () => {
  const result = classify([msg('Rafi', 'ping for a.b')], { myName: 'a.b' });
  assert.match(result.reason, /directly addressed/);
  // And the dot is a literal, not a wildcard.
  assert.doesNotMatch(classify([msg('Rafi', 'ping for axb')], { myName: 'a.b' }).reason, /directly addressed/);
});

test('a name of "Me" is not matched against message text', () => {
  // Otherwise any message containing "me" would read as addressing the user.
  const result = classify([msg('Rafi', 'let me think about it')], { myName: 'Me' });
  assert.equal(result.reason, 'Direct message from the other person.');
});
