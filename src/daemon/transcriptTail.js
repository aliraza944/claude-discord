import fs from 'node:fs';

const DEFAULT_POLL_MS = 100;

/**
 * Tails `filePath` from its current end-of-file, calling `onLine(line)` for
 * each newline-terminated line appended after the tail starts — no backfill
 * of anything already in the file. A partial (not-yet-newline-terminated)
 * line is buffered across polls and only surfaced once a later append
 * completes it. A missing file — at creation, or one that disappears
 * mid-tail — simply yields nothing rather than throwing; callers that need
 * to know up front whether a feed is even possible should check existence
 * themselves before creating a tail.
 * @param {string} filePath
 * @param {{ onLine: (line: string) => void, pollMs?: number }} options
 */
export function createTranscriptTail(filePath, { onLine, pollMs = DEFAULT_POLL_MS }) {
  let offset;
  try {
    offset = fs.statSync(filePath).size;
  } catch {
    offset = 0;
  }
  let buffer = '';
  let stopped = false;
  let busy = false;

  function poll() {
    if (stopped || busy) return;
    busy = true;
    fs.stat(filePath, (statErr, stats) => {
      if (stopped || statErr || stats.size <= offset) {
        busy = false;
        return;
      }
      const stream = fs.createReadStream(filePath, { start: offset, end: stats.size - 1, encoding: 'utf8' });
      let chunk = '';
      stream.on('data', (data) => {
        chunk += data;
      });
      stream.on('end', () => {
        offset = stats.size;
        busy = false;
        if (stopped) return;
        buffer += chunk;
        const lines = buffer.split('\n');
        buffer = lines.pop();
        for (const line of lines) {
          if (line.length > 0) onLine(line);
        }
      });
      stream.on('error', () => {
        busy = false;
      });
    });
  }

  const interval = setInterval(poll, pollMs);
  return {
    stop() {
      stopped = true;
      clearInterval(interval);
    },
  };
}
