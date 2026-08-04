'use strict';

/**
 * The single execution path shared by all four platform scrapers.
 *
 * A scraper module only has to describe itself (URL, output fields, strategy
 * list); everything else — navigation, strategy chaining, cache writing,
 * logging, error containment, terminal output — happens here exactly once.
 */

const { withPage, gotoResilient, runStrategies } = require('./browser');
const { finalize } = require('./utils');
const { writeCache, logEvent } = require('./storage');

/**
 * @typedef {Object} ScraperSpec
 * @property {string} platform      e.g. 'instagram' — also the cache filename
 * @property {string} url           the fixed public URL
 * @property {string[]} fields      output key order for the JSON file
 * @property {string[]} requiredKeys at least one must be found or we keep the old cache
 * @property {Array<{name: string, run: Function}>} strategies ordered fallback chain
 * @property {(page) => Promise<void>} [prepare] optional pre-step (dismiss overlays)
 */

/**
 * Scrape one platform, save it, log the outcome. Never throws.
 *
 * @param {ScraperSpec} spec
 * @param {import('playwright').Browser} [browser] reuse an already-open browser
 * @returns {Promise<{ok: boolean, platform: string, data: Object|null, report: Array, error?: string}>}
 */
async function scrapeAndSave(spec, browser = null) {
  const { platform, url, fields, requiredKeys, strategies, prepare } = spec;

  try {
    const { data, report } = await withPage(async (page) => {
      const httpStatus = await gotoResilient(page, url);
      if (httpStatus && httpStatus >= 400) {
        throw new Error(`page returned HTTP ${httpStatus}`);
      }

      // Platform-specific prep: cookie banners, login overlays, lazy content.
      if (prepare) await prepare(page);

      const { acc, report } = await runStrategies(page, strategies);

      const out = finalize(acc, fields);
      out.url = url;              // always known, never scraped
      out.lastUpdated = '';       // stamped by writeCache on success
      return { data: out, report };
    }, browser);

    // Persist, refusing to blank out good data.
    const saved = await writeCache(platform, data, requiredKeys);

    if (!saved.written) {
      await logEvent(platform, 'FAILURE', `cache not updated — ${saved.reason}`);
      return { ok: false, platform, data: saved.data, report, error: saved.reason };
    }

    const missing = fields.filter((f) => !saved.data[f]);
    const status = missing.length ? 'PARTIAL' : 'SUCCESS';
    const detail = [
      `strategies: ${report.map((r) => `${r.name}=${r.status}`).join(' ')}`,
      missing.length ? `missing: ${missing.join(', ')}` : '',
      saved.reused.length ? `kept previous: ${saved.reused.join(', ')}` : '',
    ]
      .filter(Boolean)
      .join(' | ');

    await logEvent(platform, status, detail);
    return { ok: true, platform, data: saved.data, report };
  } catch (err) {
    // Anything at all — navigation, timeout, block page — lands here so the
    // orchestrator can carry on with the other three platforms.
    await logEvent(platform, 'FAILURE', err.message);
    return { ok: false, platform, data: null, report: [], error: err.message };
  }
}

/**
 * Print a scrape result to the terminal: the strategy chain, then the JSON.
 * @param {{ok: boolean, platform: string, data: Object|null, report: Array, error?: string}} result
 */
function printResult(result) {
  const { platform, report, data, ok, error } = result;

  console.log(`\n=== ${platform.toUpperCase()} ===`);

  for (const r of report) {
    const icon = r.status === 'ok' ? '[ok]   ' : r.status === 'empty' ? '[skip] ' : '[fail] ';
    console.log(`${icon}${r.name.padEnd(14)} ${r.detail}`);
  }

  if (ok) {
    console.log(`\n--- cache/${platform}.json ---`);
    console.log(JSON.stringify(data, null, 2));
  } else {
    console.log(`\nFAILED: ${error}`);
    if (data && Object.keys(data).length) {
      console.log('Previous cached data kept:');
      console.log(JSON.stringify(data, null, 2));
    }
  }
}

/**
 * Convenience entry point for `node <platform>.js`.
 * Sets the process exit code so callers (PHP, cron) can detect failure.
 * @param {ScraperSpec} spec
 */
async function runStandalone(spec) {
  const result = await scrapeAndSave(spec);
  printResult(result);
  if (!result.ok) process.exitCode = 1;
  return result;
}

module.exports = { scrapeAndSave, printResult, runStandalone };
