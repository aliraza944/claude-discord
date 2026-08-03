import { sendJson, readJsonBody } from '../router.js';
import { readStateSync } from '../../state.js';
import { postToThread } from '../../discord/threads.js';
import { findBySessionId } from '../sessions.js';
import { registerPending, resolvePending } from '../pending.js';
import { formatToolInput } from '../toolCallFormat.js';
import { buildPermissionDecisionRow, permCustomIdFor } from '../../discord/decisionButtons.js';
import { postAskUserQuestionForm } from '../../discord/askQuestionForm.js';
import { isAlwaysAllowed } from '../sessionAllowlist.js';

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
 * Posts the interactive multiselect form and resolves once it's answered
 * (allow, with the answers folded into `updatedInput`) or abandoned — timed
 * out, paused, or too big to render (defer, falling back to the tool's own
 * local prompt). This *is* the delivery mechanism for AskUserQuestion: the
 * PermissionRequest hook is the one point that genuinely blocks the tool
 * until the daemon responds, unlike tailing the transcript (see
 * feedWatcher.js's doc comment) which can never see the question before
 * it's already been answered elsewhere.
 * @param {object} discordClient
 * @param {{ threadId: string, questions: object[] }} params
 * @param {object} [askQuestionDeps]
 */
async function resolveAskUserQuestion(discordClient, { threadId, questions }, askQuestionDeps) {
  const answers = await new Promise((resolve) => {
    postAskUserQuestionForm(discordClient, { threadId, questions }, { ...askQuestionDeps, onDeliver: resolve })
      .then((message) => {
        if (!message) resolve(null); // over budget: a plain fallback message was posted instead, no form to await
      })
      .catch(() => resolve(null));
  });

  return answers ? { decision: 'allow', updatedInput: { questions, answers } } : { decision: 'defer' };
}

/**
 * @param {{ discordClient?: object, safetyTimeoutMs?: number, askQuestionDeps?: object }} [deps]
 */
export function permissionRequestRoutes({ discordClient, safetyTimeoutMs = DEFAULT_SAFETY_TIMEOUT_MS, askQuestionDeps } = {}) {
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

      if (payload.tool_name === 'AskUserQuestion') {
        const questions = payload.tool_input?.questions;
        if (!Array.isArray(questions) || questions.length === 0) {
          sendJson(res, 200, { decision: 'defer' });
          return;
        }
        sendJson(res, 200, await resolveAskUserQuestion(discordClient, { threadId: session.threadId, questions }, askQuestionDeps));
        return;
      }

      // A prior "Always Allow" tap this session for this exact tool call:
      // resolve silently, with no Discord round-trip at all — mirrors Claude
      // Code CLI's "don't ask again this session" prompt option.
      if (isAlwaysAllowed(sessionId, payload.tool_name, payload.tool_input)) {
        sendJson(res, 200, { decision: 'allow' });
        return;
      }

      const message = await postToThread(discordClient, session.threadId, describeToolCall(payload));
      await message.edit({
        content: message.content,
        components: [buildPermissionDecisionRow({ customIdFor: permCustomIdFor(message.id) })],
      });

      const decision = await new Promise((resolve) => {
        const timeoutHandle = setTimeout(() => {
          resolvePending(message.id, 'defer');
        }, safetyTimeoutMs);

        registerPending(message.id, {
          sessionId,
          toolName: payload.tool_name,
          toolInput: payload.tool_input,
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
