/**
 * text.js — message-text utilities shared by the content script and the worker.
 *
 * The similarity function here is the reason this module exists. Root detection
 * used a textbook Levenshtein that allocated a full (m+1) x (n+1) array of
 * arrays and ran it for every message against every cluster, then again for
 * every quoted text, then again inside a `find` that re-normalized the whole
 * conversation. On thirty messages of a few hundred characters that is tens of
 * millions of cell writes plus the garbage collection to match — seconds of
 * blocked main thread, which is what made pressing Generate freeze the tab.
 *
 * The replacement costs about the same as reading the strings once.
 */

/** Above this length, exact edit distance is replaced by trigram overlap. */
const SHORT_LIMIT = 120;

/**
 * Texts whose lengths differ by more than this ratio are never near-duplicates,
 * so they are rejected before any character is compared.
 */
const MIN_LENGTH_RATIO = 0.6;

/**
 * Results are only meaningful against thresholds at or above this. Distances
 * beyond it are abandoned early rather than computed exactly.
 */
const MIN_MEANINGFUL_SIMILARITY = 0.5;

/** Trigram sets are memoized; the cache is dropped wholesale when it fills. */
const TRIGRAM_CACHE = new Map();
const TRIGRAM_CACHE_MAX = 256;

/**
 * Generates a stable ID for a message from sender + timestamp + text.
 * @param {string} sender
 * @param {number} ts
 * @param {string} text
 * @returns {string}
 */
export function makeMessageId(sender, ts, text) {
  const raw = `${sender}|${ts}|${text.slice(0, 40)}`;
  let hash = 0;
  for (let i = 0; i < raw.length; i++) {
    hash = ((hash << 5) - hash) + raw.charCodeAt(i);
    hash |= 0;
  }
  return String(hash >>> 0);
}

/**
 * Normalizes whitespace and case for fuzzy-duplicate detection.
 * @param {string} text
 * @returns {string}
 */
export function normalizeText(text) {
  return text.trim().replace(/\s+/g, ' ').toLowerCase();
}

/**
 * Similarity of two normalized strings, in [0, 1].
 *
 * Short strings get an exact edit-distance ratio. Longer ones get trigram
 * containment — overlap over the smaller set — which is both linear and a better
 * fit for what root detection actually looks for: one message quoting another,
 * where the quote is a subset of the original rather than an edit of it.
 *
 * Only meaningful for thresholds of 0.5 and above; below that it may return 0
 * where an exact measure would return a small positive number.
 *
 * @param {string} a
 * @param {string} b
 * @returns {number}
 */
export function similarity(a, b) {
  if (!a || !b) return 0;
  if (a === b) return 1;

  const la = a.length;
  const lb = b.length;
  const shorter = la < lb ? la : lb;
  const longer = la < lb ? lb : la;

  // Cheap reject: lengths this far apart cannot clear any useful threshold.
  if (shorter / longer < MIN_LENGTH_RATIO) return 0;

  if (longer <= SHORT_LIMIT) {
    const maxDist = Math.ceil(longer * (1 - MIN_MEANINGFUL_SIMILARITY));
    const dist = boundedLevenshtein(a, b, maxDist);
    return dist > maxDist ? 0 : 1 - dist / longer;
  }

  const setA = trigramsOf(a);
  const setB = trigramsOf(b);
  const smaller = setA.size < setB.size ? setA : setB;
  const larger = setA.size < setB.size ? setB : setA;
  if (smaller.size === 0) return 0;

  let overlap = 0;
  for (const gram of smaller) {
    if (larger.has(gram)) overlap++;
  }
  return overlap / smaller.size;
}

/**
 * Edit distance between two strings, abandoned once every path exceeds
 * `maxDist`. Uses two rows of a typed array rather than a full matrix, so memory
 * is O(min(n, m)) instead of O(n * m).
 *
 * @param {string} a
 * @param {string} b
 * @param {number} maxDist
 * @returns {number} the distance, or a value greater than maxDist if abandoned
 */
export function boundedLevenshtein(a, b, maxDist) {
  if (a === b) return 0;

  // Iterate over the longer string, index the shorter one.
  if (a.length > b.length) { const swap = a; a = b; b = swap; }

  const m = a.length;
  const n = b.length;
  if (m === 0) return n;
  if (n - m > maxDist) return maxDist + 1;

  let prev = new Uint16Array(m + 1);
  let curr = new Uint16Array(m + 1);
  for (let i = 0; i <= m; i++) prev[i] = i;

  for (let j = 1; j <= n; j++) {
    curr[0] = j;
    let rowMin = j;
    const bj = b.charCodeAt(j - 1);

    for (let i = 1; i <= m; i++) {
      const substitute = prev[i - 1] + (a.charCodeAt(i - 1) === bj ? 0 : 1);
      const remove = prev[i] + 1;
      const insert = curr[i - 1] + 1;

      let best = substitute;
      if (remove < best) best = remove;
      if (insert < best) best = insert;

      curr[i] = best;
      if (best < rowMin) rowMin = best;
    }

    // Every alignment through this row already costs more than we care about.
    if (rowMin > maxDist) return maxDist + 1;

    const swap = prev; prev = curr; curr = swap;
  }

  return prev[m];
}

/**
 * Character trigrams of a string, padded so the head and tail are represented.
 * @param {string} s
 * @returns {Set<string>}
 */
export function trigramsOf(s) {
  const hit = TRIGRAM_CACHE.get(s);
  if (hit !== undefined) return hit;

  const padded = `  ${s} `;
  const set = new Set();
  for (let i = 0; i + 3 <= padded.length; i++) set.add(padded.substring(i, i + 3));

  if (TRIGRAM_CACHE.size >= TRIGRAM_CACHE_MAX) TRIGRAM_CACHE.clear();
  TRIGRAM_CACHE.set(s, set);
  return set;
}

/** Empties the trigram cache. Exposed for tests. */
export function clearTextCaches() {
  TRIGRAM_CACHE.clear();
}
