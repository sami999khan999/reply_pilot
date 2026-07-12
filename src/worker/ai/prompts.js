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

/** JSON schema for the model's response constraint */
export const RESPONSE_SCHEMA = {
  type: 'object',
  properties: {
    needsReply: { type: 'boolean' },
    reason: { type: 'string' },
    summary: { type: 'string' },
    replies: {
      type: 'array',
      items: { type: 'string' },
      minItems: 3,
      maxItems: 3,
    },
  },
  required: ['needsReply', 'reason', 'summary', 'replies'],
};

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
}) {
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

  parts.push(
    `TASK: Decide needsReply. Write a 1-sentence summary of the conversation. ` +
    `Produce exactly 3 reply options I could send, varied in tone (formal, neutral, casual), ` +
    `matching the register shown above. Output only valid JSON.`
  );

  return parts.join('\n\n');
}

/**
 * The follow-up prompt for "Generate 3 more".
 */
export const GENERATE_MORE_PROMPT =
  'Give 3 different alternative replies, varied in tone — no repeats of previous options. ' +
  'Output only a JSON array of 3 strings: ["reply1", "reply2", "reply3"]';

/** Schema for the generate-more response */
export const MORE_REPLIES_SCHEMA = {
  type: 'array',
  items: { type: 'string' },
  minItems: 3,
  maxItems: 3,
};
