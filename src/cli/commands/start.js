import path from 'node:path';
import crypto from 'node:crypto';
import { readConfig as readConfigDefault } from '../../config.js';
import { newSession as newSessionDefault } from '../../tmux.js';
import { httpRequest } from '../../httpClient.js';

const REGISTER_TIMEOUT_MS = 5000;

/**
 * @param {string} projectPath
 * @param {{ newSession?: typeof newSessionDefault, requestJson?: typeof httpRequest, readConfig?: typeof readConfigDefault, generateToken?: () => string }} [deps]
 */
export async function startCommand(
  projectPath,
  {
    newSession = newSessionDefault,
    requestJson = httpRequest,
    readConfig = readConfigDefault,
    generateToken = () => crypto.randomUUID(),
  } = {}
) {
  const cwd = path.resolve(projectPath);
  const projectName = path.basename(cwd);
  const token = generateToken();
  const tmuxTarget = `claude-discord-${projectName}-${token.slice(0, 8)}`;

  await newSession({ target: tmuxTarget, cwd, command: 'claude', env: { CLAUDE_DISCORD_TOKEN: token } });

  const config = readConfig();
  try {
    const res = await requestJson(`http://127.0.0.1:${config.port}/register`, {
      method: 'POST',
      body: { token, projectName, cwd, tmuxTarget },
      timeoutMs: REGISTER_TIMEOUT_MS,
    });
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      console.error(`Failed to register session with daemon: ${res.status}${body.error ? ` (${body.error})` : ''}`);
      return;
    }
    console.log(`Session started in tmux (${tmuxTarget}); Discord thread created.`);
  } catch (err) {
    console.error(`Could not reach daemon at 127.0.0.1:${config.port}: ${err.message}`);
  }
}
