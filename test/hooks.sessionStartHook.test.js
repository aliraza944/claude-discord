import { describe, it, expect, vi } from 'vitest';
import { reportSessionStart } from '../src/hooks/sessionStartHook.js';

describe('hooks/sessionStartHook.js reportSessionStart', () => {
  it('POSTs token and session_id to /hook/session-start', async () => {
    const requestJson = vi.fn().mockResolvedValue({ ok: true });

    await reportSessionStart({ token: 'tok-1', sessionId: 'sess-1', port: 4790, requestJson });

    expect(requestJson).toHaveBeenCalledWith('http://127.0.0.1:4790/hook/session-start', {
      method: 'POST',
      body: { token: 'tok-1', session_id: 'sess-1' },
      timeoutMs: expect.any(Number),
    });
  });

  it('does nothing when token is missing', async () => {
    const requestJson = vi.fn();
    await reportSessionStart({ token: undefined, sessionId: 'sess-1', port: 4790, requestJson });
    expect(requestJson).not.toHaveBeenCalled();
  });

  it('does nothing when session_id is missing', async () => {
    const requestJson = vi.fn();
    await reportSessionStart({ token: 'tok-1', sessionId: undefined, port: 4790, requestJson });
    expect(requestJson).not.toHaveBeenCalled();
  });

  it('swallows errors from the daemon request (never blocks session startup)', async () => {
    const requestJson = vi.fn().mockRejectedValue(new Error('ECONNREFUSED'));
    await expect(
      reportSessionStart({ token: 'tok-1', sessionId: 'sess-1', port: 4790, requestJson })
    ).resolves.toBeUndefined();
  });
});
