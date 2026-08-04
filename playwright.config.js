'use strict';

/**
 * Shared Playwright settings for every scraper.
 *
 * This is NOT a Playwright *test* config (there is no test runner in this
 * project) — it is a plain settings object consumed by lib/browser.js so all
 * four platform scrapers behave identically.
 */

module.exports = {
  /** Chromium launch options. */
  launch: {
    headless: true,
    args: [
      '--disable-blink-features=AutomationControlled', // hide the obvious automation flag
      '--disable-dev-shm-usage',
      '--no-sandbox',
    ],
  },

  /** Browser context options — a realistic, ordinary desktop visitor. */
  context: {
    userAgent:
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 ' +
      '(KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
    viewport: { width: 1366, height: 900 },
    locale: 'en-US',
    timezoneId: 'Asia/Kolkata',
    deviceScaleFactor: 1,
    // Ask for English markup so our text regexes ("followers", "Posts") match.
    extraHTTPHeaders: { 'Accept-Language': 'en-US,en;q=0.9' },
  },

  /**
   * Timeouts, in milliseconds.
   *
   * Sized against a hard budget: four platforms must finish inside a serverless
   * function's limit. The previous 60s navigation × 3 attempts meant a single
   * unreachable site burned ~190s on its own — YouTube did exactly that on
   * Vercel and the whole run blew past the timeout.
   *
   * Worst case now is 25s × 2 attempts + 1.5s backoff ≈ 52s for a dead site,
   * and a site that bounces us to a login page fails in under a second because
   * that is detected and not retried.
   */
  timeouts: {
    navigation: 25000, // hard cap on page.goto()
    settle: 3500,      // grace period after load for client-side rendering
    selector: 8000,    // per-selector wait inside strategies
  },

  /** Retries after the first attempt. Blocks are never retried. */
  navigationRetries: 1,
};
