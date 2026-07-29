import { describe, it, expect, vi } from 'vitest';
import { pauseCommand, resumeCommand } from '../src/cli/commands/control.js';

function jsonResponse(body, ok = true, status = 200) {
  return { ok, status, json: async () => body };
}

describe('cli/commands/control.js', () => {
  it('pauseCommand calls the daemon control route when the daemon is reachable', async () => {
    const requestJson = vi.fn().mockResolvedValue(jsonResponse({ paused: true }));
    const readConfig = () => ({ port: 4790 });
    const setPausedDirect = vi.fn();
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

    await pauseCommand({ requestJson, readConfig, setPausedDirect });

    expect(requestJson).toHaveBeenCalledWith('http://127.0.0.1:4790/control/pause', {
      method: 'POST',
      timeoutMs: expect.any(Number),
    });
    expect(setPausedDirect).not.toHaveBeenCalled();
    logSpy.mockRestore();
  });

  it('resumeCommand calls the daemon control route when the daemon is reachable', async () => {
    const requestJson = vi.fn().mockResolvedValue(jsonResponse({ paused: false }));
    const readConfig = () => ({ port: 4790 });
    const setPausedDirect = vi.fn();
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

    await resumeCommand({ requestJson, readConfig, setPausedDirect });

    expect(requestJson).toHaveBeenCalledWith('http://127.0.0.1:4790/control/resume', {
      method: 'POST',
      timeoutMs: expect.any(Number),
    });
    expect(setPausedDirect).not.toHaveBeenCalled();
    logSpy.mockRestore();
  });

  it('pauseCommand falls back to a direct state-file write when the daemon is unreachable', async () => {
    const requestJson = vi.fn().mockRejectedValue(new Error('ECONNREFUSED'));
    const readConfig = () => ({ port: 4790 });
    const setPausedDirect = vi.fn().mockResolvedValue({ paused: true });
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

    await pauseCommand({ requestJson, readConfig, setPausedDirect });

    expect(setPausedDirect).toHaveBeenCalledWith(true);
    logSpy.mockRestore();
  });

  it('resumeCommand falls back to a direct state-file write when the daemon is unreachable', async () => {
    const requestJson = vi.fn().mockRejectedValue(new Error('ECONNREFUSED'));
    const readConfig = () => ({ port: 4790 });
    const setPausedDirect = vi.fn().mockResolvedValue({ paused: false });
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

    await resumeCommand({ requestJson, readConfig, setPausedDirect });

    expect(setPausedDirect).toHaveBeenCalledWith(false);
    logSpy.mockRestore();
  });

  it('falls back to a direct state-file write when the daemon responds with an error status', async () => {
    const requestJson = vi.fn().mockResolvedValue(jsonResponse({ error: 'boom' }, false, 500));
    const readConfig = () => ({ port: 4790 });
    const setPausedDirect = vi.fn().mockResolvedValue({ paused: true });
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

    await pauseCommand({ requestJson, readConfig, setPausedDirect });

    expect(setPausedDirect).toHaveBeenCalledWith(true);
    logSpy.mockRestore();
  });
});
