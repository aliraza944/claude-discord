import { EventEmitter } from 'node:events';

// A Components V2 message (TextDisplay interleaved with ActionRows, see
// askQuestionForm.js) can carry up to 40 top-level components — much looser
// than the classic 5-action-rows-only cap, since most of those top-level
// slots here are TextDisplay, not ActionRow.
const MAX_TOP_LEVEL_COMPONENTS = 40;
const MAX_BUTTONS_PER_ROW = 5;
const MAX_SELECT_OPTIONS = 25;
const MAX_MODAL_FIELDS = 5;

/** Discord component type ids relevant to validation (ActionRow=1, Button=2, StringSelect=3, TextDisplay=10). */
const COMPONENT_TYPE = { ACTION_ROW: 1, BUTTON: 2, STRING_SELECT: 3, TEXT_DISPLAY: 10 };

/**
 * Enforces the real Discord limits this repo's forms must respect (spec.md's
 * "Seam 1" test-seam requirement): at most 40 top-level components, a select
 * menu must be the only component in its row, at most 5 buttons sharing a
 * button row, and at most 25 options per select menu. Non-ActionRow
 * top-level components (e.g. TextDisplay) have no row-shape to check.
 * Called on every send/edit/update so a bug that would silently violate
 * these limits in production fails loudly in-test instead.
 */
function validateComponents(components = []) {
  if (components.length > MAX_TOP_LEVEL_COMPONENTS) {
    throw new Error(`Message has ${components.length} top-level components; Discord allows at most ${MAX_TOP_LEVEL_COMPONENTS}`);
  }
  for (const row of components) {
    const json = row?.toJSON ? row.toJSON() : row;
    if (json?.type !== COMPONENT_TYPE.ACTION_ROW) continue;
    const rowComponents = json?.components ?? [];
    const hasSelect = rowComponents.some((c) => c.type === COMPONENT_TYPE.STRING_SELECT);
    if (hasSelect && rowComponents.length > 1) {
      throw new Error('A select menu must be the only component in its action row');
    }
    if (!hasSelect && rowComponents.length > MAX_BUTTONS_PER_ROW) {
      throw new Error(`Action row has ${rowComponents.length} buttons; Discord allows at most ${MAX_BUTTONS_PER_ROW}`);
    }
    for (const c of rowComponents) {
      if (c.type === COMPONENT_TYPE.STRING_SELECT && (c.options?.length ?? 0) > MAX_SELECT_OPTIONS) {
        throw new Error(`Select menu has ${c.options.length} options; Discord allows at most ${MAX_SELECT_OPTIONS}`);
      }
    }
  }
}

/**
 * Joins the `content` of every top-level TextDisplay component (Components
 * V2) in a message/payload's `components`, in order — the analogue of
 * reading `message.content` for a form built out of TextDisplayBuilder
 * instead of a single content string. Tests use this the way they'd assert
 * on `message.content` for a classic message.
 */
export function componentText(message) {
  return (message.components ?? [])
    .map((c) => (c?.toJSON ? c.toJSON() : c))
    .filter((c) => c.type === COMPONENT_TYPE.TEXT_DISPLAY)
    .map((c) => c.content)
    .join('\n');
}

/** Enforces a modal's top-level-field cap (Label/TextDisplay components), mirroring `validateComponents` for modals. */
function validateModal(modal) {
  const json = modal?.toJSON ? modal.toJSON() : modal;
  const fields = json?.components ?? [];
  if (fields.length > MAX_MODAL_FIELDS) {
    throw new Error(`Modal has ${fields.length} fields; Discord allows at most ${MAX_MODAL_FIELDS}`);
  }
}

/** Accepts either a plain string or a `{ content, components, flags }` object, as real discord.js send/edit/update calls do. */
function normalizePayload(payload) {
  if (typeof payload === 'string') return { content: payload, components: [], flags: 0 };
  return { content: payload?.content ?? '', components: payload?.components ?? [], flags: payload?.flags ?? 0 };
}

/**
 * A fake discord.js Client used across the daemon HTTP-layer tests (see
 * spec.md's "Seam 1"). Implements just enough surface — login/ready state,
 * thread creation, posting/editing messages, reacting, and button/select/modal
 * interactions — to drive src/discord/* handlers the same way the real
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
  const pendingModalsByCustomId = new Map();

  function makeMessage(payload) {
    const { content, components, flags } = normalizePayload(payload);
    validateComponents(components);
    const message = new EventEmitter();
    message.id = makeId('msg');
    message.content = content;
    message.components = components;
    message.flags = flags;
    message.reactions = [];
    message.react = async (emoji) => {
      message.reactions.push(emoji);
      return { emoji, message };
    };
    message.edit = async (editPayload) => {
      const normalized = normalizePayload(editPayload);
      validateComponents(normalized.components);
      message.content = normalized.content;
      message.components = normalized.components;
      message.flags = normalized.flags;
      return message;
    };
    return message;
  }

  function makeThread(name) {
    const thread = new EventEmitter();
    thread.id = makeId('thread');
    thread.name = name;
    thread.messages = [];
    thread.deleted = false;
    thread.send = async (payload) => {
      const message = makeMessage(payload);
      thread.messages.push(message);
      channelsById.set(message.id, message);
      return message;
    };
    thread.delete = async () => {
      thread.deleted = true;
      channelsById.delete(thread.id);
      return thread;
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
    // Mirrors real Discord: creating a thread without a starting message
    // posts a "started a thread" system message in the parent channel whose
    // id is identical to the thread's id. deletedMessageIds records calls to
    // messages.delete so tests can assert that starter message gets cleaned
    // up alongside the thread.
    channel.deletedMessageIds = [];
    channel.messages = {
      delete: async (messageId) => {
        channel.deletedMessageIds.push(messageId);
      },
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

  function makeComponentInteraction({ kind, customId, message, userId, values }) {
    const interaction = new EventEmitter();
    interaction.customId = customId;
    interaction.user = { id: userId, bot: false };
    interaction.message = message ?? null;
    interaction.values = values;
    interaction.isButton = () => kind === 'button';
    interaction.isStringSelectMenu = () => kind === 'select';
    interaction.isModalSubmit = () => false;
    interaction.deferred = false;
    interaction.updates = [];
    interaction.update = async (payload) => {
      const normalized = normalizePayload(payload);
      validateComponents(normalized.components);
      interaction.updates.push(normalized);
      if (interaction.message) {
        interaction.message.content = normalized.content;
        interaction.message.components = normalized.components;
        interaction.message.flags = normalized.flags;
      }
    };
    interaction.deferUpdate = async () => {
      interaction.deferred = true;
    };
    interaction.showModal = async (modal) => {
      validateModal(modal);
      const modalCustomId = modal?.data?.custom_id ?? modal?.custom_id;
      interaction.shownModal = modal;
      pendingModalsByCustomId.set(modalCustomId, { openerMessage: interaction.message });
    };
    return interaction;
  }

  /** Test helper: simulates a button click on `customId`, on the message identified by `messageId`. */
  client.simulateButtonClick = (customId, { messageId, userId = 'fake-user' } = {}) => {
    const message = messageId ? channelsById.get(messageId) : null;
    const interaction = makeComponentInteraction({ kind: 'button', customId, message, userId });
    client.emit('interactionCreate', interaction);
    return interaction;
  };

  /** Test helper: simulates picking `values` on the string select menu `customId`, on the message identified by `messageId`. */
  client.simulateSelectMenu = (customId, values, { messageId, userId = 'fake-user' } = {}) => {
    const message = messageId ? channelsById.get(messageId) : null;
    const interaction = makeComponentInteraction({ kind: 'select', customId, message, userId, values });
    client.emit('interactionCreate', interaction);
    return interaction;
  };

  /**
   * Test helper: simulates submitting the modal `modalCustomId` (previously
   * opened via `interaction.showModal(modal)` on a button/select interaction)
   * with `fields` — a `{ [textInputCustomId]: value }` map. The resulting
   * interaction's `.message` is the message that had the button/select which
   * opened the modal, matching real discord.js's `ModalSubmitInteraction`
   * behavior so `.update()` can rewrite that original message.
   */
  client.simulateModalSubmit = (modalCustomId, fields = {}, { userId = 'fake-user' } = {}) => {
    const pending = pendingModalsByCustomId.get(modalCustomId);
    pendingModalsByCustomId.delete(modalCustomId);

    const interaction = new EventEmitter();
    interaction.customId = modalCustomId;
    interaction.user = { id: userId, bot: false };
    interaction.message = pending?.openerMessage ?? null;
    interaction.isButton = () => false;
    interaction.isStringSelectMenu = () => false;
    interaction.isModalSubmit = () => true;
    interaction.fields = {
      getTextInputValue: (fieldCustomId) => fields[fieldCustomId],
    };
    interaction.deferred = false;
    interaction.updates = [];
    interaction.update = async (payload) => {
      const normalized = normalizePayload(payload);
      validateComponents(normalized.components);
      interaction.updates.push(normalized);
      if (interaction.message) {
        interaction.message.content = normalized.content;
        interaction.message.components = normalized.components;
        interaction.message.flags = normalized.flags;
      }
    };
    interaction.deferUpdate = async () => {
      interaction.deferred = true;
    };

    client.emit('interactionCreate', interaction);
    return interaction;
  };

  return client;
}
