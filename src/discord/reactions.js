import { resolvePending } from '../daemon/pending.js';
import { resolveAttachApproval } from '../daemon/attachApprovals.js';
import { approveSession, removeSession } from '../daemon/sessions.js';
import { startFeedWatcher, stopFeedWatcher } from '../daemon/feedWatcher.js';
import { postToThread } from './threads.js';

const EMOJI_DECISIONS = { '✅': 'allow', '❌': 'deny' };

/**
 * Wires MessageReactionAdd so a ✅/❌ reaction resolves the matching pending
 * permission request by message id only — a reaction on one session's
 * message never touches another session's pending request. Also resolves
 * attach-approval messages (tracked separately, see attachApprovals.js):
 * ✅ promotes the pending-approval session to active and starts its feed
 * watcher, ❌ discards it (and stops any feed watcher, though none should be
 * running yet for a still-pending-approval session) and posts a
 * confirmation reply.
 */
export function registerReactionHandlers(discordClient) {
  discordClient.on('messageReactionAdd', async (reaction, user) => {
    if (user?.bot) return;

    const decision = EMOJI_DECISIONS[reaction.emoji?.name];
    const messageId = reaction.message?.id;
    if (!decision || !messageId) return;

    if (resolvePending(messageId, decision)) return;

    const sessionId = resolveAttachApproval(messageId);
    if (!sessionId) return;

    if (decision === 'allow') {
      const session = await approveSession(sessionId);
      if (session) startFeedWatcher(session, discordClient);
      return;
    }

    const removed = await removeSession(sessionId);
    if (removed) stopFeedWatcher(sessionId);
    if (removed?.threadId) {
      await postToThread(discordClient, removed.threadId, 'Attach discarded — this session will not be routed to Discord.');
    }
  });
}
