import { Client, GatewayIntentBits, Partials } from 'discord.js';

/**
 * The intents/partials needed across this project's Discord surface:
 * creating threads, posting/reading messages (including their raw content
 * for steering replies), and reacting to / observing reactions on messages
 * that may not be in the gateway cache (hence the partials).
 *
 * An `error` listener is always attached: discord.js re-emits a rejected
 * async listener (e.g. an interaction reply hitting a network timeout) as
 * an `error` event, and with no listener Node treats that as unhandled and
 * kills the whole daemon — leaving every open form/button unanswerable.
 */
export function createDiscordClient() {
  const client = new Client({
    intents: [
      GatewayIntentBits.Guilds,
      GatewayIntentBits.GuildMessages,
      GatewayIntentBits.MessageContent,
      GatewayIntentBits.GuildMessageReactions,
    ],
    partials: [Partials.Message, Partials.Channel, Partials.Reaction],
  });
  client.on('error', (err) => {
    console.error('Discord client error:', err.message);
  });
  return client;
}
