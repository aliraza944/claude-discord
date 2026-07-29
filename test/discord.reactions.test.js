import { describe, it, expect, afterEach } from 'vitest';
import { createFakeDiscordClient } from './support/fakeDiscordClient.js';
import { registerReactionHandlers } from '../src/discord/reactions.js';
import { registerPending, resetPending } from '../src/daemon/pending.js';

afterEach(() => {
  resetPending();
});

describe('discord/reactions.js', () => {
  it('resolves the pending request matching the reacted message id, with the mapped decision', async () => {
    const discordClient = createFakeDiscordClient();
    registerReactionHandlers(discordClient);

    const decision = new Promise((resolve) => {
      registerPending('msg-1', { sessionId: 'sess-1', resolve });
    });

    discordClient.simulateReaction('msg-1', '✅');
    await expect(decision).resolves.toBe('allow');
  });

  it('maps ❌ to deny', async () => {
    const discordClient = createFakeDiscordClient();
    registerReactionHandlers(discordClient);

    const decision = new Promise((resolve) => {
      registerPending('msg-1', { sessionId: 'sess-1', resolve });
    });

    discordClient.simulateReaction('msg-1', '❌');
    await expect(decision).resolves.toBe('deny');
  });

  it('ignores an unrelated emoji', () => {
    const discordClient = createFakeDiscordClient();
    registerReactionHandlers(discordClient);

    let resolved = false;
    registerPending('msg-1', { sessionId: 'sess-1', resolve: () => { resolved = true; } });

    discordClient.simulateReaction('msg-1', '🎉');
    expect(resolved).toBe(false);
  });

  it('a reaction on one message never resolves a different message pending request', () => {
    const discordClient = createFakeDiscordClient();
    registerReactionHandlers(discordClient);

    let resolvedA = null;
    let resolvedB = null;
    registerPending('msg-a', { sessionId: 'sess-a', resolve: (d) => { resolvedA = d; } });
    registerPending('msg-b', { sessionId: 'sess-b', resolve: (d) => { resolvedB = d; } });

    discordClient.simulateReaction('msg-a', '✅');

    expect(resolvedA).toBe('allow');
    expect(resolvedB).toBeNull();
  });
});
