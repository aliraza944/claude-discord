import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createDaemonServer } from '../src/daemon/run.js';
import { readStateSync, setPaused } from '../src/state.js';
import { createFakeDiscordClient, componentText } from './support/fakeDiscordClient.js';
import { postAskUserQuestionForm, resetAskQuestionForms } from '../src/discord/askQuestionForm.js';

let home;

beforeEach(() => {
  home = mkdtempSync(path.join(tmpdir(), 'claude-discord-control-'));
  process.env.CLAUDE_DISCORD_HOME = home;
});

afterEach(() => {
  delete process.env.CLAUDE_DISCORD_HOME;
  rmSync(home, { recursive: true, force: true });
  resetAskQuestionForms();
});

async function startServer(deps = {}) {
  const server = createDaemonServer(deps);
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  return server;
}

describe('POST /control/pause and /control/resume', () => {
  it('pause flips paused to true and persists it', async () => {
    const server = await startServer();
    const { port } = server.address();

    try {
      const res = await fetch(`http://127.0.0.1:${port}/control/pause`, { method: 'POST' });
      expect(await res.json()).toEqual({ paused: true });
      expect(readStateSync().paused).toBe(true);
    } finally {
      await new Promise((resolve) => server.close(resolve));
    }
  });

  it('resume flips paused to false and persists it', async () => {
    await setPaused(true);
    const server = await startServer();
    const { port } = server.address();

    try {
      const res = await fetch(`http://127.0.0.1:${port}/control/resume`, { method: 'POST' });
      expect(await res.json()).toEqual({ paused: false });
      expect(readStateSync().paused).toBe(false);
    } finally {
      await new Promise((resolve) => server.close(resolve));
    }
  });

  it('takes effect immediately for a subsequent request with no daemon restart', async () => {
    const server = await startServer();
    const { port } = server.address();

    try {
      await fetch(`http://127.0.0.1:${port}/control/pause`, { method: 'POST' });
      let res = await fetch(`http://127.0.0.1:${port}/status`);
      expect((await res.json()).paused).toBe(true);

      await fetch(`http://127.0.0.1:${port}/control/resume`, { method: 'POST' });
      res = await fetch(`http://127.0.0.1:${port}/status`);
      expect((await res.json()).paused).toBe(false);
    } finally {
      await new Promise((resolve) => server.close(resolve));
    }
  });

  it('pausing disables any in-flight AskUserQuestion form immediately', async () => {
    const discordClient = createFakeDiscordClient();
    const server = await startServer({ discordClient });
    const { port } = server.address();

    try {
      const channel = await discordClient.channels.fetch('chan-1');
      const thread = await channel.threads.create({ name: 't' });
      const message = await postAskUserQuestionForm(discordClient, {
        threadId: thread.id,
        questions: [{ question: 'Pick one', multiSelect: false, options: [{ label: 'A' }] }],
      });

      await fetch(`http://127.0.0.1:${port}/control/pause`, { method: 'POST' });

      expect(componentText(message)).toMatch(/paused/i);
      expect(message.components[2].toJSON().components.every((c) => c.disabled)).toBe(true);
    } finally {
      await new Promise((resolve) => server.close(resolve));
    }
  });
});
