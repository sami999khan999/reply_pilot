/**
 * summarizer.js — Wraps the Chrome Summarizer API.
 * Compresses older message history into a short paragraph.
 */

import { getSummarizerAPI } from './availability.js';

/** @type {object|null} */
let _summarizerInstance = null;

/**
 * Lazily creates (or reuses) a Summarizer instance.
 * @returns {Promise<object|null>}
 */
async function getSummarizer() {
  if (_summarizerInstance) return _summarizerInstance;

  const api = getSummarizerAPI();
  if (!api) return null;

  try {
    _summarizerInstance = await api.create({
      type: 'tldr',
      format: 'plain-text',
      length: 'short',
    });
    return _summarizerInstance;
  } catch (err) {
    console.warn('[ReplyPilot] Summarizer.create failed:', err);
    return null;
  }
}

/**
 * Summarizes an array of older messages into a 2–3 sentence context summary.
 * Falls back to a truncated string if the Summarizer API is unavailable.
 *
 * @param {import('../../content/adapters/base.js').Message[]} messages
 * @returns {Promise<string>}
 */
export async function summarizeHistory(messages) {
  if (!messages || messages.length === 0) return '';

  const transcript = messages
    .map(m => `${m.isMe ? 'Me' : m.sender}: ${m.text}`)
    .join('\n');

  const summarizer = await getSummarizer();

  if (!summarizer) {
    // Fallback: take first + last couple of messages as a rough summary
    const head = messages.slice(0, 2).map(m => `${m.sender}: ${m.text.slice(0, 80)}`).join('; ');
    const tail = messages.slice(-2).map(m => `${m.sender}: ${m.text.slice(0, 80)}`).join('; ');
    return messages.length <= 4
      ? transcript.slice(0, 300)
      : `[Earlier: ${head}] … [Before recent: ${tail}]`;
  }

  try {
    const result = await summarizer.summarize(transcript);
    return result || '';
  } catch (err) {
    console.warn('[ReplyPilot] summarize() failed:', err);
    return transcript.slice(0, 300);
  }
}

/**
 * Destroys the summarizer instance (call on extension unload).
 */
export function destroySummarizer() {
  if (_summarizerInstance) {
    try { _summarizerInstance.destroy?.(); } catch { /* ignore */ }
    _summarizerInstance = null;
  }
}
