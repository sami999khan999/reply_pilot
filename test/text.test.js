import test from 'node:test';
import assert from 'node:assert/strict';
import { boundedLevenshtein, similarity, normalizeText, trigramsOf } from '../src/shared/text.js';

/** The textbook implementation this replaced, kept as the oracle. */
function naiveLevenshtein(a, b) {
  const m = a.length, n = b.length;
  const dp = Array.from({ length: m + 1 }, (_, i) =>
    Array.from({ length: n + 1 }, (_, j) => (i === 0 ? j : j === 0 ? i : 0)));
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      dp[i][j] = a[i - 1] === b[j - 1]
        ? dp[i - 1][j - 1]
        : 1 + Math.min(dp[i - 1][j], dp[i][j - 1], dp[i - 1][j - 1]);
    }
  }
  return dp[m][n];
}

test('boundedLevenshtein matches the naive implementation when under the bound', () => {
  const pairs = [
    ['', ''], ['a', ''], ['', 'abc'], ['kitten', 'sitting'], ['flaw', 'lawn'],
    ['noted sir', 'noted sirs'], ['okay', 'okay'], ['abcdef', 'abcdef'],
    ['the meeting is at 3pm', 'the meeting is at 4pm'],
    ['completely different', 'nothing alike here'],
  ];
  for (const [a, b] of pairs) {
    const expected = naiveLevenshtein(a, b);
    assert.equal(boundedLevenshtein(a, b, 1000), expected, `${a} / ${b}`);
  }
});

test('boundedLevenshtein is symmetric', () => {
  assert.equal(boundedLevenshtein('kitten', 'sitting', 99), boundedLevenshtein('sitting', 'kitten', 99));
});

test('boundedLevenshtein abandons work past the bound instead of finishing it', () => {
  // Distance is 10; asked to care only up to 2, it must report "more than 2"
  // rather than the exact answer.
  const result = boundedLevenshtein('aaaaaaaaaa', 'bbbbbbbbbb', 2);
  assert.ok(result > 2, `expected > 2, got ${result}`);
  assert.equal(boundedLevenshtein('aaaaaaaaaa', 'bbbbbbbbbb', 20), 10);
});

test('similarity is 1 for identical strings and 0 for empty input', () => {
  assert.equal(similarity('hello there', 'hello there'), 1);
  assert.equal(similarity('', 'anything'), 0);
  assert.equal(similarity('anything', ''), 0);
});

test('similarity rejects wildly different lengths without comparing characters', () => {
  assert.equal(similarity('ok', 'a very long message that goes on and on and on'), 0);
});

const NOTICE = normalizeText(
  'Team, please note that the quarterly all-hands has been moved to Thursday the 14th at 3pm ' +
  'in the main hall. Bring your project updates and be ready to present a two minute summary.');

test('similarity clears the 0.65 threshold for near-duplicates of a long message', () => {
  const quoted = NOTICE.replace('3pm', '3 pm').replace('Thursday', 'thursday');
  assert.ok(similarity(NOTICE, quoted) > 0.65, similarity(NOTICE, quoted));
});

test('similarity stays below the threshold for unrelated messages of similar length', () => {
  const other = normalizeText(
    'Hey, are we still on for football on Saturday morning? I can bring the ball and the bibs ' +
    'if someone else sorts out booking the pitch for an hour or so around ten.');
  assert.ok(similarity(NOTICE, other) < 0.65, similarity(NOTICE, other));
});

test('similarity handles short strings exactly', () => {
  // 'noted sir' -> 'noted sirs' is one insertion over 10 characters.
  assert.equal(similarity('noted sir', 'noted sirs'), 1 - 1 / 10);
});

test('trigramsOf pads so the head and tail are represented', () => {
  const grams = trigramsOf('ab');
  assert.ok(grams.has('  a'));
  assert.ok(grams.has('ab '));
});

test('normalizeText collapses whitespace and case', () => {
  assert.equal(normalizeText('  Hello   THERE\n\nfriend '), 'hello there friend');
});
