import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createDaemonServer } from '../src/daemon/run.js';
import { createFakeDiscordClient } from './support/fakeDiscordClient.js';
import { resetSessions, findBySessionId } from '../src/daemon/sessions.js';
import { resetAttachApprovals } from '../src/daemon/attachApprovals.js';
import { resetPending } from '../src/daemon/pending.js';

let home;

beforeEach(() => {
  home = mkdtempSync(path.join(tmpdir(), 'claude-discord-attach-'));
  process.env.CLAUDE_DISCORD_HOME = home;
  resetSessions();
  resetAttachApprovals();
  resetPending();
});

afterEach(() => {
  delete process.env.CLAUDE_DISCORD_HOME;
  rmSync(home, { recursive: true, force: true });
  resetSessions();
  resetAttachApprovals();
  resetPending();
});

async function startServer(deps) {
  const server = createDaemonServer(deps);
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  return server;
}

async function postAttach(port, body) {
  return fetch(`http://127.0.0.1:${port}/attach`, {
    method: 'POST',
    body: JSON.stringify(body),
  });
}

describe('POST /attach', () => {
  it('registers a pending-approval session, creates a thread, and posts a reactable context message', async () => {
    const { writeConfig } = await import('../src/config.js');
    writeConfig({ port: 0, token: 'bot-token', guildId: 'g1', channelId: 'chan-1' });

    const discordClient = createFakeDiscordClient();
    const server = await startServer({ discordClient });
    const { port } = server.address();

    try {
      const res = await postAttach(port, {
        sessionId: 'sess-1',
        projectName: 'my-project',
        cwd: '/home/x/my-project',
        tmuxTarget: 'main:1.0',
      });
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body).toMatchObject({ sessionId: 'sess-1', threadId: expect.stringMatching(/^thread-/) });

      const record = findBySessionId('sess-1');
      expect(record).toMatchObject({
        sessionId: 'sess-1',
        projectName: 'my-project',
        cwd: '/home/x/my-project',
        tmuxTarget: 'main:1.0',
        threadId: body.threadId,
        status: 'pending-approval',
      });

      const thread = await discordClient.channels.fetch(body.threadId);
      expect(thread.messages).toHaveLength(1);
      const message = thread.messages[0];
      expect(message.content).toContain('my-project');
      expect(message.content).toContain('/home/x/my-project');
      expect(message.content).toContain('main:1.0');
      expect(message.reactions).toEqual(['✅', '❌']);
    } finally {
      await new Promise((resolve) => server.close(resolve));
    }
  });

  it('rejects an attach request missing required fields', async () => {
    const discordClient = createFakeDiscordClient();
    const server = await startServer({ discordClient });
    const { port } = server.address();

    try {
      const res = await postAttach(port, { sessionId: 'sess-1' });
      expect(res.status).toBe(400);
    } finally {
      await new Promise((resolve) => server.close(resolve));
    }
  });

  it('503s when no discord client is connected', async () => {
    const server = await startServer({});
    const { port } = server.address();

    try {
      const res = await postAttach(port, { sessionId: 'sess-1', projectName: 'p', cwd: '/p', tmuxTarget: 'tm' });
      expect(res.status).toBe(503);
    } finally {
      await new Promise((resolve) => server.close(resolve));
    }
  });

  it('reacting ✅ promotes the session to active, and permission requests then route to its thread', async () => {
    const { writeConfig } = await import('../src/config.js');
    writeConfig({ port: 0, token: 'bot-token', guildId: 'g1', channelId: 'chan-1' });

    const discordClient = createFakeDiscordClient();
    const server = await startServer({ discordClient, safetyTimeoutMs: 400 });
    const { port } = server.address();

    try {
      const attachRes = await postAttach(port, {
        sessionId: 'sess-1',
        projectName: 'my-project',
        cwd: '/x',
        tmuxTarget: 'main:1.0',
      });
      const { threadId } = await attachRes.json();
      const thread = await discordClient.channels.fetch(threadId);
      const approvalMessage = thread.messages[0];

      discordClient.simulateReaction(approvalMessage.id, '✅');
      expect(findBySessionId('sess-1').status).toBe('active');

      const responsePromise = fetch(`http://127.0.0.1:${port}/hook/permission-request`, {
        method: 'POST',
        body: JSON.stringify({ session_id: 'sess-1', tool_name: 'Bash', tool_input: { command: 'echo hi' } }),
      });

      await new Promise((resolve) => setTimeout(resolve, 50));
      expect(thread.messages).toHaveLength(2);
      expect(thread.messages[1].content).toContain('echo hi');

      discordClient.simulateReaction(thread.messages[1].id, '✅');
      const res = await responsePromise;
      expect(await res.json()).toEqual({ decision: 'allow' });
    } finally {
      await new Promise((resolve) => server.close(resolve));
    }
  });

  it('reacting ❌ discards the pending session and posts a confirmation reply; permission requests still defer', async () => {
    const { writeConfig } = await import('../src/config.js');
    writeConfig({ port: 0, token: 'bot-token', guildId: 'g1', channelId: 'chan-1' });

    const discordClient = createFakeDiscordClient();
    const server = await startServer({ discordClient });
    const { port } = server.address();

    try {
      const attachRes = await postAttach(port, {
        sessionId: 'sess-1',
        projectName: 'my-project',
        cwd: '/x',
        tmuxTarget: 'main:1.0',
      });
      const { threadId } = await attachRes.json();
      const thread = await discordClient.channels.fetch(threadId);
      const approvalMessage = thread.messages[0];

      discordClient.simulateReaction(approvalMessage.id, '❌');

      // Fire-and-forget async reply inside the reaction handler.
      await new Promise((resolve) => setTimeout(resolve, 20));

      expect(findBySessionId('sess-1')).toBeNull();
      expect(thread.messages).toHaveLength(2);
      expect(thread.messages[1].content).toMatch(/discard/i);

      const res = await fetch(`http://127.0.0.1:${port}/hook/permission-request`, {
        method: 'POST',
        body: JSON.stringify({ session_id: 'sess-1', tool_name: 'Bash' }),
      });
      expect(await res.json()).toEqual({ decision: 'defer' });
    } finally {
      await new Promise((resolve) => server.close(resolve));
    }
  });

  it('two concurrent attach flows never cross-talk on approval or thread content', async () => {
    const { writeConfig } = await import('../src/config.js');
    writeConfig({ port: 0, token: 'bot-token', guildId: 'g1', channelId: 'chan-1' });

    const discordClient = createFakeDiscordClient();
    const server = await startServer({ discordClient });
    const { port } = server.address();

    try {
      const [resA, resB] = await Promise.all([
        postAttach(port, { sessionId: 'sess-a', projectName: 'project-a', cwd: '/a', tmuxTarget: 'tm-a' }),
        postAttach(port, { sessionId: 'sess-b', projectName: 'project-b', cwd: '/b', tmuxTarget: 'tm-b' }),
      ]);
      const bodyA = await resA.json();
      const bodyB = await resB.json();
      expect(bodyA.threadId).not.toBe(bodyB.threadId);

      const threadA = await discordClient.channels.fetch(bodyA.threadId);
      const threadB = await discordClient.channels.fetch(bodyB.threadId);

      discordClient.simulateReaction(threadA.messages[0].id, '✅');

      expect(findBySessionId('sess-a').status).toBe('active');
      expect(findBySessionId('sess-b').status).toBe('pending-approval');
      expect(threadB.messages).toHaveLength(1);
    } finally {
      await new Promise((resolve) => server.close(resolve));
    }
  });
});
