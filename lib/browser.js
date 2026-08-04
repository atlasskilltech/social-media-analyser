'use strict';

/**
 * Browser lifecycle + the strategy runner.
 *
 * Every scraper is built the same way: open a page, run an ordered list of
 * extraction strategies over it, merge whatever each one manages to find.
 * A strategy that throws is recorded and skipped — the chain always runs to
 * the end, so a broken DOM selector never costs us the meta tags.
 */

const { chromium } = require('playwright');
const config = require('../playwright.config');
const { mergePartials } = require('./utils');

/**
 * Launch Chromium with the shared settings.
 * @returns {Promise<import('playwright').Browser>}
 */
async function launchBrowser() {
  return chromium.launch(config.launch);
}

/**
 * Run `fn(page)` inside a fresh browser + context, then tear everything down.
 *
 * The finally block is the important part: it runs even when fn throws, so we
 * never leave an orphaned Chromium process behind.
 *
 * @param {(page: import('playwright').Page) => Promise<T>} fn
 * @param {import('playwright').Browser} [existingBrowser] reuse a browser when
 *        the orchestrator already opened one (all four platforms share it)
 * @returns {Promise<T>}
 * @template T
 */
async function withPage(fn, existingBrowser = null) {
  const browser = existingBrowser || (await launchBrowser());
  // A dedicated context per platform = isolated cookies and storage, so a
  // Facebook login overlay can never leak into the Instagram scrape.
  const context = await browser.newContext(config.context);
  const page = await context.newPage();

  try {
    return await fn(page);
  } finally {
    await page.close().catch(() => {});
    await context.close().catch(() => {});
    if (!existingBrowser) await browser.close().catch(() => {});
  }
}

/**
 * Navigate with retries, then give the page time to render client-side.
 *
 * @param {import('playwright').Page} page
 * @param {string} url
 * @param {{settle?: number}} [opts]
 * @returns {Promise<number|null>} the HTTP status of the main response
 */
async function gotoResilient(page, url, opts = {}) {
  const settle = opts.settle ?? config.timeouts.settle;
  let lastError = null;

  for (let attempt = 0; attempt <= config.navigationRetries; attempt++) {
    try {
      const response = await page.goto(url, {
        waitUntil: 'domcontentloaded',
        timeout: config.timeouts.navigation,
      });

      // Best-effort wait for XHR-driven content; these pages never truly go
      // idle (analytics beacons, video preloads), so a timeout here is normal.
      await page.waitForLoadState('networkidle', { timeout: settle }).catch(() => {});
      await page.waitForTimeout(settle);

      return response ? response.status() : null;
    } catch (err) {
      lastError = err;
      if (attempt < config.navigationRetries) {
        await page.waitForTimeout(2000 * (attempt + 1)); // linear backoff
      }
    }
  }

  throw new Error(`navigation failed after ${config.navigationRetries + 1} attempts: ${lastError.message}`);
}

/**
 * Run every strategy in order and merge their results.
 *
 * @param {import('playwright').Page} page
 * @param {Array<{name: string, run: (page) => Promise<Object>}>} strategies
 * @returns {Promise<{acc: Object, report: Array<{name, status, detail}>}>}
 */
async function runStrategies(page, strategies) {
  const acc = {};
  const report = [];

  for (const strategy of strategies) {
    try {
      const partial = await strategy.run(page);
      const contributed = mergePartials(acc, partial, strategy.name);

      report.push({
        name: strategy.name,
        status: contributed.length ? 'ok' : 'empty',
        detail: contributed.length ? contributed.join(', ') : 'nothing new',
      });
    } catch (err) {
      // Never stop the chain — record and continue to the next strategy.
      report.push({ name: strategy.name, status: 'error', detail: err.message });
    }
  }

  return { acc, report };
}

module.exports = { launchBrowser, withPage, gotoResilient, runStrategies, config };
