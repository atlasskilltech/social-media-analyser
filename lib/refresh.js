'use strict';

/**
 * Scrape-run coordinator.
 *
 * Owns the single in-flight refresh job and its state. A scrape of all four
 * platforms takes roughly a minute, which is far too long to hold an HTTP
 * request open, so the API starts a job here and returns immediately; the
 * client polls for progress.
 */

const { launchBrowser } = require('./browser');
const { scrapeAndSave } = require('./runner');
const { SPECS } = require('./platforms');
const cooldown = require('./cooldown');
const { logEvent } = require('./storage');

/**
 * State of the current or most recent refresh.
 * Exactly one refresh may run at a time, process-wide.
 */
const state = {
  running: false,
  startedAt: null,
  finishedAt: null,
  /** @type {Array<{platform: string, ok: boolean, error?: string}>} */
  results: [],
  /** @type {string|null} set only when the job itself blew up */
  error: null,
};

/** A snapshot of refresh state, safe to serialise to JSON. */
function getState() {
  return {
    running: state.running,
    startedAt: state.startedAt,
    finishedAt: state.finishedAt,
    results: state.results,
    error: state.error,
    cooldownRemaining: cooldown.secondsRemaining(),
    cooldownSeconds: cooldown.COOLDOWN_SECONDS,
  };
}

/**
 * Scrape every implemented platform, sharing one Chromium instance.
 *
 * Platforms run sequentially and independently: scrapeAndSave never throws, so
 * one platform failing cannot stop the rest. The browser is closed in a
 * finally block so a crash cannot orphan it.
 *
 * @param {string[]} [only] restrict to these platforms
 * @returns {Promise<Array>} per-platform results
 */
async function runRefresh(only = null) {
  const names = Object.keys(SPECS).filter((n) => !only || only.includes(n));

  state.running = true;
  state.startedAt = new Date().toISOString();
  state.finishedAt = null;
  state.results = [];
  state.error = null;

  // Claim the cooldown slot up front, not on completion — otherwise a second
  // request arriving mid-scrape would see an expired cooldown and start again.
  cooldown.markRun();

  let browser = null;
  try {
    browser = await launchBrowser();

    for (const name of names) {
      const result = await scrapeAndSave(SPECS[name], browser);
      state.results.push({
        platform: name,
        ok: result.ok,
        error: result.error || null,
      });
    }
  } catch (err) {
    // Only a browser-level failure lands here (launch failed, OOM, etc.).
    state.error = err.message;
    await logEvent('system', 'FAILURE', `refresh job failed: ${err.message}`);
  } finally {
    if (browser) await browser.close().catch(() => {});
    state.running = false;
    state.finishedAt = new Date().toISOString();
  }

  return state.results;
}

/**
 * Start a refresh without waiting for it.
 * @returns {{started: boolean, reason?: string}}
 */
function startRefresh(only = null) {
  if (state.running) return { started: false, reason: 'already-running' };
  if (cooldown.isActive()) return { started: false, reason: 'cooldown' };

  // Deliberately not awaited: the HTTP handler returns while this continues.
  runRefresh(only).catch((err) => {
    state.error = err.message;
    state.running = false;
  });

  return { started: true };
}

module.exports = { getState, startRefresh, runRefresh };
