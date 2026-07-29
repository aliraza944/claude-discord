import { readConfig } from '../config.js';
import { httpRequest } from '../httpClient.js';
import { readStdinJson } from './stdin.js';

const REPORT_TIMEOUT_MS = 2000;

/**
 * Fire-and-forget POST of the raw Notification hook payload to the daemon.
 * Never throws — a Notification hook must never block Claude Code, daemon up
 * or not.
 * @param {{ payload: any, port: number, requestJson?: typeof httpRequest }} options
 */
export async function reportNotification({ payload, port, requestJson = httpRequest }) {
  try {
    await requestJson(`http://127.0.0.1:${port}/hook/notification`, {
      method: 'POST',
      body: payload,
      timeoutMs: REPORT_TIMEOUT_MS,
    });
  } catch {
    // daemon unreachable or request failed; nothing more to do here.
  }
}

export async function run() {
  const payload = await readStdinJson();
  const config = readConfig();
  await reportNotification({ payload, port: config.port });
}
