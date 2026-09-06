/**
 * composerInsert.js — puts a drafted reply into the chat composer.
 *
 * Never sends: the user reviews first. And never destroys what is already
 * there. The previous version cleared the box before its fallback path, so a
 * half-typed message was lost whenever the first attempt did not take. It also
 * assumed every composer was contenteditable — Instagram and the structural
 * fallback both resolve `<textarea>`, whose value is not `textContent`, so those
 * always failed the success check, fell into the destructive path, wrote to a
 * property the element ignores, and still reported success.
 *
 * The three editors that matter here are rich-text ones with their own internal
 * models — Slate on Discord, Quill on Slack, Lexical on Messenger — which is why
 * text goes in through events they are listening for rather than by assignment.
 */

/** Editors that ignore direct DOM writes but honour a paste. */
const PASTE_TYPE = 'text/plain';

/**
 * @param {Element|null} box the composer element
 * @param {string} text
 * @returns {boolean} whether the text actually landed
 */
export function insertIntoComposer(box, text) {
  if (!box || !text) return false;

  try {
    // Read this before focusing: focus alone puts a caret in the box, and a
    // default caret at position 0 is not the same as one the user placed.
    const userCaret = hasCaretInside(box);

    box.focus({ preventScroll: true });

    if (isFormField(box)) return intoFormField(box, text, userCaret);
    if (box.isContentEditable) return intoContentEditable(box, text, userCaret);

    return false;
  } catch (err) {
    console.error('[ReplyPilot] composerInsert error:', err);
    return false;
  }
}

// ── textarea / input ─────────────────────────────────────────────────────────

/** @param {Element} el */
function isFormField(el) {
  return el.tagName === 'TEXTAREA' || el.tagName === 'INPUT';
}

/**
 * Writes through the prototype's `value` setter so React's onChange sees the
 * change — assigning `el.value` directly is swallowed by React's own setter.
 *
 * @param {HTMLTextAreaElement|HTMLInputElement} field
 * @param {string} text
 * @param {boolean} userCaret whether the user had placed a caret here
 */
function intoFormField(field, text, userCaret) {
  const before = field.value;
  const start = userCaret ? (field.selectionStart ?? before.length) : before.length;
  const end = userCaret ? (field.selectionEnd ?? before.length) : before.length;

  // Insert at the caret, replacing a selection — the user's existing draft on
  // either side of it survives.
  const next = before.slice(0, start) + text + before.slice(end);

  const proto = field.tagName === 'TEXTAREA'
    ? HTMLTextAreaElement.prototype
    : HTMLInputElement.prototype;
  const setter = Object.getOwnPropertyDescriptor(proto, 'value')?.set;

  if (setter) setter.call(field, next);
  else field.value = next;

  const caret = start + text.length;
  try { field.setSelectionRange(caret, caret); } catch { /* input types without a caret */ }

  field.dispatchEvent(new InputEvent('input', {
    bubbles: true,
    inputType: 'insertText',
    data: text,
  }));

  return field.value.includes(text);
}

// ── contenteditable ──────────────────────────────────────────────────────────

/**
 * @param {Element} box
 * @param {string} text
 * @param {boolean} userCaret
 */
function intoContentEditable(box, text, userCaret) {
  const before = box.textContent || '';
  if (!userCaret) placeCaretAtEnd(box);

  // execCommand is deprecated but remains the most widely honoured way to enter
  // text into a rich editor, because it produces the same events typing does.
  try {
    if (document.execCommand('insertText', false, text) && landed(box, before, text)) return true;
  } catch { /* fall through to paste */ }

  // Slate, Quill and Lexical all implement paste handling.
  if (pasteInto(box, text) && landed(box, before, text)) return true;

  // Nothing took. Leave the box exactly as we found it and say so — the panel
  // tells the user to paste it themselves.
  return false;
}

/**
 * Whether the user already has a caret or selection inside the composer, in
 * which case that position is where the reply belongs.
 * @param {Element} box
 */
function hasCaretInside(box) {
  const selection = window.getSelection();
  if (!selection || selection.rangeCount === 0) {
    // A form field keeps its own selection independently of the document's.
    return isFormField(box) && document.activeElement === box;
  }
  return box.contains(selection.getRangeAt(0).commonAncestorContainer);
}

/**
 * Appends the caret to the end of the composer's content.
 * @param {Element} box
 */
function placeCaretAtEnd(box) {
  const selection = window.getSelection();
  if (!selection) return;

  const range = document.createRange();
  range.selectNodeContents(box);
  range.collapse(false);
  selection.removeAllRanges();
  selection.addRange(range);
}

/**
 * @param {Element} box
 * @param {string} text
 * @returns {boolean} whether the editor accepted the paste
 */
function pasteInto(box, text) {
  const data = new DataTransfer();
  data.setData(PASTE_TYPE, text);

  const event = new ClipboardEvent('paste', {
    bubbles: true,
    cancelable: true,
    clipboardData: data,
  });

  box.dispatchEvent(event);
  return true; // whether it worked is decided by `landed`
}

/**
 * Confirms the text is really in the box now. execCommand can report success
 * without changing anything, so the DOM is the only trustworthy answer.
 *
 * @param {Element} box
 * @param {string} before
 * @param {string} text
 */
function landed(box, before, text) {
  const after = box.textContent || '';
  if (after === before) return false;

  // Rich editors may reflow whitespace, so compare on collapsed whitespace.
  return collapse(after).includes(collapse(text));
}

/** @param {string} value */
function collapse(value) {
  return value.replace(/\s+/g, ' ').trim();
}
