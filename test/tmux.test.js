import { describe, it, expect, afterEach } from 'vitest';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
import { hasSession, newSession, sendText, capturePane, currentPaneTarget } from '../src/tmux.js';

const execFileAsync = promisify(execFile);
const tmuxModulePath = fileURLToPath(new URL('../src/tmux.js', import.meta.url));

// Seam 2 (spec.md): a small integration test against the real tmux binary,
// since execFile-based argv-array send-keys/new-session/capture-pane is an
// OS-process boundary fakes can't verify.
describe('tmux.js (real tmux)', () => {
  const target = `claude-discord-test-${process.pid}`;

  afterEach(async () => {
    try {
      await execFileAsync('tmux', ['kill-session', '-t', target]);
    } catch {
      // already gone
    }
  });

  it('creates a session with env injected via -e, and reports hasSession', async () => {
    expect(await hasSession(target)).toBe(false);

    await newSession({
      target,
      cwd: '/tmp',
      command: 'sh',
      args: ['-c', 'echo "TOKEN=$CLAUDE_DISCORD_TOKEN"; sleep 300'],
      env: { CLAUDE_DISCORD_TOKEN: 'test-token-123' },
    });

    expect(await hasSession(target)).toBe(true);

    await new Promise((resolve) => setTimeout(resolve, 300));
    const pane = await capturePane(target);
    expect(pane).toContain('TOKEN=test-token-123');
  });

  it('sends literal text (including shell-special characters) via sendText, followed by Enter', async () => {
    await newSession({ target, cwd: '/tmp', command: 'cat' });
    await new Promise((resolve) => setTimeout(resolve, 300));

    await sendText(target, '-rf $(rm everything); echo hi');
    await new Promise((resolve) => setTimeout(resolve, 300));

    const pane = await capturePane(target);
    expect(pane).toContain('-rf $(rm everything); echo hi');
  });
});

// Seam 2 (ticket 01): currentPaneTarget must resolve to the target of the
// real pane it's invoked from, not a mocked value — so we run it as a node
// subprocess inside a throwaway tmux session and read the result back off
// the pane, rather than calling it in-process (this test process isn't
// itself running as that session's pane).
describe('currentPaneTarget (real tmux)', () => {
  const target = `claude-discord-selfid-test-${process.pid}`;

  afterEach(async () => {
    try {
      await execFileAsync('tmux', ['kill-session', '-t', target]);
    } catch {
      // already gone
    }
  });

  it('resolves to the real #S:#I.#P target of the pane it runs in', async () => {
    await newSession({ target, cwd: '/tmp', command: 'sh' });
    await new Promise((resolve) => setTimeout(resolve, 300));

    const script = `import('${tmuxModulePath}').then(m => m.currentPaneTarget()).then(t => console.log('RESULT:' + t))`;
    await sendText(target, `node -e "${script}"`);
    await new Promise((resolve) => setTimeout(resolve, 1000));

    const pane = await capturePane(target);
    expect(pane).toContain(`RESULT:${target}:1.0`);
  });

  it('rejects when TMUX is not set', async () => {
    const previous = process.env.TMUX;
    delete process.env.TMUX;
    try {
      await expect(currentPaneTarget()).rejects.toThrow(/not running inside a tmux session/i);
    } finally {
      if (previous !== undefined) process.env.TMUX = previous;
    }
  });
});
