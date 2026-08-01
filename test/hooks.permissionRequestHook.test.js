import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import net from 'node:net';
import http from 'node:http';
import { probeHealth, requestDecision, formatDecisionOutput } from '../src/hooks/permissionRequestHook.js';

describe('hooks/permissionRequestHook.js', () => {
  describe('probeHealth', () => {
    it('resolves true when /health responds ok', async () => {
      const server = http.createServer((req, res) => {
        res.writeHead(200);
        res.end();
      });
      await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
      const port = server.address().port;

      try {
        expect(await probeHealth({ port })).toBe(true);
      } finally {
        await new Promise((resolve) => server.close(resolve));
      }
    });

    it('resolves false, within budget, when nothing is listening on the port', async () => {
      // Grab an ephemeral port and immediately release it so nothing listens there.
      const probe = net.createServer();
      await new Promise((resolve) => probe.listen(0, '127.0.0.1', resolve));
      const port = probe.address().port;
      await new Promise((resolve) => probe.close(resolve));

      const start = performance.now();
      const alive = await probeHealth({ port, timeoutMs: 1500 });
      const elapsedMs = performance.now() - start;

      expect(alive).toBe(false);
      expect(elapsedMs).toBeLessThan(2000);
    });

    it('resolves false when the health check times out', async () => {
      const server = http.createServer(() => {
        // never responds
      });
      await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
      const port = server.address().port;

      try {
        const alive = await probeHealth({ port, timeoutMs: 100 });
        expect(alive).toBe(false);
      } finally {
        await new Promise((resolve) => server.close(resolve));
      }
    });
  });

  describe('requestDecision', () => {
    let server;
    let port;

    beforeEach(async () => {
      server = http.createServer((req, res) => {
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ decision: 'allow' }));
      });
      await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
      port = server.address().port;
    });

    afterEach(async () => {
      await new Promise((resolve) => server.close(resolve));
    });

    it('POSTs the raw payload and returns the daemon decision', async () => {
      const result = await requestDecision({ payload: { session_id: 'sess-1', tool_name: 'Bash' }, port });
      expect(result).toEqual({ decision: 'allow' });
    });
  });

  describe('formatDecisionOutput', () => {
    it('formats allow', () => {
      expect(JSON.parse(formatDecisionOutput({ decision: 'allow' }))).toEqual({
        hookSpecificOutput: { hookEventName: 'PermissionRequest', decision: { behavior: 'allow' } },
      });
    });

    it('formats deny', () => {
      expect(JSON.parse(formatDecisionOutput({ decision: 'deny' }))).toEqual({
        hookSpecificOutput: { hookEventName: 'PermissionRequest', decision: { behavior: 'deny' } },
      });
    });

    it('folds updatedInput into the decision when present (e.g. an AskUserQuestion answered via Discord)', () => {
      const updatedInput = { questions: [{ question: 'Q?' }], answers: { 'Q?': 'A' } };
      expect(JSON.parse(formatDecisionOutput({ decision: 'allow', updatedInput }))).toEqual({
        hookSpecificOutput: { hookEventName: 'PermissionRequest', decision: { behavior: 'allow', updatedInput } },
      });
    });

    it('returns null for defer (print nothing)', () => {
      expect(formatDecisionOutput({ decision: 'defer' })).toBeNull();
    });

    it('returns null for any unrecognized value', () => {
      expect(formatDecisionOutput({})).toBeNull();
    });
  });
});
