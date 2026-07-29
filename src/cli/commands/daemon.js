import fs from 'node:fs';
import {
  daemonStatus,
  startDaemonProcess,
  stopDaemonProcess,
} from '../../daemon/lifecycle.js';
import { logPath } from '../../paths.js';

export function daemonStartCommand() {
  const result = startDaemonProcess();
  if (result.alreadyRunning) {
    console.log(`daemon already running (pid ${result.pid})`);
  } else {
    console.log(`daemon started (pid ${result.pid})`);
  }
}

export function daemonStopCommand() {
  const result = stopDaemonProcess();
  if (result.stopped) {
    console.log(`daemon stopped (pid ${result.pid})`);
  } else {
    console.log('daemon not running');
  }
}

export function daemonStatusCommand() {
  const status = daemonStatus();
  console.log(status.running ? `running (pid ${status.pid})` : 'not running');
}

export function daemonLogsCommand() {
  try {
    process.stdout.write(fs.readFileSync(logPath(), 'utf8'));
  } catch (err) {
    if (err.code === 'ENOENT') {
      console.log('no log file yet');
      return;
    }
    throw err;
  }
}

export async function daemonRunCommand() {
  const { startDaemon } = await import('../../daemon/run.js');
  const server = await startDaemon();
  const address = server.address();
  const port = typeof address === 'object' && address ? address.port : address;
  console.log(`daemon listening on port ${port}`);

  const shutdown = () => {
    server.close(() => process.exit(0));
  };
  process.on('SIGTERM', shutdown);
  process.on('SIGINT', shutdown);
}
