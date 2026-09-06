/**
 * panel.css.js — "Flight deck" design system for Reply Pilot.
 *
 * Identity: a co-pilot's instrument panel. Deep navy blueprint grid,
 * aviation amber accents, monospace instrument readouts, radar-sweep
 * loading, boarding-pass reply cards. Zero external assets — everything
 * is CSS (page CSP blocks remote fonts/images inside the shadow root).
 */

/** @returns {string} CSS injected into the Shadow DOM */
export const PANEL_CSS = /* css */`
  *, *::before, *::after {
    box-sizing: border-box;
    margin: 0;
    padding: 0;
  }

  :host {
    font-family: system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif;

    /* Instrument palette */
    --rp-bg: #0a0f1e;
    --rp-bg-2: #0d1528;
    --rp-grid: rgba(140, 180, 255, 0.05);
    --rp-surface: #111a30;
    --rp-surface-2: #17233e;
    --rp-border: rgba(130, 165, 225, 0.16);
    --rp-border-strong: rgba(130, 165, 225, 0.3);

    --rp-amber: #ffb454;
    --rp-amber-2: #ff8a3d;
    --rp-amber-glow: rgba(255, 170, 70, 0.35);
    --rp-radar: #2dd4bf;

    --rp-text: #e9eefb;
    --rp-muted: #93a4c4;
    --rp-dim: #5c6d92;
    --rp-success: #4ade80;
    --rp-warn: #fbbf24;
    --rp-error: #f87171;

    --rp-mono: ui-monospace, 'Cascadia Code', 'SF Mono', Consolas, 'Liberation Mono', monospace;
    --rp-radius: 12px;
    --rp-radius-sm: 8px;
    --rp-shadow: -16px 0 48px rgba(2, 6, 18, 0.65);
    --rp-transition: 0.22s cubic-bezier(0.4, 0, 0.2, 1);
  }

  /* Instrument readout label — reused everywhere */
  .rp-section-label,
  .rp-replies-header,
  .rp-reply-card-badge,
  .rp-batch-divider,
  .rp-panel-title span {
    font-family: var(--rp-mono);
    font-size: 10px;
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 1.4px;
  }

  /* ── FAB — the cockpit call button ── */
  #rp-fab {
    position: fixed;
    bottom: 28px;
    right: 28px;
    width: 54px;
    height: 54px;
    border-radius: 50%;
    background: linear-gradient(140deg, var(--rp-amber) 0%, var(--rp-amber-2) 100%);
    border: none;
    cursor: pointer;
    display: flex;
    align-items: center;
    justify-content: center;
    box-shadow:
      0 6px 24px var(--rp-amber-glow),
      0 2px 8px rgba(0, 0, 0, 0.45),
      inset 0 1px 0 rgba(255, 255, 255, 0.35);
    z-index: 2147483646;
    transition: transform var(--rp-transition), box-shadow var(--rp-transition), opacity var(--rp-transition);
    user-select: none;
  }

  #rp-fab:hover {
    /* takes off: lifts and banks slightly */
    transform: translateY(-3px) rotate(-8deg) scale(1.05);
    box-shadow:
      0 12px 32px var(--rp-amber-glow),
      0 4px 12px rgba(0, 0, 0, 0.5),
      inset 0 1px 0 rgba(255, 255, 255, 0.35);
  }

  #rp-fab:active { transform: scale(0.94); }

  #rp-fab.hidden {
    opacity: 0;
    pointer-events: none;
    transform: scale(0.7) translateY(10px);
  }

  #rp-fab svg {
    width: 24px;
    height: 24px;
    fill: none;
    stroke: #1c1204;
    stroke-width: 2;
    stroke-linecap: round;
    stroke-linejoin: round;
  }

  #rp-fab .rp-fab-pulse {
    position: absolute;
    inset: -4px;
    border-radius: 50%;
    border: 2px solid var(--rp-amber);
    opacity: 0;
    pointer-events: none;
  }

  /* Only animates on hover/focus. This ran as an infinite animation for the
     lifetime of the tab: .hidden sets opacity to 0, which does not stop it. */
  @media (prefers-reduced-motion: no-preference) {
    #rp-fab:hover .rp-fab-pulse,
    #rp-fab:focus-visible .rp-fab-pulse {
      animation: rp-pulse 2.6s ease-out infinite;
    }
  }

  @keyframes rp-pulse {
    0%   { transform: scale(1);   opacity: 0.6; }
    100% { transform: scale(1.55); opacity: 0; }
  }

  /* ── PANEL — the flight deck ── */
  #rp-panel {
    position: fixed;
    top: 0;
    right: 0;
    width: 384px;
    max-width: 100vw;
    height: 100dvh;
    /* blueprint grid over deep navy */
    background:
      linear-gradient(var(--rp-grid) 1px, transparent 1px),
      linear-gradient(90deg, var(--rp-grid) 1px, transparent 1px),
      linear-gradient(180deg, var(--rp-bg-2) 0%, var(--rp-bg) 45%);
    background-size: 26px 26px, 26px 26px, 100% 100%;
    border-left: 1px solid var(--rp-border-strong);
    box-shadow: var(--rp-shadow);
    z-index: 2147483645;
    display: flex;
    flex-direction: column;
    transform: translateX(105%);
    transition: transform 0.38s cubic-bezier(0.32, 0.72, 0.25, 1);
    overflow: hidden;
    color: var(--rp-text);
    /* The panel's layout, style and paint are its own business — nothing inside
       it may force the host page to recalculate. */
    contain: layout style paint;
  }

  #rp-panel.open { transform: translateX(0); }

  /* amber runway strip along the panel edge */
  #rp-panel::before {
    content: '';
    position: absolute;
    top: 0;
    left: 0;
    bottom: 0;
    width: 3px;
    background: repeating-linear-gradient(
      180deg,
      var(--rp-amber) 0 14px,
      transparent 14px 26px
    );
    opacity: 0.55;
    pointer-events: none;
  }

  /* Panel Header — cockpit masthead */
  .rp-panel-header {
    display: flex;
    align-items: center;
    gap: 12px;
    padding: 18px 18px 14px 20px;
    border-bottom: 1px dashed var(--rp-border-strong);
    background: linear-gradient(180deg, rgba(255, 180, 84, 0.07) 0%, transparent 100%);
    flex-shrink: 0;
  }

  .rp-panel-logo {
    width: 36px;
    height: 36px;
    background: linear-gradient(140deg, var(--rp-amber), var(--rp-amber-2));
    border-radius: 10px;
    display: flex;
    align-items: center;
    justify-content: center;
    flex-shrink: 0;
    box-shadow: 0 4px 14px var(--rp-amber-glow), inset 0 1px 0 rgba(255,255,255,0.35);
  }

  .rp-panel-logo svg {
    width: 19px;
    height: 19px;
    fill: none;
    stroke: #1c1204;
    stroke-width: 2;
    stroke-linecap: round;
    stroke-linejoin: round;
  }

  .rp-panel-title { flex: 1; min-width: 0; }

  .rp-panel-title h2 {
    font-size: 15px;
    font-weight: 700;
    color: var(--rp-text);
    letter-spacing: 0.4px;
    line-height: 1.2;
  }

  .rp-panel-title span {
    display: flex;
    align-items: center;
    gap: 6px;
    color: var(--rp-dim);
    font-size: 9.5px;
  }

  /* green "systems online" beacon in the subtitle */
  .rp-panel-title span::before {
    content: '';
    width: 6px;
    height: 6px;
    border-radius: 50%;
    background: var(--rp-success);
    box-shadow: 0 0 6px var(--rp-success);
    flex-shrink: 0;
  }

  @media (prefers-reduced-motion: no-preference) {
    #rp-panel.open .rp-panel-title span::before {
      animation: rp-beacon 2.2s ease-in-out infinite;
    }
  }

  @keyframes rp-beacon {
    0%, 100% { opacity: 1; }
    50%      { opacity: 0.35; }
  }

  .rp-close-btn {
    width: 32px;
    height: 32px;
    border: 1px solid var(--rp-border);
    background: rgba(255, 255, 255, 0.04);
    border-radius: var(--rp-radius-sm);
    cursor: pointer;
    display: flex;
    align-items: center;
    justify-content: center;
    color: var(--rp-muted);
    transition: background var(--rp-transition), color var(--rp-transition), border-color var(--rp-transition);
  }

  .rp-close-btn:hover {
    background: rgba(255, 255, 255, 0.09);
    border-color: var(--rp-border-strong);
    color: var(--rp-text);
  }

  .rp-close-btn svg {
    width: 15px;
    height: 15px;
    stroke: currentColor;
    fill: none;
    stroke-width: 2;
    stroke-linecap: round;
  }

  /* Panel Body */
  .rp-panel-body {
    flex: 1;
    overflow-y: auto;
    padding: 16px;
    scrollbar-width: thin;
    scrollbar-color: var(--rp-surface-2) transparent;
  }

  .rp-panel-body::-webkit-scrollbar { width: 4px; }
  .rp-panel-body::-webkit-scrollbar-track { background: transparent; }
  .rp-panel-body::-webkit-scrollbar-thumb {
    background: var(--rp-surface-2);
    border-radius: 4px;
  }

  /* Panel Footer */
  .rp-panel-footer {
    padding: 12px 16px 16px;
    border-top: 1px dashed var(--rp-border-strong);
    flex-shrink: 0;
    background: rgba(10, 15, 30, 0.6);
  }

  /* ── STATES ── */

  /* Loading — radar sweep */
  .rp-state-loading {
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 18px;
    height: 100%;
    min-height: 220px;
    padding: 40px 20px;
    text-align: center;
  }

  .rp-radar {
    position: relative;
    width: 84px;
    height: 84px;
    border-radius: 50%;
    border: 1px solid rgba(45, 212, 191, 0.4);
    background: radial-gradient(circle, rgba(45, 212, 191, 0.09) 0%, transparent 70%);
  }

  /* inner rings + crosshairs */
  .rp-radar::before {
    content: '';
    position: absolute;
    inset: 0;
    border-radius: 50%;
    background:
      radial-gradient(circle, transparent 26px, rgba(45,212,191,0.22) 26px, transparent 27px),
      radial-gradient(circle, transparent 12px, rgba(45,212,191,0.22) 12px, transparent 13px),
      linear-gradient(rgba(45,212,191,0.18), rgba(45,212,191,0.18)) 50% 0 / 1px 100% no-repeat,
      linear-gradient(rgba(45,212,191,0.18), rgba(45,212,191,0.18)) 0 50% / 100% 1px no-repeat;
  }

  /* the sweep */
  .rp-radar::after {
    content: '';
    position: absolute;
    inset: 1px;
    border-radius: 50%;
    background: conic-gradient(from 0deg, rgba(45, 212, 191, 0.55), rgba(45, 212, 191, 0.08) 70deg, transparent 90deg);
  }

  @media (prefers-reduced-motion: no-preference) {
    .rp-radar::after { animation: rp-sweep 1.8s linear infinite; }
  }

  @keyframes rp-sweep {
    to { transform: rotate(360deg); }
  }

  /* blip */
  .rp-radar-blip {
    position: absolute;
    top: 24%;
    left: 62%;
    width: 5px;
    height: 5px;
    border-radius: 50%;
    background: var(--rp-radar);
    box-shadow: 0 0 8px var(--rp-radar);
  }

  @media (prefers-reduced-motion: no-preference) {
    .rp-radar-blip { animation: rp-blip 1.8s ease-out infinite; }
  }

  @keyframes rp-blip {
    0%, 20%  { opacity: 0; }
    30%      { opacity: 1; }
    100%     { opacity: 0; }
  }

  .rp-loading-label {
    font-size: 13px;
    color: var(--rp-text);
    font-weight: 600;
    letter-spacing: 0.2px;
  }

  .rp-loading-sub {
    font-family: var(--rp-mono);
    font-size: 10.5px;
    letter-spacing: 0.8px;
    text-transform: uppercase;
    color: var(--rp-dim);
    margin-top: -10px;
  }

  /* AI setup / model download */
  .rp-ai-setup {
    background: linear-gradient(135deg, rgba(255, 180, 84, 0.1), rgba(255, 138, 61, 0.04));
    border: 1px solid rgba(255, 180, 84, 0.25);
    border-radius: var(--rp-radius);
    padding: 18px;
    margin-bottom: 12px;
  }

  .rp-ai-setup h3 {
    font-size: 13px;
    font-weight: 700;
    color: var(--rp-amber);
    margin-bottom: 6px;
    letter-spacing: 0.2px;
  }

  .rp-ai-setup p {
    font-size: 12.5px;
    color: var(--rp-muted);
    line-height: 1.55;
    margin-bottom: 12px;
  }

  .rp-progress-bar {
    height: 5px;
    background: var(--rp-surface-2);
    border-radius: 3px;
    overflow: hidden;
  }

  .rp-progress-fill {
    height: 100%;
    background: linear-gradient(90deg, var(--rp-amber), var(--rp-amber-2));
    border-radius: 3px;
    transition: width 0.3s ease;
  }

  @media (prefers-reduced-motion: no-preference) {
    .rp-progress-fill { animation: rp-progress-pulse 1.5s ease-in-out infinite alternate; }
  }

  @keyframes rp-progress-pulse {
    from { opacity: 0.65; }
    to   { opacity: 1; }
  }

  /* Section label (SUMMARY / etc.) */
  .rp-section-label {
    color: var(--rp-amber);
    margin-bottom: 7px;
    display: flex;
    align-items: center;
    gap: 8px;
  }

  .rp-section-label::after {
    content: '';
    flex: 1;
    height: 1px;
    background: linear-gradient(90deg, rgba(255, 180, 84, 0.3), transparent);
  }

  /* Summary block — the "briefing" */
  .rp-summary-block {
    background: rgba(17, 26, 48, 0.85);
    border: 1px solid var(--rp-border);
    border-radius: var(--rp-radius);
    padding: 14px 16px;
    margin-bottom: 14px;
    animation: rp-fade-in 0.3s ease;
  }

  .rp-summary-text {
    font-size: 13px;
    color: var(--rp-muted);
    line-height: 1.6;
  }

  /* Reply status — the clearance chip */
  .rp-reply-status {
    display: flex;
    align-items: flex-start;
    gap: 11px;
    padding: 12px 15px;
    border-radius: var(--rp-radius);
    border: 1px solid;
    margin-bottom: 14px;
    animation: rp-fade-in 0.3s ease;
    background: rgba(17, 26, 48, 0.7);
  }

  .rp-reply-status.needed     { border-color: rgba(74, 222, 128, 0.3); }
  .rp-reply-status.optional   { border-color: rgba(251, 191, 36, 0.3); }
  .rp-reply-status.not-needed { border-color: rgba(248, 113, 113, 0.3); }

  .rp-reply-status .rp-status-icon {
    width: 20px;
    height: 20px;
    flex-shrink: 0;
    margin-top: 1px;
    stroke: currentColor;
  }

  .needed .rp-status-icon     { color: var(--rp-success); }
  .optional .rp-status-icon   { color: var(--rp-warn); }
  .not-needed .rp-status-icon { color: var(--rp-error); }

  .rp-reply-status .rp-status-text {
    font-size: 12.5px;
    color: var(--rp-muted);
    line-height: 1.5;
  }

  .rp-reply-status .rp-status-text strong {
    display: block;
    font-family: var(--rp-mono);
    font-size: 11px;
    font-weight: 700;
    text-transform: uppercase;
    letter-spacing: 1.2px;
    margin-bottom: 3px;
  }

  .needed .rp-status-text strong     { color: var(--rp-success); }
  .optional .rp-status-text strong   { color: var(--rp-warn); }
  .not-needed .rp-status-text strong { color: var(--rp-error); }

  /* Replies header */
  .rp-replies-header {
    color: var(--rp-dim);
    margin: 4px 2px 10px;
    display: flex;
    align-items: center;
    gap: 8px;
  }

  .rp-replies-header::after {
    content: '';
    flex: 1;
    height: 1px;
    background: linear-gradient(90deg, var(--rp-border), transparent);
  }

  /* Reply Cards — boarding passes */
  .rp-reply-card {
    position: relative;
    background: var(--rp-surface);
    border: 1px solid var(--rp-border);
    border-left: 3px solid var(--rp-amber);
    border-radius: 10px;
    padding: 13px 14px 12px 15px;
    margin-bottom: 12px;
    transition: border-color var(--rp-transition), box-shadow var(--rp-transition), transform var(--rp-transition);
    animation: rp-card-in 0.35s cubic-bezier(0.4, 0, 0.2, 1) both;
  }

  .rp-reply-card:nth-child(2) { animation-delay: 0.05s; }
  .rp-reply-card:nth-child(3) { animation-delay: 0.10s; }

  @keyframes rp-card-in {
    from { opacity: 0; transform: translateX(14px); }
    to   { opacity: 1; transform: translateX(0); }
  }

  .rp-reply-card:hover {
    border-color: rgba(255, 180, 84, 0.35);
    border-left-color: var(--rp-amber);
    box-shadow: 0 6px 20px rgba(2, 6, 18, 0.5);
    transform: translateY(-1px);
  }

  .rp-reply-card-badge {
    color: var(--rp-amber);
    margin-bottom: 7px;
    display: block;
  }

  .rp-reply-card-text {
    font-size: 13.5px;
    color: var(--rp-text);
    line-height: 1.55;
  }

  /* perforated tear-line above the actions, with punched notches */
  .rp-reply-card-actions {
    display: flex;
    gap: 8px;
    position: relative;
    margin-top: 11px;
    padding-top: 11px;
    border-top: 1px dashed var(--rp-border-strong);
  }

  .rp-reply-card-actions::before,
  .rp-reply-card-actions::after {
    content: '';
    position: absolute;
    top: -6px;
    width: 11px;
    height: 11px;
    border-radius: 50%;
    background: var(--rp-bg);
    border: 1px solid var(--rp-border);
  }

  .rp-reply-card-actions::before { left: -21px; }
  .rp-reply-card-actions::after  { right: -20px; }

  /* Buttons */
  .rp-btn {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    padding: 6px 13px;
    border-radius: 7px;
    font-size: 12px;
    font-weight: 600;
    cursor: pointer;
    border: none;
    transition: background var(--rp-transition), transform var(--rp-transition), opacity var(--rp-transition), color var(--rp-transition);
    user-select: none;
    font-family: inherit;
  }

  .rp-btn:active { transform: scale(0.95); }

  .rp-btn-primary {
    background: linear-gradient(140deg, var(--rp-amber), var(--rp-amber-2));
    color: #1c1204;
    box-shadow: 0 2px 10px rgba(255, 170, 70, 0.25), inset 0 1px 0 rgba(255,255,255,0.3);
  }

  .rp-btn-primary:hover { filter: brightness(1.08); }

  .rp-btn-ghost {
    background: rgba(255, 255, 255, 0.04);
    color: var(--rp-muted);
    border: 1px solid var(--rp-border);
  }

  .rp-btn-ghost:hover {
    background: rgba(255, 255, 255, 0.08);
    color: var(--rp-text);
  }

  .rp-btn-success {
    background: rgba(74, 222, 128, 0.14);
    color: var(--rp-success);
    border: 1px solid rgba(74, 222, 128, 0.25);
  }

  .rp-btn svg {
    width: 13px;
    height: 13px;
    stroke: currentColor;
    fill: none;
    stroke-width: 2;
    stroke-linecap: round;
    stroke-linejoin: round;
    flex-shrink: 0;
  }

  /* Generate More — the "next leg" button */
  .rp-generate-more-btn {
    width: 100%;
    padding: 12px;
    border-radius: var(--rp-radius);
    font-family: var(--rp-mono);
    font-size: 11px;
    font-weight: 700;
    text-transform: uppercase;
    letter-spacing: 1.2px;
    background: transparent;
    color: var(--rp-muted);
    border: 1px dashed rgba(255, 180, 84, 0.4);
    cursor: pointer;
    transition: all var(--rp-transition);
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 8px;
  }

  .rp-generate-more-btn:hover:not(:disabled) {
    background: rgba(255, 180, 84, 0.1);
    border-color: var(--rp-amber);
    color: var(--rp-amber);
  }

  .rp-generate-more-btn:disabled {
    opacity: 0.45;
    cursor: not-allowed;
  }

  .rp-generate-more-btn svg {
    width: 14px;
    height: 14px;
    stroke: currentColor;
    fill: none;
    stroke-width: 2;
    stroke-linecap: round;
    stroke-linejoin: round;
  }

  /* Error state */
  .rp-error-state {
    display: flex;
    flex-direction: column;
    align-items: center;
    text-align: center;
    gap: 10px;
    padding: 44px 20px;
    animation: rp-fade-in 0.3s ease;
  }

  .rp-error-icon {
    width: 50px;
    height: 50px;
    border-radius: 50%;
    background: rgba(248, 113, 113, 0.1);
    border: 1px solid rgba(248, 113, 113, 0.3);
    display: flex;
    align-items: center;
    justify-content: center;
    color: var(--rp-error);
  }

  .rp-error-icon svg {
    width: 24px;
    height: 24px;
    stroke: currentColor;
    fill: none;
    stroke-width: 2;
    stroke-linecap: round;
  }

  .rp-error-title {
    font-size: 15px;
    font-weight: 700;
    color: var(--rp-text);
  }

  .rp-error-desc {
    font-size: 13px;
    color: var(--rp-muted);
    line-height: 1.55;
    max-width: 290px;
  }

  /* Draft-anyway link */
  .rp-draft-anyway {
    background: none;
    border: none;
    color: var(--rp-amber);
    font-size: 13px;
    font-weight: 600;
    cursor: pointer;
    padding: 4px 0;
    font-family: inherit;
    text-decoration: underline;
    text-decoration-color: transparent;
    text-underline-offset: 3px;
    transition: text-decoration-color var(--rp-transition);
  }

  .rp-draft-anyway:hover { text-decoration-color: var(--rp-amber); }

  /* Toast — cockpit advisory */
  .rp-toast {
    position: fixed;
    bottom: 94px;
    right: 28px;
    background: var(--rp-surface);
    border: 1px solid var(--rp-border-strong);
    border-left: 3px solid var(--rp-amber);
    border-radius: 8px;
    padding: 10px 16px;
    font-size: 12.5px;
    font-weight: 500;
    color: var(--rp-text);
    box-shadow: 0 10px 28px rgba(2, 6, 18, 0.6);
    z-index: 2147483647;
    animation: rp-toast-in 0.25s ease forwards;
    font-family: system-ui, sans-serif;
  }

  @keyframes rp-toast-in {
    from { opacity: 0; transform: translateY(8px); }
    to   { opacity: 1; transform: translateY(0); }
  }

  .rp-toast.fade-out { animation: rp-toast-out 0.3s ease forwards; }

  @keyframes rp-toast-out {
    to { opacity: 0; transform: translateY(8px); }
  }

  /* Batch divider — the next round marker */
  .rp-batch-divider {
    display: flex;
    align-items: center;
    gap: 10px;
    margin: 16px 0 12px;
    color: var(--rp-dim);
  }

  .rp-batch-divider::before,
  .rp-batch-divider::after {
    content: '';
    flex: 1;
    height: 1px;
    background: repeating-linear-gradient(90deg, var(--rp-border) 0 6px, transparent 6px 12px);
  }

  @keyframes rp-fade-in {
    from { opacity: 0; transform: translateY(6px); }
    to   { opacity: 1; transform: translateY(0); }
  }

  /* ── CONFIG / LAUNCH SCREEN ── */
  .rp-config {
    animation: rp-fade-in 0.3s ease;
  }

  .rp-config-lead {
    font-size: 12.5px;
    color: var(--rp-muted);
    line-height: 1.5;
    margin-bottom: 16px;
  }

  .rp-field {
    background: rgba(17, 26, 48, 0.6);
    border: 1px solid var(--rp-border);
    border-radius: var(--rp-radius);
    padding: 13px 14px;
    margin-bottom: 12px;
  }

  .rp-field-head {
    display: flex;
    align-items: baseline;
    justify-content: space-between;
    gap: 10px;
    margin-bottom: 11px;
  }

  .rp-field .rp-section-label {
    margin-bottom: 0;
  }

  .rp-field-val {
    font-family: var(--rp-mono);
    font-size: 19px;
    font-weight: 700;
    line-height: 1;
    color: var(--rp-text);
    text-shadow: 0 0 12px var(--rp-amber-glow);
  }

  .rp-field-hint {
    font-size: 10.5px;
    color: var(--rp-dim);
    line-height: 1.5;
    margin-top: 9px;
  }

  .rp-field .rp-section-label {
    color: var(--rp-amber);
  }

  /* Sliders (shared look with the popup) */
  .rp-slider {
    -webkit-appearance: none;
    appearance: none;
    width: 100%;
    height: 6px;
    border-radius: 999px;
    background: var(--rp-surface-2);
    background-image: linear-gradient(90deg, var(--rp-amber), var(--rp-amber-2));
    background-repeat: no-repeat;
    background-size: 40% 100%;
    outline: none;
    cursor: pointer;
  }

  .rp-slider::-webkit-slider-thumb {
    -webkit-appearance: none;
    appearance: none;
    width: 17px;
    height: 17px;
    border-radius: 50%;
    background: #fff5e6;
    border: 3px solid var(--rp-amber-2);
    box-shadow: 0 2px 8px rgba(0, 0, 0, 0.5), 0 0 0 4px rgba(255, 170, 70, 0.14);
    cursor: pointer;
    transition: transform var(--rp-transition), box-shadow var(--rp-transition);
  }

  .rp-slider::-webkit-slider-thumb:hover { transform: scale(1.12); }
  .rp-slider:active::-webkit-slider-thumb {
    box-shadow: 0 2px 8px rgba(0, 0, 0, 0.5), 0 0 0 6px rgba(255, 170, 70, 0.24);
  }
  .rp-slider:focus-visible::-webkit-slider-thumb {
    box-shadow: 0 2px 8px rgba(0, 0, 0, 0.5), 0 0 0 6px rgba(255, 170, 70, 0.3);
  }

  /* Reference textarea */
  .rp-textarea {
    width: 100%;
    margin-top: 10px;
    resize: none;
    background: var(--rp-bg);
    border: 1px solid var(--rp-border);
    border-radius: var(--rp-radius-sm);
    padding: 10px 11px;
    color: var(--rp-text);
    font-family: inherit;
    font-size: 12.5px;
    line-height: 1.5;
    transition: border-color var(--rp-transition), box-shadow var(--rp-transition);
  }

  .rp-textarea::placeholder { color: var(--rp-dim); }

  .rp-textarea:focus {
    outline: none;
    border-color: var(--rp-amber);
    box-shadow: 0 0 0 3px rgba(255, 170, 70, 0.14);
  }

  /* Estimate readout */
  .rp-estimate {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 11px 14px;
    margin: 4px 0 16px;
    border-radius: var(--rp-radius);
    border: 1px dashed var(--rp-border-strong);
    background: rgba(45, 212, 191, 0.05);
    font-family: var(--rp-mono);
    font-size: 11px;
    letter-spacing: 0.5px;
    text-transform: uppercase;
    color: var(--rp-muted);
  }

  .rp-estimate svg {
    width: 15px;
    height: 15px;
    color: var(--rp-radar);
    flex-shrink: 0;
  }

  .rp-estimate strong {
    margin-left: auto;
    color: var(--rp-radar);
    font-size: 13px;
    font-weight: 700;
    text-transform: none;
    letter-spacing: 0.4px;
  }

  /* Launch button */
  .rp-launch-btn {
    width: 100%;
    justify-content: center;
    padding: 13px;
    font-size: 13.5px;
    letter-spacing: 0.3px;
  }

  .rp-launch-btn svg {
    width: 16px;
    height: 16px;
    fill: none;
    stroke: currentColor;
    stroke-width: 2;
    stroke-linecap: round;
    stroke-linejoin: round;
  }
`;
