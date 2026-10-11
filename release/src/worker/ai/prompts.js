/**
 * prompts.js — System prompt, JSON schema, and payload builder.
 */

export const SYSTEM_PROMPT = `You are a chat reply assistant. Your job is to draft short, natural replies on behalf of the user.

Rules:
- Match the conversation's language, tone, and formality exactly.
- Prefer 1–2 sentences per reply. Never exceed 3 sentences.
- Never invent facts, names, or details not present in the conversation.
- Do not add pleasantries or filler unless the conversation's register calls for them.
- Output ONLY valid JSON matching the schema — no extra commentary, no markdown fences.`;

/**
 * JSON schema for the model's response constraint.
 * @param {number} [replyCount] how many reply options to require
 */
export function buildResponseSchema(replyCount = 3) {
  const n = Math.max(1, Math.round(replyCount));
  return {
    type: 'object',
    properties: {
      needsReply: { type: 'boolean' },
      reason: { type: 'string' },
      summary: { type: 'string' },
      replies: {
        type: 'array',
        items: { type: 'string' },
        minItems: n,
        maxItems: n,
      },
    },
    required: ['needsReply', 'reason', 'summary', 'replies'],
  };
}

/**
 * Builds the user-turn payload sent to the model.
 *
 * @param {{
 *   conversationType: 'group' | 'direct',
 *   myName: string,
 *   olderSummary: string,
 *   rootMessageText: string,
 *   ackSamples: string[],
 *   recentRaw: string,
 *   replyCount?: number,
 *   referenceNote?: string,
 *   excludeReplies?: string[],
 * }} opts
 * @returns {string}
 */
export function buildPayload({
  conversationType,
  myName,
  olderSummary,
  rootMessageText,
  ackSamples,
  recentRaw,
  replyCount = 3,
  referenceNote = '',
  excludeReplies = [],
}) {
  const n = Math.max(1, Math.round(replyCount));
  const parts = [
    `CONVERSATION TYPE: ${conversationType}`,
    `MY NAME: ${myName}`,
  ];

  if (olderSummary) {
    parts.push(`OLDER CONTEXT (summarized):\n${olderSummary}`);
  }

  if (rootMessageText) {
    parts.push(`MESSAGE TO RESPOND TO:\n${rootMessageText}`);
  }

  if (ackSamples.length > 0) {
    parts.push(`HOW OTHERS ACKNOWLEDGED IT (use this register):\n${ackSamples.join('\n')}`);
  }

  parts.push(`RECENT MESSAGES:\n${recentRaw}`);

  if (referenceNote) {
    parts.push(
      `USER'S INSTRUCTIONS FOR THE REPLIES (follow these closely):\n${referenceNote}`
    );
  }

  if (excludeReplies.length > 0) {
    parts.push(
      `DO NOT REPEAT THESE ALREADY-SUGGESTED REPLIES (produce fresh, different ones):\n` +
      excludeReplies.map(r => `- ${r}`).join('\n')
    );
  }

  parts.push(
    `TASK: Decide needsReply. Write a 1-sentence summary of the conversation. ` +
    `Produce exactly ${n} reply option${n === 1 ? '' : 's'} I could send, varied in tone` +
    `${n > 1 ? ' (e.g. formal, neutral, casual)' : ''}, matching the register shown above` +
    `${referenceNote ? ' and the user instructions' : ''}. Output only valid JSON.`
  );

  return parts.join('\n\n');
}

/**
 * The follow-up prompt for "Generate N more".
 * @param {number} [replyCount]
 * @param {string} [referenceNote]
 */
export function buildMorePrompt(replyCount = 3, referenceNote = '') {
  const n = Math.max(1, Math.round(replyCount));
  return (
    `Give ${n} different alternative repl${n === 1 ? 'y' : 'ies'}, varied in tone — ` +
    `no repeats of any previous options` +
    `${referenceNote ? `, still following the user's instructions (${referenceNote})` : ''}. ` +
    `Output only a JSON array of ${n} string${n === 1 ? '' : 's'}.`
  );
}

/**
 * Schema for the generate-more response.
 * @param {number} [replyCount]
 */
export function buildMoreSchema(replyCount = 3) {
  const n = Math.max(1, Math.round(replyCount));
  return {
    type: 'array',
    items: { type: 'string' },
    minItems: n,
    maxItems: n,
  };
}
