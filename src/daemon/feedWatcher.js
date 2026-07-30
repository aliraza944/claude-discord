import fs from 'node:fs';
import { readStateSync } from '../state.js';
import { postToThread } from '../discord/threads.js';
import { createTranscriptTail } from './transcriptTail.js';
import { formatToolInput, truncate } from './toolCallFormat.js';

/** In-memory Map<sessionId, tailHandle> of running feed watchers — one per active session. */
const watchersBySessionId = new Map();

function stringifyToolResultContent(content) {
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) {
    const texts = content.map((block) => (block?.type === 'text' && typeof block.text === 'string' ? block.text : null));
    if (texts.every((text) => text !== null)) return texts.join('\n');
  }
  return null;
}

function formatAssistantText(block) {
  return truncate(block.text ?? '');
}

function formatToolUseBlock(block) {
  const toolName = block.name ?? 'a tool call';
  return `🔧 **${toolName}**\n${formatToolInput(toolName, block.input ?? {})}`;
}

function formatToolResultBlock(block) {
  const text = stringifyToolResultContent(block.content) ?? '[non-text tool result]';
  const prefix = block.is_error ? '⚠️ **Tool error**\n' : '';
  return `${prefix}\`\`\`\n${truncate(text)}\n\`\`\``;
}

/**
 * Maps one parsed transcript JSONL entry to zero or more feed message
 * strings, per spec.md's "Entry filtering and mapping": subagent
 * (`isSidechain`) entries and non-`user`/`assistant` lines are dropped
 * entirely; `thinking` blocks are skipped; `assistant` `text`/`tool_use`
 * blocks and `user` `tool_result` blocks each produce one message. Exported
 * for direct unit testing — it's a pure function with no I/O.
 */
export function mapEntryToMessages(entry) {
  if (!entry || entry.isSidechain) return [];
  if (entry.type !== 'assistant' && entry.type !== 'user') return [];

  const content = entry.message?.content;
  if (!Array.isArray(content)) return [];

  const messages = [];
  for (const block of content) {
    if (entry.type === 'assistant') {
      if (block?.type === 'text') messages.push(formatAssistantText(block));
      else if (block?.type === 'tool_use') messages.push(formatToolUseBlock(block));
    } else if (block?.type === 'tool_result') {
      messages.push(formatToolResultBlock(block));
    }
  }
  return messages;
}

async function postEntryMessages(entry, { threadId, discordClient }) {
  for (const content of mapEntryToMessages(entry)) {
    if (readStateSync().paused) continue;
    try {
      await postToThread(discordClient, threadId, content);
    } catch {
      // Best-effort: a failed post (e.g. thread gone) never crashes the watcher.
    }
  }
}

/**
 * Starts tailing `session.transcriptPath` for newly appended entries,
 * posting each qualifying one to `session.threadId` in order, as soon as
 * it's available. No-ops (no feed for this session) if the transcript
 * path/thread/client aren't available, the transcript file doesn't exist, or
 * a watcher is already running for this session.
 * @param {{ sessionId: string, transcriptPath?: string|null, threadId?: string|null }} session
 * @param {object} discordClient
 * @param {{ pollMs?: number }} [opts]
 */
export function startFeedWatcher(session, discordClient, opts = {}) {
  const sessionId = session?.sessionId;
  if (!sessionId || !session.transcriptPath || !session.threadId || !discordClient) return;
  if (watchersBySessionId.has(sessionId)) return;
  if (!fs.existsSync(session.transcriptPath)) return;

  let chain = Promise.resolve();
  const tail = createTranscriptTail(session.transcriptPath, {
    pollMs: opts.pollMs,
    onLine: (line) => {
      chain = chain.then(async () => {
        let entry;
        try {
          entry = JSON.parse(line);
        } catch {
          return;
        }
        await postEntryMessages(entry, { threadId: session.threadId, discordClient });
      });
    },
  });
  watchersBySessionId.set(sessionId, tail);
}

/** Stops the running feed watcher for `sessionId`, if any. Safe to call when none is running. */
export function stopFeedWatcher(sessionId) {
  const tail = watchersBySessionId.get(sessionId);
  if (!tail) return;
  tail.stop();
  watchersBySessionId.delete(sessionId);
}

/** Test-only: stops every running watcher and clears the registry. */
export function resetFeedWatchers() {
  for (const tail of watchersBySessionId.values()) tail.stop();
  watchersBySessionId.clear();
}
