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
 * Full two-pass pipeline: summarize older history + prompt with recent raw.
 *
 * @param {{
 *   messages: import('../content/adapters/base.js').Message[],
 *   rootMessage: import('../content/adapters/base.js').Message | null,
 *   ackSamples: string[],
 *   conversationType: 'group' | 'direct',
 *   myName: string,
 *   replyCount?: number,
 *   referenceNote?: string,
 *   excludeReplies?: string[],
 * }} payload
 */
async function handleGenerate({
  messages,
  rootMessage,
  ackSamples,
  conversationType,
  myName,
  replyCount = 3,
  referenceNote = '',
  excludeReplies = [],
}) {
  // Step 1: Split into raw recent vs. older (summarizable)
  const { rawMessages, olderMessages } = splitBudget(messages, rootMessage);

  // Step 2: Summarize older history
  const olderSummary = await summarizeHistory(olderMessages);

  // Step 3: Format the raw window as text lines
  const recentRaw = formatRawMessages(rawMessages);

  // Step 4: Build prompt payload
  const promptPayload = buildPayload({
    conversationType,
    myName,
    olderSummary,
    rootMessageText: rootMessage?.text || '',
    ackSamples: ackSamples || [],
    recentRaw,
    replyCount,
    referenceNote,
    excludeReplies,
  });

  // Step 5: Prompt the model
  const result = await promptForReplies(promptPayload, { replyCount });

  return result;
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
