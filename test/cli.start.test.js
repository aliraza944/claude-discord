import { describe, it, expect, vi } from 'vitest';
import { startCommand } from '../src/cli/commands/start.js';

function jsonResponse(body, ok = true, status = 200) {
  return { ok, status, json: async () => body };
}

describe('cli/commands/start.js', () => {
  it('creates a uniquely-named tmux session with CLAUDE_DISCORD_TOKEN set, and registers with the daemon', async () => {
    const newSession = vi.fn().mockResolvedValue(undefined);
    const requestJson = vi.fn().mockResolvedValue(jsonResponse({ token: 'fixed-token', threadId: 'thread-1' }));
    const readConfig = () => ({ port: 4790 });

    await startCommand('/home/x/my-project', {
      newSession,
      requestJson,
      readConfig,
      generateToken: () => 'fixed-token',
    });

    expect(newSession).toHaveBeenCalledWith({
      target: 'claude-discord-my-project-fixed-to',
      cwd: '/home/x/my-project',
      command: 'claude',
      env: { CLAUDE_DISCORD_TOKEN: 'fixed-token' },
    });

    expect(requestJson).toHaveBeenCalledWith('http://127.0.0.1:4790/register', {
      method: 'POST',
      body: { token: 'fixed-token', projectName: 'my-project', cwd: '/home/x/my-project', tmuxTarget: 'claude-discord-my-project-fixed-to' },
      timeoutMs: expect.any(Number),
    });
  });

  it('two concurrent starts against different projects generate distinct tokens and tmux targets', async () => {
    const newSession = vi.fn().mockResolvedValue(undefined);
    const requestJson = vi.fn().mockResolvedValue(jsonResponse({ token: 't', threadId: 'thread-x' }));
    const readConfig = () => ({ port: 4790 });

    await Promise.all([
      startCommand('/a/project-a', { newSession, requestJson, readConfig, generateToken: () => 'token-aaaaaaaa' }),
      startCommand('/b/project-b', { newSession, requestJson, readConfig, generateToken: () => 'token-bbbbbbbb' }),
    ]);

    const targets = newSession.mock.calls.map((call) => call[0].target);
    expect(new Set(targets).size).toBe(2);

    const registeredTokens = requestJson.mock.calls.map((call) => call[1].body.token);
    expect(new Set(registeredTokens).size).toBe(2);
  });

  it('reports an error and does not throw when the daemon is unreachable', async () => {
    const newSession = vi.fn().mockResolvedValue(undefined);
    const requestJson = vi.fn().mockRejectedValue(new Error('ECONNREFUSED'));
    const readConfig = () => ({ port: 4790 });
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    await expect(
      startCommand('/home/x/my-project', { newSession, requestJson, readConfig, generateToken: () => 'tok' })
    ).resolves.toBeUndefined();

    expect(errorSpy).toHaveBeenCalled();
    errorSpy.mockRestore();
  });
});
