import { resolvePending } from '../daemon/pending.js';
import { approveSession, removeSession } from '../daemon/sessions.js';
import { startFeedWatcher, stopFeedWatcher } from '../daemon/feedWatcher.js';
import { buildDecisionRow, permCustomIdFor, attachCustomIdFor } from './decisionButtons.js';
import { deleteThread, deleteThreadStarterMessage } from './threads.js';
import { readConfig } from '../config.js';

function appendOutcome(content, outcomeText) {
  return `${content}\n\n${outcomeText}`;
}

/** Edits the interaction's own message in place: appends the outcome text and redraws the row disabled. */
async function updateWithOutcome(interaction, { customIdFor, allowAction = 'allow', denyAction = 'deny', allowLabel, denyLabel, outcomeText }) {
  await interaction.update({
    content: appendOutcome(interaction.message.content, outcomeText),
    components: [buildDecisionRow({ customIdFor, allowAction, denyAction, allowLabel, denyLabel, disabled: true })],
  });
}

async function handlePermButton(interaction, messageId, action) {
  const decision = action === 'allow' ? 'allow' : 'deny';
  if (!resolvePending(messageId, decision)) return;

  await updateWithOutcome(interaction, {
    customIdFor: permCustomIdFor(messageId),
    allowLabel: 'Allow',
    denyLabel: 'Deny',
    outcomeText: decision === 'allow' ? '✅ **Allowed**' : '❌ **Denied**',
  });
}

async function handleAttachButton(discordClient, interaction, sessionId, action) {
  if (action === 'accept') {
    const session = await approveSession(sessionId);
    if (!session) return;
    if (discordClient) startFeedWatcher(session, discordClient);
    await updateWithOutcome(interaction, {
      customIdFor: attachCustomIdFor(sessionId),
      allowAction: 'accept',
      denyAction: 'discard',
      allowLabel: 'Accept',
      denyLabel: 'Discard',
      outcomeText: '✅ **Accepted**',
    });
    return;
  }

  const removed = await removeSession(sessionId);
  if (!removed) return;
  stopFeedWatcher(sessionId);

  // Best-effort: the session is unregistered even if there's no discordClient
  // to delete the thread with, or the thread/starter message is already
  // gone. No discard message is posted — the thread (and its approval
  // message) is deleted outright, along with the "started a thread" message
  // Discord posts in the parent channel (deleting the thread alone doesn't
  // remove that).
  if (discordClient && removed.threadId) {
    await deleteThread(discordClient, removed.threadId).catch(() => {});
    const { channelId } = readConfig();
    await deleteThreadStarterMessage(discordClient, channelId, removed.threadId).catch(() => {});
  }
}

/**
 * Wires InteractionCreate so tapping a permission-request or attach-approval
 * button resolves the matching decision — replacing MessageReactionAdd/✅❌
 * entirely (see decisionButtons.js for the `custom_id` formats). A tap only
 * ever affects the id embedded in its own `custom_id`, so one session's
 * button can never resolve another session's pending request or approval.
 * The decision-resolution logic itself is unchanged from the old
 * reactions.js — only the input surface moved from reactions to buttons.
 */
export function registerInteractionHandlers(discordClient) {
  discordClient.on('interactionCreate', async (interaction) => {
    if (!interaction.isButton?.()) return;

    const [kind, id, action] = interaction.customId?.split(':') ?? [];
    if (!kind || !id || !action) return;

    if (kind === 'perm') {
      await handlePermButton(interaction, id, action);
    } else if (kind === 'attach') {
      await handleAttachButton(discordClient, interaction, id, action);
    }
  });
}
