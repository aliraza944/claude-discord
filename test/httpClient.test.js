import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import http from 'node:http';
import { httpRequest } from '../src/httpClient.js';

describe('httpClient.js', () => {
  let server;
  let port;

  beforeEach(async () => {
    server = http.createServer((req, res) => {
      const chunks = [];
      req.on('data', (c) => chunks.push(c));
      req.on('end', () => {
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ method: req.method, body: chunks.length ? JSON.parse(Buffer.concat(chunks)) : null }));
      });
    });
    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
    port = server.address().port;
  });

  afterEach(async () => {
    await new Promise((resolve) => server.close(resolve));
  });

  it('defaults to GET with no body', async () => {
    const res = await httpRequest(`http://127.0.0.1:${port}/`);
    expect(await res.json()).toEqual({ method: 'GET', body: null });
  });

  it('sends a JSON body on POST', async () => {
    const res = await httpRequest(`http://127.0.0.1:${port}/`, {
      method: 'POST',
      body: { hello: 'world' },
    });
    expect(await res.json()).toEqual({ method: 'POST', body: { hello: 'world' } });
  });

  it('aborts once timeoutMs elapses against an unresponsive server', async () => {
    const stuckServer = http.createServer(() => {
      // never responds
    });
    await new Promise((resolve) => stuckServer.listen(0, '127.0.0.1', resolve));
    const stuckPort = stuckServer.address().port;

    await expect(
      httpRequest(`http://127.0.0.1:${stuckPort}/`, { timeoutMs: 100 })
    ).rejects.toThrow();

    await new Promise((resolve) => stuckServer.close(resolve));
  });
});
