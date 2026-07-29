import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createFakeDiscordClient } from './support/fakeDiscordClient.js';
import { registerSlashCommands, registerSlashCommandHandlers, SLASH_COMMANDS } from '../src/discord/slashCommands.js';
import { readStateSync } from '../src/state.js';

let home;

beforeEach(() => {
  home = mkdtempSync(path.join(tmpdir(), 'claude-discord-slash-'));
  process.env.CLAUDE_DISCORD_HOME = home;
});

afterEach(() => {
  delete process.env.CLAUDE_DISCORD_HOME;
  rmSync(home, { recursive: true, force: true });
});

async function flushMicrotasks() {
  await new Promise((resolve) => setTimeout(resolve, 0));
}

describe('discord/slashCommands.js', () => {
  it('registerSlashCommands deploys /pause and /resume as guild commands', async () => {
    const discordClient = createFakeDiscordClient();

    await registerSlashCommands(discordClient, { guildId: 'guild-1' });

    expect(discordClient.setCommandsCalls).toEqual([{ commands: SLASH_COMMANDS, guildId: 'guild-1' }]);
  });

  it('/pause sets the paused flag and replies to confirm', async () => {
    const discordClient = createFakeDiscordClient();
    registerSlashCommandHandlers(discordClient);

    const interaction = discordClient.simulateSlashCommand('pause');
    await flushMicrotasks();

    expect(readStateSync().paused).toBe(true);
    expect(interaction.replies).toHaveLength(1);
  });

  it('/resume clears the paused flag and replies to confirm', async () => {
    const discordClient = createFakeDiscordClient();
    registerSlashCommandHandlers(discordClient);

    discordClient.simulateSlashCommand('pause');
    await flushMicrotasks();
    expect(readStateSync().paused).toBe(true);

    const interaction = discordClient.simulateSlashCommand('resume');
    await flushMicrotasks();

    expect(readStateSync().paused).toBe(false);
    expect(interaction.replies).toHaveLength(1);
  });

  it('ignores an unrelated command name', async () => {
    const discordClient = createFakeDiscordClient();
    registerSlashCommandHandlers(discordClient);

    const interaction = discordClient.simulateSlashCommand('some-other-command');
    await flushMicrotasks();

    expect(interaction.replies).toHaveLength(0);
  });
});
