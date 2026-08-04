/**
 * Thin wrapper around the Node API.
 *
 * Every call returns parsed JSON or throws an Error carrying the server's
 * message, so components handle one failure shape instead of juggling
 * response codes.
 */

/**
 * @param {string} path
 * @param {RequestInit} [options]
 */
async function request(path, options = {}) {
  let response;
  try {
    response = await fetch(path, {
      headers: { 'Content-Type': 'application/json' },
      ...options,
    });
  } catch {
    // Network-level failure — the API process is probably not running.
    throw new Error('Cannot reach the API. Is the server running on port 3001?');
  }

  const body = await response.json().catch(() => ({}));

  if (!response.ok) {
    const error = new Error(body.message || body.error || `Request failed (${response.status})`);
    error.status = response.status;
    error.body = body;
    throw error;
  }

  return body;
}

/** Full dashboard payload: every platform plus refresh state. */
export const fetchData = () => request('/api/data');

/** Refresh state only — cheap enough to poll every couple of seconds. */
export const fetchStatus = () => request('/api/status');

/**
 * Ask the server to start a scrape.
 * Throws with status 429 when the cooldown is active, 409 when one is running.
 */
export const triggerRefresh = () => request('/api/refresh', { method: 'POST', body: '{}' });
