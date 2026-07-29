import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createFakeDiscordClient } from './support/fakeDiscordClient.js';
import { resetSessions, findByToken } from '../src/daemon/sessions.js';

let home;

beforeEach(() => {
  home = mkdtempSync(path.join(tmpdir(), 'claude-discord-register-'));
  process.env.CLAUDE_DISCORD_HOME = home;
  resetSessions();
});

afterEach(() => {
  delete process.env.CLAUDE_DISCORD_HOME;
  rmSync(home, { recursive: true, force: true });
  resetSessions();
});

async function startServer(deps) {
  const { createDaemonServer } = await import('../src/daemon/run.js');
  const server = createDaemonServer(deps);
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  return server;
}

describe('POST /register', () => {
  it('creates a thread named for the project and registers the session as pending', async () => {
    const { writeConfig } = await import('../src/config.js');
    writeConfig({ port: 0, token: 'bot-token', guildId: 'g1', channelId: 'chan-1' });

    const discordClient = createFakeDiscordClient();
    const server = await startServer({ discordClient });
    const { port } = server.address();

    try {
      const res = await fetch(`http://127.0.0.1:${port}/register`, {
        method: 'POST',
        body: JSON.stringify({ token: 'tok-1', projectName: 'my-project', cwd: '/home/x/my-project', tmuxTarget: 'tm-1' }),
      });
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.token).toBe('tok-1');
      expect(body.threadId).toMatch(/^thread-/);

      const record = findByToken('tok-1');
      expect(record).toMatchObject({
        token: 'tok-1',
        projectName: 'my-project',
        cwd: '/home/x/my-project',
        tmuxTarget: 'tm-1',
        threadId: body.threadId,
        status: 'pending',
      });
    } finally {
      await new Promise((resolve) => server.close(resolve));
    }
  });

  it('rejects a registration missing required fields', async () => {
    const discordClient = createFakeDiscordClient();
    const server = await startServer({ discordClient });
    const { port } = server.address();

    try {
      const res = await fetch(`http://127.0.0.1:${port}/register`, {
        method: 'POST',
        body: JSON.stringify({ token: 'tok-1' }),
      });
      expect(res.status).toBe(400);
    } finally {
      await new Promise((resolve) => server.close(resolve));
    }
  });

  it('503s when no discord client is connected', async () => {
    const server = await startServer({});
    const { port } = server.address();

    try {
      const res = await fetch(`http://127.0.0.1:${port}/register`, {
        method: 'POST',
        body: JSON.stringify({ token: 'tok-1', projectName: 'p', cwd: '/p', tmuxTarget: 'tm' }),
      });
      expect(res.status).toBe(503);
    } finally {
      await new Promise((resolve) => server.close(resolve));
    }
  });

  it('two concurrent registrations against different projects produce two distinct threads and independent registry entries', async () => {
    const { writeConfig } = await import('../src/config.js');
    writeConfig({ port: 0, token: 'bot-token', guildId: 'g1', channelId: 'chan-1' });

    const discordClient = createFakeDiscordClient();
    const server = await startServer({ discordClient });
    const { port } = server.address();

    try {
      const [resA, resB] = await Promise.all([
        fetch(`http://127.0.0.1:${port}/register`, {
          method: 'POST',
          body: JSON.stringify({ token: 'tok-a', projectName: 'project-a', cwd: '/a', tmuxTarget: 'tm-a' }),
        }),
        fetch(`http://127.0.0.1:${port}/register`, {
          method: 'POST',
          body: JSON.stringify({ token: 'tok-b', projectName: 'project-b', cwd: '/b', tmuxTarget: 'tm-b' }),
        }),
      ]);
      const bodyA = await resA.json();
      const bodyB = await resB.json();

      expect(bodyA.threadId).not.toBe(bodyB.threadId);
      expect(findByToken('tok-a')).toMatchObject({ projectName: 'project-a', threadId: bodyA.threadId });
      expect(findByToken('tok-b')).toMatchObject({ projectName: 'project-b', threadId: bodyB.threadId });
    } finally {
      await new Promise((resolve) => server.close(resolve));
    }
  });
});
