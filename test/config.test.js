import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { readConfig, writeConfig } from '../src/config.js';

let home;

beforeEach(() => {
  home = mkdtempSync(path.join(tmpdir(), 'claude-discord-config-'));
  process.env.CLAUDE_DISCORD_HOME = home;
});

afterEach(() => {
  delete process.env.CLAUDE_DISCORD_HOME;
  rmSync(home, { recursive: true, force: true });
});

describe('config.js', () => {
  it('returns a default config when no file exists', () => {
    expect(readConfig()).toEqual({ port: 4790 });
  });

  it('round-trips a written config', () => {
    writeConfig({ port: 5555, token: 'abc', guildId: 'g1', channelId: 'c1' });
    expect(readConfig()).toEqual({ port: 5555, token: 'abc', guildId: 'g1', channelId: 'c1' });
  });
});
