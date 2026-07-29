import { Client, GatewayIntentBits, Partials } from 'discord.js';

/**
 * The intents/partials needed across this project's Discord surface:
 * creating threads, posting/reading messages (including their raw content
 * for steering replies), and reacting to / observing reactions on messages
 * that may not be in the gateway cache (hence the partials).
 */
export function createDiscordClient() {
  return new Client({
    intents: [
      GatewayIntentBits.Guilds,
      GatewayIntentBits.GuildMessages,
      GatewayIntentBits.MessageContent,
      GatewayIntentBits.GuildMessageReactions,
    ],
    partials: [Partials.Message, Partials.Channel, Partials.Reaction],
  });
}
