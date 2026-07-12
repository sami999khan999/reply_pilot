/**
 * composerInsert.js
 * Inserts text into the chat composer box (contenteditable, React-controlled).
 * Does NOT auto-send — the user reviews first.
 *
 * @param {Element} box - The contenteditable composer element
 * @param {string} text - Text to insert
 * @returns {boolean} true if insertion succeeded
 */
export function insertIntoComposer(box, text) {
  if (!box) return false;

  try {
    box.focus();

    // Attempt 1: execCommand — fires the React synthetic events most reliably
    const success = document.execCommand('insertText', false, text);
    if (success && box.textContent.includes(text)) return true;

    // Attempt 2: manual InputEvent dispatch (fallback for browsers where execCommand is deprecated)
    // Clear existing content first, then set
    box.textContent = '';
    const event = new InputEvent('input', {
      bubbles: true,
      cancelable: true,
      inputType: 'insertText',
      data: text,
    });

    // Set value via nativeInputValueSetter trick for React-controlled inputs
    const nativeInputValueSetter = Object.getOwnPropertyDescriptor(
      window.HTMLElement.prototype, 'textContent'
    )?.set || Object.getOwnPropertyDescriptor(window.Node.prototype, 'textContent')?.set;

    if (nativeInputValueSetter) {
      nativeInputValueSetter.call(box, text);
    } else {
      box.textContent = text;
    }

    box.dispatchEvent(event);

    // Move cursor to end
    const range = document.createRange();
    const sel = window.getSelection();
    range.selectNodeContents(box);
    range.collapse(false);
    sel.removeAllRanges();
    sel.addRange(range);

    return true;
  } catch (err) {
    console.error('[ReplyPilot] composerInsert error:', err);
    return false;
  }
}
