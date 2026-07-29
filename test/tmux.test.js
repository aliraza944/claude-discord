import { describe, it, expect, afterEach } from 'vitest';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { hasSession, newSession, sendText, capturePane } from '../src/tmux.js';

const execFileAsync = promisify(execFile);

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
