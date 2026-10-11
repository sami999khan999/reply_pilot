/**
 * popup.js — Browser-action popup controller.
 *
 * Lets the user choose how many messages Reply Pilot reads from the open chat.
 * The value is clamped, persisted to chrome.storage.sync, and read back by the
 * content script's orchestrator before each scrape.
 */

import {
  getSettings,
  saveSettings,
  clampMessageCount,
  MESSAGE_COUNT_MIN,
  MESSAGE_COUNT_MAX,
} from '../shared/settings.js';

const range = /** @type {HTMLInputElement} */ (document.getElementById('rp-count'));
const readout = /** @type {HTMLOutputElement} */ (document.getElementById('rp-count-readout'));
const presets = /** @type {HTMLElement} */ (document.getElementById('rp-presets'));
const saveEl = /** @type {HTMLElement} */ (document.getElementById('rp-save'));

range.min = String(MESSAGE_COUNT_MIN);
range.max = String(MESSAGE_COUNT_MAX);

let saveTimer = null;
let savedFlagTimer = null;

/** Paints the filled slider track + numeric readout for a value. */
function paint(value) {
  const pct = ((value - MESSAGE_COUNT_MIN) / (MESSAGE_COUNT_MAX - MESSAGE_COUNT_MIN)) * 100;
  range.style.backgroundSize = `${pct}% 100%`;
  readout.textContent = String(value);

  // Highlight a matching preset chip, if any.
  presets.querySelectorAll('.rp-chip').forEach(chip => {
    chip.classList.toggle('active', Number(chip.dataset.value) === value);
  });
}

/** Little scale-bump on the readout for tactile feedback. */
function bumpReadout() {
  readout.classList.remove('bump');
  // reflow to restart the animation
  void readout.offsetWidth;
  readout.classList.add('bump');
}

/** Shows the "Saved" confirmation briefly. */
function flashSaved() {
  saveEl.dataset.state = 'saved';
  clearTimeout(savedFlagTimer);
  savedFlagTimer = setTimeout(() => {
    saveEl.dataset.state = 'idle';
  }, 1600);
}

/** Debounced persist so dragging the slider doesn't spam storage. */
function persist(value) {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(async () => {
    await saveSettings({ messageCount: value });
    flashSaved();
  }, 250);
}

/** Applies a value everywhere: UI + storage. */
function apply(rawValue, { fromInput = false } = {}) {
  const value = clampMessageCount(rawValue);
  range.value = String(value);
  paint(value);
  if (!fromInput) bumpReadout();
  persist(value);
}

// Live update while dragging.
range.addEventListener('input', () => {
  const value = clampMessageCount(range.value);
  paint(value);
  persist(value);
});

// Preset chips.
presets.addEventListener('click', event => {
  const chip = event.target.closest('.rp-chip');
  if (!chip) return;
  apply(chip.dataset.value);
});

// Load persisted value on open.
(async function init() {
  const { messageCount } = await getSettings();
  range.value = String(messageCount);
  paint(messageCount);
})();
