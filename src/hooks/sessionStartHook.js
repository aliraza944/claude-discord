import { readConfig } from '../config.js';
import { httpRequest } from '../httpClient.js';
import { readStdinJson } from './stdin.js';

const REPORT_TIMEOUT_MS = 2000;

/**
 * Reports `{ token, session_id }` to the daemon so it can promote the
 * pending-by-token registration made at `claude-discord start` time to
 * active-by-session_id. Never throws — a SessionStart hook must never block
 * Claude Code's startup, daemon down or not.
 * @param {{ token?: string, sessionId?: string, port: number, requestJson?: typeof httpRequest }} options
 */
export async function reportSessionStart({ token, sessionId, port, requestJson = httpRequest }) {
  if (!token || !sessionId) return;
  try {
    await requestJson(`http://127.0.0.1:${port}/hook/session-start`, {
      method: 'POST',
      body: { token, session_id: sessionId },
      timeoutMs: REPORT_TIMEOUT_MS,
    });
  } catch {
    // daemon unreachable or request failed; nothing more to do here.
  }
}

export async function run() {
  const token = process.env.CLAUDE_DISCORD_TOKEN;
  const payload = await readStdinJson();
  const config = readConfig();
  await reportSessionStart({ token, sessionId: payload.session_id, port: config.port });
}
