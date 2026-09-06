import test from 'node:test';
import assert from 'node:assert/strict';

/**
 * Drives the worker's message router through the same surface the content
 * script uses, with the AI layer stubbed out.
 */
async function loadWorker() {
  const listeners = [];
  globalThis.chrome = {
    runtime: {
      onMessage: { addListener: (fn) => listeners.push(fn) },
      getPlatformInfo: () => {},
    },
  };

  const sessions = [];
  globalThis.LanguageModel = {
    create: async () => {
      const session = {
        turns: [],
        async prompt(text) {
          this.turns.push(text);
          return JSON.stringify({ needsReply: true, reason: 'r', summary: 's', replies: ['reply'] });
        },
        destroy() {},
        clone: async () => globalThis.LanguageModel.create(),
      };
      sessions.push(session);
      return session;
    },
  };

  await import(`../src/worker/service-worker.js?t=${Math.random()}`);
  const listener = listeners[0];

  /** @returns {Promise<any>} the worker's response */
  const send = (type, payload) => new Promise((resolve) => listener({ type, payload }, {}, resolve));

  // The AI layer is a singleton shared across imports, so clear whatever the
  // previous test left warm.
  await send('RESET_SESSION', {});
  sessions.length = 0;

  return { send, sessions };
}

test.afterEach(() => {
  delete globalThis.chrome;
  delete globalThis.LanguageModel;
});

const conversation = {
  messages: [
    { id: '1', sender: 'Rafi', isMe: false, text: 'are we still on for four?', ts: 1000, isGroup: false, mentionsMe: false },
  ],
  conversationType: 'direct',
  myName: 'Sami',
};

test('an unknown message type is reported, not thrown', async () => {
  const { send } = await loadWorker();
  const response = await send('NOPE', {});
  assert.equal(response.ok, false);
  assert.match(response.error, /Unknown message type/);
});

test('generate returns replies and a context handle', async () => {
  const { send } = await loadWorker();
  const response = await send('GENERATE', { requestId: 'r1', ...conversation, replyCount: 1 });

  assert.equal(response.ok, true);
  assert.equal(response.contextId, 'r1');
  assert.deepEqual(response.replies, ['reply']);
  assert.equal(typeof response.confidence, 'string', 'the heuristic confidence comes back too');
});

test('generate more continues under the handle it was given', async () => {
  const { send } = await loadWorker();
  await send('GENERATE', { requestId: 'r1', ...conversation, replyCount: 1 });

  const more = await send('GENERATE_MORE', { requestId: 'r2', contextId: 'r1', replyCount: 1 });
  assert.equal(more.ok, true);
  assert.deepEqual(more.replies, ['reply']);
});

test('generate more without any context asks the caller to resend', async () => {
  const { send } = await loadWorker();
  const more = await send('GENERATE_MORE', { requestId: 'r1', contextId: 'gone', replyCount: 1 });

  assert.equal(more.ok, false);
  assert.equal(more.code, 'CONTEXT_LOST');
});

test('a cold rebuild hands back a fresh handle, so the next one is warm', async () => {
  // Without this the worker retained nothing after a restart, and *every*
  // subsequent "generate more" resent the whole conversation.
  const { send } = await loadWorker();

  const rebuilt = await send('GENERATE_MORE', {
    requestId: 'r9', contextId: 'stale', replyCount: 1, context: conversation,
  });
  assert.equal(rebuilt.ok, true);
  assert.equal(rebuilt.contextId, 'r9', 'the rebuilt conversation is retained under a handle');

  const next = await send('GENERATE_MORE', { requestId: 'r10', contextId: 'r9', replyCount: 1 });
  assert.equal(next.ok, true, 'and the handle works without resending anything');
});

test('aborting an unknown request is harmless', async () => {
  const { send } = await loadWorker();
  assert.deepEqual(await send('ABORT', { requestId: 'never-existed' }), { ok: true });
});

test('availability probes both APIs', async () => {
  const { send } = await loadWorker();
  const response = await send('CHECK_AVAILABILITY', {});

  assert.equal(response.ok, true);
  assert.equal(response.languageModel, 'no', 'no availability() on the stub');
  assert.equal(response.summarizer, 'no');
});

test('each generate prompts a session that has seen nothing else', async () => {
  const { send, sessions } = await loadWorker();
  await send('GENERATE', { requestId: 'a', ...conversation, replyCount: 1 });
  await send('GENERATE', { requestId: 'b', ...conversation, replyCount: 1 });

  const used = sessions.filter(s => s.turns.length > 0);
  assert.equal(used.length, 2);
  for (const session of used) assert.equal(session.turns.length, 1);
});

test('a stale handle never continues another conversation\'s session', async () => {
  // A warm session belongs to one chat. Continuing it for a different one would
  // answer with the wrong conversation in context.
  const { send } = await loadWorker();
  await send('GENERATE', { requestId: 'chat-a', ...conversation, replyCount: 1 });

  const wrongChat = await send('GENERATE_MORE', {
    requestId: 'r2', contextId: 'chat-b', replyCount: 1,
  });

  assert.equal(wrongChat.ok, false);
  assert.equal(wrongChat.code, 'CONTEXT_LOST', 'the caller is asked to resend rather than served chat A');
});
