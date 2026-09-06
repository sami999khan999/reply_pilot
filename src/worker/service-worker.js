/**
 * service-worker.js — Message router between content script and AI layer.
 *
 * Messages from content script:
 *   { type: 'CHECK_AVAILABILITY' }
 *   { type: 'GENERATE', payload: { messages, rootMessage, ackSamples, conversationType, myName } }
 *   { type: 'GENERATE_MORE' }
 *   { type: 'RESET_SESSION' }
 */

import { checkLanguageModelAvailability, checkSummarizerAvailability } from './ai/availability.js';
import { promptForReplies, promptForMoreReplies, resetSession, hasSession } from './ai/promptSession.js';
import { summarizeHistory } from './ai/summarizer.js';
import { splitBudget, formatRawMessages } from './ai/budget.js';
import { buildPayload, buildMorePrompt, buildMoreSchema } from './ai/prompts.js';
import { classify } from './logic/classifier.js';
import { findRoot } from './logic/rootFinder.js';

// Keep the service worker alive while processing (MV3 workaround)
let _keepAliveInterval = null;

function startKeepAlive() {
  if (_keepAliveInterval) return;
  _keepAliveInterval = setInterval(() => {
    chrome.runtime.getPlatformInfo(() => { /* noop — keeps SW alive */ });
  }, 20000);
}

function stopKeepAlive() {
  if (_keepAliveInterval) {
    clearInterval(_keepAliveInterval);
    _keepAliveInterval = null;
  }
}

// ── Message handler ───────────────────────────────────────────────────────────

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  handleMessage(message).then(sendResponse).catch(err => {
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
      const lm = await checkLanguageModelAvailability();
      const summarizer = await checkSummarizerAvailability();
      return { ok: true, languageModel: lm, summarizer };
    }

    case 'GENERATE': {
      startKeepAlive();
      try {
        const result = await handleGenerate(message.payload);
        return { ok: true, ...result };
      } finally {
        stopKeepAlive();
      }
    }

    case 'GENERATE_MORE': {
      startKeepAlive();
      try {
        const replies = await handleGenerateMore(message.payload || {});
        return { ok: true, replies };
      } finally {
        stopKeepAlive();
      }
    }

    case 'RESET_SESSION': {
      resetSession();
      return { ok: true };
    }

    default:
      return { ok: false, error: `Unknown message type: ${message.type}` };
  }
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
 */
async function handleGenerate({
  messages,
  conversationType,
  myName,
  replyCount = 3,
  referenceNote = '',
  excludeReplies = [],
}) {
  // Step 1: Heuristics — does this even need a reply, and what is it replying to?
  const classification = classify(messages, { myName });
  const { rootMessage, ackSamples } = findRoot(messages);

  // Step 2: Split into raw recent vs. older (summarizable)
  const { rawMessages, olderMessages } = splitBudget(messages, rootMessage);

  // Step 3: Summarize older history
  const olderSummary = await summarizeHistory(olderMessages);

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
  const result = await promptForReplies(promptPayload, { replyCount });

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
 * "Generate more" — prefer the warm session (cheap follow-up that already knows
 * the conversation and the earlier suggestions). If the worker was terminated
 * and the session is gone, rebuild from the context the content script resends,
 * excluding the replies already shown so we don't repeat them.
 *
 * @param {{
 *   replyCount?: number,
 *   referenceNote?: string,
 *   previousReplies?: string[],
 *   context?: object,
 * }} payload
 * @returns {Promise<string[]>}
 */
async function handleGenerateMore({ replyCount = 3, referenceNote = '', previousReplies = [], context }) {
  if (hasSession()) {
    try {
      const morePrompt = buildMorePrompt(replyCount, referenceNote);
      const moreSchema = buildMoreSchema(replyCount);
      const replies = await promptForMoreReplies(morePrompt, moreSchema, replyCount);
      if (replies.length > 0) return replies;
    } catch {
      // fall through to rebuild
    }
  }

  // Cold path: rebuild the whole request from resent context.
  if (!context || !context.messages) {
    throw new Error('Session expired and no context to rebuild from — reopen the panel.');
  }

  const result = await handleGenerate({
    ...context,
    replyCount,
    referenceNote,
    excludeReplies: previousReplies,
  });
  return result.replies || [];
}
