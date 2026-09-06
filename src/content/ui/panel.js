/**
 * panel.js — Slide-in panel with all UI states.
 *
 * States:
 *  - config     (launch screen: settings + Generate button)
 *  - loading
 *  - ai-setup   (model downloading)
 *  - no-reply   (no reply needed)
 *  - results    (summary + reply cards)
 *  - error
 *
 * @param {ShadowRoot} shadow
 * @param {{
 *   onClose: () => void,
 *   onGenerateMore: () => void,
 *   onInsert: (text: string) => void,
 *   onRetry?: () => void,
 * }} opts
 */
import {
  clampMessageCount,
  clampReplyCount,
  sanitizeReference,
  formatEstimate,
  MESSAGE_COUNT_MIN,
  MESSAGE_COUNT_MAX,
  REPLY_COUNT_MIN,
  REPLY_COUNT_MAX,
  REFERENCE_MAX_LEN,
} from '../../shared/settings.js';

export function createPanel(shadow, { onClose, onGenerateMore, onInsert, onRetry }) {
  // ── Panel shell ────────────────────────────────────────────────────────────
  const panel = document.createElement('div');
  panel.id = 'rp-panel';
  panel.setAttribute('role', 'complementary');
  panel.setAttribute('aria-label', 'Reply Pilot');

  panel.innerHTML = `
    <div class="rp-panel-header">
      <div class="rp-panel-logo">
        <svg viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
          <path d="M22 2L11 13M22 2L15 22l-4-9-9-4 20-7z"/>
        </svg>
      </div>
      <div class="rp-panel-title">
        <h2>Reply Pilot</h2>
        <span>Co-pilot online · On-device</span>
      </div>
      <button class="rp-close-btn" id="rp-close-btn" aria-label="Close panel">
        <svg viewBox="0 0 24 24">
          <line x1="18" y1="6" x2="6" y2="18"/>
          <line x1="6" y1="6" x2="18" y2="18"/>
        </svg>
      </button>
    </div>
    <div class="rp-panel-body" id="rp-panel-body">
      <!-- State is rendered here by JS -->
    </div>
    <div class="rp-panel-footer" id="rp-panel-footer" style="display:none;"></div>
  `;

  shadow.appendChild(panel);

  const body = panel.querySelector('#rp-panel-body');
  const footer = panel.querySelector('#rp-panel-footer');
  const closeBtn = panel.querySelector('#rp-close-btn');
  let batchCount = 0;
  let renderedCount = 0;      // total reply cards rendered (across batches)
  let currentReplyCount = 3;  // how many replies each "generate more" adds

  closeBtn.addEventListener('click', () => {
    close();
    onClose();
  });

  // ── Public API ─────────────────────────────────────────────────────────────

  function open() {
    panel.classList.add('open');
  }

  function close() {
    panel.classList.remove('open');
  }

  /**
   * Launch/config screen. Nothing generates until the user presses Generate.
   * @param {{ messageCount: number, replyCount: number, referenceNote: string }} settings
   * @param {{ onGenerate: (params: { messageCount: number, replyCount: number, referenceNote: string }) => void }} handlers
   */
  function showConfig(settings, { onGenerate }) {
    batchCount = 0;
    renderedCount = 0;
    footer.style.display = 'none';

    const mc = clampMessageCount(settings.messageCount);
    const rc = clampReplyCount(settings.replyCount);
    const ref = sanitizeReference(settings.referenceNote);

    body.innerHTML = `
      <div class="rp-config">
        <p class="rp-config-lead">Set your flight parameters, then launch.</p>

        <div class="rp-field">
          <div class="rp-field-head">
            <label class="rp-section-label" for="rp-cfg-messages">Messages to read</label>
            <output class="rp-field-val" id="rp-cfg-messages-val">${mc}</output>
          </div>
          <input type="range" class="rp-slider" id="rp-cfg-messages"
            min="${MESSAGE_COUNT_MIN}" max="${MESSAGE_COUNT_MAX}" step="1" value="${mc}"
            aria-label="Messages to read">
          <p class="rp-field-hint">Your messages and everyone else's both count toward this.</p>
        </div>

        <div class="rp-field">
          <div class="rp-field-head">
            <label class="rp-section-label" for="rp-cfg-replies">Reply options</label>
            <output class="rp-field-val" id="rp-cfg-replies-val">${rc}</output>
          </div>
          <input type="range" class="rp-slider" id="rp-cfg-replies"
            min="${REPLY_COUNT_MIN}" max="${REPLY_COUNT_MAX}" step="1" value="${rc}"
            aria-label="Number of reply options">
          <p class="rp-field-hint">How many drafts to generate each round.</p>
        </div>

        <div class="rp-field">
          <label class="rp-section-label" for="rp-cfg-ref">Reference for replies</label>
          <textarea class="rp-textarea" id="rp-cfg-ref" rows="2" maxlength="${REFERENCE_MAX_LEN}"
            placeholder="Optional — e.g. keep it formal · say I'll be 10 min late · reply in Bangla">${escapeHtml(ref)}</textarea>
        </div>

        <div class="rp-estimate">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"/><polyline points="12 7 12 12 15 14"/></svg>
          <span>Est. generation time</span>
          <strong id="rp-cfg-estimate">${formatEstimate(mc, rc)}</strong>
        </div>

        <button class="rp-btn rp-btn-primary rp-launch-btn" id="rp-launch-btn">
          <svg viewBox="0 0 24 24"><path d="M22 2L11 13M22 2L15 22l-4-9-9-4 20-7z"/></svg>
          Generate replies
        </button>
      </div>
    `;

    const messagesEl = body.querySelector('#rp-cfg-messages');
    const messagesValEl = body.querySelector('#rp-cfg-messages-val');
    const repliesEl = body.querySelector('#rp-cfg-replies');
    const repliesValEl = body.querySelector('#rp-cfg-replies-val');
    const refEl = body.querySelector('#rp-cfg-ref');
    const estimateEl = body.querySelector('#rp-cfg-estimate');

    const paintSlider = (el) => {
      const min = Number(el.min), max = Number(el.max);
      const pct = ((Number(el.value) - min) / (max - min)) * 100;
      el.style.backgroundSize = `${pct}% 100%`;
    };
    const refreshEstimate = () => {
      estimateEl.textContent = formatEstimate(Number(messagesEl.value), Number(repliesEl.value));
    };

    paintSlider(messagesEl);
    paintSlider(repliesEl);

    messagesEl.addEventListener('input', () => {
      messagesValEl.textContent = messagesEl.value;
      paintSlider(messagesEl);
      refreshEstimate();
    });
    repliesEl.addEventListener('input', () => {
      repliesValEl.textContent = repliesEl.value;
      paintSlider(repliesEl);
      refreshEstimate();
    });

    body.querySelector('#rp-launch-btn').addEventListener('click', () => {
      onGenerate({
        messageCount: clampMessageCount(messagesEl.value),
        replyCount: clampReplyCount(repliesEl.value),
        referenceNote: sanitizeReference(refEl.value),
      });
    });
  }

  function showLoading(label = 'Reading conversation…', sub = '') {
    batchCount = 0;
    footer.style.display = 'none';
    body.innerHTML = `
      <div class="rp-state-loading">
        <div class="rp-radar"><span class="rp-radar-blip"></span></div>
        <p class="rp-loading-label">${escapeHtml(label)}</p>
        ${sub ? `<p class="rp-loading-sub">${escapeHtml(sub)}</p>` : ''}
      </div>
    `;
  }

  function showAISetup(progress = 0) {
    batchCount = 0;
    footer.style.display = 'none';
    body.innerHTML = `
      <div class="rp-ai-setup">
        <h3>Pre-flight check: downloading the model…</h3>
        <p>Gemini Nano is downloading (one-time ~2 GB). This may take a few minutes — everything stays on your device.</p>
        <div class="rp-progress-bar">
          <div class="rp-progress-fill" id="rp-progress-fill" style="width: ${Math.round(progress * 100)}%"></div>
        </div>
      </div>
      <div class="rp-state-loading" style="min-height:120px;">
        <p class="rp-loading-sub">You can close this panel and reopen once the model is ready.</p>
      </div>
    `;
  }

  function updateAIProgress(progress = 0) {
    const fill = body.querySelector('#rp-progress-fill');
    if (fill) fill.style.width = `${Math.round(progress * 100)}%`;
  }

  /**
   * @param {{
   *   needsReply: boolean,
   *   confidence: 'high'|'medium'|'low',
   *   reason: string,
   *   summary?: string,
   *   replies?: string[],
   *   replyCount?: number,
   *   historyNote?: string,
   *   onDraftAnyway?: () => void,
   * }} result
   */
  function showResults(result) {
    batchCount = 0;
    renderedCount = 0;
    const { needsReply, confidence, reason, summary, replies = [], replyCount, historyNote, onDraftAnyway } = result;
    if (replyCount) currentReplyCount = clampReplyCount(replyCount);

    let statusClass = 'needed';
    let statusTitle = 'Cleared to reply';
    let statusIcon = `<svg class="rp-status-icon" viewBox="0 0 24 24" fill="none" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>`;

    if (!needsReply) {
      statusClass = 'not-needed';
      statusTitle = 'Stand by — no reply needed';
      statusIcon = `<svg class="rp-status-icon" viewBox="0 0 24 24" fill="none" stroke-width="2.5" stroke-linecap="round"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>`;
    } else if (confidence === 'low') {
      statusClass = 'optional';
      statusTitle = 'Optional acknowledgement';
      statusIcon = `<svg class="rp-status-icon" viewBox="0 0 24 24" fill="none" stroke-width="2.5" stroke-linecap="round"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>`;
    }

    let html = `
      <div class="rp-reply-status ${statusClass}">
        ${statusIcon}
        <div class="rp-status-text">
          <strong>${statusTitle}</strong>
          ${escapeHtml(reason)}
        </div>
      </div>
    `;

    if (historyNote) {
      html += `<p class="rp-history-note">${escapeHtml(historyNote)}</p>`;
    }

    if (summary) {
      html += `
        <div class="rp-summary-block">
          <div class="rp-section-label">Briefing</div>
          <p class="rp-summary-text">${escapeHtml(summary)}</p>
        </div>
      `;
    }

    const hasReplies = replies.length > 0;
    if (hasReplies) {
      html += `<div class="rp-replies-header">Suggested replies</div>`;
      html += renderReplyCards(replies, 0);
    } else if (!needsReply && onDraftAnyway) {
      html += `<p style="text-align:center;margin-top:20px;">
        <button class="rp-draft-anyway" id="rp-draft-anyway">Draft a reply anyway →</button>
      </p>`;
    }

    body.innerHTML = html;
    batchCount = 1;
    renderedCount = replies.length;

    if (!needsReply) {
      const btn = body.querySelector('#rp-draft-anyway');
      btn?.addEventListener('click', onDraftAnyway);
    }

    _wireCardButtons();
    // Only show "Generate more" once we actually have a first batch of replies.
    if (hasReplies) _updateFooter();
    else footer.style.display = 'none';
  }

  /** Appends a new batch of reply cards below the existing ones. */
  function appendReplies(replies = []) {
    if (replies.length === 0) return;
    batchCount++;

    const divider = document.createElement('div');
    divider.className = 'rp-batch-divider';
    divider.textContent = `Round ${String(batchCount).padStart(2, '0')}`;
    body.appendChild(divider);

    const fragment = document.createElement('div');
    fragment.innerHTML = renderReplyCards(replies, renderedCount);
    while (fragment.firstChild) body.appendChild(fragment.firstChild);
    renderedCount += replies.length;

    _wireCardButtons();
    _updateFooter();
    body.scrollTop = body.scrollHeight;
  }

  function showError(title = 'Something went wrong', desc = '') {
    footer.style.display = 'none';
    body.innerHTML = `
      <div class="rp-error-state">
        <div class="rp-error-icon">
          <svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>
        </div>
        <p class="rp-error-title">${escapeHtml(title)}</p>
        ${desc ? `<p class="rp-error-desc">${escapeHtml(desc)}</p>` : ''}
        <button class="rp-btn rp-btn-ghost" id="rp-retry-btn" style="margin-top:8px;">Try Again</button>
      </div>
    `;
    body.querySelector('#rp-retry-btn')?.addEventListener('click', () => {
      if (onRetry) {
        onRetry();
      } else {
        close();
        onClose();
      }
    });
  }

  // ── Helpers ────────────────────────────────────────────────────────────────

  function renderReplyCards(replies, startIndex) {
    return replies.map((text, i) => {
      const idx = startIndex + i + 1;
      return `
        <div class="rp-reply-card" data-card-index="${idx - 1}">
          <span class="rp-reply-card-badge">Option ${String(idx).padStart(2, '0')}</span>
          <p class="rp-reply-card-text">${escapeHtml(text)}</p>
          <div class="rp-reply-card-actions">
            <button class="rp-btn rp-btn-primary rp-insert-btn" data-text="${escapeAttr(text)}">
              <svg viewBox="0 0 24 24"><path d="M22 2L11 13M22 2L15 22l-4-9-9-4 20-7z"/></svg>
              Insert
            </button>
            <button class="rp-btn rp-btn-ghost rp-copy-btn" data-text="${escapeAttr(text)}">
              <svg viewBox="0 0 24 24"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>
              Copy
            </button>
          </div>
        </div>
      `;
    }).join('');
  }

  function _wireCardButtons() {
    body.querySelectorAll('.rp-insert-btn').forEach(btn => {
      btn.onclick = () => onInsert(btn.dataset.text || '');
    });
    body.querySelectorAll('.rp-copy-btn').forEach(btn => {
      btn.onclick = async () => {
        try {
          await navigator.clipboard.writeText(btn.dataset.text || '');
          const orig = btn.innerHTML;
          btn.className = 'rp-btn rp-btn-success';
          btn.innerHTML = `<svg viewBox="0 0 24 24"><polyline points="20 6 9 17 4 12"/></svg> Copied!`;
          setTimeout(() => { btn.className = 'rp-btn rp-btn-ghost'; btn.innerHTML = orig; }, 1800);
        } catch {
          showToast('Copy failed — clipboard permission denied.');
        }
      };
    });
  }

  function _updateFooter() {
    footer.style.display = '';
    const label = `Generate ${currentReplyCount} more`;
    footer.innerHTML = `
      <button class="rp-generate-more-btn" id="rp-gen-more-btn">
        <svg viewBox="0 0 24 24"><polyline points="1 4 1 10 7 10"/><path d="M3.51 15a9 9 0 1 0 .49-3.4"/></svg>
        <span class="rp-gen-more-label">${escapeHtml(label)}</span>
      </button>
    `;
    footer.querySelector('#rp-gen-more-btn').addEventListener('click', async (e) => {
      const btn = e.currentTarget;
      btn.disabled = true;
      const labelEl = btn.querySelector('.rp-gen-more-label');
      if (labelEl) labelEl.textContent = 'Generating…';
      try {
        await onGenerateMore();
      } finally {
        // appendReplies re-renders the footer on success; this covers failures
        _updateFooter();
      }
    });
  }

  // ── Toast ──────────────────────────────────────────────────────────────────

  function showToast(msg, durationMs = 2200) {
    const existing = shadow.querySelector('.rp-toast');
    if (existing) existing.remove();

    const toast = document.createElement('div');
    toast.className = 'rp-toast';
    toast.textContent = msg;
    shadow.appendChild(toast);

    setTimeout(() => {
      toast.classList.add('fade-out');
      setTimeout(() => toast.remove(), 350);
    }, durationMs);
  }

  // ── Sanitize ───────────────────────────────────────────────────────────────

  function escapeHtml(s) {
    return String(s)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function escapeAttr(s) {
    return escapeHtml(s).replace(/'/g, '&#39;');
  }

  return {
    panel,
    open,
    close,
    showConfig,
    showLoading,
    showAISetup,
    updateAIProgress,
    showResults,
    appendReplies,
    showError,
    showToast,
  };
}
