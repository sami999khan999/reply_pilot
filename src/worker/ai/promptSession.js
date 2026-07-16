/**
 * promptSession.js — Manages a reusable LanguageModel session.
 *
 * One session is kept warm and reused across chats. It is recreated only
 * when the context fills up or on explicit reset.
 */

import { getLanguageModelAPI } from './availability.js';
import { SYSTEM_PROMPT, buildResponseSchema } from './prompts.js';

/** @type {object|null} */
let _session = null;

/** @returns {boolean} whether a warm session is currently held. */
export function hasSession() {
  return _session !== null;
}

/**
 * Creates (or reuses) the LanguageModel session.
 * Must be called from within a user-gesture path on first call (FAB click).
 *
 * @param {{ onDownloadProgress?: (e: ProgressEvent) => void }} [opts]
 * @returns {Promise<object>}
 */
async function getSession(opts = {}) {
  if (_session) return _session;

  const api = getLanguageModelAPI();
  if (!api) throw new Error('LanguageModel API not available in this browser/context.');

  const monitor = (m) => {
    if (opts.onDownloadProgress) {
      m.addEventListener('downloadprogress', opts.onDownloadProgress);
    }
  };

  try {
    // Modern API (Chrome 138+): system prompt goes in initialPrompts
    _session = await api.create({
      initialPrompts: [{ role: 'system', content: SYSTEM_PROMPT }],
      monitor,
    });
    return _session;
  } catch (err) {
    // Legacy API: `systemPrompt` option
    try {
      _session = await api.create({ systemPrompt: SYSTEM_PROMPT, monitor });
      return _session;
    } catch {
      _session = null;
      throw err;
    }
  }
}

/**
 * Prompts the model with the full payload and returns parsed JSON.
 *
 * @param {string} payload
 * @param {{ onDownloadProgress?: (e: ProgressEvent) => void, replyCount?: number }} [opts]
 * @returns {Promise<{ needsReply: boolean, reason: string, summary: string, replies: string[] }>}
 */
export async function promptForReplies(payload, opts = {}) {
  const session = await getSession(opts);
  const schema = buildResponseSchema(opts.replyCount ?? 3);

  let raw;
  try {
    // Use responseConstraint for structured output if supported
    raw = await session.prompt(payload, { responseConstraint: schema });
  } catch (constraintErr) {
    // Fallback: prompt without constraint and parse manually
    console.warn('[ReplyPilot] responseConstraint not supported, falling back:', constraintErr);
    raw = await session.prompt(payload);
  }

  return parseJSON(raw, {
    needsReply: true,
    reason: '',
    summary: '',
    replies: [],
  });
}

/**
 * Sends the "generate more" follow-up turn on the warm session and returns new
 * reply strings. Throws if there is no warm session (the caller then rebuilds
 * from context) — this is the common MV3 case where the worker was terminated
 * between the initial generate and the follow-up click.
 *
 * @param {string} morePrompt
 * @param {object} moreSchema
 * @param {number} [replyCount]
 * @returns {Promise<string[]>}
 */
export async function promptForMoreReplies(morePrompt, moreSchema, replyCount = 3) {
  if (!_session) throw new Error('No active session');

  let raw;
  try {
    raw = await _session.prompt(morePrompt, { responseConstraint: moreSchema });
  } catch {
    raw = await _session.prompt(morePrompt);
  }

  // The response may be a JSON array or a JSON object with a replies field
  const parsed = parseJSON(raw, []);
  if (Array.isArray(parsed)) return parsed.slice(0, replyCount);
  if (parsed.replies && Array.isArray(parsed.replies)) return parsed.replies.slice(0, replyCount);
  return [];
}

/**
 * Destroys the session (call on extension unload or context overflow).
 */
export function destroySession() {
  if (_session) {
    try { _session.destroy?.(); } catch { /* ignore */ }
    _session = null;
  }
}

/**
 * Resets the session so the next call creates a fresh one.
 */
export function resetSession() {
  destroySession();
}

// ── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Safely parses JSON from a model response, with a fallback default.
 * @template T
 * @param {string} raw
 * @param {T} fallback
 * @returns {T}
 */
function parseJSON(raw, fallback) {
  if (!raw) return fallback;
  // Strip markdown fences if present
  const cleaned = raw.replace(/^```(?:json)?\n?/i, '').replace(/\n?```$/i, '').trim();
  try {
    return JSON.parse(cleaned);
  } catch {
    // Try to extract a JSON object from within the text
    const objMatch = cleaned.match(/\{[\s\S]*\}/);
    const arrMatch = cleaned.match(/\[[\s\S]*\]/);
    const match = objMatch || arrMatch;
    if (match) {
      try { return JSON.parse(match[0]); } catch { /* fall through */ }
    }
    return fallback;
  }
}
