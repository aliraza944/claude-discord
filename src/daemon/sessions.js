/**
 * In-memory registry of Claude Code sessions the daemon knows about. A
 * session starts out pending-by-token (registered by `claude-discord start`
 * before Claude Code has even booted) and is promoted to active-by-session_id
 * once the SessionStart hook reports the real session_id for that token.
 */
const byToken = new Map();
const bySessionId = new Map();

/** Registers a new pending session, keyed by its start-time token. */
export function registerPending({ token, projectName, cwd, tmuxTarget }) {
  const record = {
    token,
    projectName,
    cwd,
    tmuxTarget,
    sessionId: null,
    threadId: null,
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
 * (awaiting a hook) and `active` (routing to Discord).
 */
export function registerPendingApproval({ sessionId, projectName, cwd, tmuxTarget }) {
  const record = {
    token: null,
    projectName,
    cwd,
    tmuxTarget,
    sessionId,
    threadId: null,
    status: 'pending-approval',
  };
  bySessionId.set(sessionId, record);
  return record;
}

/** Promotes a `pending-approval` session to `active`. */
export function approveSession(sessionId) {
  const record = bySessionId.get(sessionId);
  if (!record) return null;
  record.status = 'active';
  return record;
}

/** Removes a session from the registry entirely (declined attach, or detach). */
export function removeSession(sessionId) {
  const record = bySessionId.get(sessionId);
  if (!record) return null;
  bySessionId.delete(sessionId);
  if (record.token) byToken.delete(record.token);
  return record;
}

/** Promotes a pending-by-token registration to active-by-session_id. */
export function promoteToActive(token, sessionId) {
  const record = byToken.get(token);
  if (!record) return null;
  record.sessionId = sessionId;
  record.status = 'active';
  bySessionId.set(sessionId, record);
  return record;
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
