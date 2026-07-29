import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdtempSync, rmSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { initCommand } from '../src/cli/commands/init.js';
import { readConfig } from '../src/config.js';
import { claudeSettingsPath } from '../src/paths.js';

let discordHome;
let claudeHome;

beforeEach(() => {
  discordHome = mkdtempSync(path.join(tmpdir(), 'claude-discord-init-'));
  claudeHome = mkdtempSync(path.join(tmpdir(), 'claude-discord-init-claude-'));
  process.env.CLAUDE_DISCORD_HOME = discordHome;
  process.env.CLAUDE_DISCORD_CLAUDE_HOME = claudeHome;
});

afterEach(() => {
  delete process.env.CLAUDE_DISCORD_HOME;
  delete process.env.CLAUDE_DISCORD_CLAUDE_HOME;
  rmSync(discordHome, { recursive: true, force: true });
  rmSync(claudeHome, { recursive: true, force: true });
  vi.restoreAllMocks();
});

describe('initCommand', () => {
  it('writes config and installs hooks when all values are supplied non-interactively', async () => {
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

    await initCommand({ token: 'tok', guildId: 'guild-1', channelId: 'chan-1' });

    expect(readConfig()).toMatchObject({ token: 'tok', guildId: 'guild-1', channelId: 'chan-1' });

    const settings = JSON.parse(readFileSync(claudeSettingsPath(), 'utf8'));
    expect(settings.hooks.PermissionRequest[0].matcher).toBe('.*');
    expect(settings.hooks.Notification[0].matcher).toBe(
      'agent_needs_input|idle_prompt|agent_completed'
    );
    expect(settings.hooks.SessionStart[0].matcher).toBe('startup|resume');

    const printed = logSpy.mock.calls.flat().join('\n');
    expect(printed).toMatch(/Message Content/);
    expect(printed).toMatch(/create threads, send messages, and add reactions/);
  });
});
