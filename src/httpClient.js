/**
 * `fetch` wrapper used by hook scripts to talk to the daemon. `timeoutMs`
 * becomes a per-call `AbortSignal.timeout`; omitting it makes the request
 * wait indefinitely (used for the permission-request POST, which the daemon
 * intentionally holds open).
 * @param {string} url
 * @param {{ method?: string, body?: any, timeoutMs?: number }} [options]
 */
export async function httpRequest(url, { method = 'GET', body, timeoutMs } = {}) {
  const init = { method };
  if (body !== undefined) {
    init.headers = { 'content-type': 'application/json' };
    init.body = JSON.stringify(body);
  }
  if (timeoutMs != null) {
    init.signal = AbortSignal.timeout(timeoutMs);
  }
  return fetch(url, init);
}
