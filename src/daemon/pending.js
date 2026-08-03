/**
 * In-memory Map<messageId, PendingPermissionRequest> tracking permission
 * requests awaiting a Discord reaction. A PendingPermissionRequest is
 * `{ resolve, sessionId }`, where `resolve(decision)` settles the promise
 * the HTTP route is awaiting.
 */
const pendingRequests = new Map();

export function registerPending(messageId, entry) {
  pendingRequests.set(messageId, entry);
}

/** Read-only lookup, unlike `resolvePending` — used to inspect an entry (e.g. its toolName/toolInput) before deciding how to resolve it. */
export function peekPending(messageId) {
  return pendingRequests.get(messageId) ?? null;
}

/** Resolves the pending request for `messageId` only — never any other. */
export function resolvePending(messageId, decision) {
  const entry = pendingRequests.get(messageId);
  if (!entry) return false;
  pendingRequests.delete(messageId);
  entry.resolve(decision);
  return true;
}

/** Test-only: clears the map so tests don't leak state across cases. */
export function resetPending() {
  pendingRequests.clear();
}
