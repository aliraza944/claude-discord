import { sendJson, readJsonBody } from '../router.js';
import { readConfig } from '../../config.js';
import { createSessionThread, formatThreadName } from '../../discord/threads.js';
import { registerPending, attachThread } from '../sessions.js';

/**
 * @param {{ discordClient?: object, now?: () => Date }} [deps]
 */
export function registerRoutes({ discordClient, now = () => new Date() } = {}) {
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
      const name = formatThreadName(projectName, now());
      const thread = await createSessionThread(discordClient, { channelId: config.channelId, name });
      attachThread(token, thread.id);

      sendJson(res, 200, { token, threadId: thread.id });
    },
  };
}
