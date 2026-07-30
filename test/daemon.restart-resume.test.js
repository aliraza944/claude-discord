import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync, appendFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createDaemonServer } from '../src/daemon/run.js';
import { createFakeDiscordClient } from './support/fakeDiscordClient.js';
import { registerPending, attachThread, promoteToActive, resetSessions, findBySessionId } from '../src/daemon/sessions.js';
import { resetFeedWatchers } from '../src/daemon/feedWatcher.js';
import { wait } from './support/wait.js';

let home;

beforeEach(() => {
  home = mkdtempSync(path.join(tmpdir(), 'claude-discord-restart-'));
  process.env.CLAUDE_DISCORD_HOME = home;
  resetSessions();
  resetFeedWatchers();
});

afterEach(() => {
  delete process.env.CLAUDE_DISCORD_HOME;
  rmSync(home, { recursive: true, force: true });
  resetSessions();
  resetFeedWatchers();
});

async function startServer(deps) {
  const server = createDaemonServer(deps);
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  return server;
}

describe('daemon restart resumes the live feed for still-active sessions', () => {
  it('rehydrates a persisted active session and resumes its feed, tailing only from the current point onward', async () => {
    const transcriptPath = path.join(home, 'transcript.jsonl');
    writeFileSync(transcriptPath, '');

    // The real Discord connection/thread survives a daemon restart even
    // though the daemon's own in-memory process state doesn't — so the same
    // fake client instance stands in for "Discord" across both servers.
    const discordClient = createFakeDiscordClient();
    const thread = await discordClient.channels.fetch('chan-1').then((c) => c.threads.create({ name: 'p1' }));

    // "Process 1": register + promote to active, which persists the active
    // session (including transcriptPath/threadId) to state.json.
    registerPending({ token: 'tok-1', projectName: 'p1', cwd: '/p1', tmuxTarget: 'tm-1' });
    attachThread('tok-1', thread.id);
    await promoteToActive('tok-1', 'sess-1', transcriptPath);

    const server1 = await startServer({ discordClient });
    await new Promise((resolve) => server1.close(resolve));

    // Content appended while "process 1" is down must never be backfilled —
    // only entries appended after "process 2" starts its fresh tail should post.
    appendFileSync(transcriptPath, `${JSON.stringify({ type: 'assistant', message: { content: [{ type: 'text', text: 'during downtime' }] } })}\n`);

    // Simulate the daemon process actually restarting: in-memory registry
    // and any running watchers are gone, but state.json on disk survives.
    resetSessions();
    resetFeedWatchers();
    expect(findBySessionId('sess-1')).toBeNull();

    const server2 = await startServer({ discordClient });
    try {
      // Boot resumed the session into the registry as active.
      expect(findBySessionId('sess-1')).toMatchObject({ sessionId: 'sess-1', status: 'active', transcriptPath });

      await wait(200);
      expect(thread.messages).toHaveLength(0); // the downtime entry was never backfilled

      appendFileSync(transcriptPath, `${JSON.stringify({ type: 'assistant', message: { content: [{ type: 'text', text: 'after restart' }] } })}\n`);
      await wait(250);
      expect(thread.messages.map((m) => m.content)).toEqual(['after restart']);
    } finally {
      await new Promise((resolve) => server2.close(resolve));
    }
  });

  it('never resumes a session that was only pending/pending-approval (never became active) before restart', async () => {
    registerPending({ token: 'tok-1', projectName: 'p1', cwd: '/p1', tmuxTarget: 'tm-1' });
    attachThread('tok-1', 'thread-1');
    // Never promoted to active — nothing should be persisted or resumed.

    resetSessions();
    const discordClient = createFakeDiscordClient();
    const server = await startServer({ discordClient });
    try {
      expect(findBySessionId('sess-1')).toBeNull();
    } finally {
      await new Promise((resolve) => server.close(resolve));
    }
  });
});
