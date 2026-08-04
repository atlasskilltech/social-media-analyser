'use strict';

/**
 * The single execution path shared by all platform scrapers.
 *
 * A platform module only describes itself — URL, output fields, strategy list.
 * Navigation, strategy chaining, forensics, status classification, cache
 * writing, logging and error containment happen here exactly once.
 */

const { withPage, gotoResilient } = require('./browser');
const { runPipeline } = require('./pipeline');
const { shutdownOcr } = require('./ocr');
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
/**
 * Normalise a field before comparing two records.
 *
 * Meta signs its CDN image URLs and rotates the query string on every request,
 * so the raw URL always differs even when the picture has not changed. Comparing
 * the asset path is what makes "Already Up To Date" mean something — otherwise
 * every refresh would report a change.
 */
function comparable(key, value) {
  if (value === null || value === undefined) return null;
  if (key === 'profileImage') return String(value).split('?')[0];
  return value;
}

function isBlockSignal(message = '') {
  return /HTTP 999|HTTP 40[13]|HTTP 429|login page|blocked/i.test(message);
}

/**
 * Fetch one platform from an official API, save it, log it. Never throws.
 *
 * Providers with `kind: 'api'` have no page, no strategies and no browser —
 * they return values directly. Everything downstream (classification, cache
 * writing, logging, the unified record) is shared with the scraper path, so
 * this adds a source of data rather than a second pipeline.
 *
 * @param {Object} spec
 * @returns {Promise<{ok, platform, record, report, forensics, error?}>}
 */
async function fetchAndSave(spec) {
  const { platform, url, fields, requiredKeys, source } = spec;
  const startedAt = Date.now();

  try {
    const values = await spec.fetch();
    const scrapeTime = Date.now() - startedAt;
    const missing = requiredKeys.filter((key) => !values[key]);

    const record = toRecord(platform, values, {
      status: missing.length ? STATUS.PARTIAL : STATUS.SUCCESS,
      profileUrl: url,
      scrapeTime,
      strategy: source || 'api',
    });

    // A single synthetic report entry keeps the API response shape identical to
    // the scraper path, so the UI needs no special case.
    const report = [
      {
        name: source || 'api',
        status: missing.length ? 'empty' : 'ok',
        detail: missing.length ? `missing ${missing.join(', ')}` : `satisfied ${requiredKeys.join(', ')}`,
        ms: scrapeTime,
      },
    ];

    if (missing.length) {
      await logEvent(platform, 'FAILURE', `API response missing: ${missing.join(', ')}`);
      return { ok: false, platform, record, report, forensics: null, error: `missing ${missing.join(', ')}` };
    }

    /*
     * Compare against what is cached before writing.
     *
     * lastUpdated and scrapeTime change on every call by definition, so only
     * the platform's own data fields are compared.
     */
    const previous = await readCache(platform);
    const changed =
      !previous || fields.some((key) => comparable(key, previous[key]) !== comparable(key, record[key]));

    /*
     * When nothing meaningful changed, keep the previous lastUpdated so the card
     * reports when the data last actually moved, not when we last checked.
     *
     * The record is still written, because signed CDN image URLs expire. Not
     * rewriting would leave a stale signature that eventually 403s on a page
     * whose follower count rarely changes.
     */
    if (!changed && previous?.lastUpdated) {
      record.lastUpdated = previous.lastUpdated;
    }

    const saved = await writeCache(platform, record, requiredKeys, { preserveLastUpdated: !changed });

    if (!changed) {
      await logEvent(platform, 'SUCCESS', `no change (${scrapeTime}ms)`);
      console.log(`[api] ${platform} already up to date (${scrapeTime}ms)`);
      return { ok: true, platform, record: saved.written ? saved.data : record, report, forensics: null, changed: false };
    }

    if (!saved.written) {
      // The write failing does not invalidate the data we just fetched — hand
      // the fresh record back so the UI can still display it. On serverless the
      // filesystem is ephemeral anyway; the response is the source of truth.
      await logEvent(platform, 'FAILURE', `cache not updated — ${saved.reason}`);
      console.warn(`[api] ${platform} fetched ok but cache write failed: ${saved.reason}`);
      return { ok: true, platform, record, report, forensics: null, changed: true, cacheWriteFailed: true };
    }

    await logEvent(platform, 'SUCCESS', `via ${source || 'api'} in ${scrapeTime}ms (data changed)`);
    console.log(`[api] ${platform} updated via ${source || 'api'} (${scrapeTime}ms)`);

    return { ok: true, platform, record: saved.data, report, forensics: null, changed: true };
  } catch (err) {
    // Config, auth, permission, rate-limit and network failures all land here
    // with a message written for a human — see lib/meta/common.js.
    const message = err.userMessage || err.message;
    const scrapeTime = Date.now() - startedAt;

    const record = toRecord(platform, {}, {
      status: err.code === 'META_GRAPH' && [190, 10, 200].includes(err.graphCode)
        ? STATUS.BLOCKED
        : STATUS.FAILED,
      profileUrl: url,
      scrapeTime,
      strategy: null,
    });

    // Nothing cached yet? Record the attempt so the card can explain itself.
    const previous = await readCache(platform);
    if (!previous) await writeCache(platform, record, requiredKeys, { allowEmpty: true });

    await logEvent(platform, 'FAILURE', message);
    console.error(`[api] ${platform} failed: ${message}`);

    return {
      ok: false,
      platform,
      record,
      report: [{ name: source || 'api', status: 'error', detail: message, ms: scrapeTime }],
      forensics: null,
      error: message,
    };
  }
}

/**
 * Run one platform through whichever pipeline it declares. Never throws.
 *
 * @param {ScraperSpec} spec
 * @param {import('playwright-core').Browser} [browser] reuse an open browser
 * @returns {Promise<{ok, platform, record, report, forensics, error?}>}
 */
async function scrapeAndSave(spec, browser = null) {
  // API-backed platforms never touch a browser.
  if (spec.kind === 'api') return fetchAndSave(spec);

  const { platform, url, fields, requiredKeys, strategies, prepare } = spec;
  const startedAt = Date.now();

  try {
    const { values, report, forensics, nav, succeededVia } = await withPage(async (page) => {
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

      const { values, report, succeededVia } = await runPipeline(page, usable, fields, requiredKeys);
      return { values, report, forensics, nav, succeededVia };
    }, browser);

    const missing = requiredKeys.filter((key) => !values[key]);
    const contributors = succeededVia ? [succeededVia] : [];
    const scrapeTime = Date.now() - startedAt;

    // ------------------------------------------------------------- classify
    let status;
    if (missing.length === 0) {
      // Everything required was found — even if the rendered page was blocked
      // and only the page-independent strategies contributed.
      status = STATUS.SUCCESS;
    } else if (
      nav?.blocked ||
      // Refusal status codes: 999 is LinkedIn's, 403/429 are the standard ones.
      // These arrive as a normal response rather than a redirect, so they are
      // not caught by nav.blocked and must be recognised explicitly.
      [999, 403, 429].includes(nav?.status) ||
      BLOCKED_PAGE_TYPES.has(forensics?.pageType)
    ) {
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

    // Nothing usable — leave the previous cache untouched. The report already
    // carries every strategy that was attempted and why each one failed.
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

module.exports = { scrapeAndSave, fetchAndSave, printResult, BLOCKED_PAGE_TYPES };
