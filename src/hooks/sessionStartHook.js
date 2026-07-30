import { readConfig } from '../config.js';
import { httpRequest } from '../httpClient.js';
import { readStdinJson } from './stdin.js';
import { currentPaneTarget as currentPaneTargetDefault } from '../tmux.js';

const REPORT_TIMEOUT_MS = 2000;

/**
 * Reports `{ token, session_id, transcript_path, cwd, tmux_target }` to the
 * daemon so it can promote a session to active-by-session_id, capturing the
 * transcript path the feed watcher will tail. `token` correlates a
 * `claude-discord start`-launched session; `cwd` + `tmux_target` together
 * are the fallback correlation for an `attach`-registered session, which has
 * no token (see `sessions.js#findActiveByCwd`) — both matter equally on a
 * `/clear`/`/compact` re-fire, which hands the session a brand new
 * `session_id`. `tmux_target` alone (not `cwd` alone) disambiguates which
 * pane's record to rebind when multiple active sessions share a project
 * directory. Never throws — a SessionStart hook must never block Claude
 * Code's startup, daemon down or not.
 * @param {{ token?: string, sessionId?: string, transcriptPath?: string, cwd?: string, tmuxTarget?: string, port: number, requestJson?: typeof httpRequest }} options
 */
export async function reportSessionStart({ token, sessionId, transcriptPath, cwd, tmuxTarget, port, requestJson = httpRequest }) {
  if (!sessionId) return;
  try {
    await requestJson(`http://127.0.0.1:${port}/hook/session-start`, {
      method: 'POST',
      body: { token, session_id: sessionId, transcript_path: transcriptPath, cwd, tmux_target: tmuxTarget },
      timeoutMs: REPORT_TIMEOUT_MS,
    });
  } catch {
    // daemon unreachable or request failed; nothing more to do here.
  }
}

/**
 * Resolves the current tmux pane target, or `undefined` if unavailable
 * (e.g. not running inside tmux) — best-effort, since a SessionStart hook
 * must never block Claude Code's startup over it.
 */
async function resolveTmuxTarget(currentPaneTarget) {
  try {
    return await currentPaneTarget();
  } catch {
    return undefined;
  }
}

export async function run({ currentPaneTarget = currentPaneTargetDefault } = {}) {
  const token = process.env.CLAUDE_DISCORD_TOKEN;
  const payload = await readStdinJson();
  const config = readConfig();
  const tmuxTarget = await resolveTmuxTarget(currentPaneTarget);
  await reportSessionStart({
    token,
    sessionId: payload.session_id,
    transcriptPath: payload.transcript_path,
    cwd: payload.cwd,
    tmuxTarget,
    port: config.port,
  });
}
