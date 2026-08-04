'use strict';

/**
 * Shared Meta Graph API client.
 *
 * Every Graph call in the project goes through here: one place that knows the
 * base URL, how credentials are read, and how Graph's error shapes translate
 * into messages a human can act on.
 *
 * Credentials come from the environment only — nothing is hardcoded.
 */

/** Fallback version, used only when the environment does not specify one. */
const DEFAULT_VERSION = 'v21.0';

/**
 * Read and validate configuration.
 *
 * Throws a MetaConfigError naming the missing variable rather than letting a
 * request fail later with an opaque Graph error.
 *
 * @param {string[]} required extra keys this call needs (e.g. an account id)
 */
function readConfig(required = []) {
  const token = process.env.META_ACCESS_TOKEN;
  // META_GRAPH_VERSION is the documented name; the older
  // META_GRAPH_API_VERSION is still accepted so existing .env files keep working.
  const version =
    process.env.META_GRAPH_VERSION || process.env.META_GRAPH_API_VERSION || DEFAULT_VERSION;

  const missing = [];
  if (!token) missing.push('META_ACCESS_TOKEN');
  for (const key of required) {
    if (!process.env[key]) missing.push(key);
  }

  if (missing.length) {
    const err = new Error(
      `Missing environment variable${missing.length > 1 ? 's' : ''}: ${missing.join(', ')}`
    );
    err.code = 'META_CONFIG';
    err.userMessage = `Configuration incomplete — set ${missing.join(', ')}.`;
    throw err;
  }

  return { token, version };
}

/**
 * Translate a Graph error into something actionable.
 *
 * Graph reports almost everything as HTTP 400 with a code in the body, so the
 * code is what matters, not the status.
 *
 * @param {number} status
 * @param {{code?: number, error_subcode?: number, message?: string, type?: string}} graphError
 */
function describeGraphError(status, graphError = {}) {
  const { code, error_subcode: subcode, message } = graphError;

  // 190 covers expired, revoked and malformed tokens; the subcode says which.
  if (code === 190) {
    if (subcode === 463) return 'Access token has expired. Generate a new Page token.';
    if (subcode === 467) return 'Access token is invalid or was revoked. Generate a new Page token.';
    return 'Access token was rejected. Check META_ACCESS_TOKEN.';
  }

  if (code === 10 || code === 200 || code === 299) {
    return `Permission denied by Graph API — the token is missing a required scope. (${message})`;
  }

  if (code === 100) {
    return `Graph API rejected the request — unknown field or invalid id. (${message})`;
  }

  if (code === 4 || code === 17 || code === 32 || code === 613) {
    return 'Graph API rate limit reached. Try again shortly.';
  }

  if (status === 401 || status === 403) {
    return `Not authorised (HTTP ${status}). ${message || ''}`.trim();
  }

  return message || `Graph API request failed with HTTP ${status}.`;
}

/**
 * GET a node from the Graph API.
 *
 * @param {string} nodeId  the object id
 * @param {string[]} fields fields to request
 * @param {{required?: string[], timeoutMs?: number}} [opts]
 * @returns {Promise<Object>} the parsed node
 */
async function graphGet(nodeId, fields, opts = {}) {
  const { token, version } = readConfig(opts.required);

  const url = new URL(`https://graph.facebook.com/${version}/${nodeId}`);
  url.searchParams.set('fields', fields.join(','));
  url.searchParams.set('access_token', token);

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), opts.timeoutMs ?? 15000);

  let response;
  try {
    response = await fetch(url, { signal: controller.signal });
  } catch (err) {
    const wrapped = new Error(
      err.name === 'AbortError' ? 'Graph API request timed out.' : `Network error: ${err.message}`
    );
    wrapped.code = 'META_NETWORK';
    wrapped.userMessage = wrapped.message;
    throw wrapped;
  } finally {
    clearTimeout(timer);
  }

  let body;
  try {
    body = await response.json();
  } catch {
    const err = new Error(`Graph API returned a non-JSON response (HTTP ${response.status}).`);
    err.code = 'META_BAD_RESPONSE';
    err.userMessage = err.message;
    throw err;
  }

  if (!response.ok || body.error) {
    const err = new Error(describeGraphError(response.status, body.error));
    err.code = 'META_GRAPH';
    err.status = response.status;
    err.graphCode = body.error?.code ?? null;
    err.userMessage = err.message;
    throw err;
  }

  return body;
}

/**
 * Normalise a Graph value for the cache.
 *
 * Counts arrive as numbers but the unified record stores strings, so the same
 * formatting path serves API and scraped data alike.
 */
function asString(value) {
  if (value === null || value === undefined || value === '') return null;
  return String(value);
}

module.exports = { graphGet, readConfig, describeGraphError, asString, DEFAULT_VERSION };
