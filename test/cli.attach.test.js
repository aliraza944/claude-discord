import { describe, it, expect, vi } from 'vitest';
import { attachCommand } from '../src/cli/commands/attach.js';

function jsonResponse(body, ok = true, status = 200) {
  return { ok, status, json: async () => body };
}

describe('cli/commands/attach.js', () => {
  it('derives sessionId/cwd/projectName and posts them plus the tmux target to /attach', async () => {
    const currentPaneTarget = vi.fn().mockResolvedValue('main:1.0');
    const requestJson = vi.fn().mockResolvedValue(jsonResponse({ sessionId: 'sess-1', threadId: 'thread-1' }));
    const readConfig = () => ({ port: 4790 });
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

    await attachCommand({
      currentPaneTarget,
      requestJson,
      readConfig,
      env: { CLAUDE_CODE_SESSION_ID: 'sess-1' },
      cwd: () => '/home/x/my-project',
    });

    expect(requestJson).toHaveBeenCalledWith('http://127.0.0.1:4790/attach', {
      method: 'POST',
      body: { sessionId: 'sess-1', projectName: 'my-project', cwd: '/home/x/my-project', tmuxTarget: 'main:1.0' },
      timeoutMs: expect.any(Number),
    });
    expect(logSpy).toHaveBeenCalled();
    logSpy.mockRestore();
  });

  it('errors without calling the daemon when CLAUDE_CODE_SESSION_ID is unset', async () => {
    const currentPaneTarget = vi.fn();
    const requestJson = vi.fn();
    const readConfig = () => ({ port: 4790 });
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    await attachCommand({ currentPaneTarget, requestJson, readConfig, env: {}, cwd: () => '/x' });

    expect(currentPaneTarget).not.toHaveBeenCalled();
    expect(requestJson).not.toHaveBeenCalled();
    expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining('CLAUDE_CODE_SESSION_ID'));
    errorSpy.mockRestore();
  });

  it('errors without calling the daemon when not inside a tmux pane', async () => {
    const currentPaneTarget = vi.fn().mockRejectedValue(new Error('Not running inside a tmux session'));
    const requestJson = vi.fn();
    const readConfig = () => ({ port: 4790 });
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    await attachCommand({
      currentPaneTarget,
      requestJson,
      readConfig,
      env: { CLAUDE_CODE_SESSION_ID: 'sess-1' },
      cwd: () => '/x',
    });

    expect(requestJson).not.toHaveBeenCalled();
    expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining('tmux target'));
    errorSpy.mockRestore();
  });

  it('reports an error and does not throw when the daemon is unreachable', async () => {
    const currentPaneTarget = vi.fn().mockResolvedValue('main:1.0');
    const requestJson = vi.fn().mockRejectedValue(new Error('ECONNREFUSED'));
    const readConfig = () => ({ port: 4790 });
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    await expect(
      attachCommand({
        currentPaneTarget,
        requestJson,
        readConfig,
        env: { CLAUDE_CODE_SESSION_ID: 'sess-1' },
        cwd: () => '/x',
      })
    ).resolves.toBeUndefined();

    expect(errorSpy).toHaveBeenCalled();
    errorSpy.mockRestore();
  });

  it('reports a non-ok daemon response as an error', async () => {
    const currentPaneTarget = vi.fn().mockResolvedValue('main:1.0');
    const requestJson = vi.fn().mockResolvedValue(jsonResponse({ error: 'discord client not connected' }, false, 503));
    const readConfig = () => ({ port: 4790 });
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    await attachCommand({
      currentPaneTarget,
      requestJson,
      readConfig,
      env: { CLAUDE_CODE_SESSION_ID: 'sess-1' },
      cwd: () => '/x',
    });

    expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining('503'));
    errorSpy.mockRestore();
  });
});
