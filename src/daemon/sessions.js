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

/** Attaches the Discord thread id created for this session's token. */
export function attachThread(token, threadId) {
  const record = byToken.get(token);
  if (record) record.threadId = threadId;
  return record ?? null;
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

/** Test-only: clears the registry so tests don't leak state across cases. */
export function resetSessions() {
  byToken.clear();
  bySessionId.clear();
}
