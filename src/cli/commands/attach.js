import path from 'node:path';
import { currentPaneTarget as currentPaneTargetDefault } from '../../tmux.js';
import { readConfig as readConfigDefault } from '../../config.js';
import { httpRequest } from '../../httpClient.js';
import {
  daemonStatus as daemonStatusDefault,
  startDaemonProcess as startDaemonProcessDefault,
} from '../../daemon/lifecycle.js';

const ATTACH_TIMEOUT_MS = 5000;
const DAEMON_READY_TIMEOUT_MS = 15000;
const DAEMON_READY_POLL_INTERVAL_MS = 300;

const defaultWait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * If the daemon isn't running, starts it and polls /status until the
 * Discord bot itself is online (`botOnline: true`) or DAEMON_READY_TIMEOUT_MS
 * elapses — whichever comes first. The daemon's HTTP server comes up well
 * before its discord.js client finishes logging in (see run.js's fire-and-
 * forget `discordClient.login()`), so waiting on plain HTTP reachability
 * isn't enough — POSTing /attach against a client that exists but hasn't
 * connected yet crashes trying to fetch/create a thread. Never throws; on
 * timeout it just returns, leaving the subsequent /attach call to report
 * the failure.
 * @param {{ port: number, daemonStatus: typeof daemonStatusDefault, startDaemonProcess: typeof startDaemonProcessDefault, requestJson: typeof httpRequest, wait: typeof defaultWait }} options
 */
export async function ensureDaemonRunning({ port, daemonStatus, startDaemonProcess, requestJson, wait }) {
  if (daemonStatus().running) return;

  console.log('Daemon not running — starting it and waiting for the Discord bot to connect...');
  startDaemonProcess();

  const deadline = Date.now() + DAEMON_READY_TIMEOUT_MS;
  while (Date.now() < deadline) {
    try {
      const res = await requestJson(`http://127.0.0.1:${port}/status`, { timeoutMs: 500 });
      if (res.ok) {
        const body = await res.json();
        if (body.botOnline) return;
      }
    } catch {
      // not up yet
    }
    await wait(DAEMON_READY_POLL_INTERVAL_MS);
  }
}

/**
 * Wires the Claude Code session running in the current tmux pane up to
 * Discord, gated by Accept/Discard button approval. Takes no arguments —
 * the session's identity comes entirely from its own environment/cwd.
 * @param {{ currentPaneTarget?: typeof currentPaneTargetDefault, requestJson?: typeof httpRequest, readConfig?: typeof readConfigDefault, daemonStatus?: typeof daemonStatusDefault, startDaemonProcess?: typeof startDaemonProcessDefault, wait?: typeof defaultWait, env?: NodeJS.ProcessEnv, cwd?: () => string }} [deps]
 */
export async function attachCommand({
  currentPaneTarget = currentPaneTargetDefault,
  requestJson = httpRequest,
  readConfig = readConfigDefault,
  daemonStatus = daemonStatusDefault,
  startDaemonProcess = startDaemonProcessDefault,
  wait = defaultWait,
  env = process.env,
  cwd = () => process.cwd(),
} = {}) {
  const sessionId = env.CLAUDE_CODE_SESSION_ID;
  if (!sessionId) {
    console.error('CLAUDE_CODE_SESSION_ID is not set — attach must be run from inside a running Claude Code session.');
    return;
  }

  let tmuxTarget;
  try {
    tmuxTarget = await currentPaneTarget();
  } catch (err) {
    console.error(`Could not determine tmux target: ${err.message}`);
    return;
  }

  const resolvedCwd = path.resolve(cwd());
  const projectName = path.basename(resolvedCwd);
  const config = readConfig();

  await ensureDaemonRunning({ port: config.port, daemonStatus, startDaemonProcess, requestJson, wait });

  try {
    const res = await requestJson(`http://127.0.0.1:${config.port}/attach`, {
      method: 'POST',
      body: { sessionId, projectName, cwd: resolvedCwd, tmuxTarget },
      timeoutMs: ATTACH_TIMEOUT_MS,
    });
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      console.error(`Failed to attach session: ${res.status}${body.error ? ` (${body.error})` : ''}`);
      return;
    }
    console.log('Attach requested; awaiting approval in Discord (tap Accept or Discard).');
  } catch (err) {
    console.error(`Could not reach daemon at 127.0.0.1:${config.port}: ${err.message}`);
  }
}
