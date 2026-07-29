import { sendJson, readJsonBody } from '../router.js';
import { findByToken, promoteToActive } from '../sessions.js';

export function sessionStartRoutes(deps = {}) {
  return {
    'POST /hook/session-start': async (req, res) => {
      const body = await readJsonBody(req);
      const { token, session_id: sessionId } = body;

      const session = token ? findByToken(token) : null;
      if (!session || !sessionId) {
        sendJson(res, 404, { error: 'unknown token' });
        return;
      }

      promoteToActive(token, sessionId);
      sendJson(res, 200, { ok: true });
    },
  };
}
