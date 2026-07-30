import { describe, it, expect, afterEach } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync, appendFileSync, closeSync, openSync, writeSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createTranscriptTail } from '../src/daemon/transcriptTail.js';

// Seam 2 (spec.md): a real, ephemeral temp file standing in for the OS-level
// append-and-read boundary a fake can't verify — the same "verify the real
// I/O boundary directly" precedent tmux.test.js already set for execFile.
describe('daemon/transcriptTail.js (real file)', () => {
  let dir;
  const tails = [];

  afterEach(() => {
    tails.forEach((t) => t.stop());
    tails.length = 0;
    if (dir) rmSync(dir, { recursive: true, force: true });
  });

  function makeTail(filePath, opts) {
    const tail = createTranscriptTail(filePath, { pollMs: 20, ...opts });
    tails.push(tail);
    return tail;
  }

  function wait(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  it('surfaces newly appended complete lines exactly once', async () => {
    dir = mkdtempSync(path.join(tmpdir(), 'claude-discord-tail-'));
    const filePath = path.join(dir, 'transcript.jsonl');
    writeFileSync(filePath, '');

    const lines = [];
    makeTail(filePath, { onLine: (line) => lines.push(line) });

    appendFileSync(filePath, 'line-one\n');
    await wait(80);
    appendFileSync(filePath, 'line-two\n');
    await wait(80);

    expect(lines).toEqual(['line-one', 'line-two']);
  });

  it('buffers a split/partial line across multiple writes until it is newline-terminated', async () => {
    dir = mkdtempSync(path.join(tmpdir(), 'claude-discord-tail-'));
    const filePath = path.join(dir, 'transcript.jsonl');
    writeFileSync(filePath, '');

    const lines = [];
    makeTail(filePath, { onLine: (line) => lines.push(line) });

    const fd = openSync(filePath, 'a');
    writeSync(fd, 'partial-sta');
    closeSync(fd);
    await wait(80);
    expect(lines).toEqual([]); // no newline yet — not surfaced

    const fd2 = openSync(filePath, 'a');
    writeSync(fd2, 'rt-completed\n');
    closeSync(fd2);
    await wait(80);

    expect(lines).toEqual(['partial-start-completed']);
  });

  it('does not backfill content already in the file when the tail starts', async () => {
    dir = mkdtempSync(path.join(tmpdir(), 'claude-discord-tail-'));
    const filePath = path.join(dir, 'transcript.jsonl');
    writeFileSync(filePath, 'already-here-1\nalready-here-2\n');

    const lines = [];
    makeTail(filePath, { onLine: (line) => lines.push(line) });
    await wait(80);
    expect(lines).toEqual([]);

    appendFileSync(filePath, 'new-line\n');
    await wait(80);
    expect(lines).toEqual(['new-line']);
  });

  it('does not throw when the file does not exist, and picks up lines once it is created', async () => {
    dir = mkdtempSync(path.join(tmpdir(), 'claude-discord-tail-'));
    const filePath = path.join(dir, 'does-not-exist-yet.jsonl');

    const lines = [];
    expect(() => makeTail(filePath, { onLine: (line) => lines.push(line) })).not.toThrow();
    await wait(80);
    expect(lines).toEqual([]);
  });

  it('stop() halts further line emission even if more data is appended', async () => {
    dir = mkdtempSync(path.join(tmpdir(), 'claude-discord-tail-'));
    const filePath = path.join(dir, 'transcript.jsonl');
    writeFileSync(filePath, '');

    const lines = [];
    const tail = makeTail(filePath, { onLine: (line) => lines.push(line) });

    appendFileSync(filePath, 'before-stop\n');
    await wait(80);
    expect(lines).toEqual(['before-stop']);

    tail.stop();
    appendFileSync(filePath, 'after-stop\n');
    await wait(80);
    expect(lines).toEqual(['before-stop']);
  });
});
