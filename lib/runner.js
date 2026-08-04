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
    const { values, report, forensics, nav } = await withPage(async (page) => {
      const nav = await gotoResilient(page, url);

      /*
       * A failed navigation is not the end of the scrape.
       *
       * Instagram bounces datacenter IPs to /accounts/login and YouTube can
       * time out entirely — but `raw-html-fetch` issues its own HTTP request
       * and never touches the rendered page, so it still works. Previously the
       * navigation error propagated and killed every strategy including that
       * one, turning a partial success into a total failure.
       */
      const reachable = nav.ok && !(nav.status && nav.status >= 400);
      const usable = reachable
        ? strategies
        : strategies.filter((s) => s.needsPage === false);

      if (!reachable) {
        console.log(
          `[scrape] ${platform} page unreachable (${nav.error || `HTTP ${nav.status}`}) — ` +
            `running ${usable.length} page-independent strateg${usable.length === 1 ? 'y' : 'ies'}`
        );
      }

      if (reachable && prepare) await prepare(page);

      // Forensics need a loaded page; skip them when there is nothing to look at.
      const forensics = reachable
        ? await captureForensics(page, platform, WRITE_CACHE_DIR)
        : { pageType: nav.blocked ? 'login-wall' : 'unreachable', url: nav.finalUrl, title: null, htmlLength: 0 };

      const { acc, report } = await runStrategies(page, usable);
      return { values: finalize(acc, fields), report, forensics, nav };
    }, browser);

    const missing = requiredKeys.filter((key) => !values[key]);
    const contributors = report.filter((r) => r.status === 'ok').map((r) => r.name);
    const scrapeTime = Date.now() - startedAt;

    // ------------------------------------------------------------- classify
    let status;
    if (missing.length === 0) {
      // Everything required was found — even if the rendered page was blocked
      // and only the page-independent strategies contributed.
      status = STATUS.SUCCESS;
    } else if (nav?.blocked || BLOCKED_PAGE_TYPES.has(forensics?.pageType)) {
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
