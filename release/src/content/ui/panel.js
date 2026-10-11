/**
 * panel.js — Slide-in panel with all UI states.
 *
 * States: config (launch screen), loading, ai-setup, results, error.
 *
 * Two things shape the implementation. Every piece of text that came from the
 * conversation or the model is written with `textContent`, never interpolated
 * into markup — so there is no hand-rolled HTML escaping to get wrong, and reply
 * text never round-trips through a `data-` attribute. And all interaction runs
 * through delegated listeners on the panel root, so appending a batch of replies
 * costs one insertion rather than re-binding every card that came before it.
 *
 * @param {ShadowRoot} shadow
 * @param {{
 *   onClose: () => void,
 *   onGenerateMore: () => void | Promise<void>,
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

const ICON_SEND = '<svg viewBox="0 0 24 24"><path d="M22 2L11 13M22 2L15 22l-4-9-9-4 20-7z"/></svg>';
const ICON_COPY = '<svg viewBox="0 0 24 24"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>';
const ICON_TICK = '<svg viewBox="0 0 24 24"><polyline points="20 6 9 17 4 12"/></svg>';
const ICON_REFRESH = '<svg viewBox="0 0 24 24"><polyline points="1 4 1 10 7 10"/><path d="M3.51 15a9 9 0 1 0 .49-3.4"/></svg>';
const ICON_ALERT = '<svg class="rp-status-icon" viewBox="0 0 24 24" fill="none" stroke-width="2.5" stroke-linecap="round"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>';
const ICON_CHECK = '<svg class="rp-status-icon" viewBox="0 0 24 24" fill="none" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>';

const COPIED_RESET_MS = 1800;

export function createPanel(shadow, { onClose, onGenerateMore, onInsert, onRetry }) {
  // ── Panel shell ────────────────────────────────────────────────────────────
  const panel = document.createElement('div');
  panel.id = 'rp-panel';
  panel.setAttribute('role', 'complementary');
  panel.setAttribute('aria-label', 'Reply Pilot');

  panel.innerHTML = `
    <div class="rp-panel-header">
      <div class="rp-panel-logo">${ICON_SEND}</div>
      <div class="rp-panel-title">
        <h2>Reply Pilot</h2>
        <span>Co-pilot online · On-device</span>
      </div>
      <button class="rp-close-btn" data-action="close" aria-label="Close panel">
        <svg viewBox="0 0 24 24">
          <line x1="18" y1="6" x2="6" y2="18"/>
          <line x1="6" y1="6" x2="18" y2="18"/>
        </svg>
      </button>
    </div>
    <div class="rp-panel-body" id="rp-panel-body"></div>
    <div class="rp-panel-footer" id="rp-panel-footer" style="display:none;"></div>
  `;

  shadow.appendChild(panel);

  const body = panel.querySelector('#rp-panel-body');
  const footer = panel.querySelector('#rp-panel-footer');

  // ── State ──────────────────────────────────────────────────────────────────
  let batchCount = 0;
  let currentReplyCount = 3;
  /** Reply text, indexed by a card's data-idx. Cards hold the index, not the text. */
  let replyTexts = [];
  /** Per-render callbacks supplied by the orchestrator. */
  let onGenerateConfig = null;
  let onDraftAnyway = null;

  // ── Delegated interaction ──────────────────────────────────────────────────
  // One listener for the panel's whole lifetime, instead of re-binding every
  // reply card's buttons after each appended batch.

  panel.addEventListener('click', (event) => {
    const el = event.target.closest?.('[data-action]');
    if (!el) return;

    switch (el.dataset.action) {
      case 'close':        close(); onClose(); break;
      case 'insert':       onInsert(replyTexts[Number(el.dataset.idx)] ?? ''); break;
      case 'copy':         copyReply(el); break;
      case 'generate':     onGenerateConfig?.(readConfig()); break;
      case 'more':         generateMore(el); break;
      case 'draft-anyway': onDraftAnyway?.(); break;
      case 'retry':
        if (onRetry) onRetry();
        else { close(); onClose(); }
        break;
    }
  });

  panel.addEventListener('input', (event) => {
    if (event.target.classList?.contains('rp-slider')) refreshConfig();
  });

  // ── Public API ─────────────────────────────────────────────────────────────

  function open() { panel.classList.add('open'); }
  function close() { panel.classList.remove('open'); }

  /**
   * Launch/config screen. Nothing generates until the user presses Generate.
   * @param {{ messageCount: number, replyCount: number, referenceNote: string }} settings
   * @param {{ onGenerate: (params: object) => void }} handlers
   */
  function showConfig(settings, handlers) {
    resetState();
    onGenerateConfig = handlers.onGenerate;

    const mc = clampMessageCount(settings.messageCount);
    const rc = clampReplyCount(settings.replyCount);

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
            placeholder="Optional — e.g. keep it formal · say I'll be 10 min late · reply in Bangla"></textarea>
        </div>

        <div class="rp-estimate">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"/><polyline points="12 7 12 12 15 14"/></svg>
          <span>Est. generation time</span>
          <strong id="rp-cfg-estimate">${formatEstimate(mc, rc)}</strong>
        </div>

        <button class="rp-btn rp-btn-primary rp-launch-btn" data-action="generate">
          ${ICON_SEND}
          Generate replies
        </button>
      </div>
    `;

    // User-supplied text is assigned, never interpolated.
    body.querySelector('#rp-cfg-ref').value = sanitizeReference(settings.referenceNote);

    paintSlider(body.querySelector('#rp-cfg-messages'));
    paintSlider(body.querySelector('#rp-cfg-replies'));
  }

  function showLoading(label = 'Reading conversation…', sub = '') {
    resetState();
    body.innerHTML = `
      <div class="rp-state-loading">
        <div class="rp-radar"><span class="rp-radar-blip"></span></div>
        <p class="rp-loading-label"></p>
        ${sub ? '<p class="rp-loading-sub"></p>' : ''}
      </div>
    `;
    body.querySelector('.rp-loading-label').textContent = label;
    if (sub) body.querySelector('.rp-loading-sub').textContent = sub;
  }

  function showAISetup(progress = 0) {
    resetState();
    body.innerHTML = `
      <div class="rp-ai-setup">
        <h3>Pre-flight check: downloading the model…</h3>
        <p>Gemini Nano is downloading (one-time ~2 GB). This may take a few minutes — everything stays on your device.</p>
        <div class="rp-progress-bar">
          <div class="rp-progress-fill" id="rp-progress-fill" style="width: ${percent(progress)}"></div>
        </div>
      </div>
      <div class="rp-state-loading" style="min-height:120px;">
        <p class="rp-loading-sub">You can close this panel and reopen once the model is ready.</p>
      </div>
    `;
  }

  function updateAIProgress(progress = 0) {
    const fill = body.querySelector('#rp-progress-fill');
    if (fill) fill.style.width = percent(progress);
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
    const { needsReply, confidence, reason, summary, replies = [], replyCount, historyNote } = result;

    resetState();
    onDraftAnyway = result.onDraftAnyway || null;
    if (replyCount) currentReplyCount = clampReplyCount(replyCount);

    body.appendChild(renderStatus(needsReply, confidence, reason));

    if (historyNote) {
      body.appendChild(makeEl('p', 'rp-history-note', historyNote));
    }

    if (summary) {
      const block = makeEl('div', 'rp-summary-block');
      block.appendChild(makeEl('div', 'rp-section-label', 'Briefing'));
      block.appendChild(makeEl('p', 'rp-summary-text', summary));
      body.appendChild(block);
    }

    if (replies.length > 0) {
      body.appendChild(makeEl('div', 'rp-replies-header', 'Suggested replies'));
      body.appendChild(buildReplyCards(replies));
      batchCount = 1;
      showFooter();
    } else if (!needsReply && onDraftAnyway) {
      const wrap = makeEl('p');
      wrap.style.cssText = 'text-align:center;margin-top:20px;';
      const btn = makeEl('button', 'rp-draft-anyway', 'Draft a reply anyway →');
      btn.dataset.action = 'draft-anyway';
      wrap.appendChild(btn);
      body.appendChild(wrap);
    }
  }

  /** Appends a new batch of reply cards below the existing ones. */
  function appendReplies(replies = []) {
    if (replies.length === 0) return;
    batchCount++;

    const divider = makeEl('div', 'rp-batch-divider', `Round ${String(batchCount).padStart(2, '0')}`);
    body.appendChild(divider);

    const cards = buildReplyCards(replies);
    const firstCard = cards.firstElementChild;
    body.appendChild(cards);

    showFooter();
    // Scrolling into view beats reading scrollHeight, which forces a layout.
    (firstCard || divider).scrollIntoView({ block: 'nearest' });
  }

  function showError(title = 'Something went wrong', desc = '') {
    resetState();
    body.innerHTML = `
      <div class="rp-error-state">
        <div class="rp-error-icon">
          <svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>
        </div>
        <p class="rp-error-title"></p>
        ${desc ? '<p class="rp-error-desc"></p>' : ''}
        <button class="rp-btn rp-btn-ghost" data-action="retry" style="margin-top:8px;">Try Again</button>
      </div>
    `;
    body.querySelector('.rp-error-title').textContent = title;
    if (desc) body.querySelector('.rp-error-desc').textContent = desc;
  }

  function showToast(msg, durationMs = 2200) {
    shadow.querySelector('.rp-toast')?.remove();

    const toast = makeEl('div', 'rp-toast', msg);
    shadow.appendChild(toast);

    setTimeout(() => {
      toast.classList.add('fade-out');
      setTimeout(() => toast.remove(), 350);
    }, durationMs);
  }

  // ── Rendering helpers ──────────────────────────────────────────────────────

  /** Clears per-render state so a stale handler can never fire against new UI. */
  function resetState() {
    batchCount = 0;
    replyTexts = [];
    onGenerateConfig = null;
    onDraftAnyway = null;
    footer.style.display = 'none';
    footer.replaceChildren();
    body.replaceChildren();
  }

  function renderStatus(needsReply, confidence, reason) {
    let cls = 'needed';
    let title = 'Cleared to reply';
    let icon = ICON_CHECK;

    if (!needsReply) {
      cls = 'not-needed';
      title = 'Stand by — no reply needed';
      icon = ICON_ALERT;
    } else if (confidence === 'low') {
      cls = 'optional';
      title = 'Optional acknowledgement';
      icon = ICON_ALERT;
    }

    const wrap = makeEl('div', `rp-reply-status ${cls}`);
    wrap.innerHTML = icon;

    const text = makeEl('div', 'rp-status-text');
    text.appendChild(makeEl('strong', '', title));
    text.appendChild(document.createTextNode(reason || ''));
    wrap.appendChild(text);

    return wrap;
  }

  /**
   * Builds a batch of reply cards into a fragment — one insertion into the live
   * tree rather than one per card.
   * @param {string[]} replies
   */
  function buildReplyCards(replies) {
    const fragment = document.createDocumentFragment();

    for (let i = 0; i < replies.length; i++) {
      const idx = replyTexts.push(replies[i]) - 1;

      const card = makeEl('div', 'rp-reply-card');
      card.dataset.cardIndex = String(idx);

      card.appendChild(makeEl('span', 'rp-reply-card-badge', `Option ${String(idx + 1).padStart(2, '0')}`));
      card.appendChild(makeEl('p', 'rp-reply-card-text', replies[i]));

      const actions = makeEl('div', 'rp-reply-card-actions');
      actions.appendChild(actionButton('insert', idx, 'rp-btn rp-btn-primary rp-insert-btn', ICON_SEND, 'Insert'));
      actions.appendChild(actionButton('copy', idx, 'rp-btn rp-btn-ghost rp-copy-btn', ICON_COPY, 'Copy'));
      card.appendChild(actions);

      fragment.appendChild(card);
    }

    return fragment;
  }

  function actionButton(action, idx, className, icon, label) {
    const btn = makeEl('button', className);
    btn.dataset.action = action;
    btn.dataset.idx = String(idx);
    btn.innerHTML = icon;
    btn.appendChild(document.createTextNode(` ${label}`));
    return btn;
  }

  function showFooter() {
    footer.style.display = '';
    footer.replaceChildren();

    const btn = makeEl('button', 'rp-generate-more-btn');
    btn.dataset.action = 'more';
    btn.innerHTML = ICON_REFRESH;
    btn.appendChild(makeEl('span', 'rp-gen-more-label', `Generate ${currentReplyCount} more`));
    footer.appendChild(btn);
  }

  async function generateMore(btn) {
    btn.disabled = true;
    const label = btn.querySelector('.rp-gen-more-label');
    if (label) label.textContent = 'Generating…';
    try {
      await onGenerateMore();
    } finally {
      // appendReplies rebuilds the footer on success; this covers failures.
      showFooter();
    }
  }

  async function copyReply(btn) {
    const text = replyTexts[Number(btn.dataset.idx)] ?? '';
    try {
      await navigator.clipboard.writeText(text);
    } catch {
      showToast('Copy failed — clipboard permission denied.');
      return;
    }

    const original = btn.innerHTML;
    const originalClass = btn.className;
    btn.className = 'rp-btn rp-btn-success';
    btn.innerHTML = `${ICON_TICK} Copied!`;
    setTimeout(() => {
      btn.className = originalClass;
      btn.innerHTML = original;
    }, COPIED_RESET_MS);
  }

  // ── Config screen ──────────────────────────────────────────────────────────

  function readConfig() {
    return {
      messageCount: clampMessageCount(body.querySelector('#rp-cfg-messages')?.value),
      replyCount: clampReplyCount(body.querySelector('#rp-cfg-replies')?.value),
      referenceNote: sanitizeReference(body.querySelector('#rp-cfg-ref')?.value),
    };
  }

  function refreshConfig() {
    const messages = body.querySelector('#rp-cfg-messages');
    const replies = body.querySelector('#rp-cfg-replies');
    if (!messages || !replies) return;

    body.querySelector('#rp-cfg-messages-val').textContent = messages.value;
    body.querySelector('#rp-cfg-replies-val').textContent = replies.value;
    paintSlider(messages);
    paintSlider(replies);
    body.querySelector('#rp-cfg-estimate').textContent =
      formatEstimate(Number(messages.value), Number(replies.value));
  }

  function paintSlider(el) {
    if (!el) return;
    const min = Number(el.min);
    const max = Number(el.max);
    const pct = ((Number(el.value) - min) / (max - min)) * 100;
    el.style.backgroundSize = `${pct}% 100%`;
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

// ── Small DOM helpers ────────────────────────────────────────────────────────

/**
 * @param {string} tag
 * @param {string} [className]
 * @param {string} [text] assigned as textContent — never parsed as markup
 */
function makeEl(tag, className = '', text) {
  const el = document.createElement(tag);
  if (className) el.className = className;
  if (text !== undefined) el.textContent = text;
  return el;
}

function percent(progress) {
  return `${Math.round(progress * 100)}%`;
}
