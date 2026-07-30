import path from 'node:path';
import { claudeHomeDir } from '../paths.js';

/**
 * Reconstructs the transcript file path Claude Code itself writes for a
 * session, using the observed (undocumented) convention:
 * `<claude home>/projects/<cwd with every "/" replaced by "-">/<sessionId>.jsonl`
 * — confirmed against this repo's own live session transcripts. Used for
 * `attach`ed sessions, which have no `SessionStart` hook payload to read a
 * `transcript_path` from directly.
 */
export function resolveTranscriptPath({ cwd, sessionId }) {
  const slug = cwd.replaceAll('/', '-');
  return path.join(claudeHomeDir(), 'projects', slug, `${sessionId}.jsonl`);
}
