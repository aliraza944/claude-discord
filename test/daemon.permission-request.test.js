import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createDaemonServer } from '../src/daemon/run.js';
import { createFakeDiscordClient } from './support/fakeDiscordClient.js';
import { registerPending, attachThread, promoteToActive, resetSessions } from '../src/daemon/sessions.js';
import { resetPending } from '../src/daemon/pending.js';
import { setPaused } from '../src/state.js';
import { createSessionThread } from '../src/discord/threads.js';

let home;

beforeEach(() => {
  home = mkdtempSync(path.join(tmpdir(), 'claude-discord-permission-'));
  process.env.CLAUDE_DISCORD_HOME = home;
  resetSessions();
  resetPending();
});

afterEach(async () => {
  delete process.env.CLAUDE_DISCORD_HOME;
  rmSync(home, { recursive: true, force: true });
  resetSessions();
  resetPending();
});

async function registerActiveSession(discordClient, { token, sessionId, projectName }) {
  registerPending({ token, projectName, cwd: `/${projectName}`, tmuxTarget: `tm-${token}` });
  const thread = await createSessionThread(discordClient, { channelId: 'chan-1', name: projectName });
  attachThread(token, thread.id);
  await promoteToActive(token, sessionId);
  return thread;
}

async function startServer(discordClient, extraDeps = {}) {
  const server = createDaemonServer({ discordClient, ...extraDeps });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  return server;
}

describe('POST /hook/permission-request', () => {
  it('defers immediately (no discord message) for an unregistered session', async () => {
    const discordClient = createFakeDiscordClient();
    const server = await startServer(discordClient);
    const { port } = server.address();

    try {
      const res = await fetch(`http://127.0.0.1:${port}/hook/permission-request`, {
        method: 'POST',
        body: JSON.stringify({ session_id: 'unknown-session', tool_name: 'Bash' }),
      });
      expect(await res.json()).toEqual({ decision: 'defer' });
    } finally {
      await new Promise((resolve) => server.close(resolve));
    }
  });

  it('defers immediately (no discord message) when globally paused', async () => {
    await setPaused(true);
    const discordClient = createFakeDiscordClient();
    await registerActiveSession(discordClient, { token: 'tok-1', sessionId: 'sess-1', projectName: 'p1' });

    const server = await startServer(discordClient);
    const { port } = server.address();

    try {
      const res = await fetch(`http://127.0.0.1:${port}/hook/permission-request`, {
        method: 'POST',
        body: JSON.stringify({ session_id: 'sess-1', tool_name: 'Bash' }),
      });
      expect(await res.json()).toEqual({ decision: 'defer' });
    } finally {
      await new Promise((resolve) => server.close(resolve));
    }
  });

  it('posts a message with Allow/Deny buttons and resolves allow when Allow is tapped', async () => {
    const discordClient = createFakeDiscordClient();
    const thread = await registerActiveSession(discordClient, { token: 'tok-1', sessionId: 'sess-1', projectName: 'p1' });

    const server = await startServer(discordClient);
    const { port } = server.address();

    try {
      const responsePromise = fetch(`http://127.0.0.1:${port}/hook/permission-request`, {
        method: 'POST',
        body: JSON.stringify({ session_id: 'sess-1', tool_name: 'Bash' }),
      });

      // Give the route a tick to post the message and register as pending.
      await new Promise((resolve) => setTimeout(resolve, 50));
      expect(thread.messages).toHaveLength(1);
      const message = thread.messages[0];
      expect(message.components).toHaveLength(1);
      const buttonLabels = message.components[0].toJSON().components.map((b) => b.label);
      expect(buttonLabels).toEqual(['Allow', 'Deny']);

      discordClient.simulateButtonClick(`perm:${message.id}:allow`, { messageId: message.id });

      const res = await responsePromise;
      expect(await res.json()).toEqual({ decision: 'allow' });
    } finally {
      await new Promise((resolve) => server.close(resolve));
    }
  });

  it('resolves deny when Deny is tapped', async () => {
    const discordClient = createFakeDiscordClient();
    const thread = await registerActiveSession(discordClient, { token: 'tok-1', sessionId: 'sess-1', projectName: 'p1' });

    const server = await startServer(discordClient);
    const { port } = server.address();

    try {
      const responsePromise = fetch(`http://127.0.0.1:${port}/hook/permission-request`, {
        method: 'POST',
        body: JSON.stringify({ session_id: 'sess-1', tool_name: 'Bash' }),
      });

      await new Promise((resolve) => setTimeout(resolve, 50));
      const message = thread.messages[0];

      discordClient.simulateButtonClick(`perm:${message.id}:deny`, { messageId: message.id });

      const res = await responsePromise;
      expect(await res.json()).toEqual({ decision: 'deny' });
    } finally {
      await new Promise((resolve) => server.close(resolve));
    }
  });

  it('resolves as defer once the safety timeout elapses without a reaction', async () => {
    const discordClient = createFakeDiscordClient();
    await registerActiveSession(discordClient, { token: 'tok-1', sessionId: 'sess-1', projectName: 'p1' });

    const server = await startServer(discordClient, { safetyTimeoutMs: 50 });
    const { port } = server.address();

    try {
      const res = await fetch(`http://127.0.0.1:${port}/hook/permission-request`, {
        method: 'POST',
        body: JSON.stringify({ session_id: 'sess-1', tool_name: 'Bash' }),
      });
      expect(await res.json()).toEqual({ decision: 'defer' });
    } finally {
      await new Promise((resolve) => server.close(resolve));
    }
  });

  it('renders the Bash command (and description, if present) in a code block', async () => {
    const discordClient = createFakeDiscordClient();
    const thread = await registerActiveSession(discordClient, { token: 'tok-1', sessionId: 'sess-1', projectName: 'p1' });

    const server = await startServer(discordClient, { safetyTimeoutMs: 400 });
    const { port } = server.address();

    try {
      const responsePromise = fetch(`http://127.0.0.1:${port}/hook/permission-request`, {
        method: 'POST',
        body: JSON.stringify({
          session_id: 'sess-1',
          tool_name: 'Bash',
          tool_input: { command: 'rm -rf build', description: 'Clean the build directory' },
        }),
      });

      await new Promise((resolve) => setTimeout(resolve, 50));
      const message = thread.messages[0];
      expect(message.content).toContain('Clean the build directory');
      expect(message.content).toContain('```\nrm -rf build\n```');

      discordClient.simulateButtonClick(`perm:${message.id}:allow`, { messageId: message.id });
      await responsePromise;
    } finally {
      await new Promise((resolve) => server.close(resolve));
    }
  });

  it('renders the file path plus a diff-style preview for Edit', async () => {
    const discordClient = createFakeDiscordClient();
    const thread = await registerActiveSession(discordClient, { token: 'tok-1', sessionId: 'sess-1', projectName: 'p1' });

    const server = await startServer(discordClient, { safetyTimeoutMs: 400 });
    const { port } = server.address();

    try {
      const responsePromise = fetch(`http://127.0.0.1:${port}/hook/permission-request`, {
        method: 'POST',
        body: JSON.stringify({
          session_id: 'sess-1',
          tool_name: 'Edit',
          tool_input: { file_path: '/repo/src/index.js', old_string: 'const a = 1;', new_string: 'const a = 2;' },
        }),
      });

      await new Promise((resolve) => setTimeout(resolve, 50));
      const message = thread.messages[0];
      expect(message.content).toContain('/repo/src/index.js');
      expect(message.content).toContain('- const a = 1;');
      expect(message.content).toContain('+ const a = 2;');

      discordClient.simulateButtonClick(`perm:${message.id}:allow`, { messageId: message.id });
      await responsePromise;
    } finally {
      await new Promise((resolve) => server.close(resolve));
    }
  });

  it('renders the file path plus a diff-style preview of every edit for MultiEdit', async () => {
    const discordClient = createFakeDiscordClient();
    const thread = await registerActiveSession(discordClient, { token: 'tok-1', sessionId: 'sess-1', projectName: 'p1' });

    const server = await startServer(discordClient, { safetyTimeoutMs: 400 });
    const { port } = server.address();

    try {
      const responsePromise = fetch(`http://127.0.0.1:${port}/hook/permission-request`, {
        method: 'POST',
        body: JSON.stringify({
          session_id: 'sess-1',
          tool_name: 'MultiEdit',
          tool_input: {
            file_path: '/repo/src/index.js',
            edits: [
              { old_string: 'foo', new_string: 'bar' },
              { old_string: 'baz', new_string: 'qux' },
            ],
          },
        }),
      });

      await new Promise((resolve) => setTimeout(resolve, 50));
      const message = thread.messages[0];
      expect(message.content).toContain('/repo/src/index.js');
      expect(message.content).toContain('- foo');
      expect(message.content).toContain('+ bar');
      expect(message.content).toContain('- baz');
      expect(message.content).toContain('+ qux');

      discordClient.simulateButtonClick(`perm:${message.id}:allow`, { messageId: message.id });
      await responsePromise;
    } finally {
      await new Promise((resolve) => server.close(resolve));
    }
  });

  it('renders the file path plus a content preview for Write', async () => {
    const discordClient = createFakeDiscordClient();
    const thread = await registerActiveSession(discordClient, { token: 'tok-1', sessionId: 'sess-1', projectName: 'p1' });

    const server = await startServer(discordClient, { safetyTimeoutMs: 400 });
    const { port } = server.address();

    try {
      const responsePromise = fetch(`http://127.0.0.1:${port}/hook/permission-request`, {
        method: 'POST',
        body: JSON.stringify({
          session_id: 'sess-1',
          tool_name: 'Write',
          tool_input: { file_path: '/repo/notes.txt', content: 'hello world' },
        }),
      });

      await new Promise((resolve) => setTimeout(resolve, 50));
      const message = thread.messages[0];
      expect(message.content).toContain('/repo/notes.txt');
      expect(message.content).toContain('hello world');

      discordClient.simulateButtonClick(`perm:${message.id}:allow`, { messageId: message.id });
      await responsePromise;
    } finally {
      await new Promise((resolve) => server.close(resolve));
    }
  });

  it('renders tool name plus pretty-printed tool_input JSON for any other tool', async () => {
    const discordClient = createFakeDiscordClient();
    const thread = await registerActiveSession(discordClient, { token: 'tok-1', sessionId: 'sess-1', projectName: 'p1' });

    const server = await startServer(discordClient, { safetyTimeoutMs: 400 });
    const { port } = server.address();

    try {
      const responsePromise = fetch(`http://127.0.0.1:${port}/hook/permission-request`, {
        method: 'POST',
        body: JSON.stringify({
          session_id: 'sess-1',
          tool_name: 'WebFetch',
          tool_input: { url: 'https://example.com' },
        }),
      });

      await new Promise((resolve) => setTimeout(resolve, 50));
      const message = thread.messages[0];
      expect(message.content).toContain('**WebFetch**');
      expect(message.content).toContain('"url": "https://example.com"');

      discordClient.simulateButtonClick(`perm:${message.id}:allow`, { messageId: message.id });
      await responsePromise;
    } finally {
      await new Promise((resolve) => server.close(resolve));
    }
  });

  it('truncates a preview exceeding the safe max length with an explicit marker', async () => {
    const discordClient = createFakeDiscordClient();
    const thread = await registerActiveSession(discordClient, { token: 'tok-1', sessionId: 'sess-1', projectName: 'p1' });

    const server = await startServer(discordClient, { safetyTimeoutMs: 400 });
    const { port } = server.address();

    try {
      const responsePromise = fetch(`http://127.0.0.1:${port}/hook/permission-request`, {
        method: 'POST',
        body: JSON.stringify({
          session_id: 'sess-1',
          tool_name: 'Bash',
          tool_input: { command: 'x'.repeat(5000) },
        }),
      });

      await new Promise((resolve) => setTimeout(resolve, 50));
      const message = thread.messages[0];
      expect(message.content).toContain('…truncated');
      expect(message.content.length).toBeLessThan(2000);

      discordClient.simulateButtonClick(`perm:${message.id}:allow`, { messageId: message.id });
      await responsePromise;
    } finally {
      await new Promise((resolve) => server.close(resolve));
    }
  });

  it('a button tap on one session thread message never resolves another session pending request', async () => {
    const discordClient = createFakeDiscordClient();
    const threadA = await registerActiveSession(discordClient, { token: 'tok-1', sessionId: 'sess-1', projectName: 'p1' });
    const threadB = await registerActiveSession(discordClient, { token: 'tok-2', sessionId: 'sess-2', projectName: 'p2' });

    const server = await startServer(discordClient, { safetyTimeoutMs: 400 });
    const { port } = server.address();

    try {
      const responseA = fetch(`http://127.0.0.1:${port}/hook/permission-request`, {
        method: 'POST',
        body: JSON.stringify({ session_id: 'sess-1', tool_name: 'Bash' }),
      });
      const responseB = fetch(`http://127.0.0.1:${port}/hook/permission-request`, {
        method: 'POST',
        body: JSON.stringify({ session_id: 'sess-2', tool_name: 'Write' }),
      });

      await new Promise((resolve) => setTimeout(resolve, 50));
      const messageA = threadA.messages[0];
      const messageB = threadB.messages[0];
      expect(messageA.id).not.toBe(messageB.id);

      // Tap A's Allow button only. B gets no tap and must resolve via its
      // own safety timeout as defer, never as a side effect of A's tap.
      discordClient.simulateButtonClick(`perm:${messageA.id}:allow`, { messageId: messageA.id });

      const [resA, resB] = await Promise.all([responseA, responseB]);
      expect(await resA.json()).toEqual({ decision: 'allow' });
      expect(await resB.json()).toEqual({ decision: 'defer' });
    } finally {
      await new Promise((resolve) => server.close(resolve));
    }
  });
});
