import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createDaemonServer } from '../src/daemon/run.js';
import { createFakeDiscordClient } from './support/fakeDiscordClient.js';
import {
  registerPending,
  attachThread,
  promoteToActive,
  registerPendingApproval,
  resetSessions,
} from '../src/daemon/sessions.js';
import { createSessionThread } from '../src/discord/threads.js';
import { setPaused } from '../src/state.js';

let home;

beforeEach(() => {
  home = mkdtempSync(path.join(tmpdir(), 'claude-discord-notification-'));
  process.env.CLAUDE_DISCORD_HOME = home;
  resetSessions();
});

afterEach(() => {
  delete process.env.CLAUDE_DISCORD_HOME;
  rmSync(home, { recursive: true, force: true });
  resetSessions();
});

async function registerActiveSession(discordClient, { token, sessionId, projectName }) {
  registerPending({ token, projectName, cwd: `/${projectName}`, tmuxTarget: `tm-${token}` });
  const thread = await createSessionThread(discordClient, { channelId: 'chan-1', name: projectName });
  attachThread(token, thread.id);
  await promoteToActive(token, sessionId);
  return thread;
}

async function startServer(discordClient) {
  const server = createDaemonServer({ discordClient });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  return server;
}

describe('POST /hook/notification', () => {
  it('posts an FYI message to the session thread', async () => {
    const discordClient = createFakeDiscordClient();
    const thread = await registerActiveSession(discordClient, { token: 'tok-1', sessionId: 'sess-1', projectName: 'p1' });

    const server = await startServer(discordClient);
    const { port } = server.address();

    try {
      const res = await fetch(`http://127.0.0.1:${port}/hook/notification`, {
        method: 'POST',
        body: JSON.stringify({ session_id: 'sess-1', hook_event_name: 'Notification', message: 'Claude is waiting for your input' }),
      });
      expect(res.status).toBe(200);
      expect(thread.messages).toHaveLength(1);
      expect(thread.messages[0].content).toContain('Claude is waiting for your input');
    } finally {
      await new Promise((resolve) => server.close(resolve));
    }
  });

  it('does nothing (200 ok, no discord message) for an unregistered session', async () => {
    const discordClient = createFakeDiscordClient();
    const server = await startServer(discordClient);
    const { port } = server.address();

    try {
      const res = await fetch(`http://127.0.0.1:${port}/hook/notification`, {
        method: 'POST',
        body: JSON.stringify({ session_id: 'unknown-session', message: 'idle' }),
      });
      expect(res.status).toBe(200);
    } finally {
      await new Promise((resolve) => server.close(resolve));
    }
  });

  it('suppresses the notification (200 ok, no discord message) while globally paused', async () => {
    await setPaused(true);
    const discordClient = createFakeDiscordClient();
    const thread = await registerActiveSession(discordClient, { token: 'tok-1', sessionId: 'sess-1', projectName: 'p1' });

    const server = await startServer(discordClient);
    const { port } = server.address();

    try {
      const res = await fetch(`http://127.0.0.1:${port}/hook/notification`, {
        method: 'POST',
        body: JSON.stringify({ session_id: 'sess-1', message: 'idle' }),
      });
      expect(res.status).toBe(200);
      expect(thread.messages).toHaveLength(0);
    } finally {
      await new Promise((resolve) => server.close(resolve));
    }
  });

  it('does nothing (200 ok, no discord message) for a pending-approval (unapproved attach) session even though it already has a thread', async () => {
    const discordClient = createFakeDiscordClient();
    registerPendingApproval({ sessionId: 'sess-1', projectName: 'p1', cwd: '/p1', tmuxTarget: 'tm-1' });
    const thread = await createSessionThread(discordClient, { channelId: 'chan-1', name: 'p1' });
    attachThread('sess-1', thread.id);

    const server = await startServer(discordClient);
    const { port } = server.address();

    try {
      const res = await fetch(`http://127.0.0.1:${port}/hook/notification`, {
        method: 'POST',
        body: JSON.stringify({ session_id: 'sess-1', message: 'idle' }),
      });
      expect(res.status).toBe(200);
      expect(thread.messages).toHaveLength(0);
    } finally {
      await new Promise((resolve) => server.close(resolve));
    }
  });

  it('a notification for one session never posts to another session thread', async () => {
    const discordClient = createFakeDiscordClient();
    const threadA = await registerActiveSession(discordClient, { token: 'tok-1', sessionId: 'sess-1', projectName: 'p1' });
    const threadB = await registerActiveSession(discordClient, { token: 'tok-2', sessionId: 'sess-2', projectName: 'p2' });

    const server = await startServer(discordClient);
    const { port } = server.address();

    try {
      await fetch(`http://127.0.0.1:${port}/hook/notification`, {
        method: 'POST',
        body: JSON.stringify({ session_id: 'sess-1', message: 'only for session 1' }),
      });

      expect(threadA.messages).toHaveLength(1);
      expect(threadB.messages).toHaveLength(0);
    } finally {
      await new Promise((resolve) => server.close(resolve));
    }
  });
});
