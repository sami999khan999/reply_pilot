/**
 * orchestrator.js — The "Generate" click flow controller.
 *
 * Ties together: adapter → message cache → worker → panel.
 *
 * Deliberately thin. Classification and root-finding used to run here, on the
 * chat page's main thread; they now run in the service worker, over the same
 * message array that crosses to it anyway.
 */

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
  let lastGenerate = null;   // { messages, conversationType, myName, replyCount, referenceNote }
  let shownReplies = [];     // every reply option shown so far (to avoid repeats)
  let contextId = null;      // handle the worker holds this conversation under
  let inFlight = null;       // requestId of the request currently running, if any

  /** A new id per request, so the worker can be told to abandon one by name. */
  function nextRequestId() {
    return (crypto.randomUUID?.() ?? `rp-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  }

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

  /**
   * Sends a message to the service worker and returns its response.
   * @param {string} type
   * @param {object} [payload]
   * @param {{ allowFailure?: boolean }} [opts] resolve rather than throw on a
   *   structured failure, so the caller can act on `code`
   */
  async function workerMessage(type, payload = {}, opts = {}) {
    return new Promise((resolve, reject) => {
      chrome.runtime.sendMessage({ type, payload }, response => {
        if (chrome.runtime.lastError) {
          reject(new Error(chrome.runtime.lastError.message));
        } else if (response?.ok || opts.allowFailure) {
          resolve(response);
        } else {
          reject(new Error(response?.error || 'Worker returned error'));
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
    onCancel(); // supersede anything still running

    const requestId = nextRequestId();
    inFlight = requestId;

    panel.open();
    panel.showLoading('Scanning the conversation…');

    /** True once this request has been superseded or cancelled. */
    const stale = () => inFlight !== requestId;

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
      if (stale()) return;

      if (avail.languageModel === 'no') {
        panel.showError(
          'On-device AI not available',
          'Reply Pilot requires Chrome 138+ on desktop with Gemini Nano support. ' +
          'Check chrome://on-device-internals to verify.'
        );
        return;
      }

      // The model downloads on first use, during the prompt below. Leave the
      // setup screen up while that happens instead of replacing it with a
      // loading spinner that says nothing about the wait.
      const downloading = avail.languageModel === 'after-download';
      if (downloading) panel.showAISetup(0);

      // ── 2. Read the conversation ─────────────────────────────────────────
      if (!downloading) panel.showLoading('Scanning the conversation…', 'Gathering recent messages');

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

      // ── 3. Hand off to the worker ────────────────────────────────────────
      // Classification and root-finding happen there. They are pure functions
      // over `messages`, which is crossing to the worker regardless, and running
      // them here would block the chat page for no benefit.
      if (!downloading) panel.showLoading('Drafting replies…', 'On-device — nothing leaves your machine');

      const myName = adapter.getMyName();
      const conversationType = adapter.isGroupChat() ? 'group' : 'direct';

      // Remember the context so "Generate more" can rebuild if the worker's
      // warm session is lost (MV3 termination).
      lastGenerate = { messages, conversationType, myName, replyCount, referenceNote };
      shownReplies = [];

      const result = await workerMessage('GENERATE', {
        requestId,
        messages,
        conversationType,
        myName,
        replyCount,
        referenceNote,
      });
      if (stale()) return;

      contextId = result.contextId;
      shownReplies = [...(result.replies || [])];

      // ── 4. Render results ────────────────────────────────────────────────
      panel.showResults({
        needsReply: params.ignoreClassification ? true : result.needsReply,
        confidence: result.confidence,
        reason: result.reason,
        summary: result.summary,
        replies: result.replies || [],
        replyCount,
        historyNote,
        onDraftAnyway: () => onGenerate({ ...params, ignoreClassification: true }),
      });

    } catch (err) {
      if (stale()) return; // we asked for this — not an error to report

      console.error('[ReplyPilot] orchestrator error:', err);

      if (err.message?.includes('download')) {
        panel.showAISetup(0);
      } else {
        panel.showError('Generation failed', err.message || 'Unexpected error. Please try again.');
      }
    } finally {
      if (inFlight === requestId) inFlight = null;
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
    const requestId = nextRequestId();
    inFlight = requestId;

    try {
      // The worker normally still holds the conversation under `contextId`, so
      // the common case sends a handle rather than the whole thread again.
      let result = await workerMessage('GENERATE_MORE', {
        requestId,
        contextId,
        replyCount: lastGenerate.replyCount,
        referenceNote: lastGenerate.referenceNote,
        previousReplies: shownReplies,
      }, { allowFailure: true });

      // Only when the worker was torn down between clicks does the full context
      // need to cross again.
      if (result?.code === 'CONTEXT_LOST') {
        result = await workerMessage('GENERATE_MORE', {
          requestId,
          replyCount: lastGenerate.replyCount,
          referenceNote: lastGenerate.referenceNote,
          previousReplies: shownReplies,
          context: {
            messages: lastGenerate.messages,
            conversationType: lastGenerate.conversationType,
            myName: lastGenerate.myName,
          },
        });
      } else if (!result?.ok) {
        throw new Error(result?.error || 'Worker returned error');
      }

      if (inFlight !== requestId) return;

      const replies = result.replies || [];
      shownReplies = [...shownReplies, ...replies];
      panel.appendReplies(replies);
    } catch (err) {
      if (inFlight !== requestId) return;
      console.error('[ReplyPilot] generateMore error:', err);
      panel.showToast('Failed to generate more — try reopening the panel.');
    } finally {
      if (inFlight === requestId) inFlight = null;
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
   * Abandons whatever is in flight. Called when the panel closes, when the chat
   * changes underneath us, and before starting a fresh generate.
   *
   * Previously a closed panel left the model running and the worker's keep-alive
   * ticking until it finished.
   */
  function onCancel() {
    if (inFlight === null) return;
    const requestId = inFlight;
    inFlight = null;
    workerMessage('ABORT', { requestId }, { allowFailure: true }).catch(() => {
      // The worker may already be gone; the request dies with it either way.
    });
  }

  return { openConfig, onGenerate, onGenerateMore, onInsert, onCancel };
}
