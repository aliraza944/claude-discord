import { describe, it, expect, afterEach, beforeEach } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync, appendFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { mapEntryToMessages, startFeedWatcher, stopFeedWatcher, resetFeedWatchers } from '../src/daemon/feedWatcher.js';
import { createFakeDiscordClient } from './support/fakeDiscordClient.js';
import { setPaused } from '../src/state.js';
import { wait } from './support/wait.js';

let stateHome;

beforeEach(() => {
  stateHome = mkdtempSync(path.join(tmpdir(), 'claude-discord-feed-state-'));
  process.env.CLAUDE_DISCORD_HOME = stateHome;
});

afterEach(() => {
  delete process.env.CLAUDE_DISCORD_HOME;
  rmSync(stateHome, { recursive: true, force: true });
});

describe('daemon/feedWatcher.js mapEntryToMessages (pure)', () => {
  it('skips lines whose top-level type is not user or assistant', () => {
    expect(mapEntryToMessages({ type: 'file-history-snapshot' })).toEqual([]);
    expect(mapEntryToMessages({ type: 'queue-operation' })).toEqual([]);
    expect(mapEntryToMessages({ type: 'ai-title' })).toEqual([]);
  });

  it('skips subagent (isSidechain) entries entirely', () => {
    const entry = {
      type: 'assistant',
      isSidechain: true,
      message: { content: [{ type: 'text', text: 'from a subagent' }] },
    };
    expect(mapEntryToMessages(entry)).toEqual([]);
  });

  it('skips thinking blocks', () => {
    const entry = { type: 'assistant', message: { content: [{ type: 'thinking', thinking: 'pondering...' }] } };
    expect(mapEntryToMessages(entry)).toEqual([]);
  });

  it('maps an assistant text block to its truncated text', () => {
    const entry = { type: 'assistant', message: { content: [{ type: 'text', text: 'Hello from Claude' }] } };
    expect(mapEntryToMessages(entry)).toEqual(['Hello from Claude']);
  });

  it('maps an assistant tool_use block via the shared formatter, without a react footer', () => {
    const entry = {
      type: 'assistant',
      message: { content: [{ type: 'tool_use', name: 'Bash', input: { command: 'echo hi' } }] },
    };
    const [message] = mapEntryToMessages(entry);
    expect(message).toContain('Bash');
    expect(message).toContain('```\necho hi\n```');
    expect(message).not.toContain('React');
  });

  it('maps a user tool_result block to its truncated text', () => {
    const entry = {
      type: 'user',
      message: { content: [{ type: 'tool_result', tool_use_id: 't1', content: 'command output' }] },
    };
    expect(mapEntryToMessages(entry)).toEqual([expect.stringContaining('command output')]);
  });

  it('visually flags an is_error tool_result', () => {
    const entry = {
      type: 'user',
      message: { content: [{ type: 'tool_result', is_error: true, content: 'boom' }] },
    };
    const [message] = mapEntryToMessages(entry);
    expect(message).toMatch(/error/i);
    expect(message).toContain('boom');
  });

  it('renders a tool_result with array-of-text-block content by joining the text', () => {
    const entry = {
      type: 'user',
      message: {
        content: [{ type: 'tool_result', content: [{ type: 'text', text: 'part one' }, { type: 'text', text: 'part two' }] }],
      },
    };
    const [message] = mapEntryToMessages(entry);
    expect(message).toContain('part one');
    expect(message).toContain('part two');
  });

  it('renders a generic placeholder for non-text tool_result content instead of failing', () => {
    const entry = {
      type: 'user',
      message: { content: [{ type: 'tool_result', content: [{ type: 'image', source: { data: 'abc' } }] }] },
    };
    const [message] = mapEntryToMessages(entry);
    expect(message).toMatch(/non-text/i);
  });

  it('skips a plain user text block (not a tool_result)', () => {
    const entry = { type: 'user', message: { content: [{ type: 'text', text: 'the users own prompt' }] } };
    expect(mapEntryToMessages(entry)).toEqual([]);
  });

  it('skips an AskUserQuestion tool_use block — no plain feed message for it', () => {
    const entry = {
      type: 'assistant',
      message: { content: [{ type: 'tool_use', name: 'AskUserQuestion', input: { questions: [{ question: 'Q?', options: [] }] } }] },
    };
    expect(mapEntryToMessages(entry)).toEqual([]);
  });
});

describe('daemon/feedWatcher.js startFeedWatcher/stopFeedWatcher (real temp file + fake discord)', () => {
  let dir;
  let discordClient;
  let thread;

  beforeEach(async () => {
    dir = mkdtempSync(path.join(tmpdir(), 'claude-discord-feed-'));
    discordClient = createFakeDiscordClient();
    thread = await discordClient.channels.fetch('chan-1').then((c) => c.threads.create({ name: 'p1' }));
  });

  afterEach(() => {
    resetFeedWatchers();
    rmSync(dir, { recursive: true, force: true });
  });

  function transcriptPath() {
    return path.join(dir, 'transcript.jsonl');
  }

  function appendEntry(entry) {
    appendFileSync(transcriptPath(), `${JSON.stringify(entry)}\n`);
  }

  it('posts a tool_use entry via the shared formatter and a flagged tool_result error, end-to-end through the real tail', async () => {
    writeFileSync(transcriptPath(), '');
    const session = { sessionId: 'sess-1', transcriptPath: transcriptPath(), threadId: thread.id };
    startFeedWatcher(session, discordClient, { pollMs: 20 });

    appendEntry({
      type: 'assistant',
      message: { content: [{ type: 'tool_use', name: 'Bash', input: { command: 'exit 1' } }] },
    });
    await wait(60);
    appendEntry({
      type: 'user',
      message: { content: [{ type: 'tool_result', is_error: true, content: 'command failed' }] },
    });
    await wait(60);

    expect(thread.messages).toHaveLength(2);
    expect(thread.messages[0].content).toContain('Bash');
    expect(thread.messages[0].content).toContain('exit 1');
    expect(thread.messages[1].content).toMatch(/error/i);
    expect(thread.messages[1].content).toContain('command failed');
  });

  it('posts each qualifying newly appended entry to the session thread, in order', async () => {
    writeFileSync(transcriptPath(), '');
    const session = { sessionId: 'sess-1', transcriptPath: transcriptPath(), threadId: thread.id };
    startFeedWatcher(session, discordClient, { pollMs: 20 });

    appendEntry({ type: 'assistant', message: { content: [{ type: 'text', text: 'first' }] } });
    await wait(60);
    appendEntry({ type: 'assistant', message: { content: [{ type: 'text', text: 'second' }] } });
    await wait(60);

    expect(thread.messages.map((m) => m.content)).toEqual(['first', 'second']);
  });

  it('does not backfill lines already in the transcript when the watcher starts', async () => {
    writeFileSync(transcriptPath(), `${JSON.stringify({ type: 'assistant', message: { content: [{ type: 'text', text: 'old' }] } })}\n`);
    const session = { sessionId: 'sess-1', transcriptPath: transcriptPath(), threadId: thread.id };
    startFeedWatcher(session, discordClient, { pollMs: 20 });
    await wait(60);

    expect(thread.messages).toHaveLength(0);

    appendEntry({ type: 'assistant', message: { content: [{ type: 'text', text: 'new' }] } });
    await wait(60);
    expect(thread.messages.map((m) => m.content)).toEqual(['new']);
  });

  it('does not throw when the transcript file does not exist yet, and picks up lines once it is created', async () => {
    const missingPath = path.join(dir, 'missing.jsonl');
    const session = { sessionId: 'sess-1', transcriptPath: missingPath, threadId: thread.id };
    expect(() => startFeedWatcher(session, discordClient, { pollMs: 20 })).not.toThrow();
    await wait(60);
    expect(thread.messages).toHaveLength(0);

    // A `/clear` can report the new transcript path before Claude Code has
    // created the file — the watcher must still catch on once it appears.
    writeFileSync(missingPath, `${JSON.stringify({ type: 'assistant', message: { content: [{ type: 'text', text: 'caught up' }] } })}\n`);
    await wait(60);
    expect(thread.messages.map((m) => m.content)).toEqual(['caught up']);
  });

  it('respects the global pause flag, resuming once unpaused, without restarting the watcher', async () => {
    writeFileSync(transcriptPath(), '');
    const session = { sessionId: 'sess-1', transcriptPath: transcriptPath(), threadId: thread.id };
    startFeedWatcher(session, discordClient, { pollMs: 20 });

    await setPaused(true);
    appendEntry({ type: 'assistant', message: { content: [{ type: 'text', text: 'while paused' }] } });
    await wait(60);
    expect(thread.messages).toHaveLength(0);

    await setPaused(false);
    appendEntry({ type: 'assistant', message: { content: [{ type: 'text', text: 'after resume' }] } });
    await wait(60);
    expect(thread.messages.map((m) => m.content)).toEqual(['after resume']);
  });

  it('stop() halts posting for further appended entries', async () => {
    writeFileSync(transcriptPath(), '');
    const session = { sessionId: 'sess-1', transcriptPath: transcriptPath(), threadId: thread.id };
    startFeedWatcher(session, discordClient, { pollMs: 20 });

    appendEntry({ type: 'assistant', message: { content: [{ type: 'text', text: 'before stop' }] } });
    await wait(60);
    stopFeedWatcher('sess-1');

    appendEntry({ type: 'assistant', message: { content: [{ type: 'text', text: 'after stop' }] } });
    await wait(60);

    expect(thread.messages.map((m) => m.content)).toEqual(['before stop']);
  });

  it('two concurrent session watchers never cross-post into each others thread', async () => {
    const dirB = mkdtempSync(path.join(tmpdir(), 'claude-discord-feed-b-'));
    try {
      const threadB = await discordClient.channels.fetch('chan-1').then((c) => c.threads.create({ name: 'p2' }));
      writeFileSync(transcriptPath(), '');
      const pathB = path.join(dirB, 'transcript.jsonl');
      writeFileSync(pathB, '');

      startFeedWatcher({ sessionId: 'sess-a', transcriptPath: transcriptPath(), threadId: thread.id }, discordClient, { pollMs: 20 });
      startFeedWatcher({ sessionId: 'sess-b', transcriptPath: pathB, threadId: threadB.id }, discordClient, { pollMs: 20 });

      appendEntry({ type: 'assistant', message: { content: [{ type: 'text', text: 'for A only' }] } });
      appendFileSync(pathB, `${JSON.stringify({ type: 'assistant', message: { content: [{ type: 'text', text: 'for B only' }] } })}\n`);
      await wait(80);

      expect(thread.messages.map((m) => m.content)).toEqual(['for A only']);
      expect(threadB.messages.map((m) => m.content)).toEqual(['for B only']);
    } finally {
      stopFeedWatcher('sess-b');
      rmSync(dirB, { recursive: true, force: true });
    }
  });
});
