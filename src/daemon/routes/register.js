import { sendJson, readJsonBody } from '../router.js';
import { readConfig } from '../../config.js';
import { createSessionThread } from '../../discord/threads.js';
import { registerPending, attachThread } from '../sessions.js';

/**
 * @param {{ discordClient?: object }} [deps]
 */
export function registerRoutes({ discordClient } = {}) {
  return {
    'POST /register': async (req, res) => {
      const body = await readJsonBody(req);
      const { token, projectName, cwd, tmuxTarget } = body;
      if (!token || !projectName || !cwd || !tmuxTarget) {
        sendJson(res, 400, { error: 'token, projectName, cwd, and tmuxTarget are required' });
        return;
      }

      if (!discordClient) {
        sendJson(res, 503, { error: 'discord client not connected' });
        return;
      }

      registerPending({ token, projectName, cwd, tmuxTarget });

      const config = readConfig();
      const thread = await createSessionThread(discordClient, { channelId: config.channelId, name: projectName });
      attachThread(token, thread.id);

      sendJson(res, 200, { token, threadId: thread.id });
    },
  };
}
