/**
 * classifier.js
 * Pure-JS heuristics that decide whether a reply is needed.
 * No AI involved — fast, deterministic, and testable.
 *
 * @param {import('../adapters/base.js').Message[]} messages
 * @param {{ myName: string }} opts
 * @returns {{ needsReply: boolean, confidence: 'high'|'medium'|'low', reason: string }}
 */
export function classify(messages, { myName = 'Me' } = {}) {
  if (!messages || messages.length === 0) {
    return { needsReply: false, confidence: 'high', reason: 'No messages found in the conversation.' };
  }

  const last = messages[messages.length - 1];
  const isGroup = last.isGroup;

  // Rule 1: Direct question / @mention / reply-quote to my message → highest priority
  const recentFromOthers = messages.filter(m => !m.isMe).slice(-5);
  const addressedToMe = recentFromOthers.some(m => {
    const txt = m.text.toLowerCase();
    const nameLower = myName.toLowerCase();
    return (
      m.mentionsMe ||
      m.quotedText?.includes('Me') ||
      (nameLower !== 'me' && txt.includes(nameLower)) ||
      txt.includes('?') // a question was asked
    );
  });

  if (addressedToMe) {
    return {
      needsReply: true,
      confidence: 'high',
      reason: 'You were directly addressed or a question was asked.',
    };
  }

  // Rule 2: I sent the last message → usually no reply needed
  if (last.isMe) {
    // Exception: my last message was itself a question
    if (last.text.includes('?')) {
      return {
        needsReply: false,
        confidence: 'medium',
        reason: 'You sent the last message (a question). Waiting for a reply.',
      };
    }
    return {
      needsReply: false,
      confidence: 'high',
      reason: 'You sent the last message — no reply needed.',
    };
  }

  // Rule 3: 1:1 chat, last message is from them → reply needed
  if (!isGroup) {
    return {
      needsReply: true,
      confidence: 'high',
      reason: 'Direct message from the other person.',
    };
  }

  // Rule 4: Group chat checks
  // Sub-rule 4a: strictly others talking, no mention/quote of me, no broadcast pattern
  const myMessages = messages.filter(m => m.isMe);
  const hasIBeenMentioned = messages.some(m => m.mentionsMe);
  const hasIBeenQuoted = messages.some(m =>
    m.quotedText && (m.quotedText.toLowerCase().includes(myName.toLowerCase()))
  );

  if (!hasIBeenMentioned && !hasIBeenQuoted && myMessages.length === 0) {
    // Check if this looks like a broadcast (many short acks from different senders)
    const recentSenders = new Set(messages.slice(-10).filter(m => !m.isMe).map(m => m.sender));
    const shortReplies = messages.slice(-10).filter(m => !m.isMe && m.text.length < 80);

    if (recentSenders.size >= 3 && shortReplies.length >= 3) {
      // Looks like a broadcast — optional acknowledgement
      return {
        needsReply: true, // Soft yes — we offer drafts but show a soft prompt in the UI
        confidence: 'low',
        reason: 'Group announcement — a short acknowledgement is optional.',
      };
    }

    return {
      needsReply: false,
      confidence: 'high',
      reason: 'Group conversation between others — you\'re not addressed here.',
    };
  }

  // Sub-rule 4b: broadcast with me mentioned or it's a general group message
  return {
    needsReply: true,
    confidence: 'medium',
    reason: 'Group message that may include you.',
  };
}
