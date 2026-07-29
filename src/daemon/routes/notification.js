import { sendJson, readJsonBody } from '../router.js';
import { readStateSync } from '../../state.js';
import { postToThread } from '../../discord/threads.js';
import { findBySessionId } from '../sessions.js';

function describeNotification(payload) {
  return payload.message ? `⏳ ${payload.message}` : '⏳ This session needs your input.';
}

/**
 * Fire-and-forget FYI: posts a "needs input" style message to the session's
 * thread for the Notification hook's agent_needs_input/idle_prompt/
 * agent_completed matchers. Silently no-ops for an unregistered session, a
 * session that hasn't gotten a thread yet, or while globally paused, since
 * there is nowhere to post (or nowhere it should post).
 * @param {{ discordClient?: object }} [deps]
 */
export function notificationRoutes({ discordClient } = {}) {
  return {
    'POST /hook/notification': async (req, res) => {
      const payload = await readJsonBody(req);
      const sessionId = payload.session_id;
      const state = readStateSync();
      const session = sessionId ? findBySessionId(sessionId) : null;

      if (!state.paused && session?.threadId && discordClient) {
        await postToThread(discordClient, session.threadId, describeNotification(payload));
      }

      sendJson(res, 200, { ok: true });
    },
  };
}
