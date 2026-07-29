import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createFakeDiscordClient } from './support/fakeDiscordClient.js';

let home;

beforeEach(() => {
  home = mkdtempSync(path.join(tmpdir(), 'claude-discord-status-'));
  process.env.CLAUDE_DISCORD_HOME = home;
});

afterEach(() => {
  delete process.env.CLAUDE_DISCORD_HOME;
  rmSync(home, { recursive: true, force: true });
});

describe('GET /status', () => {
  it('reports paused and botOnline from the injected discord client', async () => {
    const { createDaemonServer } = await import('../src/daemon/run.js');
    const { setPaused } = await import('../src/state.js');

    const discordClient = createFakeDiscordClient();
    await discordClient.login('fake-token');

    const server = createDaemonServer({ discordClient });
    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
    const { port } = server.address();

    try {
      let res = await fetch(`http://127.0.0.1:${port}/status`);
      let body = await res.json();
      expect(body).toEqual({ paused: false, botOnline: true });

      await setPaused(true);
      res = await fetch(`http://127.0.0.1:${port}/status`);
      body = await res.json();
      expect(body).toEqual({ paused: true, botOnline: true });
    } finally {
      await new Promise((resolve) => server.close(resolve));
    }
  });

  it('reports botOnline: false when no discord client is connected', async () => {
    const { createDaemonServer } = await import('../src/daemon/run.js');
    const server = createDaemonServer({});
    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
    const { port } = server.address();

    try {
      const res = await fetch(`http://127.0.0.1:${port}/status`);
      expect(await res.json()).toEqual({ paused: false, botOnline: false });
    } finally {
      await new Promise((resolve) => server.close(resolve));
    }
  });
});

describe('startDaemon Discord connection', () => {
  it('logs in with the configured token using an injectable client factory', async () => {
    const { writeConfig } = await import('../src/config.js');
    const { startDaemon } = await import('../src/daemon/run.js');

    writeConfig({ port: 0, token: 'fake-token', guildId: 'g1', channelId: 'c1' });

    const fakeClient = createFakeDiscordClient();
    const server = await startDaemon({
      port: 0,
      deps: { createDiscordClient: () => fakeClient },
    });

    try {
      expect(fakeClient.loginCalls).toEqual(['fake-token']);
      expect(server.discordClient).toBe(fakeClient);

      const { port } = server.address();
      const res = await fetch(`http://127.0.0.1:${port}/status`);
      expect(await res.json()).toEqual({ paused: false, botOnline: true });
    } finally {
      await new Promise((resolve) => server.close(resolve));
    }
  });

  it('does not construct a discord client when no token is configured', async () => {
    const { startDaemon } = await import('../src/daemon/run.js');
    let factoryCalled = false;

    const server = await startDaemon({
      port: 0,
      deps: { createDiscordClient: () => ((factoryCalled = true), createFakeDiscordClient()) },
    });

    try {
      expect(factoryCalled).toBe(false);
      expect(server.discordClient).toBeUndefined();
    } finally {
      await new Promise((resolve) => server.close(resolve));
    }
  });
});
