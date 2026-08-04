'use strict';

/**
 * All disk I/O: the JSON cache and the error log.
 *
 * Two guarantees this module makes to the rest of the project:
 *   1. Good data is never replaced by empty data.
 *   2. Nothing here throws — a disk problem is logged, not fatal.
 */

const fs = require('fs/promises');
const path = require('path');
const { nowIso } = require('./utils');

const ROOT = path.resolve(__dirname, '..');
const CACHE_DIR = path.join(ROOT, 'cache');
const LOG_DIR = path.join(ROOT, 'logs');
const LOG_FILE = path.join(LOG_DIR, 'error.log');

/** Create cache/ and logs/ if they do not exist yet. */
async function ensureDirs() {
  await fs.mkdir(CACHE_DIR, { recursive: true });
  await fs.mkdir(LOG_DIR, { recursive: true });
}

/**
 * Append one line to logs/error.log.
 * Format: [ISO date] [PLATFORM] [SUCCESS|FAILURE|PARTIAL] reason
 */
async function logEvent(platform, status, reason) {
  const line = `[${nowIso()}] [${String(platform).toUpperCase()}] [${status}] ${reason}\n`;
  try {
    await ensureDirs();
    await fs.appendFile(LOG_FILE, line, 'utf8');
  } catch (err) {
    // Logging must never break a scrape.
    console.error('Could not write to error.log:', err.message);
  }
}

/**
 * Read cache/<platform>.json. Returns null when missing or corrupt.
 * @param {string} platform
 */
async function readCache(platform) {
  const file = path.join(CACHE_DIR, `${platform}.json`);
  try {
    const raw = await fs.readFile(file, 'utf8');
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' ? parsed : null;
  } catch {
    return null; // missing or unparseable — treated the same way
  }
}

/**
 * Write cache/<platform>.json, preserving previously-good values.
 *
 * Any field that came back empty this run keeps whatever the last successful
 * run stored, so a partial scrape degrades the file rather than wiping it.
 * The write is refused entirely if not a single required field was extracted,
 * which is what stops a hard block (login wall, ban) from blanking the cache.
 *
 * @param {string} platform
 * @param {Object} fresh          this run's values (plain strings)
 * @param {string[]} requiredKeys at least one of these must be non-empty
 * @returns {Promise<{written: boolean, data: Object, reused: string[], reason?: string}>}
 */
async function writeCache(platform, fresh, requiredKeys) {
  const previous = (await readCache(platform)) || {};

  const gotSomething = requiredKeys.some((k) => fresh[k] && String(fresh[k]).trim());
  if (!gotSomething) {
    return {
      written: false,
      data: previous,
      reused: [],
      reason: `no required field extracted (${requiredKeys.join(', ')})`,
    };
  }

  // Fill blanks in this run from the last good run.
  const merged = { ...fresh };
  const reused = [];
  for (const [key, value] of Object.entries(fresh)) {
    // lastUpdated is always stamped fresh below, so it is never "reused".
    if (key === 'lastUpdated') continue;
    if ((value === '' || value === null || value === undefined) && previous[key]) {
      merged[key] = previous[key];
      reused.push(key);
    }
  }
  merged.lastUpdated = nowIso();

  const file = path.join(CACHE_DIR, `${platform}.json`);
  try {
    await ensureDirs();
    // Write to a temp file then rename, so a crash mid-write cannot leave
    // a half-written JSON file that PHP would fail to parse.
    const tmp = `${file}.tmp`;
    await fs.writeFile(tmp, JSON.stringify(merged, null, 2) + '\n', 'utf8');
    await fs.rename(tmp, file);
    return { written: true, data: merged, reused };
  } catch (err) {
    return { written: false, data: previous, reused: [], reason: `disk write failed: ${err.message}` };
  }
}

module.exports = { ensureDirs, logEvent, readCache, writeCache, CACHE_DIR, LOG_FILE };
