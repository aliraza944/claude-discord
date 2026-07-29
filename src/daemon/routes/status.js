import { sendJson } from '../router.js';
import { readStateSync } from '../../state.js';

/** @param {{ discordClient?: { isReady: () => boolean } }} [deps] */
export function statusRoutes({ discordClient } = {}) {
  return {
    'GET /status': async (req, res) => {
      const state = readStateSync();
      sendJson(res, 200, {
        paused: state.paused,
        botOnline: Boolean(discordClient && discordClient.isReady()),
      });
    },
  };
}
