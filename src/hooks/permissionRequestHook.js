import { readConfig } from '../config.js';
import { httpRequest } from '../httpClient.js';
import { readStdinJson } from './stdin.js';

const HEALTH_PROBE_TIMEOUT_MS = 1500;

/**
 * Fast liveness check against /health. Resolves false (never throws) on any
 * failure or timeout, so the caller can fall through to the normal local
 * prompt within roughly HEALTH_PROBE_TIMEOUT_MS.
 * @param {{ port: number, requestJson?: typeof httpRequest, timeoutMs?: number }} options
 */
export async function probeHealth({ port, requestJson = httpRequest, timeoutMs = HEALTH_PROBE_TIMEOUT_MS }) {
  try {
    const res = await requestJson(`http://127.0.0.1:${port}/health`, { timeoutMs });
    return res.ok;
  } catch {
    return false;
  }
}

/**
 * POSTs the raw hook payload to /hook/permission-request with no client-side
 * timeout — the daemon intentionally holds this open until a reaction,
 * safety timeout, pause, or unregistered-session check resolves it. Returns
 * the full `{ decision, updatedInput? }` body — `updatedInput`, when
 * present (e.g. an AskUserQuestion answered via its Discord form), carries
 * the resolved input straight back into the tool call.
 * @param {{ payload: any, port: number, requestJson?: typeof httpRequest }} options
 */
export async function requestDecision({ payload, port, requestJson = httpRequest }) {
  const res = await requestJson(`http://127.0.0.1:${port}/hook/permission-request`, {
    method: 'POST',
    body: payload,
  });
  return res.json();
}

/** PermissionRequest only supports allow/deny; defer means printing nothing. */
export function formatDecisionOutput({ decision, updatedInput } = {}) {
  if (decision !== 'allow' && decision !== 'deny') return null;
  const behavior = { behavior: decision };
  if (updatedInput) behavior.updatedInput = updatedInput;
  return JSON.stringify({
    hookSpecificOutput: { hookEventName: 'PermissionRequest', decision: behavior },
  });
}

export async function run() {
  const config = readConfig();
  const payload = await readStdinJson();

  const alive = await probeHealth({ port: config.port });
  if (!alive) return;

  try {
    const result = await requestDecision({ payload, port: config.port });
    const output = formatDecisionOutput(result);
    if (output) process.stdout.write(`${output}\n`);
  } catch {
    // treat as defer: print nothing, let Claude Code's own timeout govern.
  }
}
