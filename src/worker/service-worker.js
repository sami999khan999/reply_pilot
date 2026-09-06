/**
 * service-worker.js — Message router between content script and AI layer.
 *
 * Messages from the content script:
 *   { type: 'CHECK_AVAILABILITY' }
 *   { type: 'GENERATE',      payload: { requestId, messages, conversationType, myName, replyCount, referenceNote } }
 *   { type: 'GENERATE_MORE', payload: { requestId, contextId, replyCount, referenceNote, previousReplies, context? } }
 *   { type: 'ABORT',         payload: { requestId } }
 *   { type: 'RESET_SESSION' }
 */

import { checkLanguageModelAvailability, checkSummarizerAvailability } from './ai/availability.js';
import { promptForReplies, promptForMoreReplies, resetSession, hasSession } from './ai/promptSession.js';
import { summarizeHistory } from './ai/summarizer.js';
import { splitBudget, formatRawMessages } from './ai/budget.js';
import { buildPayload, buildMorePrompt, buildMoreSchema } from './ai/prompts.js';
import { classify } from './logic/classifier.js';
import { findRoot } from './logic/rootFinder.js';

/** Returned when "Generate more" refers to context the worker no longer holds. */
const CONTEXT_LOST = 'CONTEXT_LOST';

// ── Keep-alive (MV3 workaround) ───────────────────────────────────────────────
// Reference-counted: two overlapping generations must not leave the interval
// running after the first one finishes.

let _keepAliveInterval = null;
let _keepAliveRefs = 0;

function startKeepAlive() {
  if (_keepAliveRefs++ > 0) return;
  _keepAliveInterval = setInterval(() => {
    chrome.runtime.getPlatformInfo(() => { /* noop — keeps SW alive */ });
  }, 20000);
}

function stopKeepAlive() {
  if (_keepAliveRefs > 0) _keepAliveRefs--;
  if (_keepAliveRefs > 0 || _keepAliveInterval === null) return;
  clearInterval(_keepAliveInterval);
  _keepAliveInterval = null;
}

// ── In-flight requests and retained context ───────────────────────────────────

/** @type {Map<string, AbortController>} keyed by the content script's requestId */
const _inFlight = new Map();

/**
 * The last generate's inputs, so "Generate more" can rebuild without the content
 * script re-sending the whole conversation. Only the most recent is kept: the
 * worker can be torn down at any moment anyway, and the content script keeps its
 * own copy as the fallback.
 * @type {{ id: string, messages: object[], conversationType: string, myName: string }|null}
 */
let _context = null;

// ── Message handler ───────────────────────────────────────────────────────────

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  handleMessage(message).then(sendResponse).catch(err => {
    if (isAbort(err)) {
      sendResponse({ ok: false, aborted: true });
      return;
    }
    console.error('[ReplyPilot SW] Error:', err);
    sendResponse({ ok: false, error: err?.message || String(err) });
  });
  return true; // keep channel open for async response
});

/**
 * @param {{ type: string, payload?: any }} message
 * @returns {Promise<object>}
 */
async function handleMessage(message) {
  switch (message.type) {

    case 'CHECK_AVAILABILITY': {
      const [languageModel, summarizer] = await Promise.all([
        checkLanguageModelAvailability(),
        checkSummarizerAvailability(),
      ]);
      return { ok: true, languageModel, summarizer };
    }

    case 'GENERATE':
      return withRequest(message.payload, async (payload, signal) => {
        const result = await handleGenerate(payload, signal);
        _context = {
          id: payload.requestId,
          messages: payload.messages,
          conversationType: payload.conversationType,
          myName: payload.myName,
        };
        return { ok: true, contextId: payload.requestId, ...result };
      });

    case 'GENERATE_MORE':
      return withRequest(message.payload, async (payload, signal) => {
        const replies = await handleGenerateMore(payload, signal);
        if (replies === CONTEXT_LOST) return { ok: false, code: CONTEXT_LOST };
        return { ok: true, replies };
      });

    case 'ABORT': {
      _inFlight.get(message.payload?.requestId)?.abort();
      return { ok: true };
    }

    case 'RESET_SESSION': {
      resetSession();
      _context = null;
      return { ok: true };
    }

    default:
      return { ok: false, error: `Unknown message type: ${message.type}` };
  }
}

/**
 * Runs a handler with an abort signal registered under its requestId, and with
 * the keep-alive held for exactly its duration.
 *
 * @template T
 * @param {{ requestId?: string }} payload
 * @param {(payload: any, signal: AbortSignal) => Promise<T>} run
 * @returns {Promise<T>}
 */
async function withRequest(payload = {}, run) {
  const requestId = payload.requestId;
  const controller = new AbortController();
  if (requestId) _inFlight.set(requestId, controller);
  startKeepAlive();

  try {
    return await run(payload, controller.signal);
  } finally {
    if (requestId) _inFlight.delete(requestId);
    stopKeepAlive();
  }
}

/** @param {unknown} err */
function isAbort(err) {
  return err instanceof Error && err.name === 'AbortError';
}

// ── Generate flow ─────────────────────────────────────────────────────────────

/**
 * Full pipeline: classify, find the root message, summarize older history, then
 * prompt with the recent raw window.
 *
 * Classification and root-finding run here rather than in the content script.
 * They are pure functions over the message array the worker already receives,
 * and running them on the chat page's main thread bought nothing but jank.
 *
 * @param {{
 *   messages: import('../content/adapters/base.js').Message[],
 *   conversationType: 'group' | 'direct',
 *   myName: string,
 *   replyCount?: number,
 *   referenceNote?: string,
 *   excludeReplies?: string[],
 * }} payload
 * @param {AbortSignal} [signal]
 */
async function handleGenerate({
  messages,
  conversationType,
  myName,
  replyCount = 3,
  referenceNote = '',
  excludeReplies = [],
}, signal) {
  // Step 1: Heuristics — does this even need a reply, and what is it replying to?
  const classification = classify(messages, { myName });
  const { rootMessage, ackSamples } = findRoot(messages);

  // Step 2: Split into raw recent vs. older (summarizable)
  const { rawMessages, olderMessages } = splitBudget(messages, rootMessage);

  // Step 3: Summarize older history
  const olderSummary = await summarizeHistory(olderMessages, { signal });

  // Step 4: Format the raw window as text lines
  const recentRaw = formatRawMessages(rawMessages);

  // Step 5: Build prompt payload
  const promptPayload = buildPayload({
    conversationType,
    myName,
    olderSummary,
    rootMessageText: rootMessage?.text || '',
    ackSamples,
    recentRaw,
    replyCount,
    referenceNote,
    excludeReplies,
  });

  // Step 6: Prompt the model
  const result = await promptForReplies(promptPayload, { replyCount, signal });

  // The model's needsReply wins when it has an opinion; the heuristic is the
  // floor, and supplies the confidence the UI grades its wording by.
  return {
    ...result,
    needsReply: result.needsReply ?? classification.needsReply,
    reason: result.reason || classification.reason,
    confidence: classification.confidence,
  };
}

/**
 * "Generate more" — prefer the warm session, which already knows the
 * conversation and the earlier suggestions. If the worker was terminated and the
 * session is gone, rebuild from context: the worker's own copy if it survived,
 * otherwise the copy the content script resends.
 *
 * @param {{
 *   contextId?: string,
 *   replyCount?: number,
 *   referenceNote?: string,
 *   previousReplies?: string[],
 *   context?: object,
 * }} payload
 * @param {AbortSignal} [signal]
 * @returns {Promise<string[] | typeof CONTEXT_LOST>}
 */
async function handleGenerateMore({
  contextId,
  replyCount = 3,
  referenceNote = '',
  previousReplies = [],
  context,
}, signal) {
  if (hasSession()) {
    try {
      const replies = await promptForMoreReplies(
        buildMorePrompt(replyCount, referenceNote),
        buildMoreSchema(replyCount),
        replyCount,
        { signal },
      );
      if (replies.length > 0) return replies;
    } catch (err) {
      if (isAbort(err)) throw err;
      // Otherwise fall through and rebuild.
    }
  }

  // Cold path. Prefer the worker's retained context; the content script only
  // needs to resend when the worker was torn down between the two clicks.
  const rebuildFrom = (_context && _context.id === contextId) ? _context : context;
  if (!rebuildFrom?.messages) return CONTEXT_LOST;

  const result = await handleGenerate({
    messages: rebuildFrom.messages,
    conversationType: rebuildFrom.conversationType,
    myName: rebuildFrom.myName,
    replyCount,
    referenceNote,
    excludeReplies: previousReplies,
  }, signal);

  return result.replies || [];
}
