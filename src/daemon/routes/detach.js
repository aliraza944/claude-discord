import { sendJson, readJsonBody } from '../router.js';
import { readConfig } from '../../config.js';
import { deleteThread, deleteThreadStarterMessage } from '../../discord/threads.js';
import { findByTmuxTarget, removeSession } from '../sessions.js';
import { stopFeedWatcher } from '../feedWatcher.js';

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

      await removeSession(session.sessionId);
      stopFeedWatcher(session.sessionId);

      // Best-effort: the session is unregistered (and hook routing for it
      // stops) even if there's no discordClient to delete the thread with,
      // or the thread/starter message is already gone (e.g. previously
      // deleted/archived). Deleting the thread does not remove the "started
      // a thread" message Discord posts in the parent channel, so that's
      // deleted separately, best-effort, so it doesn't pile up there either.
      if (discordClient && session.threadId) {
        await deleteThread(discordClient, session.threadId).catch((err) => {
          console.error(`Failed to delete thread ${session.threadId} on detach:`, err);
        });
        const { channelId } = readConfig();
        await deleteThreadStarterMessage(discordClient, channelId, session.threadId).catch((err) => {
          console.error(`Failed to delete thread-started message ${session.threadId} on detach:`, err);
        });
      }

      sendJson(res, 200, { detached: true, sessionId: session.sessionId, threadId: session.threadId });
    },
  };
}
