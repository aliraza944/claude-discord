import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync, appendFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createDaemonServer } from '../src/daemon/run.js';
import {
  registerPending,
  attachThread,
  findByToken,
  findBySessionId,
  registerPendingApproval,
  approveSession,
  resetSessions,
} from '../src/daemon/sessions.js';
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

  it('re-promoting the same token to a new session_id (e.g. /clear) retires the old watcher and tails the new transcript', async () => {
    const oldTranscriptPath = path.join(home, 'old-transcript.jsonl');
    const newTranscriptPath = path.join(home, 'new-transcript.jsonl');
    writeFileSync(oldTranscriptPath, '');
    writeFileSync(newTranscriptPath, '');

    registerPending({ token: 'tok-1', projectName: 'p', cwd: '/p', tmuxTarget: 'tm-1' });
    const discordClient = createFakeDiscordClient();
    const thread = await discordClient.channels.fetch('chan-1').then((c) => c.threads.create({ name: 'p' }));
    attachThread('tok-1', thread.id);

    const server = await startServer({ discordClient });
    const { port } = server.address();

    try {
      await fetch(`http://127.0.0.1:${port}/hook/session-start`, {
        method: 'POST',
        body: JSON.stringify({ token: 'tok-1', session_id: 'sess-1', transcript_path: oldTranscriptPath }),
      });
      await wait(200);

      const res = await fetch(`http://127.0.0.1:${port}/hook/session-start`, {
        method: 'POST',
        body: JSON.stringify({ token: 'tok-1', session_id: 'sess-2', transcript_path: newTranscriptPath }),
      });
      expect(res.status).toBe(200);
      expect(findBySessionId('sess-2')).toMatchObject({ transcriptPath: newTranscriptPath });
      expect(findBySessionId('sess-1')).toBeNull(); // stale duplicate is dropped, not left dangling

      // The old transcript growing after the restart must not produce messages.
      appendFileSync(oldTranscriptPath, `${JSON.stringify({ type: 'assistant', message: { content: [{ type: 'text', text: 'stale, watcher should be stopped' }] } })}\n`);
      appendFileSync(newTranscriptPath, `${JSON.stringify({ type: 'assistant', message: { content: [{ type: 'text', text: 'from the new session' }] } })}\n`);
      await wait(250);

      expect(thread.messages.map((m) => m.content)).toEqual(['from the new session']);
    } finally {
      await new Promise((resolve) => server.close(resolve));
    }
  });

  it('re-fires for an attach-registered (token-less) session by cwd, e.g. /clear on an attached session', async () => {
    const oldTranscriptPath = path.join(home, 'attach-old-transcript.jsonl');
    const newTranscriptPath = path.join(home, 'attach-new-transcript.jsonl');
    writeFileSync(oldTranscriptPath, '');
    writeFileSync(newTranscriptPath, '');

    registerPendingApproval({ sessionId: 'sess-1', projectName: 'p', cwd: '/p', tmuxTarget: 'tm-1', transcriptPath: oldTranscriptPath });
    const discordClient = createFakeDiscordClient();
    const thread = await discordClient.channels.fetch('chan-1').then((c) => c.threads.create({ name: 'p' }));
    attachThread('sess-1', thread.id);
    await approveSession('sess-1');

    const server = await startServer({ discordClient });
    const { port } = server.address();

    try {
      // /clear hands Claude Code a new session_id; the hook has no token
      // for an attach-registered session, only cwd + tmux_target.
      const res = await fetch(`http://127.0.0.1:${port}/hook/session-start`, {
        method: 'POST',
        body: JSON.stringify({ token: undefined, session_id: 'sess-2', transcript_path: newTranscriptPath, cwd: '/p', tmux_target: 'tm-1' }),
      });
      expect(res.status).toBe(200);
      expect(findBySessionId('sess-2')).toMatchObject({ transcriptPath: newTranscriptPath, threadId: thread.id });
      expect(findBySessionId('sess-1')).toBeNull();

      appendFileSync(oldTranscriptPath, `${JSON.stringify({ type: 'assistant', message: { content: [{ type: 'text', text: 'stale, watcher should be stopped' }] } })}\n`);
      appendFileSync(newTranscriptPath, `${JSON.stringify({ type: 'assistant', message: { content: [{ type: 'text', text: 'from the re-attached session' }] } })}\n`);
      await wait(250);

      expect(thread.messages.map((m) => m.content)).toEqual(['from the re-attached session']);
    } finally {
      await new Promise((resolve) => server.close(resolve));
    }
  });

  it('re-fires by cwd + tmux_target, not cwd alone, so a second active session in the same project directory is never rebound instead', async () => {
    // Regression test: an orphaned active record from an earlier failed
    // rebind (or simply a second tmux pane) sharing the same cwd must not
    // be mistaken for the pane that actually re-fired SessionStart.
    const otherPaneTranscriptPath = path.join(home, 'other-pane-transcript.jsonl');
    const oldTranscriptPath = path.join(home, 'this-pane-old-transcript.jsonl');
    const newTranscriptPath = path.join(home, 'this-pane-new-transcript.jsonl');
    writeFileSync(otherPaneTranscriptPath, '');
    writeFileSync(oldTranscriptPath, '');
    writeFileSync(newTranscriptPath, '');

    registerPendingApproval({ sessionId: 'other-pane-sess', projectName: 'p', cwd: '/p', tmuxTarget: 'tm-other', transcriptPath: otherPaneTranscriptPath });
    await approveSession('other-pane-sess');

    registerPendingApproval({ sessionId: 'sess-1', projectName: 'p', cwd: '/p', tmuxTarget: 'tm-1', transcriptPath: oldTranscriptPath });
    const discordClient = createFakeDiscordClient();
    const thread = await discordClient.channels.fetch('chan-1').then((c) => c.threads.create({ name: 'p' }));
    attachThread('sess-1', thread.id);
    await approveSession('sess-1');

    const server = await startServer({ discordClient });
    const { port } = server.address();

    try {
      const res = await fetch(`http://127.0.0.1:${port}/hook/session-start`, {
        method: 'POST',
        body: JSON.stringify({ token: undefined, session_id: 'sess-2', transcript_path: newTranscriptPath, cwd: '/p', tmux_target: 'tm-1' }),
      });
      expect(res.status).toBe(200);

      // The pane that fired SessionStart got rebound...
      expect(findBySessionId('sess-2')).toMatchObject({ transcriptPath: newTranscriptPath, tmuxTarget: 'tm-1' });
      expect(findBySessionId('sess-1')).toBeNull();
      // ...and the other pane's session was left untouched, not clobbered.
      expect(findBySessionId('other-pane-sess')).toMatchObject({ transcriptPath: otherPaneTranscriptPath, tmuxTarget: 'tm-other' });
    } finally {
      await new Promise((resolve) => server.close(resolve));
    }
  });

  it('a pending-approval attach session (not yet approved) is never re-correlated by cwd', async () => {
    registerPendingApproval({ sessionId: 'sess-1', projectName: 'p', cwd: '/p', tmuxTarget: 'tm-1' });
    const discordClient = createFakeDiscordClient();
    const server = await startServer({ discordClient });
    const { port } = server.address();

    try {
      const res = await fetch(`http://127.0.0.1:${port}/hook/session-start`, {
        method: 'POST',
        body: JSON.stringify({ token: undefined, session_id: 'sess-2', cwd: '/p' }),
      });
      expect(res.status).toBe(404);
      expect(findBySessionId('sess-1')).toMatchObject({ status: 'pending-approval' }); // untouched
    } finally {
      await new Promise((resolve) => server.close(resolve));
    }
  });
});
