import { readConfig as readConfigDefault } from '../../config.js';
import { httpRequest } from '../../httpClient.js';
import { setPaused as setPausedDefault } from '../../state.js';

const CONTROL_TIMEOUT_MS = 2000;

/**
 * Flips the global paused flag via the daemon's HTTP control route; falls
 * back to a direct state.json read-modify-write (src/state.js's setPaused)
 * when the daemon can't be reached, so pause/resume always succeeds
 * regardless of whether the daemon is running.
 * @param {boolean} paused
 * @param {{ requestJson?: typeof httpRequest, readConfig?: typeof readConfigDefault, setPausedDirect?: typeof setPausedDefault }} [deps]
 */
async function setPausedViaDaemonOrFile(
  paused,
  { requestJson = httpRequest, readConfig = readConfigDefault, setPausedDirect = setPausedDefault } = {}
) {
  const config = readConfig();
  try {
    const res = await requestJson(`http://127.0.0.1:${config.port}/control/${paused ? 'pause' : 'resume'}`, {
      method: 'POST',
      timeoutMs: CONTROL_TIMEOUT_MS,
    });
    if (res.ok) {
      const body = await res.json();
      return body.paused;
    }
  } catch {
    // Daemon unreachable (or erroring) is an expected, silent case here — the
    // direct state-file edit below is the designed fallback, not a failure to
    // report.
  }
  const state = await setPausedDirect(paused);
  return state.paused;
}

export async function pauseCommand(deps) {
  await setPausedViaDaemonOrFile(true, deps);
  console.log('paused');
}

export async function resumeCommand(deps) {
  await setPausedViaDaemonOrFile(false, deps);
  console.log('resumed');
}
