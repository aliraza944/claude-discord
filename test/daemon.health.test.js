import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { createDaemonServer } from '../src/daemon/run.js';

describe('daemon http server', () => {
  let server;
  let port;

  beforeEach(async () => {
    server = createDaemonServer({});
    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
    port = server.address().port;
  });

  afterEach(async () => {
    await new Promise((resolve) => server.close(resolve));
  });

  it('responds ok on GET /health', async () => {
    const res = await fetch(`http://127.0.0.1:${port}/health`);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
  });

  it('404s on unknown routes', async () => {
    const res = await fetch(`http://127.0.0.1:${port}/nope`);
    expect(res.status).toBe(404);
  });

  it('disables the default 5-minute requestTimeout/headersTimeout', () => {
    expect(server.requestTimeout).toBe(0);
    expect(server.headersTimeout).toBe(0);
  });
});
