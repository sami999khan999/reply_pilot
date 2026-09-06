import test from 'node:test';
import assert from 'node:assert/strict';
import { readText, findAncestorToken, collectTail } from '../src/content/logic/scrape.js';

// Minimal stand-ins for the DOM surface these helpers touch. Deliberately not a
// full DOM: the point of the helpers is that they only use tree structure, never
// anything layout-dependent, and a stub that offers no geometry proves it.

const textNode = (value) => ({ nodeType: 3, nodeValue: value, nextSibling: null });

function element(tagName, children = [], attrs = {}) {
  const node = {
    nodeType: 1,
    tagName,
    className: attrs.class || '',
    parentElement: null,
    firstChild: null,
    getAttribute: (name) => (name in attrs ? attrs[name] : null),
  };

  let previous = null;
  for (const child of children) {
    child.parentElement = node;
    if (previous) previous.nextSibling = child; else node.firstChild = child;
    previous = child;
  }
  if (previous) previous.nextSibling = null;

  return node;
}

test('readText returns nothing for a missing element', () => {
  assert.equal(readText(null), '');
});

test('readText joins text nodes and resolves emoji from img alt', () => {
  const el = element('SPAN', [textNode('hey '), element('IMG', [], { alt: '\u{1F44B}' })]);
  assert.equal(readText(el), 'hey \u{1F44B}');
});

test('readText turns <br> into a line break', () => {
  const el = element('SPAN', [textNode('line one'), element('BR'), textNode('line two')]);
  assert.equal(readText(el), 'line one\nline two');
});

test('readText breaks between block elements', () => {
  const el = element('DIV', [
    element('DIV', [textNode('first')]),
    element('DIV', [textNode('second')]),
  ]);
  assert.equal(readText(el), 'first\nsecond');
});

test('readText strips zero-width and bidi marks', () => {
  const el = element('SPAN', [textNode('‎hello​ there﻿')]);
  assert.equal(readText(el), 'hello there');
});

test('readText collapses runs of blank lines and trims', () => {
  const el = element('DIV', [
    element('DIV', [textNode('  top  ')]),
    element('DIV', []),
    element('DIV', []),
    element('DIV', [textNode('bottom')]),
  ]);
  assert.equal(readText(el), 'top\n\nbottom');
});

test('findAncestorToken finds a marker on an ancestor', () => {
  const inner = element('SPAN', [textNode('hi')]);
  const bubble = element('DIV', [inner], { class: 'x message-out y' });
  const found = findAncestorToken(inner, ['message-out', 'message-in']);
  assert.equal(found.token, 'message-out');
  assert.equal(found.node, bubble);
});

test('findAncestorToken prefers the token order it was given', () => {
  const inner = element('SPAN', []);
  element('DIV', [inner], { class: 'message-in message-out' });
  assert.equal(findAncestorToken(inner, ['message-out', 'message-in']).token, 'message-out');
});

test('findAncestorToken gives up rather than walking to the root', () => {
  // An unbounded closest() up a deep host-app tree is exactly what this avoids.
  const deep = element('SPAN', []);
  let node = deep;
  for (let i = 0; i < 12; i++) node = element('DIV', [node]);
  element('DIV', [node], { class: 'message-out' }); // marker 13 levels up

  assert.equal(findAncestorToken(deep, ['message-out'], 3), null);
  assert.equal(findAncestorToken(deep, ['message-out'], 20).token, 'message-out');
});

test('findAncestorToken tolerates elements whose class is not a string', () => {
  const inner = element('SPAN', []);
  const svgish = element('svg', [inner]);
  svgish.className = { baseVal: 'message-out' }; // SVGAnimatedString
  assert.equal(findAncestorToken(inner, ['message-out']), null);
});

test('collectTail keeps the newest items in chronological order', () => {
  const nodes = [1, 2, 3, 4, 5, 6, 7].map(i => ({ i }));
  assert.deepEqual(collectTail(nodes, 3, n => n.i), [5, 6, 7]);
});

test('collectTail skips what the parser rejects', () => {
  const nodes = [1, 2, 3, 4, 5, 6, 7].map(i => ({ i }));
  assert.deepEqual(collectTail(nodes, 3, n => (n.i % 2 ? n.i : null)), [3, 5, 7]);
});

test('collectTail stops parsing once it has enough', () => {
  // The whole point: cost tracks what was asked for, not what is rendered.
  const nodes = Array.from({ length: 1000 }, (_, i) => ({ i }));
  let parsed = 0;
  collectTail(nodes, 20, (n) => { parsed++; return n.i; });
  assert.equal(parsed, 20);
});

test('collectTail returns everything when asked for more than exists', () => {
  const nodes = [1, 2, 3].map(i => ({ i }));
  assert.deepEqual(collectTail(nodes, 99, n => n.i), [1, 2, 3]);
});
