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
    return;
  }

  if (!daemon.running) {
    console.log('bot: unknown (daemon not running)');
    return;
  }

  try {
    const res = await fetch(`http://127.0.0.1:${config.port}/status`, {
      signal: AbortSignal.timeout(1500),
    });
    if (!res.ok) throw new Error(`daemon returned ${res.status}`);
    const body = await res.json();
    console.log(`bot: ${body.botOnline ? 'online' : 'offline'}`);
  } catch (err) {
    console.log(`bot: unreachable (${err.message})`);
  }
}
