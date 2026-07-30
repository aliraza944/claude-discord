import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createDaemonServer } from '../src/daemon/run.js';
import { createFakeDiscordClient } from './support/fakeDiscordClient.js';
import { registerPendingApproval, attachThread, approveSession, findBySessionId } from '../src/daemon/sessions.js';
import { resetSessions } from '../src/daemon/sessions.js';

let home;

beforeEach(() => {
  home = mkdtempSync(path.join(tmpdir(), 'claude-discord-detach-'));
  process.env.CLAUDE_DISCORD_HOME = home;
  resetSessions();
});

afterEach(() => {
  delete process.env.CLAUDE_DISCORD_HOME;
  rmSync(home, { recursive: true, force: true });
  resetSessions();
});

async function startServer(deps) {
  const server = createDaemonServer(deps);
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  return server;
}

async function postDetach(port, body) {
  return fetch(`http://127.0.0.1:${port}/detach`, {
    method: 'POST',
    body: JSON.stringify(body),
  });
}

describe('POST /detach', () => {
  it('removes an attached session by tmux target and posts a farewell message to its thread', async () => {
    const discordClient = createFakeDiscordClient();
    registerPendingApproval({ sessionId: 'sess-1', projectName: 'p1', cwd: '/p1', tmuxTarget: 'tm-1' });
    const thread = await discordClient.channels.fetch('chan-1').then((c) => c.threads.create({ name: 'p1' }));
    attachThread('sess-1', thread.id);
    approveSession('sess-1');

    const server = await startServer({ discordClient });
    const { port } = server.address();

    try {
      const res = await postDetach(port, { tmuxTarget: 'tm-1' });
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body).toMatchObject({ detached: true, sessionId: 'sess-1', threadId: thread.id });

      expect(findBySessionId('sess-1')).toBeNull();
      expect(thread.messages).toHaveLength(1);
      expect(thread.messages[0].content).toMatch(/detach/i);
    } finally {
      await new Promise((resolve) => server.close(resolve));
    }
  });

  it('makes a permission-request for the detached session defer again', async () => {
    const discordClient = createFakeDiscordClient();
    registerPendingApproval({ sessionId: 'sess-1', projectName: 'p1', cwd: '/p1', tmuxTarget: 'tm-1' });
    const thread = await discordClient.channels.fetch('chan-1').then((c) => c.threads.create({ name: 'p1' }));
    attachThread('sess-1', thread.id);
    approveSession('sess-1');

    const server = await startServer({ discordClient });
    const { port } = server.address();

    try {
      await postDetach(port, { tmuxTarget: 'tm-1' });

      const res = await fetch(`http://127.0.0.1:${port}/hook/permission-request`, {
        method: 'POST',
        body: JSON.stringify({ session_id: 'sess-1', tool_name: 'Bash' }),
      });
      expect(await res.json()).toEqual({ decision: 'defer' });
    } finally {
      await new Promise((resolve) => server.close(resolve));
    }
  });

  it('rejects a detach request missing tmuxTarget', async () => {
    const discordClient = createFakeDiscordClient();
    const server = await startServer({ discordClient });
    const { port } = server.address();

    try {
      const res = await postDetach(port, {});
      expect(res.status).toBe(400);
    } finally {
      await new Promise((resolve) => server.close(resolve));
    }
  });

  it('still removes the session from the registry when no discord client is connected, without posting or crashing', async () => {
    registerPendingApproval({ sessionId: 'sess-1', projectName: 'p1', cwd: '/p1', tmuxTarget: 'tm-1' });
    attachThread('sess-1', 'thread-1');
    approveSession('sess-1');

    const server = await startServer({});
    const { port } = server.address();

    try {
      const res = await postDetach(port, { tmuxTarget: 'tm-1' });
      expect(res.status).toBe(200);
      expect(await res.json()).toMatchObject({ detached: true, sessionId: 'sess-1' });
      expect(findBySessionId('sess-1')).toBeNull();
    } finally {
      await new Promise((resolve) => server.close(resolve));
    }
  });

  it('reports no match (200, detached: false) for a tmux target with no attached session', async () => {
    const discordClient = createFakeDiscordClient();
    const server = await startServer({ discordClient });
    const { port } = server.address();

    try {
      const res = await postDetach(port, { tmuxTarget: 'no-such-target' });
      expect(res.status).toBe(200);
      expect(await res.json()).toEqual({ detached: false });
    } finally {
      await new Promise((resolve) => server.close(resolve));
    }
  });

  it('detaching one session leaves another session in a different pane completely unaffected', async () => {
    const discordClient = createFakeDiscordClient();
    registerPendingApproval({ sessionId: 'sess-1', projectName: 'p1', cwd: '/p1', tmuxTarget: 'tm-1' });
    registerPendingApproval({ sessionId: 'sess-2', projectName: 'p2', cwd: '/p2', tmuxTarget: 'tm-2' });
    const threadA = await discordClient.channels.fetch('chan-1').then((c) => c.threads.create({ name: 'p1' }));
    const threadB = await discordClient.channels.fetch('chan-1').then((c) => c.threads.create({ name: 'p2' }));
    attachThread('sess-1', threadA.id);
    attachThread('sess-2', threadB.id);
    approveSession('sess-1');
    approveSession('sess-2');

    const server = await startServer({ discordClient });
    const { port } = server.address();

    try {
      await postDetach(port, { tmuxTarget: 'tm-1' });

      expect(findBySessionId('sess-1')).toBeNull();
      const remaining = findBySessionId('sess-2');
      expect(remaining).toMatchObject({ sessionId: 'sess-2', threadId: threadB.id, status: 'active' });
      expect(threadB.messages).toHaveLength(0);
    } finally {
      await new Promise((resolve) => server.close(resolve));
    }
  });
});
