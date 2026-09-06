import test from 'node:test';
import assert from 'node:assert/strict';
import { buildTokens, applyTheme } from '../src/content/ui/theme.js';
import { parseColor, contrastRatio, MIN_TEXT_CONTRAST } from '../src/shared/color.js';

/** The real background/text/accent triples of the apps we support. */
const SURFACES = [
  { name: 'WhatsApp dark', bg: '#111b21', text: '#e9edef', accent: '#25d366', dark: true },
  { name: 'WhatsApp light', bg: '#efeae2', text: '#111b21', accent: '#25d366', dark: false },
  { name: 'Messenger light', bg: '#ffffff', text: '#050505', accent: '#0084ff', dark: false },
  { name: 'Discord dark', bg: '#313338', text: '#dbdee1', accent: '#5865f2', dark: true },
  { name: 'Slack dark', bg: '#1a1d21', text: '#d1d2d3', accent: '#611f69', dark: true },
  { name: 'Slack light', bg: '#ffffff', text: '#1d1c1d', accent: '#611f69', dark: false },
  { name: 'Telegram dark', bg: '#212121', text: '#ffffff', accent: '#3390ec', dark: true },
  { name: 'LinkedIn light', bg: '#ffffff', text: '#000000e6', accent: '#0a66c2', dark: false },
  { name: 'pure black (OLED)', bg: '#000000', text: '#ffffff', accent: '#1d9bf0', dark: true },
];

const tokensFor = (s) => buildTokens({
  base: parseColor(s.bg),
  text: { ...parseColor(s.text), a: 1 },
  brand: parseColor(s.accent),
  dark: s.dark,
});

for (const surface of SURFACES) {
  test(`${surface.name}: body text is legible on the panel background`, () => {
    const t = tokensFor(surface);
    const ratio = contrastRatio(parseColor(t['--rp-text']), parseColor(t['--rp-bg']));
    assert.ok(ratio >= MIN_TEXT_CONTRAST, `contrast ${ratio.toFixed(2)}`);
  });

  test(`${surface.name}: quieter text still clears the contrast floor`, () => {
    const t = tokensFor(surface);
    // Muted and dim carry hints, labels and placeholders — all small text, so
    // they get the same floor as body text, not the large-text allowance.
    for (const name of ['--rp-muted', '--rp-dim']) {
      const ratio = contrastRatio(parseColor(t[name]), parseColor(t['--rp-bg']));
      assert.ok(ratio >= MIN_TEXT_CONTRAST, `${name} contrast ${ratio.toFixed(2)}`);
    }
  });

  test(`${surface.name}: the text tiers stay visually distinct`, () => {
    const t = tokensFor(surface);
    const bg = parseColor(t['--rp-bg']);
    const [text, muted, dim] = ['--rp-text', '--rp-muted', '--rp-dim']
      .map(n => contrastRatio(parseColor(t[n]), bg));
    assert.ok(text > muted, 'body text is stronger than muted');
    assert.ok(muted >= dim, 'muted is at least as strong as dim');
  });

  test(`${surface.name}: label on the accent button is legible`, () => {
    const t = tokensFor(surface);
    const ratio = contrastRatio(parseColor(t['--rp-on-accent']), parseColor(t['--rp-accent']));
    assert.ok(ratio >= MIN_TEXT_CONTRAST, `contrast ${ratio.toFixed(2)}`);
  });

  test(`${surface.name}: the accent is visible against the background`, () => {
    const t = tokensFor(surface);
    const ratio = contrastRatio(parseColor(t['--rp-accent']), parseColor(t['--rp-bg']));
    assert.ok(ratio >= 3, `contrast ${ratio.toFixed(2)}`);
  });

  test(`${surface.name}: surfaces separate from the background`, () => {
    const t = tokensFor(surface);
    // Cards must be distinguishable from the panel behind them, or the layout
    // collapses into one flat block.
    assert.notEqual(t['--rp-surface'], t['--rp-bg']);
    assert.notEqual(t['--rp-surface-2'], t['--rp-surface']);
  });

  test(`${surface.name}: status colours stay legible`, () => {
    const t = tokensFor(surface);
    for (const name of ['--rp-success', '--rp-warn', '--rp-error']) {
      const ratio = contrastRatio(parseColor(t[name]), parseColor(t['--rp-bg']));
      assert.ok(ratio >= MIN_TEXT_CONTRAST, `${name} contrast ${ratio.toFixed(2)}`);
    }
  });
}

test('the panel background is exactly the host background', () => {
  // Anything else and the panel reads as a separate app pasted over the site.
  const t = tokensFor(SURFACES[0]);
  assert.deepEqual(parseColor(t['--rp-bg']), { ...parseColor('#111b21'), a: 1 });
});

test('dark themes elevate toward white, light themes toward black', () => {
  const dark = tokensFor(SURFACES[0]);
  const light = tokensFor(SURFACES[2]);

  assert.equal(dark['--rp-elevate'], 'rgb(255 255 255)');
  assert.equal(light['--rp-elevate'], 'rgb(0 0 0)');

  const lum = (v) => parseColor(v).r;
  assert.ok(lum(dark['--rp-surface']) > lum(dark['--rp-bg']), 'dark surfaces lighten');
  assert.ok(lum(light['--rp-surface']) < lum(light['--rp-bg']), 'light surfaces darken');
});

test('every token is a value CSS can actually use', () => {
  for (const surface of SURFACES) {
    for (const [name, value] of Object.entries(tokensFor(surface))) {
      if (name === '--rp-scheme') {
        assert.ok(value === 'dark' || value === 'light');
      } else if (name === '--rp-shadow-strength') {
        assert.match(value, /^\d+%$/);
      } else {
        assert.ok(parseColor(value) !== null, `${surface.name} ${name} = ${value}`);
      }
    }
  }
});

test('re-applying an unchanged palette writes nothing', () => {
  // Writing a custom property invalidates style for the whole shadow tree, and
  // <html> class churn (scroll state, open modals) schedules refreshes
  // constantly — so an unchanged palette has to be free.
  const writes = [];
  const host = { style: { setProperty: (n, v) => writes.push(n) }, dataset: {} };
  const tokens = tokensFor(SURFACES[0]);

  assert.equal(applyTheme(host, tokens), true, 'the first application writes');
  const initial = writes.length;
  assert.ok(initial > 0);

  assert.equal(applyTheme(host, tokens), false, 'the second is a no-op');
  assert.equal(writes.length, initial, 'and performs no writes at all');
});

test('a changed palette is applied', () => {
  const writes = [];
  const host = { style: { setProperty: (n) => writes.push(n) }, dataset: {} };

  applyTheme(host, tokensFor(SURFACES[0]));
  writes.length = 0;

  assert.equal(applyTheme(host, tokensFor(SURFACES[2])), true, 'a real theme switch is applied');
  assert.ok(writes.includes('--rp-bg'));
});
