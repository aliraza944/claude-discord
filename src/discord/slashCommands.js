import { setPaused } from '../state.js';
import { disableAllActiveForms } from './askQuestionForm.js';

export const SLASH_COMMANDS = [
  {
    name: 'pause',
    description: 'Pause Discord control: permission requests and idle notifications stop posting here.',
  },
  {
    name: 'resume',
    description: 'Resume Discord control after a pause.',
  },
];

/**
 * Deploys /pause and /resume as guild commands (instant availability, unlike
 * global commands which can take up to an hour to propagate).
 */
export async function registerSlashCommands(discordClient, { guildId }) {
  await discordClient.application.commands.set(SLASH_COMMANDS, guildId);
}

function describePauseReply(paused) {
  return paused ? '⏸️ Discord control paused.' : '▶️ Discord control resumed.';
}

/**
 * Wires InteractionCreate so /pause and /resume flip the same global
 * `paused` flag as the CLI and HTTP control routes (src/daemon/routes/control.js),
 * replying in place to confirm the new state. /pause also immediately
 * disables any in-flight AskUserQuestion form (story 17) — same treatment
 * as an inactivity expiry, just triggered by this event instead.
 */
export function registerSlashCommandHandlers(discordClient) {
  discordClient.on('interactionCreate', async (interaction) => {
    if (!interaction.isChatInputCommand?.()) return;

    if (interaction.commandName === 'pause' || interaction.commandName === 'resume') {
      const paused = interaction.commandName === 'pause';
      await setPaused(paused);
      if (paused) await disableAllActiveForms();
      await interaction.reply(describePauseReply(paused));
    }
  });
}
