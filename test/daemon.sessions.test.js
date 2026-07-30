import { describe, it, expect, afterEach } from 'vitest';
import {
  registerPending,
  attachThread,
  promoteToActive,
  registerPendingApproval,
  findByToken,
  findBySessionId,
  findByKey,
  findByThreadId,
  findByTmuxTarget,
  resetSessions,
} from '../src/daemon/sessions.js';

afterEach(() => {
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
      status: 'pending',
    });
  });

  it('attaches a thread id to the pending record', () => {
    registerPending({ token: 't1', projectName: 'proj-a', cwd: '/a', tmuxTarget: 'tm-a' });
    attachThread('t1', 'thread-1');
    expect(findByToken('t1').threadId).toBe('thread-1');
  });

  it('promotes a pending registration to active by session_id, findable by either key', () => {
    registerPending({ token: 't1', projectName: 'proj-a', cwd: '/a', tmuxTarget: 'tm-a' });
    const promoted = promoteToActive('t1', 'sess-1');

    expect(promoted.status).toBe('active');
    expect(promoted.sessionId).toBe('sess-1');
    expect(findByToken('t1')).toBe(promoted);
    expect(findBySessionId('sess-1')).toBe(promoted);
    expect(findByKey('t1')).toBe(promoted);
    expect(findByKey('sess-1')).toBe(promoted);
  });

  it('returns null when promoting an unknown token', () => {
    expect(promoteToActive('missing-token', 'sess-1')).toBeNull();
  });

  it('keeps two concurrently-registered sessions fully independent', () => {
    registerPending({ token: 't1', projectName: 'proj-a', cwd: '/a', tmuxTarget: 'tm-a' });
    registerPending({ token: 't2', projectName: 'proj-b', cwd: '/b', tmuxTarget: 'tm-b' });
    attachThread('t1', 'thread-1');
    attachThread('t2', 'thread-2');
    promoteToActive('t1', 'sess-1');
    promoteToActive('t2', 'sess-2');

    expect(findBySessionId('sess-1')).toMatchObject({ token: 't1', threadId: 'thread-1' });
    expect(findBySessionId('sess-2')).toMatchObject({ token: 't2', threadId: 'thread-2' });
  });

  it('returns null for unknown keys', () => {
    expect(findByToken('nope')).toBeNull();
    expect(findBySessionId('nope')).toBeNull();
    expect(findByKey('nope')).toBeNull();
  });

  it('finds a session by its attached thread id, whether pending or active', () => {
    registerPending({ token: 't1', projectName: 'proj-a', cwd: '/a', tmuxTarget: 'tm-a' });
    attachThread('t1', 'thread-1');
    expect(findByThreadId('thread-1')).toMatchObject({ token: 't1' });

    promoteToActive('t1', 'sess-1');
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
});
