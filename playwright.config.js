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

  /** Timeouts, in milliseconds. */
  timeouts: {
    navigation: 60000, // hard cap on page.goto()
    settle: 6000,      // grace period after load for client-side rendering
    selector: 10000,   // per-selector wait inside strategies
  },

  /** How many times to retry a failed navigation before giving up. */
  navigationRetries: 2,
};
