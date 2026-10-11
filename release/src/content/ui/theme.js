/**
 * theme.js — makes the panel look like it belongs to the site it is sitting on.
 *
 * The panel used to hardcode one palette: deep navy with aviation amber. That
 * reads as a foreign object on WhatsApp's light theme, and doubly so on Slack
 * aubergine or Discord's greys. So instead of shipping a palette, we read the
 * two colours that actually define a chat surface — the background behind the
 * message list, and the text drawn on it — and derive everything from them,
 * accented with the platform's own brand colour.
 *
 * Reading computed styles flushes style and layout, so it happens on mount and
 * on an actual theme change, never on a timer and never per frame.
 */

import {
  parseColor, luminance, contrastRatio, isDark, mix, mostReadable,
  ensureContrast, toCss, WHITE, BLACK, MIN_TEXT_CONTRAST,
} from '../../shared/color.js';

/** How far up from the probe to look for something that paints a background. */
const BACKGROUND_SEARCH_DEPTH = 8;

/** An almost-transparent layer is not the surface the user perceives. */
const OPAQUE_ENOUGH = 0.6;

/**
 * Attributes host apps flip when the user switches theme.
 *
 * Deliberately excludes `style`: these apps write inline styles on <html> for
 * scroll locks and viewport variables, none of which is a theme change, and
 * each one would schedule a fresh round of computed-style reads.
 */
const THEME_ATTRIBUTES = ['class', 'data-theme', 'theme', 'data-color-mode', 'data-bs-theme'];

/**
 * Reads the host page's colours and returns the panel's palette.
 *
 * @param {{ probe: () => Element|null, accent: string }} opts
 * @returns {{ scheme: 'light'|'dark', tokens: Record<string, string> }}
 */
export function detectTheme({ probe, accent }) {
  const anchor = safeProbe(probe) || document.body || document.documentElement;

  const base = findBackground(anchor) || schemeDefault();
  const dark = isDark(base);
  const text = findText(anchor, base, dark);
  const brand = parseColor(accent) || parseColor('#5b7cfa');

  return { scheme: dark ? 'dark' : 'light', tokens: buildTokens({ base, text, brand, dark }) };
}

/**
 * Derives the full token set from the three colours we have.
 *
 * Dark surfaces elevate by mixing toward white, light surfaces by mixing toward
 * black — the same relationship every one of these apps uses for its own
 * cards and hover states, which is why the panel reads as native.
 *
 * @param {{ base: import('../../shared/color.js').RGBA, text: import('../../shared/color.js').RGBA,
 *           brand: import('../../shared/color.js').RGBA, dark: boolean }} input
 * @returns {Record<string, string>}
 */
export function buildTokens({ base, text, brand, dark }) {
  const elevate = dark ? WHITE : BLACK;

  const bg = base;
  const bg2 = mix(base, elevate, dark ? 0.03 : 0.02);
  const surface = mix(base, elevate, dark ? 0.07 : 0.04);
  const surface2 = mix(base, elevate, dark ? 0.12 : 0.07);

  // A brand colour is usually picked to sit on white, so it can disappear on a
  // dark surface. Nudge it toward legibility without losing its hue.
  const accent = ensureContrast(brand, bg, 3);
  const accent2 = mix(accent, dark ? BLACK : WHITE, 0.18);
  const onAccent = mostReadable(accent, BLACK, WHITE);

  // Quieter text still has to be readable. Aim for a step down from body text,
  // then hold it to the same contrast floor rather than trusting the mix — a
  // ratio that works on Discord's mid-grey would fail on pure white.
  const muted = ensureContrast(mix(text, bg, 0.28), bg, MIN_TEXT_CONTRAST);
  const dim = ensureContrast(mix(text, bg, 0.44), bg, MIN_TEXT_CONTRAST);

  return {
    '--rp-scheme': dark ? 'dark' : 'light',
    '--rp-bg': toCss(bg),
    '--rp-bg-2': toCss(bg2),
    '--rp-surface': toCss(surface),
    '--rp-surface-2': toCss(surface2),
    '--rp-text': toCss(text),
    '--rp-muted': toCss(muted),
    '--rp-dim': toCss(dim),

    '--rp-accent': toCss(accent),
    '--rp-accent-2': toCss(accent2),
    '--rp-on-accent': toCss(onAccent),

    // Every derived shade in the stylesheet is a color-mix against one of these,
    // so light and dark need no separate rule sets.
    '--rp-elevate': toCss(elevate),
    '--rp-shadow-color': dark ? 'rgb(0 0 0)' : toCss(mix(base, BLACK, 0.55)),
    '--rp-shadow-strength': dark ? '55%' : '18%',

    '--rp-success': toCss(ensureContrast(parseColor(dark ? '#4ade80' : '#15803d'), bg, MIN_TEXT_CONTRAST)),
    '--rp-warn': toCss(ensureContrast(parseColor(dark ? '#fbbf24' : '#a16207'), bg, MIN_TEXT_CONTRAST)),
    '--rp-error': toCss(ensureContrast(parseColor(dark ? '#f87171' : '#b91c1c'), bg, MIN_TEXT_CONTRAST)),
  };
}

/**
 * Writes the tokens onto the shadow host. Inline custom properties inherit into
 * the shadow tree and override the stylesheet's `:host` defaults, so the panel
 * needs no per-platform rules.
 *
 * Writing a custom property invalidates style for the whole shadow tree, and
 * `class` on <html> churns constantly in these apps — scroll state, open modals
 * — so an unchanged palette must cost nothing.
 *
 * @param {HTMLElement} host
 * @param {Record<string, string>} tokens
 * @returns {boolean} whether anything was actually written
 */
export function applyTheme(host, tokens) {
  const signature = JSON.stringify(tokens);
  if (APPLIED.get(host) === signature) return false;

  for (const name in tokens) host.style.setProperty(name, tokens[name]);
  APPLIED.set(host, signature);
  return true;
}

/**
 * The palette last written to each host. Kept here rather than in a data
 * attribute: an attribute write is itself a DOM mutation, and this is
 * bookkeeping the page has no business seeing.
 */
const APPLIED = new WeakMap();

/**
 * Keeps the panel in step with the host when the user switches theme.
 *
 * Watches two things and nothing else: the OS colour-scheme preference, and
 * attribute changes on `<html>` — which is how every one of these apps applies a
 * theme. That observer is attribute-filtered and does not descend into the
 * document, so unlike a subtree observer it costs effectively nothing.
 *
 * @param {{ host: HTMLElement, probe: () => Element|null, accent: string,
 *           onChange?: (scheme: 'light'|'dark') => void }} opts
 * @returns {{ refresh: () => void, destroy: () => void }}
 */
export function watchTheme({ host, probe, accent, onChange }) {
  let scheme = null;
  let scheduled = null;

  function refresh() {
    scheduled = null;
    const result = detectTheme({ probe, accent });
    applyTheme(host, result.tokens);
    if (result.scheme !== scheme) {
      scheme = result.scheme;
      onChange?.(scheme);
    }
  }

  // Theme switches repaint the whole app; wait for that to settle before
  // measuring, and never measure more than once per burst.
  function schedule() {
    if (scheduled !== null) return;
    scheduled = setTimeout(refresh, 120);
  }

  const media = window.matchMedia('(prefers-color-scheme: dark)');
  media.addEventListener('change', schedule);

  const observer = new MutationObserver(schedule);
  observer.observe(document.documentElement, { attributes: true, attributeFilter: THEME_ATTRIBUTES });

  refresh();

  return {
    refresh: schedule,
    destroy() {
      if (scheduled !== null) clearTimeout(scheduled);
      media.removeEventListener('change', schedule);
      observer.disconnect();
    },
  };
}

// ── Reading the page ─────────────────────────────────────────────────────────

/** @param {() => Element|null} probe */
function safeProbe(probe) {
  try {
    return probe();
  } catch {
    return null; // host DOM mid-render
  }
}

/**
 * Walks up from the probe for the first ancestor that actually paints. Chat
 * surfaces are usually several transparent wrappers deep.
 *
 * @param {Element} start
 * @returns {import('../../shared/color.js').RGBA|null}
 */
function findBackground(start) {
  let node = start;
  for (let depth = 0; node !== null && depth < BACKGROUND_SEARCH_DEPTH; depth++, node = node.parentElement) {
    const color = parseColor(getComputedStyle(node).backgroundColor);
    if (color && color.a >= OPAQUE_ENOUGH) return { ...color, a: 1 };
  }
  return null;
}

/**
 * The host's own text colour, unless it would be illegible on the background we
 * settled on — in which case plain black or white beats an unreadable match.
 *
 * @param {Element} anchor
 * @param {import('../../shared/color.js').RGBA} bg
 * @param {boolean} dark
 */
function findText(anchor, bg, dark) {
  const found = parseColor(getComputedStyle(anchor).color);
  const fallback = dark ? WHITE : BLACK;
  if (!found || found.a < OPAQUE_ENOUGH) return fallback;

  const opaque = { ...found, a: 1 };
  return contrastRatio(opaque, bg) >= MIN_TEXT_CONTRAST ? opaque : fallback;
}

/** No usable background anywhere: fall back to the OS preference. */
function schemeDefault() {
  const prefersDark = window.matchMedia?.('(prefers-color-scheme: dark)').matches;
  return prefersDark ? { r: 24, g: 26, b: 32, a: 1 } : { r: 255, g: 255, b: 255, a: 1 };
}

export { luminance };
