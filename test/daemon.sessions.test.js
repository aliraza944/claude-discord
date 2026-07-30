import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import {
  registerPending,
  attachThread,
  promoteToActive,
  rebindActiveSession,
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
  findActiveByCwd,
  retirePaneSessions,
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

  it('re-promoting a token to a new session_id drops the stale bySessionId entry', async () => {
    registerPending({ token: 't1', projectName: 'proj-a', cwd: '/a', tmuxTarget: 'tm-a' });
    await promoteToActive('t1', 'sess-1', '/old.jsonl');
    const repromoted = await promoteToActive('t1', 'sess-2', '/new.jsonl');

    expect(repromoted).toMatchObject({ sessionId: 'sess-2', transcriptPath: '/new.jsonl' });
    expect(findBySessionId('sess-1')).toBeNull();
    expect(findBySessionId('sess-2')).toBe(repromoted);
    expect(findByToken('t1')).toBe(repromoted);
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

  describe('findActiveByCwd (attach-registered / token-less session correlation)', () => {
    it('finds an active, attach-registered session by cwd + tmuxTarget', async () => {
      registerPendingApproval({ sessionId: 'sess-1', projectName: 'p', cwd: '/p', tmuxTarget: 'tm-1' });
      await approveSession('sess-1');
      expect(findActiveByCwd('/p', 'tm-1')).toMatchObject({ sessionId: 'sess-1', token: null });
    });

    it('does not match a pending-approval (not yet approved) session', () => {
      registerPendingApproval({ sessionId: 'sess-1', projectName: 'p', cwd: '/p', tmuxTarget: 'tm-1' });
      expect(findActiveByCwd('/p', 'tm-1')).toBeNull();
    });

    it('does not match a token-based (start-registered) session, even if active', async () => {
      registerPending({ token: 't1', projectName: 'p', cwd: '/p', tmuxTarget: 'tm-1' });
      await promoteToActive('t1', 'sess-1');
      expect(findActiveByCwd('/p', 'tm-1')).toBeNull();
    });

    it('returns null for an unknown cwd', () => {
      expect(findActiveByCwd('/no-such-cwd', 'tm-1')).toBeNull();
    });

    it('does not match a same-cwd session belonging to a different tmux pane', async () => {
      registerPendingApproval({ sessionId: 'sess-1', projectName: 'p', cwd: '/p', tmuxTarget: 'tm-1' });
      await approveSession('sess-1');
      expect(findActiveByCwd('/p', 'tm-2')).toBeNull();
    });

    it('disambiguates two active sessions sharing a cwd by tmuxTarget, e.g. an orphaned record left by a prior failed rebind', async () => {
      registerPendingApproval({ sessionId: 'sess-1', projectName: 'p', cwd: '/p', tmuxTarget: 'tm-1' });
      await approveSession('sess-1');
      registerPendingApproval({ sessionId: 'sess-2', projectName: 'p', cwd: '/p', tmuxTarget: 'tm-2' });
      await approveSession('sess-2');

      expect(findActiveByCwd('/p', 'tm-1')).toMatchObject({ sessionId: 'sess-1' });
      expect(findActiveByCwd('/p', 'tm-2')).toMatchObject({ sessionId: 'sess-2' });
    });
  });

  describe('retirePaneSessions (attach-flow dedup)', () => {
    it('removes an active, attach-registered record for the same cwd + tmuxTarget and returns it', async () => {
      registerPendingApproval({ sessionId: 'sess-1', projectName: 'p', cwd: '/p', tmuxTarget: 'tm-1', transcriptPath: '/t.jsonl' });
      attachThread('sess-1', 'thread-1');
      await approveSession('sess-1');

      const retired = await retirePaneSessions('/p', 'tm-1');

      expect(retired).toMatchObject([{ sessionId: 'sess-1', threadId: 'thread-1' }]);
      expect(findBySessionId('sess-1')).toBeNull();
    });

    it('removes a still pending-approval record too, not just active ones', async () => {
      registerPendingApproval({ sessionId: 'sess-1', projectName: 'p', cwd: '/p', tmuxTarget: 'tm-1' });

      const retired = await retirePaneSessions('/p', 'tm-1');

      expect(retired).toMatchObject([{ sessionId: 'sess-1' }]);
      expect(findBySessionId('sess-1')).toBeNull();
    });

    it('leaves a token-based (start-registered) session alone', async () => {
      registerPending({ token: 't1', projectName: 'p', cwd: '/p', tmuxTarget: 'tm-1' });
      await promoteToActive('t1', 'sess-1');

      const retired = await retirePaneSessions('/p', 'tm-1');

      expect(retired).toEqual([]);
      expect(findBySessionId('sess-1')).not.toBeNull();
    });

    it('leaves sessions in a different pane untouched', async () => {
      registerPendingApproval({ sessionId: 'sess-1', projectName: 'p', cwd: '/p', tmuxTarget: 'tm-1' });
      await approveSession('sess-1');

      const retired = await retirePaneSessions('/p', 'tm-2');

      expect(retired).toEqual([]);
      expect(findBySessionId('sess-1')).not.toBeNull();
    });

    it('removes every stale record when several accumulated for the same pane', async () => {
      registerPendingApproval({ sessionId: 'sess-1', projectName: 'p', cwd: '/p', tmuxTarget: 'tm-1' });
      await approveSession('sess-1');
      registerPendingApproval({ sessionId: 'sess-2', projectName: 'p', cwd: '/p', tmuxTarget: 'tm-1' });
      await approveSession('sess-2');

      const retired = await retirePaneSessions('/p', 'tm-1');

      expect(retired.map((r) => r.sessionId).sort()).toEqual(['sess-1', 'sess-2']);
      expect(findBySessionId('sess-1')).toBeNull();
      expect(findBySessionId('sess-2')).toBeNull();
    });

    it('un-persists a retired active session from state.json', async () => {
      registerPendingApproval({ sessionId: 'sess-1', projectName: 'p', cwd: '/p', tmuxTarget: 'tm-1' });
      await approveSession('sess-1');
      expect(readPersistedActiveSessions()).toHaveLength(1);

      await retirePaneSessions('/p', 'tm-1');

      expect(readPersistedActiveSessions()).toEqual([]);
    });
  });

  describe('rebindActiveSession (attach-flow /clear re-promotion)', () => {
    it('re-keys an active, attach-registered session to a new session_id and transcriptPath', async () => {
      registerPendingApproval({ sessionId: 'sess-1', projectName: 'p', cwd: '/p', tmuxTarget: 'tm-1', transcriptPath: '/old.jsonl' });
      await approveSession('sess-1');
      const record = findBySessionId('sess-1');

      const rebound = await rebindActiveSession(record, 'sess-2', '/new.jsonl');

      expect(rebound).toMatchObject({ sessionId: 'sess-2', transcriptPath: '/new.jsonl', status: 'active' });
      expect(findBySessionId('sess-1')).toBeNull();
      expect(findBySessionId('sess-2')).toBe(rebound);
    });
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
