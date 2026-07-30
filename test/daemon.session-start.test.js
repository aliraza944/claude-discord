import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync, appendFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createDaemonServer } from '../src/daemon/run.js';
import { registerPending, attachThread, findByToken, findBySessionId, resetSessions } from '../src/daemon/sessions.js';
import { resetFeedWatchers } from '../src/daemon/feedWatcher.js';
import { createFakeDiscordClient } from './support/fakeDiscordClient.js';
import { wait } from './support/wait.js';

let home;

beforeEach(() => {
  home = mkdtempSync(path.join(tmpdir(), 'claude-discord-session-start-'));
  process.env.CLAUDE_DISCORD_HOME = home;
  resetSessions();
});

afterEach(() => {
  delete process.env.CLAUDE_DISCORD_HOME;
  rmSync(home, { recursive: true, force: true });
  resetSessions();
  resetFeedWatchers();
});

async function startServer(deps = {}) {
  const server = createDaemonServer(deps);
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  return server;
}

describe('POST /hook/session-start', () => {
  it('promotes a pending registration to active by session_id', async () => {
    registerPending({ token: 'tok-1', projectName: 'p', cwd: '/p', tmuxTarget: 'tm-1' });
    const server = await startServer();
    const { port } = server.address();

    try {
      const res = await fetch(`http://127.0.0.1:${port}/hook/session-start`, {
        method: 'POST',
        body: JSON.stringify({ token: 'tok-1', session_id: 'sess-1' }),
      });
      expect(res.status).toBe(200);

      expect(findByToken('tok-1')).toMatchObject({ status: 'active', sessionId: 'sess-1' });
      expect(findBySessionId('sess-1')).toMatchObject({ token: 'tok-1' });
    } finally {
      await new Promise((resolve) => server.close(resolve));
    }
  });

  it('404s for an unknown token', async () => {
    const server = await startServer();
    const { port } = server.address();

    try {
      const res = await fetch(`http://127.0.0.1:${port}/hook/session-start`, {
        method: 'POST',
        body: JSON.stringify({ token: 'no-such-token', session_id: 'sess-1' }),
      });
      expect(res.status).toBe(404);
    } finally {
      await new Promise((resolve) => server.close(resolve));
    }
  });

  it('captures transcript_path and starts a live feed, tailing only from the current point onward', async () => {
    const transcriptPath = path.join(home, 'transcript.jsonl');
    writeFileSync(transcriptPath, `${JSON.stringify({ type: 'assistant', message: { content: [{ type: 'text', text: 'pre-start, should not appear' }] } })}\n`);

    registerPending({ token: 'tok-1', projectName: 'p', cwd: '/p', tmuxTarget: 'tm-1' });
    const discordClient = createFakeDiscordClient();
    const thread = await discordClient.channels.fetch('chan-1').then((c) => c.threads.create({ name: 'p' }));
    attachThread('tok-1', thread.id);

    const server = await startServer({ discordClient });
    const { port } = server.address();

    try {
      const res = await fetch(`http://127.0.0.1:${port}/hook/session-start`, {
        method: 'POST',
        body: JSON.stringify({ token: 'tok-1', session_id: 'sess-1', transcript_path: transcriptPath }),
      });
      expect(res.status).toBe(200);
      expect(findBySessionId('sess-1').transcriptPath).toBe(transcriptPath);

      await wait(200);
      expect(thread.messages).toHaveLength(0); // no backfill of the pre-existing line

      appendFileSync(transcriptPath, `${JSON.stringify({ type: 'assistant', message: { content: [{ type: 'text', text: 'live update' }] } })}\n`);
      await wait(250);
      expect(thread.messages.map((m) => m.content)).toEqual(['live update']);
    } finally {
      await new Promise((resolve) => server.close(resolve));
    }
  });
});
