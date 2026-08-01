import path from 'node:path';
import { currentPaneTarget as currentPaneTargetDefault } from '../../tmux.js';
import { readConfig as readConfigDefault } from '../../config.js';
import { httpRequest } from '../../httpClient.js';

const ATTACH_TIMEOUT_MS = 5000;

/**
 * Wires the Claude Code session running in the current tmux pane up to
 * Discord, gated by Accept/Discard button approval. Takes no arguments —
 * the session's identity comes entirely from its own environment/cwd.
 * @param {{ currentPaneTarget?: typeof currentPaneTargetDefault, requestJson?: typeof httpRequest, readConfig?: typeof readConfigDefault, env?: NodeJS.ProcessEnv, cwd?: () => string }} [deps]
 */
export async function attachCommand({
  currentPaneTarget = currentPaneTargetDefault,
  requestJson = httpRequest,
  readConfig = readConfigDefault,
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
