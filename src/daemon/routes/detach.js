import { sendJson, readJsonBody } from '../router.js';
import { postToThread } from '../../discord/threads.js';
import { findByTmuxTarget, removeSession } from '../sessions.js';

const FAREWELL_MESSAGE = '👋 Session detached — no longer routing to this thread.';

/**
 * @param {{ discordClient?: object }} [deps]
 */
export function detachRoutes({ discordClient } = {}) {
  return {
    'POST /detach': async (req, res) => {
      const { tmuxTarget } = await readJsonBody(req);
      if (!tmuxTarget) {
        sendJson(res, 400, { error: 'tmuxTarget is required' });
        return;
      }

      const session = findByTmuxTarget(tmuxTarget);
      if (!session || !session.sessionId) {
        sendJson(res, 200, { detached: false });
        return;
      }

      removeSession(session.sessionId);

      // Best-effort: the session is unregistered (and hook routing for it
      // stops) even if there's no discordClient to tell the thread about it.
      if (discordClient && session.threadId) {
        await postToThread(discordClient, session.threadId, FAREWELL_MESSAGE);
      }

      sendJson(res, 200, { detached: true, sessionId: session.sessionId, threadId: session.threadId });
    },
  };
}
