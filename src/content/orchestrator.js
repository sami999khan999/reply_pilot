/**
 * orchestrator.js — The "Generate" click flow controller.
 *
 * Ties together: adapter → classifier → rootFinder → worker → panel.
 */

import { classify } from './logic/classifier.js';
import { findRoot } from './logic/rootFinder.js';
import { insertIntoComposer } from './logic/composerInsert.js';
import { getSettings, saveSettings } from '../shared/settings.js';

/**
 * @param {{
 *   adapter: import('./adapters/base.js').BaseAdapter,
 *   panel: ReturnType<import('./ui/panel.js').createPanel>,
 *   messageCache: ReturnType<import('./logic/messageCache.js').createMessageCache>,
 * }} deps
 */
export function createOrchestrator({ adapter, panel, messageCache }) {

  // Context from the most recent generate, so "Generate more" can re-send it if
  // the (MV3) service worker was terminated and lost its warm session.
  let lastGenerate = null;   // { messages, rootMessage, ackSamples, conversationType, myName, replyCount, referenceNote }
  let shownReplies = [];     // every reply option shown so far (to avoid repeats)

  /**
   * Opens the panel to its launch/config screen (no generation yet).
   * Generation only starts when the user presses the Generate button.
   */
  async function openConfig() {
    panel.open();
    const settings = await getSettings();
    panel.showConfig(settings, {
      onGenerate: (params) => onGenerate(params),
    });
  }

  /** Sends a message to the service worker and returns its response. */
  async function workerMessage(type, payload = {}) {
    return new Promise((resolve, reject) => {
      chrome.runtime.sendMessage({ type, payload }, response => {
        if (chrome.runtime.lastError) {
          reject(new Error(chrome.runtime.lastError.message));
        } else if (!response?.ok) {
          reject(new Error(response?.error || 'Worker returned error'));
        } else {
          resolve(response);
        }
      });
    });
  }

  /** Checks AI availability before generating. */
  async function checkAvailability() {
    const resp = await workerMessage('CHECK_AVAILABILITY');
    return resp;
  }

  /**
   * Main entry point — called when the user presses Generate in the panel.
   * @param {{ messageCount?: number, replyCount?: number, referenceNote?: string, ignoreClassification?: boolean }} [params]
   */
  async function onGenerate(params = {}) {
    panel.open();
    panel.showLoading('Scanning the conversation…');

    try {
      // Resolve settings: explicit params (from the config screen) win, else
      // fall back to stored settings. Persist so the popup stays in sync.
      const stored = await getSettings();
      const messageCount = params.messageCount ?? stored.messageCount;
      const replyCount = params.replyCount ?? stored.replyCount;
      const referenceNote = params.referenceNote ?? stored.referenceNote;
      saveSettings({ messageCount, replyCount, referenceNote });

      // ── 1. Check AI availability ─────────────────────────────────────────
      const avail = await checkAvailability();

      if (avail.languageModel === 'no') {
        panel.showError(
          'On-device AI not available',
          'Reply Pilot requires Chrome 138+ on desktop with Gemini Nano support. ' +
          'Check chrome://on-device-internals to verify.'
        );
        return;
      }

      if (avail.languageModel === 'after-download') {
        panel.showAISetup(0);
        // The actual first session creation (with the download) happens when we prompt.
        // We'll let it proceed and the progress is monitored in the service worker.
      }

      // ── 2. Scrape messages ───────────────────────────────────────────────
      panel.showLoading('Scanning the conversation…', 'Gathering recent messages');

      if (!adapter.isChatOpen()) {
        panel.showError('No chat open', 'Open a chat first, then click Reply Pilot.');
        return;
      }

      // messageCount caps the window — your own messages and everyone else's
      // both count toward the total. Reads what the app has rendered plus what
      // the cache has banked; never scrolls the conversation.
      messageCache.pause();
      let messages, available;
      try {
        ({ messages, available } = messageCache.read(messageCount));
      } finally {
        messageCache.resume();
      }

      if (messages.length === 0) {
        panel.showError(
          'Couldn\'t read messages',
          'The chat DOM structure may have changed. Try refreshing the page.'
        );
        return;
      }

      // We deliberately do not scroll to close a shortfall — say so instead.
      const historyNote = available < messageCount
        ? `Read ${available} of the ${messageCount} requested — scroll up in the chat to load more history.`
        : '';

      // ── 3. Classify ──────────────────────────────────────────────────────
      const myName = adapter.getMyName();
      const classification = classify(messages, { myName });

      // ── 4. Find root message ─────────────────────────────────────────────
      const { rootMessage, ackSamples } = findRoot(messages);

      // ── 5. Call worker for AI generation ─────────────────────────────────
      panel.showLoading('Drafting replies…', 'On-device — nothing leaves your machine');

      const conversationType = adapter.isGroupChat() ? 'group' : 'direct';

      // Remember the context so "Generate more" can rebuild if the worker's
      // warm session is lost (MV3 termination).
      lastGenerate = { messages, rootMessage, ackSamples, conversationType, myName, replyCount, referenceNote };
      shownReplies = [];

      const result = await workerMessage('GENERATE', {
        messages,
        rootMessage,
        ackSamples,
        conversationType,
        myName,
        replyCount,
        referenceNote,
      });

      // Merge heuristic classification with AI result
      // (AI's needsReply takes precedence when confident; else use heuristic)
      const finalNeedsReply = params.ignoreClassification ? true : (result.needsReply ?? classification.needsReply);
      const finalReason = result.reason || classification.reason;
      shownReplies = [...(result.replies || [])];

      // ── 6. Render results ────────────────────────────────────────────────
      panel.showResults({
        needsReply: finalNeedsReply,
        confidence: classification.confidence,
        reason: finalReason,
        summary: result.summary,
        replies: result.replies || [],
        replyCount,
        historyNote,
        onDraftAnyway: () => onGenerate({ ...params, ignoreClassification: true }),
      });

    } catch (err) {
      console.error('[ReplyPilot] orchestrator error:', err);

      if (err.message?.includes('download')) {
        panel.showAISetup(0);
      } else {
        panel.showError('Generation failed', err.message || 'Unexpected error. Please try again.');
      }
    }
  }

  /**
   * Called when "Generate more" is clicked. Re-sends the stored context so the
   * worker can rebuild even if its warm session was terminated.
   */
  async function onGenerateMore() {
    if (!lastGenerate) {
      panel.showToast('Generate replies first.');
      return;
    }
    try {
      const result = await workerMessage('GENERATE_MORE', {
        replyCount: lastGenerate.replyCount,
        referenceNote: lastGenerate.referenceNote,
        previousReplies: shownReplies,
        context: {
          messages: lastGenerate.messages,
          rootMessage: lastGenerate.rootMessage,
          ackSamples: lastGenerate.ackSamples,
          conversationType: lastGenerate.conversationType,
          myName: lastGenerate.myName,
        },
      });
      const replies = result.replies || [];
      shownReplies = [...shownReplies, ...replies];
      panel.appendReplies(replies);
    } catch (err) {
      console.error('[ReplyPilot] generateMore error:', err);
      panel.showToast('Failed to generate more — try reopening the panel.');
    }
  }

  /**
   * Handles inserting a reply into the composer.
   * @param {string} text
   */
  function onInsert(text) {
    const box = adapter.getComposerBox();
    const success = insertIntoComposer(box, text);
    if (success) {
      panel.showToast('✓ Reply inserted');
    } else {
      panel.showToast('Couldn\'t insert — copy and paste manually.');
    }
  }

  /**
   * Abandons whatever is in flight. Called when the panel closes or the chat
   * changes underneath us. Fleshed out once the worker learns to abort.
   */
  function onCancel() {
    // no-op for now
  }

  return { openConfig, onGenerate, onGenerateMore, onInsert, onCancel };
}
