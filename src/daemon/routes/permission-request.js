import { sendJson, readJsonBody } from '../router.js';
import { readStateSync } from '../../state.js';
import { postToThread } from '../../discord/threads.js';
import { findBySessionId } from '../sessions.js';
import { registerPending, resolvePending } from '../pending.js';

// Comfortably under settings.json's 6h (21600s) PermissionRequest hook
// timeout, so the daemon always resolves (as defer, worst case) before
// Claude Code's own hook execution would be killed.
const DEFAULT_SAFETY_TIMEOUT_MS = 6 * 60 * 60 * 1000 - 5000;

// Comfortably under Discord's 2000-char message limit, leaving room for the
// header/footer lines and code-block fencing around the preview itself.
const MAX_PREVIEW_LENGTH = 1200;

function truncate(text) {
  return text.length <= MAX_PREVIEW_LENGTH ? text : `${text.slice(0, MAX_PREVIEW_LENGTH)}\n…truncated`;
}

function describeBash(input) {
  const description = input.description ? `${input.description}\n` : '';
  return `${description}\`\`\`\n${truncate(String(input.command ?? ''))}\n\`\`\``;
}

function editDiff(edit) {
  return `- ${edit.old_string ?? ''}\n+ ${edit.new_string ?? ''}`;
}

function describeEdit(input) {
  return `**${input.file_path ?? 'unknown file'}**\n\`\`\`diff\n${truncate(editDiff(input))}\n\`\`\``;
}

function describeMultiEdit(input) {
  const diff = (input.edits ?? []).map(editDiff).join('\n\n');
  return `**${input.file_path ?? 'unknown file'}**\n\`\`\`diff\n${truncate(diff)}\n\`\`\``;
}

function describeWrite(input) {
  return `**${input.file_path ?? 'unknown file'}**\n\`\`\`\n${truncate(String(input.content ?? ''))}\n\`\`\``;
}

function describeGeneric(input) {
  return `\`\`\`json\n${truncate(JSON.stringify(input, null, 2))}\n\`\`\``;
}

const DESCRIBERS = {
  Bash: describeBash,
  Edit: describeEdit,
  MultiEdit: describeMultiEdit,
  Write: describeWrite,
};

function describeToolCall(payload) {
  const toolName = payload.tool_name ?? 'a tool call';
  const input = payload.tool_input ?? {};
  const describe = DESCRIBERS[toolName];
  const body = describe ? describe(input) : describeGeneric(input);
  return `Permission requested: **${toolName}**\n${body}\nReact ✅ to allow, ❌ to deny.`;
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
      await message.react('✅');
      await message.react('❌');

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
