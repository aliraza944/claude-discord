/**
 * In-memory Map<messageId, sessionId> tracking which Discord message is the
 * ✅/❌ approval prompt for a pending-approval session — lets the reaction
 * handler tell an attach-approval message apart from a permission-request
 * message (tracked separately in daemon/pending.js) unambiguously.
 */
const bySessionApprovalMessageId = new Map();

export function registerAttachApproval(messageId, sessionId) {
  bySessionApprovalMessageId.set(messageId, sessionId);
}

/** Resolves and clears the approval mapping for `messageId`, if any. */
export function resolveAttachApproval(messageId) {
  const sessionId = bySessionApprovalMessageId.get(messageId);
  if (!sessionId) return null;
  bySessionApprovalMessageId.delete(messageId);
  return sessionId;
}

/** Test-only: clears the map so tests don't leak state across cases. */
export function resetAttachApprovals() {
  bySessionApprovalMessageId.clear();
}
