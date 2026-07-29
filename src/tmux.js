import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

/** True if a tmux session named `target` exists. */
export async function hasSession(target) {
  try {
    await execFileAsync('tmux', ['has-session', '-t', target]);
    return true;
  } catch {
    return false;
  }
}

/**
 * Creates a detached tmux session named `target`, running `command` in
 * `cwd`. `env` is passed via tmux's own `-e KEY=value` flags (not the
 * execFile call's env) so the variables reach the session regardless of
 * whether this call started the tmux server or attached to an already-running
 * one.
 */
export async function newSession({ target, cwd, command, args = [], env = {} }) {
  const envArgs = Object.entries(env).flatMap(([key, value]) => ['-e', `${key}=${value}`]);
  await execFileAsync('tmux', ['new-session', '-d', '-s', target, '-c', cwd, ...envArgs, command, ...args]);
}

/**
 * Types `text` into the session's pane and presses Enter. `-l` sends the
 * text literally so it can never be interpreted as a tmux key name/sequence.
 */
export async function sendText(target, text) {
  await execFileAsync('tmux', ['send-keys', '-t', target, '-l', '--', text]);
  await execFileAsync('tmux', ['send-keys', '-t', target, 'Enter']);
}

/** Returns the visible contents of the session's pane. */
export async function capturePane(target) {
  const { stdout } = await execFileAsync('tmux', ['capture-pane', '-t', target, '-p']);
  return stdout;
}

/**
 * Returns the `#S:#I.#P` target of the pane this process is running in,
 * resolved by tmux itself from the `TMUX` environment variable it exports
 * into every pane it creates — not from any argument. Rejects if `TMUX`
 * isn't set, since tmux's own fallback (picking some session on the default
 * server) would otherwise silently return the wrong pane's target.
 */
export async function currentPaneTarget() {
  if (!process.env.TMUX) {
    throw new Error('Not running inside a tmux session (TMUX environment variable is not set)');
  }
  const { stdout } = await execFileAsync('tmux', ['display-message', '-p', '#S:#I.#P']);
  return stdout.trim();
}
