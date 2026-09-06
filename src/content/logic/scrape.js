/**
 * scrape.js — layout-free DOM reading helpers shared by the adapters.
 *
 * The rule this module exists to enforce: reading a conversation must never
 * force the host page to lay out. The previous scrape called `innerText` once
 * per message row and `getBoundingClientRect()` twice per row, each of which
 * flushes pending style and layout for the whole document. On a chat with a few
 * hundred rendered rows that is a few hundred full reflows, which is what made
 * pressing Generate freeze the tab.
 */

/** Tags that imply a line break when we flatten a subtree to text. */
const BLOCK_TAGS = new Set(['DIV', 'P', 'LI', 'BLOCKQUOTE']);

/** Zero-width and bidi marks the chat apps sprinkle through message text. */
const INVISIBLES = /[\u200b\u200c\u200d\u200e\u200f\ufeff]/g;

const TEXT_NODE = 3;
const ELEMENT_NODE = 1;

/**
 * Reads an element's visible text without forcing layout.
 *
 * `innerText` is defined in terms of rendered boxes, so every call flushes style
 * and layout. `textContent` is free but loses line breaks and emoji. This walks
 * the tree once: text nodes verbatim, `<br>` and block boundaries as newlines,
 * `<img alt>` (how both apps render emoji) as its alt text.
 *
 * @param {Element|null} el
 * @returns {string}
 */
export function readText(el) {
  if (!el) return '';

  let out = '';

  const walk = (node) => {
    for (let child = node.firstChild; child !== null; child = child.nextSibling) {
      const type = child.nodeType;

      if (type === TEXT_NODE) {
        out += child.nodeValue;
        continue;
      }
      if (type !== ELEMENT_NODE) continue;

      const tag = child.tagName;
      if (tag === 'BR') { out += '\n'; continue; }
      if (tag === 'IMG') { out += child.getAttribute('alt') || ''; continue; }

      walk(child);
      if (BLOCK_TAGS.has(tag)) out += '\n';
    }
  };

  walk(el);

  return out.replace(INVISIBLES, '').replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim();
}

/**
 * Walks up a bounded number of ancestors looking for one whose class list
 * carries any of `tokens`, and returns that token plus the element it sat on.
 *
 * Replaces a pair of `querySelector('[class*="..."]')` calls (an unindexed
 * substring match over the whole subtree) plus a pair of `closest()` calls
 * (an unbounded walk to the document root) that ran for every single row.
 *
 * @param {Element|null} el
 * @param {string[]} tokens
 * @param {number} [maxDepth]
 * @returns {{ token: string, node: Element }|null}
 */
export function findAncestorToken(el, tokens, maxDepth = 6) {
  let node = el;
  for (let depth = 0; node !== null && depth < maxDepth; depth++, node = node.parentElement) {
    const cls = node.className;
    // SVG elements carry an SVGAnimatedString here, not a string.
    if (typeof cls !== 'string' || cls === '') continue;
    for (let i = 0; i < tokens.length; i++) {
      if (cls.includes(tokens[i])) return { token: tokens[i], node };
    }
  }
  return null;
}

/**
 * Decides which of `elements` hug the right-hand edge of `container`, reading
 * every rect in a single batch.
 *
 * Chat apps lay out a full-width message list and push outgoing bubbles to its
 * right edge, so the message is measured against the list rather than against
 * its own row — a row that wraps the bubble tightly carries no signal, and on
 * WhatsApp the scraped element *is* its own row.
 *
 * Comparing edge distances rather than centres keeps this right for bubbles
 * wide enough to cross the midpoint.
 *
 * Rect reads are only expensive when interleaved with writes: the first flushes
 * layout and the rest are served from it, so callers must do no DOM writing
 * while this runs.
 *
 * @param {ArrayLike<Element>} elements
 * @param {Element} container
 * @returns {boolean[]}
 */
export function batchedRightAligned(elements, container) {
  const bounds = container.getBoundingClientRect();
  const out = new Array(elements.length);

  for (let i = 0; i < elements.length; i++) {
    const rect = elements[i].getBoundingClientRect();
    const gapLeft = rect.left - bounds.left;
    const gapRight = bounds.right - rect.right;
    // A bubble that fills the width sits at neither edge; treat it as incoming.
    out[i] = rect.width > 0 && gapRight < gapLeft;
  }

  return out;
}

/**
 * Collects up to `limit` items from the tail of a list, newest last.
 *
 * The old scrape parsed every rendered row — often a thousand or more — and then
 * threw all but the last 20 away. This walks backwards and stops as soon as it
 * has enough, so cost is proportional to what is asked for, not to how long the
 * user has had the chat open.
 *
 * @template T
 * @param {ArrayLike<Element>} nodes
 * @param {number} limit
 * @param {(node: Element) => T|null} parse returns null to skip the node
 * @returns {T[]} chronological order (oldest first)
 */
export function collectTail(nodes, limit, parse) {
  const out = [];
  for (let i = nodes.length - 1; i >= 0 && out.length < limit; i--) {
    const item = parse(nodes[i]);
    if (item !== null && item !== undefined) out.push(item);
  }
  out.reverse();
  return out;
}
