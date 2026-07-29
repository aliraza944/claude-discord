import { sendJson } from '../router.js';

export function healthRoutes(deps = {}) {
  return {
    'GET /health': async (req, res) => {
      sendJson(res, 200, { ok: true });
    },
  };
}
