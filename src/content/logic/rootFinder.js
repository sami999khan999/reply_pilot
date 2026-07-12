import { normalizeText, similarity } from '../adapters/base.js';

/**
 * Finds the "root" message in a broadcast/announcement scenario where many people
 * have quoted+acknowledged a single original message.
 *
 * Returns the root message and a sample of acknowledgement texts for register-matching.
 *
 * @param {import('../adapters/base.js').Message[]} messages
 * @returns {{ rootMessage: import('../adapters/base.js').Message | null, ackSamples: string[], others: import('../adapters/base.js').Message[] }}
 */
export function findRoot(messages) {
  if (!messages.length) return { rootMessage: null, ackSamples: [], others: [] };

  // --- Step 1: cluster the recent messages into a time burst ---
  // Take up to the last 30 messages, they form the recent burst.
  const recent = messages.slice(-30);

  // --- Step 2: detect the dominant repeated block ---
  // Normalize every message's text and count near-duplicates (people quoting it).
  // The text that appears most often (via fuzzy match) is the root.
  const normTexts = recent.map(m => normalizeText(m.text));
  const clusters = []; // [{ canonical: string, msgs: Message[], count: number }]

  for (let i = 0; i < recent.length; i++) {
    const norm = normTexts[i];
    if (norm.length < 20) continue; // skip short acks for root detection

    let placed = false;
    for (const cluster of clusters) {
      if (similarity(norm, cluster.canonical) > 0.65) {
        cluster.msgs.push(recent[i]);
        cluster.count++;
        placed = true;
        break;
      }
    }
    if (!placed) {
      clusters.push({ canonical: norm, msgs: [recent[i]], count: 1 });
    }
  }

  // Also consider quoted texts — if many people quote the same text, that's the root
  const quoteCounts = new Map(); // normalized quotedText -> { msg, count }
  for (const m of recent) {
    if (!m.quotedText) continue;
    const norm = normalizeText(m.quotedText);
    if (norm.length < 20) continue;
    let found = false;
    for (const [key, val] of quoteCounts) {
      if (similarity(norm, key) > 0.65) {
        val.count++;
        found = true;
        break;
      }
    }
    if (!found) quoteCounts.set(norm, { count: 1, text: m.quotedText });
  }

  // Pick the most-quoted text as candidate root
  let bestQuoteCount = 0;
  let bestQuoteText = '';
  for (const [, val] of quoteCounts) {
    if (val.count > bestQuoteCount) {
      bestQuoteCount = val.count;
      bestQuoteText = val.text;
    }
  }

  // Pick the largest cluster
  clusters.sort((a, b) => b.count - a.count);
  const biggestCluster = clusters[0];

  let rootMessage = null;

  // If quotes dominate, find the original message whose text matches the quote
  if (bestQuoteCount >= 2) {
    const normBest = normalizeText(bestQuoteText);
    rootMessage = messages.find(m => similarity(normalizeText(m.text), normBest) > 0.65) || null;
  }

  // If cluster dominates, use its earliest non-me message
  if (!rootMessage && biggestCluster && biggestCluster.count >= 2) {
    const candidates = biggestCluster.msgs.filter(m => !m.isMe);
    rootMessage = candidates.sort((a, b) => a.ts - b.ts)[0] || null;
  }

  // --- Step 3: Fallback — earliest substantive message in the burst not from me ---
  if (!rootMessage) {
    const substantive = recent.filter(m => !m.isMe && m.text.length > 30);
    rootMessage = substantive[0] || recent.find(m => !m.isMe) || null;
  }

  // --- Step 4: Collect ack samples ---
  // Short responses from others that aren't the root (the "register" examples)
  const ACK_MAX_LEN = 120;
  const acks = recent
    .filter(m => m !== rootMessage && !m.isMe && m.text.length <= ACK_MAX_LEN)
    .map(m => m.text)
    .slice(-6); // at most 6 samples

  return {
    rootMessage,
    ackSamples: acks,
    others: recent,
  };
}
