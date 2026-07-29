import { createServer } from './router.js';
import { healthRoutes } from './routes/health.js';
import { statusRoutes } from './routes/status.js';
import { registerRoutes } from './routes/register.js';
import { sessionStartRoutes } from './routes/session-start.js';
import { permissionRequestRoutes } from './routes/permission-request.js';
import { notificationRoutes } from './routes/notification.js';
import { controlRoutes } from './routes/control.js';
import { registerReactionHandlers } from '../discord/reactions.js';
import { registerSteeringHandlers } from '../discord/steering.js';
import { registerSlashCommandHandlers, registerSlashCommands } from '../discord/slashCommands.js';
import { readConfig } from '../config.js';
import { createDiscordClient } from '../discord/client.js';

/**
 * Aggregates every route module into a single "METHOD /path" -> handler map.
 * Also wires up MessageReactionAdd (permission-request resolution),
 * MessageCreate (steering), and slash command (pause/resume) handling on
 * `deps.discordClient`, if given.
 */
export function buildRoutes(deps = {}) {
  if (deps.discordClient) {
    registerReactionHandlers(deps.discordClient);
    registerSteeringHandlers(deps.discordClient);
    registerSlashCommandHandlers(deps.discordClient);
  }
  return {
    ...healthRoutes(deps),
    ...statusRoutes(deps),
    ...registerRoutes(deps),
    ...sessionStartRoutes(deps),
    ...permissionRequestRoutes(deps),
    ...notificationRoutes(deps),
    ...controlRoutes(),
  };
}

export function createDaemonServer(deps = {}) {
  return createServer(buildRoutes(deps));
}

/**
 * Boots the daemon's HTTP server on the configured port, and connects the
 * Discord client using the saved config (unless a client/factory is injected
 * via `deps`, which tests use to avoid a real gateway connection).
 * @param {{ port?: number, deps?: { discordClient?: object, createDiscordClient?: () => object } }} [options]
 */
export async function startDaemon({ port, deps = {} } = {}) {
  const config = readConfig();
  const listenPort = port ?? config.port ?? 4790;

  const clientFactory = deps.createDiscordClient ?? createDiscordClient;
  let discordClient = deps.discordClient;
  if (!discordClient && config.token) {
    discordClient = clientFactory();
    discordClient.login(config.token).then(
      () => {
        if (!config.guildId) return;
        registerSlashCommands(discordClient, { guildId: config.guildId }).catch((err) => {
          console.error('Failed to register Discord slash commands:', err.message);
        });
      },
      (err) => {
        console.error('Discord login failed:', err.message);
      }
    );
  }

  const server = createDaemonServer({ ...deps, discordClient });
  // Stashed for callers (CLI shutdown, /status route, tests) to reach the
  // live client without threading it through separately.
  /** @type {any} */ (server).discordClient = discordClient;

  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(listenPort, '127.0.0.1', () => {
      server.removeListener('error', reject);
      resolve();
    });
  });
  return server;
}
