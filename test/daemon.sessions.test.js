import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import {
  registerPending,
  attachThread,
  promoteToActive,
  registerPendingApproval,
  approveSession,
  removeSession,
  restoreSession,
  readPersistedActiveSessions,
  findByToken,
  findBySessionId,
  findByKey,
  findByThreadId,
  findByTmuxTarget,
  resetSessions,
} from '../src/daemon/sessions.js';

let home;

beforeEach(() => {
  home = mkdtempSync(path.join(tmpdir(), 'claude-discord-sessions-'));
  process.env.CLAUDE_DISCORD_HOME = home;
  resetSessions();
});

afterEach(() => {
  delete process.env.CLAUDE_DISCORD_HOME;
  rmSync(home, { recursive: true, force: true });
  resetSessions();
});

describe('daemon/sessions.js', () => {
  it('registers a pending session by token', () => {
    registerPending({ token: 't1', projectName: 'proj-a', cwd: '/a', tmuxTarget: 'tm-a' });
    const record = findByToken('t1');
    expect(record).toMatchObject({
      token: 't1',
      projectName: 'proj-a',
      cwd: '/a',
      tmuxTarget: 'tm-a',
      sessionId: null,
      threadId: null,
      transcriptPath: null,
      status: 'pending',
    });
  });

  it('attaches a thread id to the pending record', () => {
    registerPending({ token: 't1', projectName: 'proj-a', cwd: '/a', tmuxTarget: 'tm-a' });
    attachThread('t1', 'thread-1');
    expect(findByToken('t1').threadId).toBe('thread-1');
  });

  it('promotes a pending registration to active by session_id, findable by either key', async () => {
    registerPending({ token: 't1', projectName: 'proj-a', cwd: '/a', tmuxTarget: 'tm-a' });
    const promoted = await promoteToActive('t1', 'sess-1', '/path/to/transcript.jsonl');

    expect(promoted.status).toBe('active');
    expect(promoted.sessionId).toBe('sess-1');
    expect(promoted.transcriptPath).toBe('/path/to/transcript.jsonl');
    expect(findByToken('t1')).toBe(promoted);
    expect(findBySessionId('sess-1')).toBe(promoted);
    expect(findByKey('t1')).toBe(promoted);
    expect(findByKey('sess-1')).toBe(promoted);
  });

  it('returns null when promoting an unknown token', async () => {
    expect(await promoteToActive('missing-token', 'sess-1')).toBeNull();
  });

  it('keeps two concurrently-registered sessions fully independent', async () => {
    registerPending({ token: 't1', projectName: 'proj-a', cwd: '/a', tmuxTarget: 'tm-a' });
    registerPending({ token: 't2', projectName: 'proj-b', cwd: '/b', tmuxTarget: 'tm-b' });
    attachThread('t1', 'thread-1');
    attachThread('t2', 'thread-2');
    await promoteToActive('t1', 'sess-1');
    await promoteToActive('t2', 'sess-2');

    expect(findBySessionId('sess-1')).toMatchObject({ token: 't1', threadId: 'thread-1' });
    expect(findBySessionId('sess-2')).toMatchObject({ token: 't2', threadId: 'thread-2' });
  });

  it('returns null for unknown keys', () => {
    expect(findByToken('nope')).toBeNull();
    expect(findBySessionId('nope')).toBeNull();
    expect(findByKey('nope')).toBeNull();
  });

  it('finds a session by its attached thread id, whether pending or active', async () => {
    registerPending({ token: 't1', projectName: 'proj-a', cwd: '/a', tmuxTarget: 'tm-a' });
    attachThread('t1', 'thread-1');
    expect(findByThreadId('thread-1')).toMatchObject({ token: 't1' });

    await promoteToActive('t1', 'sess-1');
    expect(findByThreadId('thread-1')).toMatchObject({ token: 't1', sessionId: 'sess-1' });
  });

  it('a thread id only ever resolves to its own session, never another', () => {
    registerPending({ token: 't1', projectName: 'proj-a', cwd: '/a', tmuxTarget: 'tm-a' });
    registerPending({ token: 't2', projectName: 'proj-b', cwd: '/b', tmuxTarget: 'tm-b' });
    attachThread('t1', 'thread-1');
    attachThread('t2', 'thread-2');

    expect(findByThreadId('thread-1')).toMatchObject({ token: 't1' });
    expect(findByThreadId('thread-2')).toMatchObject({ token: 't2' });
  });

  it('returns null for an unknown thread id', () => {
    expect(findByThreadId('no-such-thread')).toBeNull();
  });

  it('finds a session by its tmux target, across both registration paths', () => {
    registerPending({ token: 't1', projectName: 'proj-a', cwd: '/a', tmuxTarget: 'tm-a' });
    registerPendingApproval({ sessionId: 'sess-2', projectName: 'proj-b', cwd: '/b', tmuxTarget: 'tm-b' });

    expect(findByTmuxTarget('tm-a')).toMatchObject({ token: 't1' });
    expect(findByTmuxTarget('tm-b')).toMatchObject({ sessionId: 'sess-2' });
  });

  it('returns null for an unknown tmux target', () => {
    expect(findByTmuxTarget('no-such-target')).toBeNull();
  });

  describe('active-session persistence (for daemon-restart resume)', () => {
    it('persists a session to state.json once it becomes active via promoteToActive', async () => {
      registerPending({ token: 't1', projectName: 'proj-a', cwd: '/a', tmuxTarget: 'tm-a' });
      attachThread('t1', 'thread-1');
      await promoteToActive('t1', 'sess-1', '/transcripts/sess-1.jsonl');

      const persisted = readPersistedActiveSessions();
      expect(persisted).toEqual([
        {
          sessionId: 'sess-1',
          projectName: 'proj-a',
          cwd: '/a',
          tmuxTarget: 'tm-a',
          threadId: 'thread-1',
          transcriptPath: '/transcripts/sess-1.jsonl',
          status: 'active',
        },
      ]);
    });

    it('persists a session to state.json once it becomes active via approveSession', async () => {
      registerPendingApproval({ sessionId: 'sess-1', projectName: 'p1', cwd: '/p1', tmuxTarget: 'tm-1', transcriptPath: '/t.jsonl' });
      attachThread('sess-1', 'thread-1');
      await approveSession('sess-1');

      expect(readPersistedActiveSessions()).toEqual([
        {
          sessionId: 'sess-1',
          projectName: 'p1',
          cwd: '/p1',
          tmuxTarget: 'tm-1',
          threadId: 'thread-1',
          transcriptPath: '/t.jsonl',
          status: 'active',
        },
      ]);
    });

    it('never persists a pending-approval (unapproved) session', () => {
      registerPendingApproval({ sessionId: 'sess-1', projectName: 'p1', cwd: '/p1', tmuxTarget: 'tm-1' });
      expect(readPersistedActiveSessions()).toEqual([]);
    });

    it('removes a session from persisted state once removeSession is called', async () => {
      registerPendingApproval({ sessionId: 'sess-1', projectName: 'p1', cwd: '/p1', tmuxTarget: 'tm-1' });
      attachThread('sess-1', 'thread-1');
      await approveSession('sess-1');
      expect(readPersistedActiveSessions()).toHaveLength(1);

      await removeSession('sess-1');
      expect(readPersistedActiveSessions()).toEqual([]);
    });

    it('restoreSession rehydrates a persisted record into the in-memory registry as active', () => {
      const restored = restoreSession({
        sessionId: 'sess-1',
        projectName: 'p1',
        cwd: '/p1',
        tmuxTarget: 'tm-1',
        threadId: 'thread-1',
        transcriptPath: '/t.jsonl',
        status: 'active',
      });

      expect(restored).toMatchObject({ status: 'active', sessionId: 'sess-1', transcriptPath: '/t.jsonl' });
      expect(findBySessionId('sess-1')).toBe(restored);
    });
  });
});
