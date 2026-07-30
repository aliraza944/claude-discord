import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createFakeDiscordClient } from './support/fakeDiscordClient.js';
import { registerSteeringHandlers } from '../src/discord/steering.js';
import {
  registerPending,
  attachThread,
  promoteToActive,
  registerPendingApproval,
  approveSession,
  resetSessions,
} from '../src/daemon/sessions.js';

let home;

beforeEach(() => {
  home = mkdtempSync(path.join(tmpdir(), 'claude-discord-steering-'));
  process.env.CLAUDE_DISCORD_HOME = home;
  resetSessions();
});

afterEach(() => {
  delete process.env.CLAUDE_DISCORD_HOME;
  rmSync(home, { recursive: true, force: true });
  resetSessions();
});

describe('discord/steering.js', () => {
  it('delivers a plain-text reply in a session thread to that session tmux target, and acks with a reaction', async () => {
    registerPending({ token: 'tok-1', projectName: 'p1', cwd: '/p1', tmuxTarget: 'tm-1' });
    attachThread('tok-1', 'thread-1');
    await promoteToActive('tok-1', 'sess-1');

    const discordClient = createFakeDiscordClient();
    const sendText = vi.fn().mockResolvedValue(undefined);
    registerSteeringHandlers(discordClient, { sendText });

    const message = discordClient.simulateMessage({ channelId: 'thread-1', content: 'go ahead and run the tests' });
    await flushMicrotasks();

    expect(sendText).toHaveBeenCalledWith('tm-1', 'go ahead and run the tests');
    expect(message.reactions).toHaveLength(1);
  });

  it('ignores messages posted in a channel that is not a registered session thread', async () => {
    const discordClient = createFakeDiscordClient();
    const sendText = vi.fn().mockResolvedValue(undefined);
    registerSteeringHandlers(discordClient, { sendText });

    const message = discordClient.simulateMessage({ channelId: 'some-other-channel', content: 'hello' });
    await flushMicrotasks();

    expect(sendText).not.toHaveBeenCalled();
    expect(message.reactions).toHaveLength(0);
  });

  it('ignores the bot own messages (never reacts to or re-delivers its own posts)', async () => {
    registerPending({ token: 'tok-1', projectName: 'p1', cwd: '/p1', tmuxTarget: 'tm-1' });
    attachThread('tok-1', 'thread-1');
    await promoteToActive('tok-1', 'sess-1');

    const discordClient = createFakeDiscordClient();
    const sendText = vi.fn().mockResolvedValue(undefined);
    registerSteeringHandlers(discordClient, { sendText });

    discordClient.simulateMessage({ channelId: 'thread-1', content: 'FYI message', bot: true });
    await flushMicrotasks();

    expect(sendText).not.toHaveBeenCalled();
  });

  it('delivers a reply for an attach-registered session (keyed only by session_id, never a token)', async () => {
    registerPendingApproval({ sessionId: 'sess-1', projectName: 'p1', cwd: '/p1', tmuxTarget: 'tm-1' });
    attachThread('sess-1', 'thread-1');
    await approveSession('sess-1');

    const discordClient = createFakeDiscordClient();
    const sendText = vi.fn().mockResolvedValue(undefined);
    registerSteeringHandlers(discordClient, { sendText });

    discordClient.simulateMessage({ channelId: 'thread-1', content: 'go ahead' });
    await flushMicrotasks();

    expect(sendText).toHaveBeenCalledWith('tm-1', 'go ahead');
  });

  it('a reply in one session thread never reaches another session tmux target', async () => {
    registerPending({ token: 'tok-1', projectName: 'p1', cwd: '/p1', tmuxTarget: 'tm-1' });
    attachThread('tok-1', 'thread-1');
    await promoteToActive('tok-1', 'sess-1');

    registerPending({ token: 'tok-2', projectName: 'p2', cwd: '/p2', tmuxTarget: 'tm-2' });
    attachThread('tok-2', 'thread-2');
    await promoteToActive('tok-2', 'sess-2');

    const discordClient = createFakeDiscordClient();
    const sendText = vi.fn().mockResolvedValue(undefined);
    registerSteeringHandlers(discordClient, { sendText });

    discordClient.simulateMessage({ channelId: 'thread-1', content: 'only for session 1' });
    await flushMicrotasks();

    expect(sendText).toHaveBeenCalledTimes(1);
    expect(sendText).toHaveBeenCalledWith('tm-1', 'only for session 1');
  });
});

async function flushMicrotasks() {
  await new Promise((resolve) => setTimeout(resolve, 0));
}
