/**
 * promptSession.js — manages LanguageModel sessions.
 *
 * A session's lifetime is one conversation, not the worker's.
 *
 * This used to hold a single session forever and prompt it on every generate.
 * Because each prompt appends a turn, the session grew without bound: Gemini
 * Nano's input quota is finite, so after a handful of generates it overflowed
 * and every later prompt threw — permanently, since nothing ever replaced the
 * wedged session. It also meant the fifth generate was answered with the four
 * previous conversations still in context, which is both wrong and a leak
 * between chats.
 *
 * So each GENERATE now starts clean, and the session is kept warm only for the
 * "generate more" follow-ups, which are the one place accumulated context is
 * actually wanted.
 */

import { getLanguageModelAPI } from './availability.js';
import { SYSTEM_PROMPT, buildResponseSchema } from './prompts.js';

/** The session serving the current conversation. */
let _session = null;

/**
 * A pristine session holding only the system prompt, cloned per conversation.
 * Cloning keeps the initial prompts and drops the conversation, which is
 * exactly what a new generate wants, and skips re-sending the system prompt.
 */
let _template = null;

/** Leave this much of the quota spare before a follow-up turn. */
const QUOTA_HEADROOM = 0.15;

/** @returns {boolean} whether a warm session is currently held. */
export function hasSession() {
  return _session !== null;
}

/**
 * Reports how much of the session's input budget is spent, where the browser
 * exposes it. Chrome 138+ uses inputUsage/inputQuota; earlier builds used
 * tokensSoFar/maxTokens. Returns null when neither is available.
 *
 * @returns {{ used: number, quota: number, ratio: number }|null}
 */
export function sessionUsage() {
  if (!_session) return null;

  const used = numberOr(_session.inputUsage, _session.tokensSoFar);
  const quota = numberOr(_session.inputQuota, _session.maxTokens);
  if (used === null || quota === null || quota <= 0) return null;

  return { used, quota, ratio: used / quota };
}

/**
 * Creates the session a conversation will run on, replacing any previous one.
 *
 * @param {{ onDownloadProgress?: (e: ProgressEvent) => void }} [opts]
 * @returns {Promise<object>}
 */
async function startSession(opts = {}) {
  destroySession();

  const api = getLanguageModelAPI();
  if (!api) throw new Error('LanguageModel API not available in this browser/context.');

  const template = await getTemplate(api, opts);
  if (template && typeof template.clone === 'function') {
    try {
      _session = await template.clone();
      return _session;
    } catch {
      // Cloning is an optimisation; fall through and build one directly.
    }
  }

  _session = await createSession(api, opts);
  return _session;
}

/**
 * The pristine system-prompt-only session. Built once and kept; if creating it
 * fails we simply do without, and every conversation builds its own.
 */
async function getTemplate(api, opts) {
  if (_template) return _template;
  try {
    _template = await createSession(api, opts);
  } catch {
    _template = null;
  }
  return _template;
}

/**
 * Builds a session with the system prompt, handling both the modern
 * `initialPrompts` shape and the older `systemPrompt` option.
 */
async function createSession(api, opts) {
  const monitor = (m) => {
    if (opts.onDownloadProgress) m.addEventListener('downloadprogress', opts.onDownloadProgress);
  };

  try {
    return await api.create({ initialPrompts: [{ role: 'system', content: SYSTEM_PROMPT }], monitor });
  } catch (err) {
    try {
      return await api.create({ systemPrompt: SYSTEM_PROMPT, monitor });
    } catch {
      throw err;
    }
  }
}

/**
 * Prompts for a fresh set of replies. Always runs on a new session, so the
 * conversation being drafted for is the only thing in context.
 *
 * @param {string} payload
 * @param {{ onDownloadProgress?: (e: ProgressEvent) => void, replyCount?: number, signal?: AbortSignal }} [opts]
 * @returns {Promise<{ needsReply: boolean, reason: string, summary: string, replies: string[] }>}
 */
export async function promptForReplies(payload, opts = {}) {
  const session = await startSession(opts);
  const schema = buildResponseSchema(opts.replyCount ?? 3);

  const raw = await prompt(session, payload, schema, opts.signal);

  return parseJSON(raw, { needsReply: true, reason: '', summary: '', replies: [] });
}

/**
 * Sends a "generate more" turn on the warm session, which already knows the
 * conversation and what has been suggested. Throws when there is no session to
 * continue, or when continuing it would exhaust the quota — the caller then
 * rebuilds from context, which starts a fresh session anyway.
 *
 * @param {string} morePrompt
 * @param {object} moreSchema
 * @param {number} [replyCount]
 * @param {{ signal?: AbortSignal }} [opts]
 * @returns {Promise<string[]>}
 */
export async function promptForMoreReplies(morePrompt, moreSchema, replyCount = 3, opts = {}) {
  if (!_session) throw new Error('No active session');

  // Better to rebuild than to send a turn we know will not fit.
  const usage = sessionUsage();
  if (usage !== null && usage.ratio > 1 - QUOTA_HEADROOM) {
    destroySession();
    throw new Error('Session context is full');
  }

  const raw = await prompt(_session, morePrompt, moreSchema, opts.signal);

  // The response may be a JSON array, or an object with a replies field.
  const parsed = parseJSON(raw, []);
  if (Array.isArray(parsed)) return parsed.slice(0, replyCount);
  if (Array.isArray(parsed.replies)) return parsed.replies.slice(0, replyCount);
  return [];
}

/**
 * One prompt turn, with the structured-output constraint where it is supported.
 *
 * A failure that is not an abort leaves the session in an unknown state — it may
 * have consumed the turn, or be wedged — so it is destroyed rather than reused
 * for every subsequent request.
 *
 * @param {object} session
 * @param {string} text
 * @param {object} schema
 * @param {AbortSignal} [signal]
 * @returns {Promise<string>}
 */
async function prompt(session, text, schema, signal) {
  try {
    return await session.prompt(text, { responseConstraint: schema, signal });
  } catch (constraintErr) {
    // An abort is the caller's decision, not an unsupported-feature signal.
    if (isAbort(constraintErr)) throw constraintErr;

    try {
      // Older builds reject the constraint option; retry without it.
      return await session.prompt(text, { signal });
    } catch (err) {
      if (!isAbort(err)) destroySession();
      throw err;
    }
  }
}

/** Destroys the conversation session. The template is kept — it holds no history. */
export function destroySession() {
  if (!_session) return;
  try { _session.destroy?.(); } catch { /* already gone */ }
  _session = null;
}

/** Drops everything, including the template. */
export function resetSession() {
  destroySession();
  if (_template) {
    try { _template.destroy?.(); } catch { /* already gone */ }
    _template = null;
  }
}

// ── Helpers ──────────────────────────────────────────────────────────────────

/** First of the candidates that is a finite number, else null. */
function numberOr(...candidates) {
  for (let i = 0; i < candidates.length; i++) {
    if (typeof candidates[i] === 'number' && Number.isFinite(candidates[i])) return candidates[i];
  }
  return null;
}

/** @param {unknown} err */
function isAbort(err) {
  return err instanceof Error && err.name === 'AbortError';
}

/**
 * Safely parses JSON from a model response, with a fallback default.
 * @template T
 * @param {string} raw
 * @param {T} fallback
 * @returns {T}
 */
function parseJSON(raw, fallback) {
  if (!raw) return fallback;

  // Strip markdown fences if present.
  const cleaned = raw.replace(/^```(?:json)?\n?/i, '').replace(/\n?```$/i, '').trim();
  try {
    return JSON.parse(cleaned);
  } catch {
    // Try to extract a JSON value from within surrounding prose.
    const match = cleaned.match(/\{[\s\S]*\}/) || cleaned.match(/\[[\s\S]*\]/);
    if (match) {
      try { return JSON.parse(match[0]); } catch { /* fall through */ }
    }
    return fallback;
  }
}
