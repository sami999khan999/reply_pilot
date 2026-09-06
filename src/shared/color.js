/**
 * color.js — the colour maths behind matching the host site's theme.
 *
 * The panel used to hardcode one palette: deep navy, aviation amber. That looks
 * like a foreign object bolted onto WhatsApp's light theme, and doubly so on
 * Slack aubergine or Discord's greys. Instead we read the colours the chat app
 * is actually using and derive a full palette from them.
 *
 * Everything here is pure, so it is testable without a DOM.
 */

/** @typedef {{ r: number, g: number, b: number, a: number }} RGBA */

const HEX_SHORT = /^#([0-9a-f])([0-9a-f])([0-9a-f])([0-9a-f])?$/i;
const HEX_LONG = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})?$/i;
const FUNCTIONAL = /^rgba?\(([^)]+)\)$/i;

/** Contrast ratio a body-text colour must clear against its background. */
export const MIN_TEXT_CONTRAST = 4.5;

/** Below this relative luminance a background counts as dark. */
const DARK_THRESHOLD = 0.22;

/**
 * Parses the colour formats `getComputedStyle` and config files actually
 * produce: `rgb()`, `rgba()`, `#rgb`, `#rrggbb`, and the `transparent` keyword.
 * Anything else — including named colours and modern colour functions — returns
 * null, and callers treat that as "no usable colour here".
 *
 * @param {string|null|undefined} input
 * @returns {RGBA|null}
 */
export function parseColor(input) {
  if (typeof input !== 'string') return null;
  const value = input.trim().toLowerCase();
  if (value === '' || value === 'none') return null;
  if (value === 'transparent') return { r: 0, g: 0, b: 0, a: 0 };

  const short = value.match(HEX_SHORT);
  if (short) {
    return {
      r: parseInt(short[1] + short[1], 16),
      g: parseInt(short[2] + short[2], 16),
      b: parseInt(short[3] + short[3], 16),
      a: short[4] === undefined ? 1 : parseInt(short[4] + short[4], 16) / 255,
    };
  }

  const long = value.match(HEX_LONG);
  if (long) {
    return {
      r: parseInt(long[1], 16),
      g: parseInt(long[2], 16),
      b: parseInt(long[3], 16),
      a: long[4] === undefined ? 1 : parseInt(long[4], 16) / 255,
    };
  }

  const fn = value.match(FUNCTIONAL);
  if (fn) {
    const parts = fn[1].split(/[\s,/]+/).filter(Boolean).map(Number);
    if (parts.length < 3 || parts.some(Number.isNaN)) return null;
    return {
      r: clamp255(parts[0]),
      g: clamp255(parts[1]),
      b: clamp255(parts[2]),
      a: parts.length > 3 ? clamp01(parts[3]) : 1,
    };
  }

  return null;
}

/**
 * WCAG relative luminance, in [0, 1].
 * @param {RGBA} color
 */
export function luminance({ r, g, b }) {
  const [lr, lg, lb] = [r, g, b].map(channel => {
    const v = channel / 255;
    return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * lr + 0.7152 * lg + 0.0722 * lb;
}

/**
 * WCAG contrast ratio between two opaque colours, from 1 to 21.
 * @param {RGBA} a
 * @param {RGBA} b
 */
export function contrastRatio(a, b) {
  const la = luminance(a);
  const lb = luminance(b);
  const lighter = Math.max(la, lb);
  const darker = Math.min(la, lb);
  return (lighter + 0.05) / (darker + 0.05);
}

/**
 * Whether a colour reads as a dark surface — which decides the whole palette.
 * @param {RGBA} color
 */
export function isDark(color) {
  return luminance(color) < DARK_THRESHOLD;
}

/**
 * Blends `amount` of `overlay` over `base`. Both are treated as opaque; this is
 * how surfaces, borders and muted text are derived from the two colours we read
 * off the page.
 *
 * @param {RGBA} base
 * @param {RGBA} overlay
 * @param {number} amount 0 keeps base, 1 returns overlay
 * @returns {RGBA}
 */
export function mix(base, overlay, amount) {
  const t = clamp01(amount);
  return {
    r: Math.round(base.r + (overlay.r - base.r) * t),
    g: Math.round(base.g + (overlay.g - base.g) * t),
    b: Math.round(base.b + (overlay.b - base.b) * t),
    a: 1,
  };
}

/**
 * Picks whichever of two candidates contrasts better against `background`.
 * @param {RGBA} background
 * @param {RGBA} first
 * @param {RGBA} second
 */
export function mostReadable(background, first, second) {
  return contrastRatio(background, first) >= contrastRatio(background, second) ? first : second;
}

/**
 * Nudges a colour toward legibility against a background, without abandoning
 * its hue. Used for a site's brand colour, which is often chosen for contrast
 * against white and can vanish on a dark surface.
 *
 * @param {RGBA} color
 * @param {RGBA} background
 * @param {number} [minContrast]
 * @returns {RGBA}
 */
export function ensureContrast(color, background, minContrast = 3) {
  if (contrastRatio(color, background) >= minContrast) return color;

  const target = isDark(background) ? WHITE : BLACK;
  let best = color;

  // Walk toward the target in small steps and stop at the first shade that
  // clears the bar, so the result stays as close to the brand colour as it can.
  for (let amount = 0.1; amount <= 1; amount += 0.1) {
    best = mix(color, target, amount);
    if (contrastRatio(best, background) >= minContrast) return best;
  }
  return best;
}

/**
 * Serializes back to CSS. Alpha is emitted only when it matters.
 * @param {RGBA} color
 */
export function toCss({ r, g, b, a = 1 }) {
  return a >= 1
    ? `rgb(${r} ${g} ${b})`
    : `rgb(${r} ${g} ${b} / ${Number(a.toFixed(3))})`;
}

export const WHITE = Object.freeze({ r: 255, g: 255, b: 255, a: 1 });
export const BLACK = Object.freeze({ r: 0, g: 0, b: 0, a: 1 });

function clamp01(n) {
  return Number.isFinite(n) ? Math.min(1, Math.max(0, n)) : 1;
}

function clamp255(n) {
  return Number.isFinite(n) ? Math.min(255, Math.max(0, Math.round(n))) : 0;
}
