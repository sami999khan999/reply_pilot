import test from 'node:test';
import assert from 'node:assert/strict';
import { chromium } from '/opt/node22/lib/node_modules/playwright/index.mjs';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

/** Composer insertion is DOM behaviour, so it is exercised in a real browser. */
let browser;
let page;

test.before(async () => {
  browser = await chromium.launch({ args: ['--no-sandbox'] });
  page = await browser.newPage();
  await page.route('**/src/**', async (route, req) => {
    const path = new URL(req.url()).pathname;
    route.fulfill({ contentType: 'text/javascript', body: await readFile(join(ROOT, path), 'utf8') });
  });
  await page.route('https://composer.test/', route =>
    route.fulfill({ contentType: 'text/html', body: '<!doctype html><html><body></body></html>' }));
});

test.after(async () => { await browser?.close(); });

/**
 * Builds a composer, runs the insert, and reports what happened to it.
 * @param {{ html: string, selector: string, text: string, draft?: string, blockEvents?: boolean }} spec
 */
async function insert(spec) {
  await page.goto('https://composer.test/');
  return page.evaluate(async (spec) => {
    const { insertIntoComposer } = await import('/src/content/logic/composerInsert.js');

    document.body.innerHTML = spec.html;
    const box = document.querySelector(spec.selector);

    if (spec.draft !== undefined) {
      if ('value' in box) box.value = spec.draft;
      else box.textContent = spec.draft;
    }

    const events = [];
    for (const type of ['input', 'paste', 'beforeinput']) {
      box.addEventListener(type, (e) => {
        events.push(type);
        if (spec.blockEvents) e.preventDefault();
      });
    }

    // An editor that ignores DOM writes entirely, like Slate or Quill.
    if (spec.inert) Object.defineProperty(box, 'textContent', { get: () => spec.draft ?? '', set: () => {} });

    const result = insertIntoComposer(box, spec.text);
    return {
      result,
      value: 'value' in box ? box.value : box.textContent,
      events,
      caret: box.selectionStart ?? null,
    };
  }, spec);
}

const EDITABLE = '<div id="c" contenteditable="true" role="textbox"></div>';
const TEXTAREA = '<textarea id="c" placeholder="Message"></textarea>';

test('inserts into a contenteditable composer', async () => {
  const out = await insert({ html: EDITABLE, selector: '#c', text: 'sounds good' });
  assert.equal(out.result, true);
  assert.match(out.value, /sounds good/);
});

test('inserts into a textarea composer', async () => {
  // Instagram and the structural fallback both resolve textareas, whose value
  // is not textContent — these used to fail silently and report success.
  const out = await insert({ html: TEXTAREA, selector: '#c', text: 'on my way' });
  assert.equal(out.result, true);
  assert.equal(out.value, 'on my way');
});

test('a textarea insert fires input so a controlled editor sees it', async () => {
  const out = await insert({ html: TEXTAREA, selector: '#c', text: 'hello' });
  assert.ok(out.events.includes('input'), `events: ${out.events.join(', ')}`);
});

test('an existing draft in a textarea survives', async () => {
  const out = await insert({ html: TEXTAREA, selector: '#c', text: 'world', draft: 'hello ' });
  assert.equal(out.value, 'hello world');
});

test('the caret ends up after the inserted text', async () => {
  const out = await insert({ html: TEXTAREA, selector: '#c', text: 'abc', draft: 'xy' });
  assert.equal(out.caret, 'xy'.length + 'abc'.length);
});

test('an existing draft in a contenteditable survives, and the reply follows it', async () => {
  const out = await insert({ html: EDITABLE, selector: '#c', text: 'there', draft: 'hi' });

  assert.match(out.value, /hi/, `draft was destroyed: ${JSON.stringify(out.value)}`);
  assert.match(out.value, /there/);
  assert.ok(out.value.indexOf('hi') < out.value.indexOf('there'), 'appended, not prepended');
});

test('an editor that accepts nothing is reported as a failure, not a success', async () => {
  // The old version cleared the box and returned true regardless, so the panel
  // said the reply was inserted when it had actually been thrown away.
  const out = await insert({
    html: EDITABLE, selector: '#c', text: 'will not land', draft: 'untouched', inert: true,
  });
  assert.equal(out.result, false);
  assert.equal(out.value, 'untouched', 'and the draft is left exactly as it was');
});

test('a rich editor is offered a paste when direct insertion does not take', async () => {
  const out = await insert({
    html: EDITABLE, selector: '#c', text: 'via paste', draft: '', inert: true,
  });
  assert.ok(out.events.includes('paste'), `events: ${out.events.join(', ')}`);
});

test('a missing composer or empty text is refused', async () => {
  const out = await page.evaluate(async () => {
    const { insertIntoComposer } = await import('/src/content/logic/composerInsert.js');
    return [insertIntoComposer(null, 'x'), insertIntoComposer(document.body, '')];
  });
  assert.deepEqual(out, [false, false]);
});

test('an element that is neither a field nor editable is refused', async () => {
  const out = await insert({ html: '<div id="c">not editable</div>', selector: '#c', text: 'x' });
  assert.equal(out.result, false);
  assert.equal(out.value, 'not editable');
});
