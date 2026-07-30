import fs from 'node:fs';
import { sendJson, readJsonBody } from '../router.js';
import { findByToken, findActiveByCwd, promoteToActive, rebindActiveSession } from '../sessions.js';
import { startFeedWatcher, stopFeedWatcher } from '../feedWatcher.js';

/**
 * @param {{ discordClient?: object }} [deps]
 */
export function sessionStartRoutes({ discordClient } = {}) {
  return {
    'POST /hook/session-start': async (req, res) => {
      const body = await readJsonBody(req);
      const { token, session_id: sessionId, transcript_path: transcriptPath, cwd, tmux_target: tmuxTarget } = body;

      // `start`-launched sessions correlate by token. Attach-registered
      // sessions have no token (nothing sets CLAUDE_DISCORD_TOKEN in a pane
      // Claude Code was already running in before `attach`), so they
      // correlate by cwd + tmuxTarget instead — see findActiveByCwd.
      const tokenSession = token ? findByToken(token) : null;
      const cwdSession = !tokenSession && cwd ? findActiveByCwd(cwd, tmuxTarget) : null;
      const session = tokenSession ?? cwdSession;
      if (!session || !sessionId) {
        sendJson(res, 404, { error: 'unknown token' });
        return;
      }

      // `/clear` and `/compact` re-fire SessionStart with a new session_id
      // for an already-active session (see rebindSessionId) — retire the
      // watcher tailing the old transcript before starting one for the new.
      const previousSessionId = session.sessionId;
      if (previousSessionId && previousSessionId !== sessionId) stopFeedWatcher(previousSessionId);

      // Snapshot the transcript's offset now, before the awaits below (which
      // persist state to disk) give Claude Code a window to append the new
      // session's first lines — startFeedWatcher must tail from here, not
      // from whatever the file has grown to by the time it's called, or
      // those early lines are silently dropped (no backfill).
      let startOffset = 0;
      if (transcriptPath) {
        try {
          startOffset = fs.statSync(transcriptPath).size;
        } catch {
          startOffset = 0;
        }
      }

      const record = tokenSession
        ? await promoteToActive(token, sessionId, transcriptPath)
        : await rebindActiveSession(session, sessionId, transcriptPath);
      if (record && discordClient) startFeedWatcher(record, discordClient, { startOffset });
      sendJson(res, 200, { ok: true });
    },
  };
}
