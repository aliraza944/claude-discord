import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { newSession, capturePane } from '../src/tmux.js';
import { registerSteeringHandlers } from '../src/discord/steering.js';
import { registerPending, attachThread, promoteToActive, resetSessions } from '../src/daemon/sessions.js';
import { createFakeDiscordClient } from './support/fakeDiscordClient.js';

const execFileAsync = promisify(execFile);
let home;

// Issue 05's explicit acceptance bullet: with two sessions registered, a
// plain-text reply in one session's thread is only ever delivered to that
// session's own tmux pane. Verified against the real tmux binary (an OS-
// process boundary a discord/tmux fake can't verify), unlike the rest of the
// steering suite which spies on tmux.sendText.
describe('discord/steering.js (real tmux, multi-session isolation)', () => {
  const targetA = `claude-discord-test-steer-a-${process.pid}`;
  const targetB = `claude-discord-test-steer-b-${process.pid}`;

  beforeEach(() => {
    home = mkdtempSync(path.join(tmpdir(), 'claude-discord-steering-tmux-'));
    process.env.CLAUDE_DISCORD_HOME = home;
  });

  afterEach(async () => {
    delete process.env.CLAUDE_DISCORD_HOME;
    rmSync(home, { recursive: true, force: true });
    resetSessions();
    for (const target of [targetA, targetB]) {
      try {
        await execFileAsync('tmux', ['kill-session', '-t', target]);
      } catch {
        // already gone
      }
    }
  });

  it('delivers a reply in one thread only into its own tmux pane, never the other session\'s', async () => {
    await newSession({ target: targetA, cwd: '/tmp', command: 'cat' });
    await newSession({ target: targetB, cwd: '/tmp', command: 'cat' });
    await new Promise((resolve) => setTimeout(resolve, 300));

    registerPending({ token: 'tok-a', projectName: 'project-a', cwd: '/a', tmuxTarget: targetA });
    registerPending({ token: 'tok-b', projectName: 'project-b', cwd: '/b', tmuxTarget: targetB });

    const discordClient = createFakeDiscordClient();
    const threadA = await discordClient.channels.fetch('chan-1').then((c) => c.threads.create({ name: 'project-a' }));
    const threadB = await discordClient.channels.fetch('chan-1').then((c) => c.threads.create({ name: 'project-b' }));
    attachThread('tok-a', threadA.id);
    attachThread('tok-b', threadB.id);
    await promoteToActive('tok-a', 'sess-a');
    await promoteToActive('tok-b', 'sess-b');

    registerSteeringHandlers(discordClient);

    const message = discordClient.simulateMessage({ channelId: threadA.id, content: 'only-for-session-a' });
    await new Promise((resolve) => setTimeout(resolve, 400));

    const paneA = await capturePane(targetA);
    const paneB = await capturePane(targetB);

    expect(paneA).toContain('only-for-session-a');
    expect(paneB).not.toContain('only-for-session-a');
    expect(message.reactions).toHaveLength(1);
  });
});
