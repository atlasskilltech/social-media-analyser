'use strict';

/**
 * The single execution path shared by all platform scrapers.
 *
 * A platform module only describes itself — URL, output fields, strategy list.
 * Navigation, strategy chaining, forensics, status classification, cache
 * writing, logging and error containment happen here exactly once.
 */

const { withPage, gotoResilient, runStrategies } = require('./browser');
const { finalize } = require('./utils');
const { writeCache, readCache, logEvent, WRITE_CACHE_DIR } = require('./storage');
const { captureForensics } = require('./pageForensics');
const { toRecord, STATUS } = require('./schema');

/**
 * @typedef {Object} ScraperSpec
 * @property {string} platform       e.g. 'instagram' — also the cache filename
 * @property {string} label          display name
 * @property {string} url            the fixed public URL
 * @property {string[]} fields       which record keys this platform produces
 * @property {string[]} requiredKeys all must be present for `success`
 * @property {Array<{name: string, run: Function}>} strategies ordered chain
 * @property {(page) => Promise<void>} [prepare] optional pre-step
 */

/** Page classifications that mean "the site refused us", not "our code broke". */
const BLOCKED_PAGE_TYPES = new Set(['login-wall', 'checkpoint', 'captcha', 'rate-limited']);

/**
 * Does this error mean the site refused us rather than something breaking?
 *
 * HTTP 999 is LinkedIn's non-standard "request denied" code for automated
 * clients. Distinguishing this from a genuine fault matters: `blocked` tells
 * the operator the scraper is fine and the platform is gating access, while
 * `failed` invites a pointless hunt for a bug in our code.
 */
function isBlockSignal(message = '') {
  return /HTTP 999|HTTP 40[13]|HTTP 429|login page|blocked/i.test(message);
}

/**
 * Scrape one platform, classify it, save it, log it. Never throws.
 *
 * @param {ScraperSpec} spec
 * @param {import('playwright-core').Browser} [browser] reuse an open browser
 * @returns {Promise<{ok, platform, record, report, forensics, error?}>}
 */
async function scrapeAndSave(spec, browser = null) {
  const { platform, url, fields, requiredKeys, strategies, prepare } = spec;
  const startedAt = Date.now();

  try {
    const { values, report, forensics } = await withPage(async (page) => {
      const httpStatus = await gotoResilient(page, url);
      if (httpStatus && httpStatus >= 400) {
        throw new Error(`page returned HTTP ${httpStatus}`);
      }

      if (prepare) await prepare(page);

      // Captured before extraction, while the page is still open: when nothing
      // is found this is what distinguishes stale selectors from a login wall.
      const forensics = await captureForensics(page, platform, WRITE_CACHE_DIR);

      const { acc, report } = await runStrategies(page, strategies);
      return { values: finalize(acc, fields), report, forensics };
    }, browser);

    const missing = requiredKeys.filter((key) => !values[key]);
    const contributors = report.filter((r) => r.status === 'ok').map((r) => r.name);
    const scrapeTime = Date.now() - startedAt;

    // ------------------------------------------------------------- classify
    let status;
    if (missing.length === 0) {
      status = STATUS.SUCCESS;
    } else if (BLOCKED_PAGE_TYPES.has(forensics?.pageType)) {
      status = STATUS.BLOCKED;
    } else {
      status = STATUS.FAILED;
    }

    const record = toRecord(platform, values, {
      status,
      profileUrl: url,
      scrapeTime,
      strategy: contributors.join(', ') || null,
    });

    const strategyDetail = report.map((r) => `${r.name}=${r.status}`).join(' ');

    // Nothing usable — leave the previous cache untouched.
    if (missing.length) {
      /*
       * One exception: if there is no previous cache, there is nothing to
       * protect, so record the attempt. That lets the card show "Blocked" with
       * a timestamp rather than an indefinite "No data available", which reads
       * as though the platform was never tried.
       */
      const previous = await readCache(platform);
      if (!previous) {
        await writeCache(platform, record, requiredKeys, { allowEmpty: true });
      }

      await logEvent(
        platform,
        'FAILURE',
        `missing: ${missing.join(', ')} | pageType=${forensics?.pageType} | ${strategyDetail}`
      );
      return {
        ok: false,
        platform,
        record,
        report,
        forensics,
        error: `no required field extracted (${missing.join(', ')})`,
      };
    }

    // ---------------------------------------------------------------- save
    const saved = await writeCache(platform, record, requiredKeys);
    if (!saved.written) {
      await logEvent(platform, 'FAILURE', `cache not updated — ${saved.reason}`);
      return { ok: false, platform, record, report, forensics, error: saved.reason };
    }

    await logEvent(platform, 'SUCCESS', `via ${contributors.join(', ')} in ${scrapeTime}ms | ${strategyDetail}`);
    console.log(`[scrape] ${platform} ok via: ${contributors.join(', ') || 'none'} (${scrapeTime}ms)`);

    return { ok: true, platform, record: saved.data, report, forensics };
  } catch (err) {
    // Navigation, timeout, block page — contained so the orchestrator can move
    // on to the next platform.
    const record = toRecord(platform, {}, {
      status: isBlockSignal(err.message) ? STATUS.BLOCKED : STATUS.FAILED,
      profileUrl: url,
      scrapeTime: Date.now() - startedAt,
    });

    // Same reasoning as above: with no previous cache there is nothing to
    // protect, so record the attempt rather than leaving the card blank.
    const previous = await readCache(platform);
    if (!previous) {
      await writeCache(platform, record, requiredKeys, { allowEmpty: true });
    }

    await logEvent(platform, 'FAILURE', err.message);
    return { ok: false, platform, record, report: [], forensics: null, error: err.message };
  }
}

/** Print a scrape result to the terminal: the strategy chain, then the record. */
function printResult(result) {
  const { platform, report, record, ok, error } = result;

  console.log(`\n=== ${platform.toUpperCase()} ===`);
  for (const r of report) {
    const icon = r.status === 'ok' ? '[ok]   ' : r.status === 'empty' ? '[skip] ' : '[fail] ';
    console.log(`${icon}${r.name.padEnd(24)} ${r.detail}`);
  }

  if (ok) {
    console.log(`\n--- cache/${platform}.json ---`);
    console.log(JSON.stringify(record, null, 2));
  } else {
    console.log(`\nFAILED: ${error}`);
  }
}

module.exports = { scrapeAndSave, printResult, BLOCKED_PAGE_TYPES };
