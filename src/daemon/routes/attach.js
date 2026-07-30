import { sendJson, readJsonBody } from '../router.js';
import { readConfig } from '../../config.js';
import { createSessionThread, formatThreadName, postToThread } from '../../discord/threads.js';
import { registerPendingApproval, attachThread, retirePaneSessions } from '../sessions.js';
import { registerAttachApproval } from '../attachApprovals.js';
import { resolveTranscriptPath } from '../transcriptPath.js';
import { stopFeedWatcher } from '../feedWatcher.js';

const REPLACED_MESSAGE = '👋 Replaced by a new attach in this pane — no longer routing to this thread.';

function describeAttachRequest({ projectName, cwd, tmuxTarget }) {
  return (
    `Attach requested for **${projectName}**\n` +
    `cwd: \`${cwd}\`\n` +
    `tmux: \`${tmuxTarget}\`\n` +
    `React ✅ to approve, ❌ to discard.`
  );
}

/** Stops the retired sessions' feed watchers and tells their threads they're no longer routed to, best-effort. */
async function retirePane(discordClient, cwd, tmuxTarget) {
  const retired = await retirePaneSessions(cwd, tmuxTarget);
  for (const record of retired) {
    stopFeedWatcher(record.sessionId);
    if (record.threadId) {
      await postToThread(discordClient, record.threadId, REPLACED_MESSAGE).catch(() => {});
    }
  }
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

      await retirePane(discordClient, cwd, tmuxTarget);
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
