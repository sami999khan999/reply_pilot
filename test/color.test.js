import test from 'node:test';
import assert from 'node:assert/strict';
import {
  parseColor, luminance, contrastRatio, isDark, mix, mostReadable,
  ensureContrast, toCss, WHITE, BLACK,
} from '../src/shared/color.js';

test('parses the formats getComputedStyle actually returns', () => {
  assert.deepEqual(parseColor('rgb(17, 27, 33)'), { r: 17, g: 27, b: 33, a: 1 });
  assert.deepEqual(parseColor('rgba(0, 0, 0, 0.5)'), { r: 0, g: 0, b: 0, a: 0.5 });
  assert.deepEqual(parseColor('rgb(255 255 255 / 0.25)'), { r: 255, g: 255, b: 255, a: 0.25 });
  assert.deepEqual(parseColor('transparent'), { r: 0, g: 0, b: 0, a: 0 });
});

test('parses hex in both lengths, with and without alpha', () => {
  assert.deepEqual(parseColor('#fff'), { r: 255, g: 255, b: 255, a: 1 });
  assert.deepEqual(parseColor('#25d366'), { r: 37, g: 211, b: 102, a: 1 });
  assert.deepEqual(parseColor('#00000080').a, 128 / 255);
});

test('returns null rather than guessing at colours it cannot read', () => {
  for (const input of [null, undefined, '', 'chartreuse', 'color(display-p3 1 0 0)', 'rgb(a, b, c)']) {
    assert.equal(parseColor(input), null, String(input));
  }
});

test('luminance and contrast follow WCAG', () => {
  assert.equal(luminance(BLACK), 0);
  assert.equal(luminance(WHITE), 1);
  assert.equal(Math.round(contrastRatio(BLACK, WHITE)), 21);
  assert.equal(contrastRatio(WHITE, WHITE), 1);
});

test('recognises the real background colours of the supported apps', () => {
  const dark = ['#111b21', '#0b141a', '#313338', '#1a1d21', '#212121', '#000000'];
  const light = ['#ffffff', '#f0f2f5', '#efeae2', '#f8f9fa', '#fafafa'];

  for (const hex of dark) assert.ok(isDark(parseColor(hex)), `${hex} should read as dark`);
  for (const hex of light) assert.ok(!isDark(parseColor(hex)), `${hex} should read as light`);
});

test('mix moves between two colours and always returns an opaque result', () => {
  assert.deepEqual(mix(BLACK, WHITE, 0), { r: 0, g: 0, b: 0, a: 1 });
  assert.deepEqual(mix(BLACK, WHITE, 1), { r: 255, g: 255, b: 255, a: 1 });
  assert.deepEqual(mix(BLACK, WHITE, 0.5), { r: 128, g: 128, b: 128, a: 1 });
});

test('mix clamps rather than extrapolating', () => {
  assert.deepEqual(mix(BLACK, WHITE, -1), { r: 0, g: 0, b: 0, a: 1 });
  assert.deepEqual(mix(BLACK, WHITE, 5), { r: 255, g: 255, b: 255, a: 1 });
});

test('mostReadable picks the higher-contrast candidate', () => {
  assert.deepEqual(mostReadable(parseColor('#111b21'), BLACK, WHITE), WHITE);
  assert.deepEqual(mostReadable(parseColor('#ffffff'), BLACK, WHITE), BLACK);
});

test('ensureContrast leaves an already-legible colour alone', () => {
  const accent = parseColor('#25d366');
  const bg = parseColor('#111b21');
  assert.deepEqual(ensureContrast(accent, bg, 3), accent);
});

test('ensureContrast rescues a brand colour that vanishes on its background', () => {
  // Slack's aubergine is picked to sit behind white text and all but disappears
  // on a dark surface — exactly the case that made a fixed palette necessary.
  const brand = parseColor('#611f69');
  const bg = parseColor('#000000');
  assert.ok(contrastRatio(brand, bg) < 3, 'precondition: brand is illegible here');

  const fixed = ensureContrast(brand, bg, 3);
  assert.ok(contrastRatio(fixed, bg) >= 3, 'result clears the bar');
  assert.notDeepEqual(fixed, brand);
});

test('ensureContrast stays as close to the brand colour as it can', () => {
  // It walks toward legibility in steps and stops at the first shade that
  // clears the bar, rather than jumping straight to white.
  const brand = parseColor('#611f69');
  const bg = parseColor('#000000');
  const fixed = ensureContrast(brand, bg, 3);

  assert.ok(contrastRatio(fixed, bg) < 6, 'did not overshoot to near-white');
  assert.ok(fixed.b > fixed.g, 'kept the purple lean');
});

test('every platform accent ends up legible on both light and dark surfaces', async () => {
  const { PLATFORMS } = await import('../src/content/adapters/platforms.js');
  const surfaces = [parseColor('#000000'), parseColor('#111b21'), parseColor('#ffffff'), parseColor('#f0f2f5')];

  for (const config of PLATFORMS) {
    for (const bg of surfaces) {
      const accent = ensureContrast(parseColor(config.accent), bg, 3);
      assert.ok(contrastRatio(accent, bg) >= 3,
        `${config.id} accent on ${toCss(bg)} = ${contrastRatio(accent, bg).toFixed(2)}`);
    }
  }
});

test('toCss omits alpha when the colour is opaque', () => {
  assert.equal(toCss({ r: 1, g: 2, b: 3, a: 1 }), 'rgb(1 2 3)');
  assert.equal(toCss({ r: 1, g: 2, b: 3, a: 0.5 }), 'rgb(1 2 3 / 0.5)');
});
