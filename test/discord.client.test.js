import { describe, it, expect, vi } from 'vitest';
import { createDiscordClient } from '../src/discord/client.js';

describe('createDiscordClient', () => {
  it('logs client errors instead of letting them crash the process', () => {
    const client = createDiscordClient();
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});

    expect(() => client.emit('error', new Error('Connect Timeout Error'))).not.toThrow();
    expect(consoleError).toHaveBeenCalledWith('Discord client error:', 'Connect Timeout Error');

    consoleError.mockRestore();
    client.destroy();
  });
});
