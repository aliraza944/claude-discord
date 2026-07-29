import { resolvePending } from '../daemon/pending.js';

const EMOJI_DECISIONS = { '✅': 'allow', '❌': 'deny' };

/**
 * Wires MessageReactionAdd so a ✅/❌ reaction resolves the matching pending
 * permission request by message id only — a reaction on one session's
 * message never touches another session's pending request.
 */
export function registerReactionHandlers(discordClient) {
  discordClient.on('messageReactionAdd', (reaction, user) => {
    if (user?.bot) return;

    const decision = EMOJI_DECISIONS[reaction.emoji?.name];
    const messageId = reaction.message?.id;
    if (!decision || !messageId) return;

    resolvePending(messageId, decision);
  });
}
