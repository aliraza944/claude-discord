import { describe, it, expect, vi } from 'vitest';
import { reportNotification } from '../src/hooks/notificationHook.js';

describe('hooks/notificationHook.js reportNotification', () => {
  it('POSTs the raw hook payload to /hook/notification', async () => {
    const requestJson = vi.fn().mockResolvedValue({ ok: true });
    const payload = { session_id: 'sess-1', hook_event_name: 'Notification', message: 'idle' };

    await reportNotification({ payload, port: 4790, requestJson });

    expect(requestJson).toHaveBeenCalledWith('http://127.0.0.1:4790/hook/notification', {
      method: 'POST',
      body: payload,
      timeoutMs: expect.any(Number),
    });
  });

  it('swallows errors from the daemon request (fire-and-forget, never blocks Claude Code)', async () => {
    const requestJson = vi.fn().mockRejectedValue(new Error('ECONNREFUSED'));
    await expect(
      reportNotification({ payload: { session_id: 'sess-1' }, port: 4790, requestJson })
    ).resolves.toBeUndefined();
  });
});
