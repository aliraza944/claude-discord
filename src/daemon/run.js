import { createServer } from './router.js';
import { healthRoutes } from './routes/health.js';
import { readConfig } from '../config.js';

/**
 * Aggregates every route module into a single "METHOD /path" -> handler map.
 * Later tickets extend this with register/session-start/permission-request/
 * notification/control routes.
 */
export function buildRoutes(deps = {}) {
  return {
    ...healthRoutes(deps),
  };
}

export function createDaemonServer(deps = {}) {
  return createServer(buildRoutes(deps));
}

/**
 * Boots the daemon's HTTP server on the configured port. Discord client
 * connection is wired in by ticket 02.
 * @param {{ port?: number, deps?: object }} [options]
 */
export async function startDaemon({ port, deps = {} } = {}) {
  const config = readConfig();
  const listenPort = port ?? config.port ?? 4790;
  const server = createDaemonServer(deps);
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(listenPort, '127.0.0.1', () => {
      server.removeListener('error', reject);
      resolve();
    });
  });
  return server;
}
