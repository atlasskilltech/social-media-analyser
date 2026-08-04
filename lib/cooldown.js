'use strict';

/**
 * Rate limit for scrape triggers.
 *
 * This used to live in the PHP page. It is server-side state on purpose: a
 * client-side guard is trivially bypassed by a reload, and we already watched
 * repeated refreshes fire eleven Chromium runs at Instagram in eight minutes.
 * Any entry point that can start a scrape must go through this module.
 */

const fs = require('fs');
const path = require('path');
const { CACHE_DIR } = require('./storage');

/** Minimum seconds between scrape runs. */
const COOLDOWN_SECONDS = 60;

/** Epoch ms of the last run in this process, or null if none yet. */
let lastRunAt = null;

/**
 * Newest mtime across the cache files, in epoch ms.
 *
 * Seeds the cooldown from disk so restarting the server does not hand out a
 * free scrape — otherwise a crash-loop would bypass the limit entirely.
 * @returns {number|null}
 */
function newestCacheWrite() {
  try {
    const files = fs.readdirSync(CACHE_DIR).filter((f) => f.endsWith('.json'));
    let newest = null;
    for (const file of files) {
      const { mtimeMs } = fs.statSync(path.join(CACHE_DIR, file));
      if (newest === null || mtimeMs > newest) newest = mtimeMs;
    }
    return newest;
  } catch {
    return null; // no cache dir yet — first run is allowed
  }
}

/** Epoch ms of the most recent scrape, from memory or disk. */
function lastRun() {
  if (lastRunAt !== null) return lastRunAt;
  return newestCacheWrite();
}

/** Whole seconds left on the cooldown; 0 when a scrape is allowed. */
function secondsRemaining() {
  const last = lastRun();
  if (last === null) return 0;
  const elapsed = (Date.now() - last) / 1000;
  return Math.max(0, Math.ceil(COOLDOWN_SECONDS - elapsed));
}

/** True while scraping is blocked. */
function isActive() {
  return secondsRemaining() > 0;
}

/** Record that a scrape just started. Call this before launching Chromium. */
function markRun() {
  lastRunAt = Date.now();
}

module.exports = { COOLDOWN_SECONDS, secondsRemaining, isActive, markRun, lastRun };
