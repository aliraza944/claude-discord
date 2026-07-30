import { describe, it, expect, afterEach, beforeEach } from 'vitest';
import path from 'node:path';
import { resolveTranscriptPath } from '../src/daemon/transcriptPath.js';

describe('daemon/transcriptPath.js', () => {
  beforeEach(() => {
    process.env.CLAUDE_DISCORD_CLAUDE_HOME = '/home/x/.claude';
  });

  afterEach(() => {
    delete process.env.CLAUDE_DISCORD_CLAUDE_HOME;
  });

  it('replaces every "/" in cwd with "-" and nests under <claude home>/projects/<slug>/<sessionId>.jsonl', () => {
    const result = resolveTranscriptPath({ cwd: '/home/aliraza/projects/claude-discord', sessionId: 'sess-1' });
    expect(result).toBe(
      path.join('/home/x/.claude', 'projects', '-home-aliraza-projects-claude-discord', 'sess-1.jsonl')
    );
  });
});
