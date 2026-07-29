import { EventEmitter } from 'node:events';

/**
 * A fake discord.js Client used across the daemon HTTP-layer tests (see
 * spec.md's "Seam 1"). Implements just enough surface — login/ready state,
 * thread creation, posting messages, reacting, and emitting
 * MessageReactionAdd — to drive src/discord/* handlers the same way the real
 * gateway would, without a network call.
 */
export function createFakeDiscordClient() {
  const client = new EventEmitter();
  client.ready = false;
  client.loginCalls = [];

  client.isReady = () => client.ready;

  client.login = async (token) => {
    client.loginCalls.push(token);
    client.ready = true;
    client.emit('ready');
    return token;
  };

  client.destroy = async () => {
    client.ready = false;
  };

  let nextId = 1;
  const makeId = (prefix) => `${prefix}-${nextId++}`;
  const channelsById = new Map();

  function makeMessage(content) {
    const message = new EventEmitter();
    message.id = makeId('msg');
    message.content = content;
    message.reactions = [];
    message.react = async (emoji) => {
      message.reactions.push(emoji);
      return { emoji, message };
    };
    return message;
  }

  function makeThread(name) {
    const thread = new EventEmitter();
    thread.id = makeId('thread');
    thread.name = name;
    thread.messages = [];
    thread.send = async (content) => {
      const message = makeMessage(content);
      thread.messages.push(message);
      channelsById.set(message.id, message);
      return message;
    };
    channelsById.set(thread.id, thread);
    return thread;
  }

  function makeChannel(channelId) {
    const channel = new EventEmitter();
    channel.id = channelId;
    channel.threads = {
      create: async ({ name }) => makeThread(name),
    };
    channelsById.set(channelId, channel);
    return channel;
  }

  client.channels = {
    fetch: async (id) => channelsById.get(id) ?? makeChannel(id),
  };

  client.setCommandsCalls = [];
  client.application = {
    commands: {
      set: async (commands, guildId) => {
        client.setCommandsCalls.push({ commands, guildId });
        return commands;
      },
    },
  };

  /** Test helper: simulates a (non-bot) user adding a reaction to a message. */
  client.simulateReaction = (messageId, emojiName, userId = 'fake-user') => {
    const reaction = { emoji: { name: emojiName }, message: { id: messageId } };
    const user = { id: userId, bot: false };
    client.emit('messageReactionAdd', reaction, user);
  };

  /** Test helper: simulates a (non-bot, by default) user posting a message in a channel/thread. */
  client.simulateMessage = ({ channelId, content, authorId = 'fake-user', bot = false }) => {
    const message = makeMessage(content);
    message.channelId = channelId;
    message.author = { id: authorId, bot };
    client.emit('messageCreate', message);
    return message;
  };

  /**
   * Test helper: simulates a user invoking a slash command. Returns the fake
   * interaction, whose `replies` array records every interaction.reply(...)
   * call so a test can await handler completion before asserting on it.
   */
  client.simulateSlashCommand = (commandName, { userId = 'fake-user' } = {}) => {
    const interaction = new EventEmitter();
    interaction.commandName = commandName;
    interaction.user = { id: userId, bot: false };
    interaction.replies = [];
    interaction.isChatInputCommand = () => true;
    interaction.reply = async (content) => {
      interaction.replies.push(content);
    };
    client.emit('interactionCreate', interaction);
    return interaction;
  };

  return client;
}
