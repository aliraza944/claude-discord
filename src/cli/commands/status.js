import { daemonStatus } from '../../daemon/lifecycle.js';
import { readStateSync } from '../../state.js';
import { readConfig } from '../../config.js';

export async function statusCommand() {
  const daemon = daemonStatus();
  const state = readStateSync();
  const config = readConfig();

  console.log(`daemon: ${daemon.running ? `running (pid ${daemon.pid})` : 'not running'}`);
  console.log(`paused: ${state.paused}`);

  if (!config.token) {
    console.log('bot: not configured (run `claude-discord init`)');
  } else {
    console.log('bot: unknown (wired up once the Discord client is connected)');
  }
}
