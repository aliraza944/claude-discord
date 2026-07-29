import { sendJson, readJsonBody } from '../router.js';
import { postToThread } from '../../discord/threads.js';
import { findBySessionId } from '../sessions.js';

function describeNotification(payload) {
  return payload.message ? `⏳ ${payload.message}` : '⏳ This session needs your input.';
}

/**
 * Fire-and-forget FYI: posts a "needs input" style message to the session's
 * thread for the Notification hook's agent_needs_input/idle_prompt/
 * agent_completed matchers. Silently no-ops for an unregistered session or a
 * session that hasn't gotten a thread yet, since there is nowhere to post.
 * @param {{ discordClient?: object }} [deps]
 */
export function notificationRoutes({ discordClient } = {}) {
  return {
    'POST /hook/notification': async (req, res) => {
      const payload = await readJsonBody(req);
      const sessionId = payload.session_id;
      const session = sessionId ? findBySessionId(sessionId) : null;

      if (session?.threadId && discordClient) {
        await postToThread(discordClient, session.threadId, describeNotification(payload));
      }

      sendJson(res, 200, { ok: true });
    },
  };
}
