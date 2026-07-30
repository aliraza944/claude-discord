import { describe, it, expect, vi } from 'vitest';
import { detachCommand } from '../src/cli/commands/detach.js';

function jsonResponse(body, ok = true, status = 200) {
  return { ok, status, json: async () => body };
}

describe('cli/commands/detach.js', () => {
  it('derives the tmux target and posts it to /detach, reporting success', async () => {
    const currentPaneTarget = vi.fn().mockResolvedValue('main:1.0');
    const requestJson = vi.fn().mockResolvedValue(jsonResponse({ detached: true, sessionId: 'sess-1', threadId: 'thread-1' }));
    const readConfig = () => ({ port: 4790 });
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

    await detachCommand({ currentPaneTarget, requestJson, readConfig });

    expect(requestJson).toHaveBeenCalledWith('http://127.0.0.1:4790/detach', {
      method: 'POST',
      body: { tmuxTarget: 'main:1.0' },
      timeoutMs: expect.any(Number),
    });
    expect(logSpy).toHaveBeenCalledWith(expect.stringMatching(/detach/i));
    logSpy.mockRestore();
  });

  it('prints a clear, non-error message when no session was attached in this pane', async () => {
    const currentPaneTarget = vi.fn().mockResolvedValue('main:1.0');
    const requestJson = vi.fn().mockResolvedValue(jsonResponse({ detached: false }));
    const readConfig = () => ({ port: 4790 });
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    await detachCommand({ currentPaneTarget, requestJson, readConfig });

    expect(logSpy).toHaveBeenCalledWith(expect.stringContaining('No attached session in this pane.'));
    expect(errorSpy).not.toHaveBeenCalled();
    logSpy.mockRestore();
    errorSpy.mockRestore();
  });

  it('errors without calling the daemon when not inside a tmux pane', async () => {
    const currentPaneTarget = vi.fn().mockRejectedValue(new Error('Not running inside a tmux session'));
    const requestJson = vi.fn();
    const readConfig = () => ({ port: 4790 });
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    await detachCommand({ currentPaneTarget, requestJson, readConfig });

    expect(requestJson).not.toHaveBeenCalled();
    expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining('tmux target'));
    errorSpy.mockRestore();
  });

  it('reports an error and does not throw when the daemon is unreachable', async () => {
    const currentPaneTarget = vi.fn().mockResolvedValue('main:1.0');
    const requestJson = vi.fn().mockRejectedValue(new Error('ECONNREFUSED'));
    const readConfig = () => ({ port: 4790 });
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    await expect(detachCommand({ currentPaneTarget, requestJson, readConfig })).resolves.toBeUndefined();

    expect(errorSpy).toHaveBeenCalled();
    errorSpy.mockRestore();
  });

  it('reports a non-ok daemon response as an error', async () => {
    const currentPaneTarget = vi.fn().mockResolvedValue('main:1.0');
    const requestJson = vi.fn().mockResolvedValue(jsonResponse({ error: 'discord client not connected' }, false, 503));
    const readConfig = () => ({ port: 4790 });
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    await detachCommand({ currentPaneTarget, requestJson, readConfig });

    expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining('503'));
    errorSpy.mockRestore();
  });
});
