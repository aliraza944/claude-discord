import { sendJson } from '../router.js';
import { setPaused } from '../../state.js';

/**
 * HTTP surface for the global pause/resume switch. Both the CLI (when the
 * daemon is up) and the Discord /pause,/resume slash commands go through
 * these routes, which all funnel into state.js's setPaused so every caller
 * shares the same locked read-modify-write of state.json.
 */
export function controlRoutes() {
  return {
    'POST /control/pause': async (req, res) => {
      const state = await setPaused(true);
      sendJson(res, 200, { paused: state.paused });
    },
    'POST /control/resume': async (req, res) => {
      const state = await setPaused(false);
      sendJson(res, 200, { paused: state.paused });
    },
  };
}
