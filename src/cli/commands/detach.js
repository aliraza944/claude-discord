import { currentPaneTarget as currentPaneTargetDefault } from '../../tmux.js';
import { readConfig as readConfigDefault } from '../../config.js';
import { httpRequest } from '../../httpClient.js';

// /detach deletes the thread and its starter message (two Discord
// round-trips) before responding, which can exceed a few seconds.
const DETACH_TIMEOUT_MS = 20000;

/**
 * Unwires the Claude Code session running in the current tmux pane from
 * Discord, reversing an earlier `attach`. Takes no arguments — the tmux
 * target is derived the same way `attach` derives it.
 * @param {{ currentPaneTarget?: typeof currentPaneTargetDefault, requestJson?: typeof httpRequest, readConfig?: typeof readConfigDefault }} [deps]
 */
export async function detachCommand({
  currentPaneTarget = currentPaneTargetDefault,
  requestJson = httpRequest,
  readConfig = readConfigDefault,
} = {}) {
  let tmuxTarget;
  try {
    tmuxTarget = await currentPaneTarget();
  } catch (err) {
    console.error(`Could not determine tmux target: ${err.message}`);
    return;
  }

  const config = readConfig();

  try {
    const res = await requestJson(`http://127.0.0.1:${config.port}/detach`, {
      method: 'POST',
      body: { tmuxTarget },
      timeoutMs: DETACH_TIMEOUT_MS,
    });
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      console.error(`Failed to detach session: ${res.status}${body.error ? ` (${body.error})` : ''}`);
      return;
    }

    const body = await res.json();
    if (!body.detached) {
      console.log('No attached session in this pane.');
      return;
    }
    console.log('Session detached.');
  } catch (err) {
    console.error(`Could not reach daemon at 127.0.0.1:${config.port}: ${err.message}`);
  }
}
