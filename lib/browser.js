'use strict';

/**
 * Browser lifecycle + the strategy runner.
 *
 * Every scraper is built the same way: open a page, run an ordered list of
 * extraction strategies over it, merge whatever each one manages to find.
 * A strategy that throws is recorded and skipped — the chain always runs to
 * the end, so a broken DOM selector never costs us the meta tags.
 */

const config = require('../playwright.config');
const { mergePartials } = require('./utils');
const { resolveChromium } = require('./chromium');

/**
 * Launch Chromium.
 *
 * Which Chromium and with what options is decided by lib/chromium.js — locally
 * it is Playwright's own download, on serverless it is @sparticuz/chromium.
 * Callers do not care and never had to change.
 *
 * @returns {Promise<import('playwright-core').Browser>}
 */
async function launchBrowser() {
  const { browserType, launchOptions, source } = await resolveChromium();
  console.log(`[browser] launching chromium via ${source}`);
  return browserType.launch(launchOptions);
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
 * Does this navigation error mean the site bounced us, rather than the network
 * failing? A redirect to a login or consent page is a decision, not a glitch.
 */
function isRedirectBlock(message = '') {
  return /interrupted by another navigation|accounts\/login|\/login|checkpoint|challenge|consent/i.test(
    message
  );
}

/**
 * Navigate, with retries, and report what happened.
 *
 * Deliberately does NOT throw. An earlier version did, which aborted the whole
 * scrape the moment a site bounced us — taking down `raw-html-fetch` too, even
 * though that strategy issues its own HTTP request and never needs the page to
 * load. Returning a result lets the caller keep going with whatever still works.
 *
 * @returns {Promise<{ok: boolean, status: number|null, finalUrl: string|null,
 *                    blocked: boolean, error: string|null}>}
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

      const finalUrl = page.url();
      // A silent redirect to a login page: the navigation "succeeded" but we
      // did not land on the profile.
      const bounced = isRedirectBlock(finalUrl) && !isRedirectBlock(url);

      return {
        ok: !bounced,
        status: response ? response.status() : null,
        finalUrl,
        blocked: bounced,
        error: bounced ? `redirected to ${finalUrl}` : null,
      };
    } catch (err) {
      lastError = err;

      // Retrying a login redirect just burns the clock — the answer will not
      // change. Bail out immediately and let the page-independent strategies run.
      if (isRedirectBlock(err.message)) {
        return {
          ok: false,
          status: null,
          finalUrl: page.url(),
          blocked: true,
          error: err.message,
        };
      }

      if (attempt < config.navigationRetries) {
        await page.waitForTimeout(1500 * (attempt + 1)); // linear backoff
      }
    }
  }

  return {
    ok: false,
    status: null,
    finalUrl: page.url(),
    blocked: false,
    error: `navigation failed after ${config.navigationRetries + 1} attempts: ${lastError.message}`,
  };
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
