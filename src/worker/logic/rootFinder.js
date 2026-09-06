import { normalizeText, similarity } from '../../shared/text.js';

/**
 * Finds the "root" message in a broadcast scenario — one announcement that many
 * people have quoted or echoed — and samples how others acknowledged it, so the
 * drafted replies can match that register.
 *
 * Runs in the service worker. It used to run in the content script, where its
 * cost landed directly on the chat page's main thread.
 */

/** Only the tail of the conversation can plausibly contain the burst. */
const BURST_SIZE = 30;

/** Below this length a message is an acknowledgement, not a candidate root. */
const MIN_ROOT_LEN = 20;

/**
 * Texts are truncated to this before any comparison. Beyond a couple of
 * sentences the extra characters cost time without changing the verdict — but
 * both sides must be truncated the same way, or the length pre-filter in
 * `similarity` will reject a text for not matching its own truncation.
 */
const COMPARE_MAX_LEN = 160;

/** Fuzzy-match threshold for "these two are the same text". */
const MATCH_THRESHOLD = 0.65;

/** Acknowledgement samples are short by definition. */
const ACK_MAX_LEN = 120;
const ACK_SAMPLE_COUNT = 6;

/**
 * @param {import('../../content/adapters/base.js').Message[]} messages
 * @returns {{
 *   rootMessage: import('../../content/adapters/base.js').Message|null,
 *   ackSamples: string[],
 *   others: import('../../content/adapters/base.js').Message[],
 * }}
 */
export function findRoot(messages) {
  if (!messages || messages.length === 0) {
    return { rootMessage: null, ackSamples: [], others: [] };
  }

  const recent = messages.slice(-BURST_SIZE);

  // Normalizing is not free, and the old code did it repeatedly for the same
  // strings — once per cluster comparison, and again inside a `find` over the
  // whole conversation. Do it once, here, and truncate at the same time so every
  // comparison sees both sides in the same shape.
  const keys = new Map();
  const keyOf = (text) => {
    let value = keys.get(text);
    if (value === undefined) {
      value = normalizeText(text).slice(0, COMPARE_MAX_LEN);
      keys.set(text, value);
    }
    return value;
  };

  const detected = looksLikeBroadcast(recent)
    ? findBroadcastRoot(recent, messages, keyOf)
    : null;
  const rootMessage = detected || fallbackRoot(recent);

  return {
    rootMessage,
    // The root is never one of its own acknowledgement samples, whether it was
    // detected or fell back to the earliest substantive message.
    ackSamples: collectAcks(recent, rootMessage),
    others: recent,
  };
}

/**
 * Whether the burst is worth clustering at all.
 *
 * Root detection only means something when several people are responding to one
 * message. In a 1:1 chat, or a group where nobody is quoting anything, the
 * clustering pass can only ever return the fallback — so skip it and pay
 * nothing. This is the common case.
 *
 * @param {import('../../content/adapters/base.js').Message[]} recent
 */
function looksLikeBroadcast(recent) {
  let quoted = 0;
  let senders = new Set();

  for (let i = 0; i < recent.length; i++) {
    const m = recent[i];
    if (m.quotedText) quoted++;
    if (!m.isMe) senders.add(m.sender);
  }

  return quoted >= 2 || (recent[0]?.isGroup === true && senders.size >= 3);
}

/**
 * @param {import('../../content/adapters/base.js').Message[]} recent
 * @param {import('../../content/adapters/base.js').Message[]} all
 * @param {(text: string) => string} keyOf normalized, truncated comparison key
 */
function findBroadcastRoot(recent, all, keyOf) {
  // ── Quotes are the strongest signal: many people quoting one text ──────────
  const quoteClusters = [];
  for (let i = 0; i < recent.length; i++) {
    const quoted = recent[i].quotedText;
    if (!quoted) continue;
    const value = keyOf(quoted);
    if (value.length < MIN_ROOT_LEN) continue;
    addToCluster(quoteClusters, value, quoted);
  }

  const bestQuote = largest(quoteClusters);
  if (bestQuote && bestQuote.count >= 2) {
    const target = bestQuote.canonical;
    const match = all.find(m => similarity(keyOf(m.text), target) > MATCH_THRESHOLD);
    if (match) return match;
  }

  // ── Otherwise, the most-repeated message text in the burst ────────────────
  const textClusters = [];
  for (let i = 0; i < recent.length; i++) {
    const value = keyOf(recent[i].text);
    if (value.length < MIN_ROOT_LEN) continue;
    addToCluster(textClusters, value, recent[i]);
  }

  const bestText = largest(textClusters);
  if (bestText && bestText.count >= 2) {
    const candidates = bestText.members.filter(m => m && !m.isMe);
    if (candidates.length > 0) {
      return candidates.reduce((oldest, m) => (m.ts < oldest.ts ? m : oldest));
    }
  }

  return null;
}

/**
 * Places a comparison key into the first cluster it is similar to, or starts a
 * new one. `value` is already normalized and truncated by `keyOf`, so it is
 * stored as the canonical unchanged.
 *
 * @param {{ canonical: string, count: number, members: any[] }[]} clusters
 * @param {string} value
 * @param {any} member
 */
function addToCluster(clusters, value, member) {
  for (let i = 0; i < clusters.length; i++) {
    if (similarity(value, clusters[i].canonical) > MATCH_THRESHOLD) {
      clusters[i].count++;
      clusters[i].members.push(member);
      return;
    }
  }
  clusters.push({ canonical: value, count: 1, members: [member] });
}

/** @param {{ count: number }[]} clusters */
function largest(clusters) {
  let best = null;
  for (let i = 0; i < clusters.length; i++) {
    if (best === null || clusters[i].count > best.count) best = clusters[i];
  }
  return best;
}

/**
 * Earliest substantive message in the burst that isn't mine.
 * @param {import('../../content/adapters/base.js').Message[]} recent
 */
function fallbackRoot(recent) {
  for (let i = 0; i < recent.length; i++) {
    if (!recent[i].isMe && recent[i].text.length > 30) return recent[i];
  }
  return recent.find(m => !m.isMe) || null;
}

/**
 * Short responses from others — the register the drafted replies should match.
 * @param {import('../../content/adapters/base.js').Message[]} recent
 * @param {import('../../content/adapters/base.js').Message|null} rootMessage
 */
function collectAcks(recent, rootMessage) {
  const rootId = rootMessage?.id;
  const acks = [];
  for (let i = 0; i < recent.length; i++) {
    const m = recent[i];
    if (m.isMe || m.id === rootId || m.text.length > ACK_MAX_LEN) continue;
    acks.push(m.text);
  }
  return acks.slice(-ACK_SAMPLE_COUNT);
}
