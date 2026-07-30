import { modifyState, readStateSync } from '../state.js';

/**
 * In-memory registry of Claude Code sessions the daemon knows about. A
 * session starts out pending-by-token (registered by `claude-discord start`
 * before Claude Code has even booted) and is promoted to active-by-session_id
 * once the SessionStart hook reports the real session_id for that token.
 */
const byToken = new Map();
const bySessionId = new Map();

function toPersistedRecord(record) {
  return {
    sessionId: record.sessionId,
    projectName: record.projectName,
    cwd: record.cwd,
    tmuxTarget: record.tmuxTarget,
    threadId: record.threadId,
    transcriptPath: record.transcriptPath ?? null,
    status: record.status,
  };
}

/**
 * Best-effort snapshot of every `active` session into `state.json`'s
 * `sessions` map, so a daemon restart can rehydrate enough to resume feed
 * watchers (see `restoreSession`). Never throws — this is a convenience for
 * restart-resume, not a correctness guarantee for the mutation that
 * triggered it.
 */
async function persistActiveSessions() {
  try {
    const active = {};
    for (const record of bySessionId.values()) {
      if (record.status === 'active') active[record.sessionId] = toPersistedRecord(record);
    }
    await modifyState((state) => ({ ...state, sessions: active }));
  } catch {
    // best-effort only
  }
}

/** Registers a new pending session, keyed by its start-time token. */
export function registerPending({ token, projectName, cwd, tmuxTarget }) {
  const record = {
    token,
    projectName,
    cwd,
    tmuxTarget,
    sessionId: null,
    threadId: null,
    transcriptPath: null,
    status: 'pending',
  };
  byToken.set(token, record);
  return record;
}

/** Attaches the Discord thread id created for this session (by token or session_id). */
export function attachThread(key, threadId) {
  const record = findByKey(key);
  if (record) record.threadId = threadId;
  return record ?? null;
}

/**
 * Registers a session directly by its real `session_id`, bypassing the
 * token + SessionStart-hook promotion dance `registerPending` requires —
 * used by `attach`, which already knows the session's true identity
 * synchronously. Starts life as `pending-approval`, distinct from `pending`
 * (awaiting a hook) and `active` (routing to Discord). `transcriptPath` is
 * already known at attach time (reconstructed from cwd + session_id).
 */
export function registerPendingApproval({ sessionId, projectName, cwd, tmuxTarget, transcriptPath = null }) {
  const record = {
    token: null,
    projectName,
    cwd,
    tmuxTarget,
    sessionId,
    threadId: null,
    transcriptPath,
    status: 'pending-approval',
  };
  bySessionId.set(sessionId, record);
  return record;
}

/** Promotes a `pending-approval` session to `active`, persisting the new active-session snapshot. */
export async function approveSession(sessionId) {
  const record = bySessionId.get(sessionId);
  if (!record) return null;
  record.status = 'active';
  await persistActiveSessions();
  return record;
}

/** Removes a session from the registry entirely (declined attach, or detach), persisting the removal. */
export async function removeSession(sessionId) {
  const record = bySessionId.get(sessionId);
  if (!record) return null;
  bySessionId.delete(sessionId);
  if (record.token) byToken.delete(record.token);
  await persistActiveSessions();
  return record;
}

/**
 * Promotes a pending-by-token registration to active-by-session_id. Stores
 * `transcriptPath` (from the SessionStart hook payload) if given, and
 * persists the new active-session snapshot.
 */
export async function promoteToActive(token, sessionId, transcriptPath) {
  const record = byToken.get(token);
  if (!record) return null;
  record.sessionId = sessionId;
  record.status = 'active';
  if (transcriptPath) record.transcriptPath = transcriptPath;
  bySessionId.set(sessionId, record);
  await persistActiveSessions();
  return record;
}

/**
 * Rehydrates an `active` session persisted in `state.json` back into the
 * in-memory registry — used on daemon boot so still-active sessions (and
 * their feed watchers) survive a restart. Lives only in `bySessionId`,
 * analogous to an `attach`-registered session (no token to resume by).
 */
export function restoreSession(persisted) {
  const record = {
    token: null,
    projectName: persisted.projectName,
    cwd: persisted.cwd,
    tmuxTarget: persisted.tmuxTarget,
    sessionId: persisted.sessionId,
    threadId: persisted.threadId,
    transcriptPath: persisted.transcriptPath ?? null,
    status: 'active',
  };
  bySessionId.set(persisted.sessionId, record);
  return record;
}

/** Every `active` session persisted in state.json, as of the last write. */
export function readPersistedActiveSessions() {
  const { sessions = {} } = readStateSync();
  return Object.values(sessions).filter((record) => record.status === 'active');
}

export function findByToken(token) {
  return byToken.get(token) ?? null;
}

export function findBySessionId(sessionId) {
  return bySessionId.get(sessionId) ?? null;
}

/** Looks up a session by either its token or its promoted session_id. */
export function findByKey(key) {
  return byToken.get(key) ?? bySessionId.get(key) ?? null;
}

/** Looks up a session by its attached Discord thread id, across both maps (attach-registered sessions live only in `bySessionId`). */
export function findByThreadId(threadId) {
  for (const record of byToken.values()) {
    if (record.threadId === threadId) return record;
  }
  for (const record of bySessionId.values()) {
    if (record.threadId === threadId) return record;
  }
  return null;
}

/** Looks up a session by its tmux target, across both maps. */
export function findByTmuxTarget(tmuxTarget) {
  for (const record of byToken.values()) {
    if (record.tmuxTarget === tmuxTarget) return record;
  }
  for (const record of bySessionId.values()) {
    if (record.tmuxTarget === tmuxTarget) return record;
  }
  return null;
}

/** Test-only: clears the registry so tests don't leak state across cases. */
export function resetSessions() {
  byToken.clear();
  bySessionId.clear();
}
