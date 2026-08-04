'use strict';

/**
 * The Node API.
 *
 * Three endpoints, no database, no auth. It reads the JSON files the scrapers
 * write and exposes a way to trigger a fresh scrape:
 *
 *   GET  /api/data     every platform's cached data + refresh state
 *   GET  /api/status   refresh state only (cheap, for polling)
 *   POST /api/refresh  start a scrape; returns 202 immediately
 *
 * In production it also serves the built React app from dist/. In development
 * Vite serves the UI on :5173 and proxies /api here.
 */

const path = require('path');
const fs = require('fs');
const express = require('express');

const URLS = require('./config');
const { ORDER, LABELS, isImplemented } = require('./lib/platforms');
const { readCache, CACHE_DIR } = require('./lib/storage');
const { getState, startRefresh } = require('./lib/refresh');

const app = express();
const PORT = process.env.PORT || 3001;
const DIST_DIR = path.join(__dirname, 'dist');

app.use(express.json());

/**
 * Seconds since a platform's cache file was last written, or null if never.
 * @param {string} platform
 */
function cacheAge(platform) {
  try {
    const { mtimeMs } = fs.statSync(path.join(CACHE_DIR, `${platform}.json`));
    return Math.floor((Date.now() - mtimeMs) / 1000);
  } catch {
    return null;
  }
}

/**
 * Build the payload for one platform.
 *
 * Unimplemented platforms are returned too, flagged, so the dashboard can show
 * a placeholder card instead of the UI hardcoding which scrapers exist yet.
 */
async function platformPayload(platform) {
  const implemented = isImplemented(platform);
  const data = implemented ? await readCache(platform) : null;

  return {
    platform,
    label: LABELS[platform] || platform,
    url: URLS[platform] || null,
    implemented,
    hasData: Boolean(data),
    data,
    ageSeconds: data ? cacheAge(platform) : null,
  };
}

// ------------------------------------------------------------------ routes

/** Everything the dashboard needs for a full render. */
app.get('/api/data', async (_req, res) => {
  const platforms = await Promise.all(ORDER.map(platformPayload));
  res.json({ platforms, refresh: getState(), serverTime: new Date().toISOString() });
});

/** Just the refresh state — what the client polls while a scrape runs. */
app.get('/api/status', (_req, res) => {
  res.json({ refresh: getState(), serverTime: new Date().toISOString() });
});

/**
 * Start a scrape.
 *
 * Returns 202 immediately rather than holding the connection for the ~15s
 * (soon ~60s, with four platforms) that Playwright needs. The client polls
 * /api/status and refetches /api/data when the run finishes.
 *
 * 409 = a scrape is already running.  429 = cooldown still active.
 */
app.post('/api/refresh', (req, res) => {
  const only = Array.isArray(req.body?.platforms) ? req.body.platforms : null;
  const { started, reason } = startRefresh(only);

  if (started) {
    return res.status(202).json({ started: true, refresh: getState() });
  }

  const status = reason === 'cooldown' ? 429 : 409;
  const message =
    reason === 'cooldown'
      ? `Cooldown active — try again in ${getState().cooldownRemaining}s.`
      : 'A refresh is already running.';

  res.status(status).json({ started: false, reason, message, refresh: getState() });
});

// ------------------------------------------------------- static (production)

if (fs.existsSync(DIST_DIR)) {
  app.use(express.static(DIST_DIR));
  // SPA fallback for anything that is not an API route.
  app.use((req, res, next) => {
    if (req.path.startsWith('/api/')) return next();
    res.sendFile(path.join(DIST_DIR, 'index.html'));
  });
}

/** Last-resort handler so a thrown error returns JSON, never an HTML stack. */
app.use((err, _req, res, _next) => {
  console.error('Unhandled API error:', err);
  res.status(500).json({ error: err.message || 'Internal error' });
});

app.listen(PORT, () => {
  console.log(`API listening on http://localhost:${PORT}`);
  console.log(fs.existsSync(DIST_DIR) ? 'Serving built UI from dist/' : 'Dev mode — run Vite for the UI');
});
