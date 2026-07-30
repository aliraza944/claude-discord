import { sendJson, readJsonBody } from '../router.js';
import { findByToken, promoteToActive } from '../sessions.js';
import { startFeedWatcher } from '../feedWatcher.js';

/**
 * @param {{ discordClient?: object }} [deps]
 */
export function sessionStartRoutes({ discordClient } = {}) {
  return {
    'POST /hook/session-start': async (req, res) => {
      const body = await readJsonBody(req);
      const { token, session_id: sessionId, transcript_path: transcriptPath } = body;

      const session = token ? findByToken(token) : null;
      if (!session || !sessionId) {
        sendJson(res, 404, { error: 'unknown token' });
        return;
      }

      const record = await promoteToActive(token, sessionId, transcriptPath);
      if (record && discordClient) startFeedWatcher(record, discordClient);
      sendJson(res, 200, { ok: true });
    },
  };
}
