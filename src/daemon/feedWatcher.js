import { readStateSync } from '../state.js';
import { postToThread } from '../discord/threads.js';
import { createTranscriptTail } from './transcriptTail.js';
import { summarizeToolCall, truncate } from './toolCallFormat.js';

/** In-memory Map<sessionId, tailHandle> of running feed watchers — one per active session. */
const watchersBySessionId = new Map();

/** Max length of a collapsed tool-error line — kept short since, unlike `formatToolInput`, there's no way to reveal more. */
const MAX_ERROR_LENGTH = 200;

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
  return `🔧 ${summarizeToolCall(toolName, block.input ?? {})}`;
}

function formatToolErrorBlock(block) {
  const text = stringifyToolResultContent(block.content) ?? '[non-text tool result]';
  const oneLine = text.replace(/\s+/g, ' ').trim();
  const capped = oneLine.length <= MAX_ERROR_LENGTH ? oneLine : `${oneLine.slice(0, MAX_ERROR_LENGTH)}…`;
  return `⚠️ **Tool error** — ${capped}`;
}

/**
 * Maps one parsed transcript JSONL entry to zero or more feed message
 * strings, per spec.md's "Entry filtering and mapping": subagent
 * (`isSidechain`) entries and non-`user`/`assistant` lines are dropped
 * entirely; `thinking` blocks are skipped; `assistant` `text`/`tool_use`
 * blocks each produce one message, collapsed to a single line for
 * `tool_use`. `user` `tool_result` blocks only produce a message when
 * `is_error` is set — a successful result is implied by the next line in the
 * feed, so it's dropped rather than posted. An `AskUserQuestion` tool_use
 * block is skipped here too — it's handled
 * synchronously by the `PermissionRequest` hook route (see
 * daemon/routes/permission-request.js), not by tailing the transcript: this
 * file's writes are batched at turn boundaries rather than flushed live per
 * tool call, so by the time a `tool_use` line for it would even appear here
 * the question has already been answered elsewhere — there's no window left
 * for a Discord form driven from this tail to ever be first. Exported for
 * direct unit testing — it's a pure function with no I/O.
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
      else if (block?.type === 'tool_use' && block.name !== 'AskUserQuestion') messages.push(formatToolUseBlock(block));
    } else if (block?.type === 'tool_result' && block.is_error) {
      messages.push(formatToolErrorBlock(block));
    }
  }
  return messages;
}

async function postEntryMessages(entry, { session, discordClient }) {
  for (const content of mapEntryToMessages(entry)) {
    if (readStateSync().paused) continue;
    try {
      await postToThread(discordClient, session.threadId, content);
    } catch {
      // Best-effort: a failed post (e.g. thread gone) never crashes the watcher.
    }
  }
}

/**
 * Starts tailing `session.transcriptPath` for newly appended entries,
 * posting each qualifying one to `session.threadId` in order, as soon as
 * it's available. No-ops (no feed for this session) if the transcript
 * path/thread/client aren't available, or a watcher is already running for
 * this session. The transcript file need not exist yet — on a `/clear`, the
 * SessionStart hook can report the new path before Claude Code has created
 * the file; `createTranscriptTail`'s poll loop tolerates that and starts
 * picking up lines as soon as the file appears.
 * @param {{ sessionId: string, transcriptPath?: string|null, threadId?: string|null }} session
 * @param {object} discordClient
 * @param {{ pollMs?: number, startOffset?: number }} [opts] `startOffset` is
 * forwarded to `createTranscriptTail` — see there for why a caller would set it.
 */
export function startFeedWatcher(session, discordClient, opts = {}) {
  const sessionId = session?.sessionId;
  if (!sessionId || !session.transcriptPath || !session.threadId || !discordClient) return;
  if (watchersBySessionId.has(sessionId)) return;

  let chain = Promise.resolve();
  const tail = createTranscriptTail(session.transcriptPath, {
    pollMs: opts.pollMs,
    startOffset: opts.startOffset,
    onLine: (line) => {
      chain = chain.then(async () => {
        let entry;
        try {
          entry = JSON.parse(line);
        } catch {
          return;
        }
        await postEntryMessages(entry, { session, discordClient });
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
