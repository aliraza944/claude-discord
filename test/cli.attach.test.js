import { describe, it, expect, vi } from 'vitest';
import { attachCommand } from '../src/cli/commands/attach.js';

function jsonResponse(body, ok = true, status = 200) {
  return { ok, status, json: async () => body };
}

// Short-circuits ensureDaemonRunning so existing-daemon tests never touch requestJson for /health.
const daemonAlreadyRunning = () => vi.fn().mockReturnValue({ running: true, pid: 123, alreadyRunning: true });

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
      daemonStatus: daemonAlreadyRunning(),
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
        daemonStatus: daemonAlreadyRunning(),
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
      daemonStatus: daemonAlreadyRunning(),
      env: { CLAUDE_CODE_SESSION_ID: 'sess-1' },
      cwd: () => '/x',
    });

    expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining('503'));
    errorSpy.mockRestore();
  });

  it('starts the daemon and waits for the bot to come online before attaching when the daemon is not running', async () => {
    const currentPaneTarget = vi.fn().mockResolvedValue('main:1.0');
    // First /status poll: HTTP up but bot not connected yet. Second: bot online. Third call is the real /attach POST.
    const requestJson = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse({ paused: false, botOnline: false }))
      .mockResolvedValueOnce(jsonResponse({ paused: false, botOnline: true }))
      .mockResolvedValueOnce(jsonResponse({ sessionId: 'sess-1', threadId: 'thread-1' }));
    const readConfig = () => ({ port: 4790 });
    const daemonStatus = vi.fn().mockReturnValue({ running: false, pid: null });
    const startDaemonProcess = vi.fn().mockReturnValue({ running: true, pid: 999, alreadyRunning: false });
    const wait = vi.fn().mockResolvedValue(undefined);
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

    await attachCommand({
      currentPaneTarget,
      requestJson,
      readConfig,
      daemonStatus,
      startDaemonProcess,
      wait,
      env: { CLAUDE_CODE_SESSION_ID: 'sess-1' },
      cwd: () => '/home/x/my-project',
    });

    expect(startDaemonProcess).toHaveBeenCalledTimes(1);
    expect(requestJson).toHaveBeenNthCalledWith(1, 'http://127.0.0.1:4790/status', { timeoutMs: 500 });
    expect(requestJson).toHaveBeenNthCalledWith(2, 'http://127.0.0.1:4790/status', { timeoutMs: 500 });
    expect(requestJson).toHaveBeenNthCalledWith(3, 'http://127.0.0.1:4790/attach', {
      method: 'POST',
      body: { sessionId: 'sess-1', projectName: 'my-project', cwd: '/home/x/my-project', tmuxTarget: 'main:1.0' },
      timeoutMs: expect.any(Number),
    });
    logSpy.mockRestore();
  });

  it('gives up waiting for the bot after the timeout and still attempts /attach, surfacing the resulting error', async () => {
    const currentPaneTarget = vi.fn().mockResolvedValue('main:1.0');
    // /status never reports botOnline; the eventual /attach POST fails against a not-yet-connected daemon.
    const requestJson = vi
      .fn()
      .mockResolvedValue(jsonResponse({ paused: false, botOnline: false }))
      .mockName('requestJson');
    const readConfig = () => ({ port: 4790 });
    const daemonStatus = vi.fn().mockReturnValue({ running: false, pid: null });
    const startDaemonProcess = vi.fn().mockReturnValue({ running: true, pid: 999, alreadyRunning: false });
    let now = 0;
    const wait = vi.fn().mockImplementation(() => {
      now += 300;
      return Promise.resolve();
    });
    const dateSpy = vi.spyOn(Date, 'now').mockImplementation(() => now);
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

    requestJson.mockImplementation((url) => {
      if (url.endsWith('/attach')) return Promise.resolve(jsonResponse({}, false, 503));
      return Promise.resolve(jsonResponse({ paused: false, botOnline: false }));
    });

    await attachCommand({
      currentPaneTarget,
      requestJson,
      readConfig,
      daemonStatus,
      startDaemonProcess,
      wait,
      env: { CLAUDE_CODE_SESSION_ID: 'sess-1' },
      cwd: () => '/x',
    });

    expect(requestJson).toHaveBeenLastCalledWith('http://127.0.0.1:4790/attach', expect.any(Object));
    expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining('503'));
    dateSpy.mockRestore();
    errorSpy.mockRestore();
    logSpy.mockRestore();
  });

  it('does not start the daemon a second time if it is already running', async () => {
    const currentPaneTarget = vi.fn().mockResolvedValue('main:1.0');
    const requestJson = vi.fn().mockResolvedValue(jsonResponse({ sessionId: 'sess-1', threadId: 'thread-1' }));
    const readConfig = () => ({ port: 4790 });
    const daemonStatus = vi.fn().mockReturnValue({ running: true, pid: 123, alreadyRunning: true });
    const startDaemonProcess = vi.fn();
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

    await attachCommand({
      currentPaneTarget,
      requestJson,
      readConfig,
      daemonStatus,
      startDaemonProcess,
      env: { CLAUDE_CODE_SESSION_ID: 'sess-1' },
      cwd: () => '/x',
    });

    expect(startDaemonProcess).not.toHaveBeenCalled();
    expect(requestJson).toHaveBeenCalledTimes(1);
    logSpy.mockRestore();
  });
});
