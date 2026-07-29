import http from 'node:http';

export function sendJson(res, statusCode, body) {
  res.writeHead(statusCode, { 'content-type': 'application/json' });
  res.end(JSON.stringify(body));
}

export async function readJsonBody(req) {
  const chunks = [];
  for await (const chunk of req) {
    chunks.push(chunk);
  }
  if (chunks.length === 0) return {};
  return JSON.parse(Buffer.concat(chunks).toString('utf8'));
}

/**
 * Builds an http.Server that dispatches to `routes`, a map of
 * "METHOD /path" -> async (req, res, url) => void. Node's default 5-minute
 * requestTimeout/headersTimeout are disabled so a permission request held
 * open awaiting a Discord reaction is never killed out from under it.
 */
export function createServer(routes) {
  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url, 'http://localhost');
    const handler = routes[`${req.method} ${url.pathname}`];
    if (!handler) {
      sendJson(res, 404, { error: 'not found' });
      return;
    }
    try {
      await handler(req, res, url);
    } catch (err) {
      if (!res.headersSent) {
        sendJson(res, 500, { error: err.message });
      } else {
        res.end();
      }
    }
  });
  server.requestTimeout = 0;
  server.headersTimeout = 0;
  return server;
}
