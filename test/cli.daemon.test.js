import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const CLI = path.resolve(__dirname, '../bin/claude-discord.js');

function run(args, env) {
  return execFileSync(process.execPath, [CLI, ...args], { env, encoding: 'utf8' });
}

async function waitForHealthy(port, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(`http://127.0.0.1:${port}/health`);
      if (res.ok) return true;
    } catch {
      // not up yet
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  return false;
}

describe('claude-discord daemon lifecycle (integration)', () => {
  let home;
  let env;
  let port;

  beforeAll(() => {
    home = mkdtempSync(path.join(tmpdir(), 'claude-discord-cli-'));
    port = 41000 + Math.floor(Math.random() * 4000);
    env = { ...process.env, CLAUDE_DISCORD_HOME: home };
    writeFileSync(path.join(home, 'config.json'), JSON.stringify({ port }));
  });

  afterAll(() => {
    try {
      run(['daemon', 'stop'], env);
    } catch {
      // already stopped
    }
    rmSync(home, { recursive: true, force: true });
  });

  it('starts a detached daemon, reports running status, serves /health, then stops cleanly', async () => {
    const startOut = run(['daemon', 'start'], env);
    expect(startOut).toMatch(/daemon started/);

    const healthy = await waitForHealthy(port, 5000);
    expect(healthy).toBe(true);

    const statusOut = run(['daemon', 'status'], env);
    expect(statusOut).toMatch(/running/);

    const topLevelStatusOut = run(['status'], env);
    expect(topLevelStatusOut).toMatch(/daemon: running/);
    expect(topLevelStatusOut).toMatch(/paused: false/);

    const stopOut = run(['daemon', 'stop'], env);
    expect(stopOut).toMatch(/daemon stopped/);

    const deadline = Date.now() + 3000;
    let stillRunning = true;
    while (Date.now() < deadline) {
      const out = run(['daemon', 'status'], env);
      if (/not running/.test(out)) {
        stillRunning = false;
        break;
      }
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    expect(stillRunning).toBe(false);
  }, 15000);
});
