import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createDaemonServer } from '../src/daemon/run.js';
import { createFakeDiscordClient } from './support/fakeDiscordClient.js';
import { registerPending, attachThread, promoteToActive, resetSessions } from '../src/daemon/sessions.js';
import { resetPending } from '../src/daemon/pending.js';
import { setPaused } from '../src/state.js';
import { createSessionThread } from '../src/discord/threads.js';

let home;

beforeEach(() => {
  home = mkdtempSync(path.join(tmpdir(), 'claude-discord-permission-'));
  process.env.CLAUDE_DISCORD_HOME = home;
  resetSessions();
  resetPending();
});

afterEach(async () => {
  delete process.env.CLAUDE_DISCORD_HOME;
  rmSync(home, { recursive: true, force: true });
  resetSessions();
  resetPending();
});

async function registerActiveSession(discordClient, { token, sessionId, projectName }) {
  registerPending({ token, projectName, cwd: `/${projectName}`, tmuxTarget: `tm-${token}` });
  const thread = await createSessionThread(discordClient, { channelId: 'chan-1', name: projectName });
  attachThread(token, thread.id);
  promoteToActive(token, sessionId);
  return thread;
}

async function startServer(discordClient, extraDeps = {}) {
  const server = createDaemonServer({ discordClient, ...extraDeps });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  return server;
}

describe('POST /hook/permission-request', () => {
  it('defers immediately (no discord message) for an unregistered session', async () => {
    const discordClient = createFakeDiscordClient();
    const server = await startServer(discordClient);
    const { port } = server.address();

    try {
      const res = await fetch(`http://127.0.0.1:${port}/hook/permission-request`, {
        method: 'POST',
        body: JSON.stringify({ session_id: 'unknown-session', tool_name: 'Bash' }),
      });
      expect(await res.json()).toEqual({ decision: 'defer' });
    } finally {
      await new Promise((resolve) => server.close(resolve));
    }
  });

  it('defers immediately (no discord message) when globally paused', async () => {
    await setPaused(true);
    const discordClient = createFakeDiscordClient();
    await registerActiveSession(discordClient, { token: 'tok-1', sessionId: 'sess-1', projectName: 'p1' });

    const server = await startServer(discordClient);
    const { port } = server.address();

    try {
      const res = await fetch(`http://127.0.0.1:${port}/hook/permission-request`, {
        method: 'POST',
        body: JSON.stringify({ session_id: 'sess-1', tool_name: 'Bash' }),
      });
      expect(await res.json()).toEqual({ decision: 'defer' });
    } finally {
      await new Promise((resolve) => server.close(resolve));
    }
  });

  it('posts a reactable message and resolves allow when ✅ is reacted', async () => {
    const discordClient = createFakeDiscordClient();
    const thread = await registerActiveSession(discordClient, { token: 'tok-1', sessionId: 'sess-1', projectName: 'p1' });

    const server = await startServer(discordClient);
    const { port } = server.address();

    try {
      const responsePromise = fetch(`http://127.0.0.1:${port}/hook/permission-request`, {
        method: 'POST',
        body: JSON.stringify({ session_id: 'sess-1', tool_name: 'Bash' }),
      });

      // Give the route a tick to post the message and register as pending.
      await new Promise((resolve) => setTimeout(resolve, 50));
      expect(thread.messages).toHaveLength(1);
      const message = thread.messages[0];
      expect(message.reactions).toEqual(['✅', '❌']);

      discordClient.simulateReaction(message.id, '✅');

      const res = await responsePromise;
      expect(await res.json()).toEqual({ decision: 'allow' });
    } finally {
      await new Promise((resolve) => server.close(resolve));
    }
  });

  it('resolves deny when ❌ is reacted', async () => {
    const discordClient = createFakeDiscordClient();
    const thread = await registerActiveSession(discordClient, { token: 'tok-1', sessionId: 'sess-1', projectName: 'p1' });

    const server = await startServer(discordClient);
    const { port } = server.address();

    try {
      const responsePromise = fetch(`http://127.0.0.1:${port}/hook/permission-request`, {
        method: 'POST',
        body: JSON.stringify({ session_id: 'sess-1', tool_name: 'Bash' }),
      });

      await new Promise((resolve) => setTimeout(resolve, 50));
      const message = thread.messages[0];

      discordClient.simulateReaction(message.id, '❌');

      const res = await responsePromise;
      expect(await res.json()).toEqual({ decision: 'deny' });
    } finally {
      await new Promise((resolve) => server.close(resolve));
    }
  });

  it('resolves as defer once the safety timeout elapses without a reaction', async () => {
    const discordClient = createFakeDiscordClient();
    await registerActiveSession(discordClient, { token: 'tok-1', sessionId: 'sess-1', projectName: 'p1' });

    const server = await startServer(discordClient, { safetyTimeoutMs: 50 });
    const { port } = server.address();

    try {
      const res = await fetch(`http://127.0.0.1:${port}/hook/permission-request`, {
        method: 'POST',
        body: JSON.stringify({ session_id: 'sess-1', tool_name: 'Bash' }),
      });
      expect(await res.json()).toEqual({ decision: 'defer' });
    } finally {
      await new Promise((resolve) => server.close(resolve));
    }
  });

  it('a reaction on one session thread message never resolves another session pending request', async () => {
    const discordClient = createFakeDiscordClient();
    const threadA = await registerActiveSession(discordClient, { token: 'tok-1', sessionId: 'sess-1', projectName: 'p1' });
    const threadB = await registerActiveSession(discordClient, { token: 'tok-2', sessionId: 'sess-2', projectName: 'p2' });

    const server = await startServer(discordClient, { safetyTimeoutMs: 400 });
    const { port } = server.address();

    try {
      const responseA = fetch(`http://127.0.0.1:${port}/hook/permission-request`, {
        method: 'POST',
        body: JSON.stringify({ session_id: 'sess-1', tool_name: 'Bash' }),
      });
      const responseB = fetch(`http://127.0.0.1:${port}/hook/permission-request`, {
        method: 'POST',
        body: JSON.stringify({ session_id: 'sess-2', tool_name: 'Write' }),
      });

      await new Promise((resolve) => setTimeout(resolve, 50));
      const messageA = threadA.messages[0];
      const messageB = threadB.messages[0];
      expect(messageA.id).not.toBe(messageB.id);

      // React on A only. B has no reaction and must resolve via its own
      // safety timeout as defer, never as a side effect of A's reaction.
      discordClient.simulateReaction(messageA.id, '✅');

      const [resA, resB] = await Promise.all([responseA, responseB]);
      expect(await resA.json()).toEqual({ decision: 'allow' });
      expect(await resB.json()).toEqual({ decision: 'defer' });
    } finally {
      await new Promise((resolve) => server.close(resolve));
    }
  });
});
