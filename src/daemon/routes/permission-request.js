import { sendJson, readJsonBody } from '../router.js';
import { readStateSync } from '../../state.js';
import { postToThread } from '../../discord/threads.js';
import { findBySessionId } from '../sessions.js';
import { registerPending, resolvePending } from '../pending.js';
import { formatToolInput } from '../toolCallFormat.js';
import { buildDecisionRow, permCustomIdFor } from '../../discord/decisionButtons.js';

// Comfortably under settings.json's 6h (21600s) PermissionRequest hook
// timeout, so the daemon always resolves (as defer, worst case) before
// Claude Code's own hook execution would be killed.
const DEFAULT_SAFETY_TIMEOUT_MS = 6 * 60 * 60 * 1000 - 5000;

function describeToolCall(payload) {
  const toolName = payload.tool_name ?? 'a tool call';
  const input = payload.tool_input ?? {};
  const body = formatToolInput(toolName, input);
  return `Permission requested: **${toolName}**\n${body}`;
}

/**
 * @param {{ discordClient?: object, safetyTimeoutMs?: number }} [deps]
 */
export function permissionRequestRoutes({ discordClient, safetyTimeoutMs = DEFAULT_SAFETY_TIMEOUT_MS } = {}) {
  return {
    'POST /hook/permission-request': async (req, res) => {
      const payload = await readJsonBody(req);
      const sessionId = payload.session_id;
      const state = readStateSync();
      const session = sessionId ? findBySessionId(sessionId) : null;

      // Paused, or a session the daemon has no record of, isn't active yet
      // (still pending or awaiting attach approval), or hasn't gotten a
      // thread yet: resolve as defer immediately, no Discord message.
      if (state.paused || !session || session.status !== 'active' || !session.threadId) {
        sendJson(res, 200, { decision: 'defer' });
        return;
      }

      const message = await postToThread(discordClient, session.threadId, describeToolCall(payload));
      await message.edit({
        content: message.content,
        components: [buildDecisionRow({ customIdFor: permCustomIdFor(message.id), allowLabel: 'Allow', denyLabel: 'Deny' })],
      });

      const decision = await new Promise((resolve) => {
        const timeoutHandle = setTimeout(() => {
          resolvePending(message.id, 'defer');
        }, safetyTimeoutMs);

        registerPending(message.id, {
          sessionId,
          resolve: (value) => {
            clearTimeout(timeoutHandle);
            resolve(value);
          },
        });
      });

      sendJson(res, 200, { decision });
    },
  };
}
