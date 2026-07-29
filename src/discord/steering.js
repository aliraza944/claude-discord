import { sendText as sendTextDefault } from '../tmux.js';
import { findByThreadId } from '../daemon/sessions.js';

const ACK_EMOJI = '✅';

/**
 * Wires MessageCreate so a plain-text reply posted inside a session's thread
 * is typed into that session's own registered tmux pane — a message in one
 * session's thread is looked up by that thread's id alone, so it can never
 * reach another session's pane — and reacts to the message to acknowledge
 * delivery.
 * @param {object} discordClient
 * @param {{ sendText?: typeof sendTextDefault }} [deps]
 */
export function registerSteeringHandlers(discordClient, { sendText = sendTextDefault } = {}) {
  discordClient.on('messageCreate', async (message) => {
    if (message.author?.bot) return;

    const session = findByThreadId(message.channelId);
    if (!session) return;

    await sendText(session.tmuxTarget, message.content);
    await message.react(ACK_EMOJI);
  });
}
