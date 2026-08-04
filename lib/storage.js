'use strict';

/**
 * All disk I/O: the JSON cache and the error log.
 *
 * Two guarantees this module makes to the rest of the project:
 *   1. Good data is never replaced by empty data.
 *   2. Nothing here throws — a disk problem is logged, not fatal.
 */

const fs = require('fs/promises');
const fsSync = require('node:fs');
const os = require('node:os');
const path = require('path');
const { nowIso } = require('./utils');

/**
 * Project root.
 *
 * __dirname is the natural choice and works for `node instagram.js`, but Next's
 * bundler rewrites it in server builds — inside a route handler it resolves to
 * a stub ("/ROOT"), so every cache read silently missed. We therefore trust
 * __dirname only when it points at a directory that really holds package.json,
 * and fall back to the working directory otherwise.
 *
 * This keeps the CLI runnable from any directory while letting the same code
 * work unchanged inside Next.
 */
const DIRNAME_ROOT = path.resolve(__dirname, '..');
const ROOT = fsSync.existsSync(path.join(DIRNAME_ROOT, 'package.json'))
  ? DIRNAME_ROOT
  : process.cwd();

/** Where the repository's committed snapshot lives. Read-only on serverless. */
const CACHE_DIR = path.join(ROOT, 'cache');
const LOG_DIR = path.join(ROOT, 'logs');
const LOG_FILE = path.join(LOG_DIR, 'error.log');

/*
 * Writable locations.
 *
 * On a normal server these are the same directories. On serverless the
 * deployment bundle is mounted read-only and /tmp is the only writable path,
 * so writes are redirected there.
 *
 * Be clear about what this does and does not buy: /tmp is per-instance and
 * ephemeral. A refresh is visible to subsequent requests only while the same
 * warm instance serves them, and is lost on cold start. It makes the write
 * succeed; it does not make the data durable or shared.
 */
const IS_SERVERLESS = Boolean(process.env.VERCEL || process.env.AWS_LAMBDA_FUNCTION_NAME);
const WRITE_CACHE_DIR = IS_SERVERLESS ? path.join(os.tmpdir(), 'social-cache') : CACHE_DIR;
const WRITE_LOG_DIR = IS_SERVERLESS ? path.join(os.tmpdir(), 'social-logs') : LOG_DIR;
const WRITE_LOG_FILE = path.join(WRITE_LOG_DIR, 'error.log');

/** Create the writable cache/log directories if they do not exist yet. */
async function ensureDirs() {
  await fs.mkdir(WRITE_CACHE_DIR, { recursive: true });
  await fs.mkdir(WRITE_LOG_DIR, { recursive: true });
}

/**
 * Append one line to the error log.
 * Format: [ISO date] [PLATFORM] [SUCCESS|FAILURE|PARTIAL] reason
 *
 * On serverless this also mirrors to stdout, which is the only place the
 * platform's log viewer can see it.
 */
async function logEvent(platform, status, reason) {
  const line = `[${nowIso()}] [${String(platform).toUpperCase()}] [${status}] ${reason}\n`;

  if (IS_SERVERLESS) console.log(line.trim());

  try {
    await ensureDirs();
    await fs.appendFile(WRITE_LOG_FILE, line, 'utf8');
  } catch (err) {
    // Logging must never break a scrape.
    console.error('Could not write to error.log:', err.message);
  }
}

/**
 * Read <platform>.json. Returns null when missing or corrupt.
 *
 * Checks the writable location first so a refresh performed by this instance
 * wins, then falls back to the snapshot committed with the deployment. On a
 * normal server both paths are the same directory.
 *
 * @param {string} platform
 */
async function readCache(platform) {
  const candidates =
    WRITE_CACHE_DIR === CACHE_DIR
      ? [path.join(CACHE_DIR, `${platform}.json`)]
      : [path.join(WRITE_CACHE_DIR, `${platform}.json`), path.join(CACHE_DIR, `${platform}.json`)];

  for (const file of candidates) {
    try {
      const raw = await fs.readFile(file, 'utf8');
      const parsed = JSON.parse(raw);
      if (parsed && typeof parsed === 'object') return parsed;
    } catch {
      // Try the next candidate; missing and unparseable are treated the same.
    }
  }

  return null;
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
 * @param {{allowEmpty?: boolean}} [opts] allowEmpty writes a record even with
 *        no usable fields. Only safe when there is no previous cache to
 *        protect — it lets the UI show "blocked" instead of "no data".
 * @returns {Promise<{written: boolean, data: Object, reused: string[], reason?: string}>}
 */
async function writeCache(platform, fresh, requiredKeys, opts = {}) {
  const previous = (await readCache(platform)) || {};

  const gotSomething = requiredKeys.some((k) => fresh[k] && String(fresh[k]).trim());
  if (!gotSomething && !opts.allowEmpty) {
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
  /*
   * lastUpdated marks when the data last changed, not when it was last checked.
   * Callers that detected no change pass preserveLastUpdated so a re-check does
   * not make unchanged data look newly refreshed.
   */
  merged.lastUpdated = opts.preserveLastUpdated && fresh.lastUpdated ? fresh.lastUpdated : nowIso();

  const file = path.join(WRITE_CACHE_DIR, `${platform}.json`);
  try {
    await ensureDirs();
    // Write to a temp file then rename, so a crash mid-write cannot leave
    // a half-written JSON file that a reader would fail to parse.
    const tmp = `${file}.tmp`;
    await fs.writeFile(tmp, JSON.stringify(merged, null, 2) + '\n', 'utf8');
    await fs.rename(tmp, file);
    return { written: true, data: merged, reused, path: file, ephemeral: IS_SERVERLESS };
  } catch (err) {
    return {
      written: false,
      data: previous,
      reused: [],
      reason: `disk write failed at ${file}: ${err.code || ''} ${err.message}`.trim(),
    };
  }
}

module.exports = {
  ensureDirs,
  logEvent,
  readCache,
  writeCache,
  CACHE_DIR,
  LOG_FILE,
  WRITE_CACHE_DIR,
  IS_SERVERLESS,
};
