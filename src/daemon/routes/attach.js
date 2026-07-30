import { sendJson, readJsonBody } from '../router.js';
import { readConfig } from '../../config.js';
import { createSessionThread, formatThreadName, postToThread } from '../../discord/threads.js';
import { registerPendingApproval, attachThread } from '../sessions.js';
import { registerAttachApproval } from '../attachApprovals.js';
import { resolveTranscriptPath } from '../transcriptPath.js';

function describeAttachRequest({ projectName, cwd, tmuxTarget }) {
  return (
    `Attach requested for **${projectName}**\n` +
    `cwd: \`${cwd}\`\n` +
    `tmux: \`${tmuxTarget}\`\n` +
    `React ✅ to approve, ❌ to discard.`
  );
}

/**
 * @param {{ discordClient?: object, now?: () => Date }} [deps]
 */
export function attachRoutes({ discordClient, now = () => new Date() } = {}) {
  return {
    'POST /attach': async (req, res) => {
      const body = await readJsonBody(req);
      const { sessionId, projectName, cwd, tmuxTarget } = body;
      if (!sessionId || !projectName || !cwd || !tmuxTarget) {
        sendJson(res, 400, { error: 'sessionId, projectName, cwd, and tmuxTarget are required' });
        return;
      }

      if (!discordClient) {
        sendJson(res, 503, { error: 'discord client not connected' });
        return;
      }

      registerPendingApproval({ sessionId, projectName, cwd, tmuxTarget, transcriptPath: resolveTranscriptPath({ cwd, sessionId }) });

      const config = readConfig();
      const name = formatThreadName(projectName, now());
      const thread = await createSessionThread(discordClient, { channelId: config.channelId, name });
      attachThread(sessionId, thread.id);

      const message = await postToThread(discordClient, thread.id, describeAttachRequest({ projectName, cwd, tmuxTarget }));
      await message.react('✅');
      await message.react('❌');
      registerAttachApproval(message.id, sessionId);

      sendJson(res, 200, { sessionId, threadId: thread.id });
    },
  };
}
