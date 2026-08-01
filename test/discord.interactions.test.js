import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createFakeDiscordClient } from './support/fakeDiscordClient.js';
import { registerInteractionHandlers } from '../src/discord/interactions.js';
import { registerPending, resetPending } from '../src/daemon/pending.js';
import { registerPendingApproval, attachThread, resetSessions, findBySessionId } from '../src/daemon/sessions.js';
import { writeConfig } from '../src/config.js';

let home;

beforeEach(() => {
  home = mkdtempSync(path.join(tmpdir(), 'claude-discord-interactions-'));
  process.env.CLAUDE_DISCORD_HOME = home;
});

afterEach(() => {
  delete process.env.CLAUDE_DISCORD_HOME;
  rmSync(home, { recursive: true, force: true });
  resetPending();
  resetSessions();
});

async function postMessage(discordClient, content = 'a message') {
  const channel = await discordClient.channels.fetch('chan-1');
  const thread = await channel.threads.create({ name: 't' });
  const message = await thread.send(content);
  return { channel, thread, message };
}

describe('discord/interactions.js', () => {
  it('resolves the pending request matching the perm button message id, with the mapped decision', async () => {
    const discordClient = createFakeDiscordClient();
    registerInteractionHandlers(discordClient);
    const { message } = await postMessage(discordClient);

    const decision = new Promise((resolve) => {
      registerPending(message.id, { sessionId: 'sess-1', resolve });
    });

    discordClient.simulateButtonClick(`perm:${message.id}:allow`, { messageId: message.id });
    await expect(decision).resolves.toBe('allow');
  });

  it('maps the deny action to deny', async () => {
    const discordClient = createFakeDiscordClient();
    registerInteractionHandlers(discordClient);
    const { message } = await postMessage(discordClient);

    const decision = new Promise((resolve) => {
      registerPending(message.id, { sessionId: 'sess-1', resolve });
    });

    discordClient.simulateButtonClick(`perm:${message.id}:deny`, { messageId: message.id });
    await expect(decision).resolves.toBe('deny');
  });

  it('a button on one message never resolves a different message pending request', async () => {
    const discordClient = createFakeDiscordClient();
    registerInteractionHandlers(discordClient);
    const { message: messageA } = await postMessage(discordClient);
    const { message: messageB } = await postMessage(discordClient);

    let resolvedA = null;
    let resolvedB = null;
    registerPending(messageA.id, { sessionId: 'sess-a', resolve: (d) => { resolvedA = d; } });
    registerPending(messageB.id, { sessionId: 'sess-b', resolve: (d) => { resolvedB = d; } });

    discordClient.simulateButtonClick(`perm:${messageA.id}:allow`, { messageId: messageA.id });
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(resolvedA).toBe('allow');
    expect(resolvedB).toBeNull();
  });

  it('edits the message in place with the outcome and disabled buttons on a perm decision', async () => {
    const discordClient = createFakeDiscordClient();
    registerInteractionHandlers(discordClient);
    const { message } = await postMessage(discordClient, 'Permission requested: **Bash**');
    registerPending(message.id, { sessionId: 'sess-1', resolve: () => {} });

    const interaction = discordClient.simulateButtonClick(`perm:${message.id}:allow`, { messageId: message.id });
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(message.content).toContain('Allowed');
    expect(message.components).toHaveLength(1);
    const buttons = message.components[0].toJSON().components;
    expect(buttons.every((b) => b.disabled)).toBe(true);
    expect(interaction.updates).toHaveLength(1);
  });

  it('ignores a stale click on an already-resolved perm message', async () => {
    const discordClient = createFakeDiscordClient();
    registerInteractionHandlers(discordClient);
    const { message } = await postMessage(discordClient);

    registerPending(message.id, { sessionId: 'sess-1', resolve: () => {} });
    discordClient.simulateButtonClick(`perm:${message.id}:allow`, { messageId: message.id });
    await new Promise((resolve) => setTimeout(resolve, 0));

    const interaction = discordClient.simulateButtonClick(`perm:${message.id}:deny`, { messageId: message.id });
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(interaction.updates).toHaveLength(0);
  });

  it('accepting an attach approval promotes the session to active and edits the message in place', async () => {
    const discordClient = createFakeDiscordClient();
    registerInteractionHandlers(discordClient);

    registerPendingApproval({ sessionId: 'sess-1', projectName: 'p', cwd: '/p', tmuxTarget: 'tm' });
    const { message } = await postMessage(discordClient, 'Attach requested for **p**');

    const interaction = discordClient.simulateButtonClick('attach:sess-1:accept', { messageId: message.id });
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(findBySessionId('sess-1').status).toBe('active');
    expect(message.content).toContain('Accepted');
    expect(interaction.updates).toHaveLength(1);
  });

  it('discarding an attach approval removes the session and deletes its thread and starter message, with no discard message', async () => {
    writeConfig({ port: 0, channelId: 'chan-1' });
    const discordClient = createFakeDiscordClient();
    registerInteractionHandlers(discordClient);

    registerPendingApproval({ sessionId: 'sess-1', projectName: 'p', cwd: '/p', tmuxTarget: 'tm' });
    const { channel, thread, message } = await postMessage(discordClient, 'Attach requested for **p**');
    attachThread('sess-1', thread.id);

    discordClient.simulateButtonClick('attach:sess-1:discard', { messageId: message.id });
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(findBySessionId('sess-1')).toBeNull();
    expect(thread.deleted).toBe(true);
    expect(channel.deletedMessageIds).toEqual([thread.id]);
  });

  it('ignores a non-button interaction', async () => {
    const discordClient = createFakeDiscordClient();
    registerInteractionHandlers(discordClient);

    let resolved = false;
    registerPending('msg-1', { sessionId: 'sess-1', resolve: () => { resolved = true; } });

    discordClient.simulateSlashCommand('pause');
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(resolved).toBe(false);
  });
});
