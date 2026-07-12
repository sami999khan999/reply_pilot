/**
 * index.js — Content script entry point.
 *
 * 1. Detects the platform (WhatsApp / Messenger).
 * 2. Mounts the Shadow DOM host.
 * 3. Creates FAB + panel.
 * 4. Wires the orchestrator.
 * 5. Polls for chat-open state to show/hide the FAB.
 */

import { detect } from './detector.js';
import { mountShadowHost } from './ui/mount.js';
import { createFAB } from './ui/fab.js';
import { createPanel } from './ui/panel.js';
import { createOrchestrator } from './orchestrator.js';

(function init() {
  // Don't double-inject
  if (document.getElementById('reply-pilot-host')) return;

  const detected = detect();
  if (!detected) return; // unsupported platform

  const { adapter } = detected;

  // Mount Shadow DOM
  const { shadow } = mountShadowHost();

  // Create panel first (so orchestrator can reference it)
  let panelOpen = false;
  const panelCtrl = createPanel(shadow, {
    onClose() {
      panelOpen = false;
    },
    onGenerateMore() {
      return orchestrator.onGenerateMore();
    },
    onInsert(text) {
      orchestrator.onInsert(text);
    },
    onRetry() {
      panelOpen = true;
      orchestrator.onGenerate();
    },
  });

  // Create orchestrator
  const orchestrator = createOrchestrator({ adapter, panel: panelCtrl });

  // Create FAB
  const fabCtrl = createFAB(shadow, {
    onClick() {
      if (panelOpen) {
        panelCtrl.close();
        panelOpen = false;
        return;
      }
      panelOpen = true;
      orchestrator.onGenerate();
    },
  });

  // Poll for chat-open state every 2s — show/hide FAB accordingly
  fabCtrl.setVisible(false); // start hidden
  const CHECK_INTERVAL = 2000;

  function checkChatOpen() {
    try {
      const open = adapter.isChatOpen();
      fabCtrl.setVisible(open);
      if (!open && panelOpen) {
        panelCtrl.close();
        panelOpen = false;
      }
    } catch {
      // DOM may not be ready yet — ignore
    }
  }

  // Initial check after a short delay to let the app render
  setTimeout(checkChatOpen, 1500);
  setInterval(checkChatOpen, CHECK_INTERVAL);

  // Also check on URL change (SPA navigation)
  let lastUrl = location.href;
  new MutationObserver(() => {
    if (location.href !== lastUrl) {
      lastUrl = location.href;
      panelCtrl.close();
      panelOpen = false;
      setTimeout(checkChatOpen, 1500);
    }
  }).observe(document.body, { childList: true, subtree: true });

})();
