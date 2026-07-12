/**
 * orchestrator.js — The "Generate" click flow controller.
 *
 * Ties together: adapter → classifier → rootFinder → worker → panel.
 */

import { classify } from './logic/classifier.js';
import { findRoot } from './logic/rootFinder.js';
import { insertIntoComposer } from './logic/composerInsert.js';

/**
 * @param {{
 *   adapter: import('./adapters/base.js').BaseAdapter,
 *   panel: ReturnType<import('./ui/panel.js').createPanel>,
 * }} deps
 */
export function createOrchestrator({ adapter, panel }) {

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
   * Main entry point — called on FAB click.
   */
  async function onGenerate() {
    panel.open();
    panel.showLoading('Scanning the conversation…');

    try {
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

      const messages = await adapter.scrapeMessages({ maxMessages: 80, scrollForHistory: true });

      if (!messages || messages.length === 0) {
        panel.showError(
          'Couldn\'t read messages',
          'The chat DOM structure may have changed. Try refreshing the page.'
        );
        return;
      }

      // ── 3. Classify ──────────────────────────────────────────────────────
      const myName = adapter.getMyName();
      const classification = classify(messages, { myName });

      // ── 4. Find root message ─────────────────────────────────────────────
      const { rootMessage, ackSamples } = findRoot(messages);

      // ── 5. Call worker for AI generation ─────────────────────────────────
      panel.showLoading('Drafting replies…', 'On-device — nothing leaves your machine');

      const conversationType = adapter.isGroupChat() ? 'group' : 'direct';

      const result = await workerMessage('GENERATE', {
        messages,
        rootMessage,
        ackSamples,
        conversationType,
        myName,
      });

      // Merge heuristic classification with AI result
      // (AI's needsReply takes precedence when confident; else use heuristic)
      const finalNeedsReply = result.needsReply ?? classification.needsReply;
      const finalReason = result.reason || classification.reason;

      // ── 6. Render results ────────────────────────────────────────────────
      panel.showResults({
        needsReply: finalNeedsReply,
        confidence: classification.confidence,
        reason: finalReason,
        summary: result.summary,
        replies: result.replies || [],
        onDraftAnyway: () => onGenerate(), // re-run but ignore classification
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
   * Called when "Generate 3 more" is clicked.
   */
  async function onGenerateMore() {
    try {
      const result = await workerMessage('GENERATE_MORE');
      panel.appendReplies(result.replies || []);
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

  return { onGenerate, onGenerateMore, onInsert };
}
