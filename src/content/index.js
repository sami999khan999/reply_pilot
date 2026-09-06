/**
 * index.js — Content script entry point.
 *
 * Mounts the Shadow DOM host and the FAB, then hands all recurring work to
 * `lifecycle.js`. Everything past the FAB — the panel, the orchestrator — is
 * built on first open, so a tab where the user never clicks the button pays for
 * one small button and one 1.5s timer that stops when the tab is backgrounded.
 */

import { detect } from './detector.js';
import { mountShadowHost } from './ui/mount.js';
import { createFAB } from './ui/fab.js';
import { createPanel } from './ui/panel.js';
import { createOrchestrator } from './orchestrator.js';
import { createLifecycle } from './lifecycle.js';
import { createMessageCache } from './logic/messageCache.js';
import { watchTheme } from './ui/theme.js';
import { MESSAGE_COUNT_MAX } from '../shared/settings.js';

(function init() {
  // Don't double-inject
  if (document.getElementById('reply-pilot-host')) return;

  const detected = detect();
  if (!detected) return; // unsupported platform

  const { adapter, platform } = detected;
  const { shadow, host } = mountShadowHost();

  // Match the chat app's own colours, and follow it when the user switches
  // theme. Probes the message list where there is one, since that is the
  // surface the panel sits beside.
  const theme = watchTheme({
    host,
    accent: platform.accent,
    probe: () => adapter.getMessageList() || document.body,
  });

  // Banks messages as the host app renders them, so Generate never has to
  // scroll the conversation to find history.
  const messageCache = createMessageCache({ adapter, capacity: MESSAGE_COUNT_MAX });

  let panelOpen = false;
  let chatOpen = false;

  // ── Lazily built on first open ─────────────────────────────────────────────
  /** @type {ReturnType<typeof createPanel>|null} */
  let panel = null;
  /** @type {ReturnType<typeof createOrchestrator>|null} */
  let orchestrator = null;

  function ensureUI() {
    if (panel) return { panel, orchestrator };

    panel = createPanel(shadow, {
      onClose() {
        panelOpen = false;
        orchestrator?.onCancel();
        syncFab();
      },
      onGenerateMore() {
        return orchestrator.onGenerateMore();
      },
      onInsert(text) {
        orchestrator.onInsert(text);
      },
      onRetry() {
        panelOpen = true;
        syncFab();
        orchestrator.onGenerate();
      },
    });

    orchestrator = createOrchestrator({ adapter, panel, messageCache });
    return { panel, orchestrator };
  }

  /** The FAB shows only when a chat is open and the panel is closed. */
  function syncFab() {
    fab.setVisible(chatOpen && !panelOpen);
  }

  const fab = createFAB(shadow, {
    onClick() {
      if (panelOpen) return; // hidden while open, but guard anyway
      panelOpen = true;
      syncFab();
      ensureUI().orchestrator.openConfig();
    },
  });
  fab.setVisible(false);

  // ── Recurring work: one visibility-gated ticker, no DOM observers ──────────
  createLifecycle({
    isChatOpen: () => adapter.isChatOpen(),

    onChatStateChange(open) {
      chatOpen = open;
      if (open) {
        // The chat surface now exists, so it can be measured properly.
        theme.refresh();
        messageCache.start();
      } else {
        messageCache.stop();
        if (panelOpen) {
          panel?.close();
          panelOpen = false;
          orchestrator?.onCancel();
        }
      }
      syncFab();
    },

    onNavigate() {
      // SPA route change — the previous chat's cached elements, per-chat
      // invariants and banked history no longer describe what's on screen.
      adapter.invalidate();
      theme.refresh();
      messageCache.stop();
      messageCache.reset();
      if (panelOpen) {
        panel?.close();
        panelOpen = false;
        orchestrator?.onCancel();
      }
    },

    onVisibilityChange(visible) {
      // Nothing to watch in a background tab.
      if (visible) {
        if (chatOpen) messageCache.start();
      } else {
        messageCache.stop();
      }
    },
  });
})();
