import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { readStateSync, modifyState, setPaused } from '../src/state.js';

let home;

beforeEach(async () => {
  home = mkdtempSync(path.join(tmpdir(), 'claude-discord-state-'));
  process.env.CLAUDE_DISCORD_HOME = home;
});

afterEach(() => {
  delete process.env.CLAUDE_DISCORD_HOME;
  rmSync(home, { recursive: true, force: true });
});

describe('state.js', () => {
  it('returns default state when no file exists', async () => {
    expect(readStateSync()).toEqual({ paused: false, sessions: {} });
  });

  it('modifyState persists changes atomically', async () => {
    await modifyState((state) => ({ ...state, paused: true }));
    expect(readStateSync().paused).toBe(true);
  });

  it('setPaused flips the paused flag', async () => {
    await setPaused(true);
    expect(readStateSync().paused).toBe(true);
    await setPaused(false);
    expect(readStateSync().paused).toBe(false);
  });

  it('serializes concurrent modifyState calls without losing updates', async () => {
    await modifyState((state) => ({ ...state, counter: 0 }));

    await Promise.all(
      Array.from({ length: 20 }, () =>
        modifyState((state) => ({ ...state, counter: state.counter + 1 }))
      )
    );

    expect(readStateSync().counter).toBe(20);
  });
});
