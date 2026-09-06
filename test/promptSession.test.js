import test from 'node:test';
import assert from 'node:assert/strict';

/**
 * A stand-in for Chrome's LanguageModel that records every session created and
 * every turn sent to it, so the tests can assert on context boundaries — the
 * thing that was actually broken.
 */
function installFakeModel({ failOn = null, quota = 1000, supportsClone = true } = {}) {
  const sessions = [];

  const makeSession = (origin) => {
    const session = {
      origin,
      turns: [],
      destroyed: false,
      inputUsage: 0,
      inputQuota: quota,
      async prompt(text) {
        if (this.destroyed) throw new Error('prompted a destroyed session');
        this.turns.push(text);
        this.inputUsage += text.length;
        if (failOn && failOn(text, this)) throw new Error('model failure');
        return JSON.stringify({ needsReply: true, reason: 'r', summary: 's', replies: ['a'] });
      },
      destroy() { this.destroyed = true; },
    };
    if (supportsClone) {
      // makeSession registers the copy itself.
      session.clone = async () => makeSession('clone');
    }
    sessions.push(session);
    return session;
  };

  globalThis.LanguageModel = { create: async () => makeSession('create') };
  return {
    sessions,
    /** Sessions that actually served a conversation. */
    used: () => sessions.filter(s => s.turns.length > 0),
  };
}

/** Fresh module state per test — the module holds the session in a closure. */
async function loadModule() {
  return import(`../src/worker/ai/promptSession.js?t=${Math.random()}`);
}

test.afterEach(() => { delete globalThis.LanguageModel; });

test('each generate runs on its own session', async () => {
  const fake = installFakeModel();
  const { promptForReplies } = await loadModule();

  await promptForReplies('chat one', { replyCount: 1 });
  await promptForReplies('chat two', { replyCount: 1 });
  await promptForReplies('chat three', { replyCount: 1 });

  const used = fake.used();
  assert.equal(used.length, 3, 'three conversations, three sessions');
  for (const session of used) {
    assert.equal(session.turns.length, 1, 'no session carried more than its own turn');
  }
});

test('one conversation never sees another one', async () => {
  // The bug this file exists for: a shared session meant generate #2 was
  // answered with chat #1 still in context.
  const fake = installFakeModel();
  const { promptForReplies } = await loadModule();

  await promptForReplies('SECRET FROM CHAT A', { replyCount: 1 });
  await promptForReplies('chat B', { replyCount: 1 });

  const second = fake.used()[1];
  assert.ok(!second.turns.some(t => t.includes('SECRET FROM CHAT A')));
});

test('the previous session is destroyed when the next generate starts', async () => {
  const fake = installFakeModel();
  const { promptForReplies } = await loadModule();

  await promptForReplies('first', { replyCount: 1 });
  const first = fake.used()[0];
  await promptForReplies('second', { replyCount: 1 });

  assert.ok(first.destroyed, 'the finished session was released');
});

test('generate more continues the same session', async () => {
  // Follow-ups are the one place accumulated context is wanted.
  const fake = installFakeModel();
  const { promptForReplies, promptForMoreReplies } = await loadModule();

  await promptForReplies('the conversation', { replyCount: 1 });
  await promptForMoreReplies('more please', {}, 1);

  const used = fake.used();
  assert.equal(used.length, 1, 'no new session for a follow-up');
  assert.deepEqual(used[0].turns, ['the conversation', 'more please']);
});

test('generate more refuses rather than overflowing the quota', async () => {
  const fake = installFakeModel({ quota: 40 });
  const { promptForReplies, promptForMoreReplies, hasSession } = await loadModule();

  await promptForReplies('x'.repeat(38), { replyCount: 1 });

  await assert.rejects(
    () => promptForMoreReplies('more', {}, 1),
    /context is full/i,
    'a turn that cannot fit is refused, so the caller rebuilds instead',
  );
  assert.equal(hasSession(), false, 'and the exhausted session is released');
});

test('reported usage tracks the live session', async () => {
  installFakeModel({ quota: 100 });
  const { promptForReplies, sessionUsage } = await loadModule();

  assert.equal(sessionUsage(), null, 'nothing to report before a session exists');
  await promptForReplies('12345', { replyCount: 1 });

  const usage = sessionUsage();
  assert.equal(usage.used, 5);
  assert.equal(usage.quota, 100);
  assert.equal(usage.ratio, 0.05);
});

test('a wedged session is destroyed rather than reused', async () => {
  // A session that failed mid-turn may have consumed it or be broken outright;
  // reusing it made every later request fail too.
  const fake = installFakeModel({ failOn: (text) => text.includes('boom') });
  const { promptForReplies, hasSession } = await loadModule();

  await assert.rejects(() => promptForReplies('boom', { replyCount: 1 }));
  assert.equal(hasSession(), false);
  assert.ok(fake.sessions.every(s => s.turns.length === 0 || s.destroyed));

  // And the next generate still works.
  await promptForReplies('fine', { replyCount: 1 });
  assert.equal(hasSession(), true);
});

test('works without clone support', async () => {
  const fake = installFakeModel({ supportsClone: false });
  const { promptForReplies } = await loadModule();

  await promptForReplies('one', { replyCount: 1 });
  await promptForReplies('two', { replyCount: 1 });

  const used = fake.used();
  assert.equal(used.length, 2);
  for (const session of used) assert.equal(session.turns.length, 1);
});

test('a missing LanguageModel API is reported clearly', async () => {
  delete globalThis.LanguageModel;
  const { promptForReplies } = await loadModule();
  await assert.rejects(() => promptForReplies('x', {}), /not available/i);
});

test('replies parse out of fenced or prose-wrapped JSON', async () => {
  const sessions = [];
  globalThis.LanguageModel = {
    create: async () => {
      const s = {
        turns: [],
        async prompt() { return '```json\n{"needsReply":false,"reason":"r","summary":"s","replies":["x"]}\n```'; },
        destroy() {},
        clone: async () => s,
      };
      sessions.push(s);
      return s;
    },
  };
  const { promptForReplies } = await loadModule();

  const result = await promptForReplies('x', { replyCount: 1 });
  assert.equal(result.needsReply, false);
  assert.deepEqual(result.replies, ['x']);
});
