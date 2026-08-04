'use strict';

/**
 * Refresh coordinator.
 *
 * Runs every platform concurrently and tracks each one's state and duration, so
 * the UI can show live per-platform progress, a real elapsed timer and an ETA
 * that learns from previous runs.
 *
 * Two guarantees the progress UI depends on:
 *   1. every platform reaches a terminal state — success, failed, blocked or
 *      timeout — so nothing can sit on "Running…" forever
 *   2. one platform failing never affects the others
 */

const { launchBrowser } = require('./browser');
const { scrapeAndSave } = require('./runner');
const { SPECS, ORDER, needsBrowser } = require('./platforms');
const { logEvent } = require('./storage');
const { shutdownOcr } = require('./ocr');

/** Terminal states a platform can end in. Nothing else is allowed to persist. */
const OUTCOME = {
  PENDING: 'pending',
  RUNNING: 'running',
  SUCCESS: 'success',
  FAILED: 'failed',
  BLOCKED: 'blocked',
  TIMEOUT: 'timeout',
};

/**
 * Hard per-platform ceiling.
 *
 * Navigation alone can take 25s × 2 attempts, so this sits above that but well
 * inside a serverless function limit. Exceeding it yields `timeout` rather than
 * a hung promise.
 */
const PLATFORM_TIMEOUT_MS = 60000;

/** Starting ETA before any run has been observed. */
const DEFAULT_ESTIMATE_MS = 15000;

const state = {
  running: false,
  startedAt: null,
  finishedAt: null,
  totalMs: null,
  /** @type {Record<string, {state, ms, error, status}>} */
  platforms: {},
  error: null,
  /** Learned from the last completed run — drives the ETA. */
  estimatedTotalMs: DEFAULT_ESTIMATE_MS,
};

/** Reset progress to "everything waiting" for the platforms about to run. */
function initProgress(names) {
  state.platforms = {};
  for (const name of names) {
    state.platforms[name] = { state: OUTCOME.PENDING, ms: null, error: null, status: null };
  }
}

/** A snapshot of refresh state, safe to serialise. */
function getState() {
  return {
    running: state.running,
    startedAt: state.startedAt,
    finishedAt: state.finishedAt,
    totalMs: state.totalMs,
    platforms: state.platforms,
    error: state.error,
    estimatedTotalMs: state.estimatedTotalMs,
  };
}

/**
 * Race a promise against a timeout.
 * @returns {Promise<{timedOut: boolean, value?: any}>}
 */
function withTimeout(promise, ms) {
  let timer;
  const timeout = new Promise((resolve) => {
    timer = setTimeout(() => resolve({ timedOut: true }), ms);
  });

  return Promise.race([promise.then((value) => ({ timedOut: false, value })), timeout]).finally(() =>
    clearTimeout(timer)
  );
}

/**
 * Map a scrape result onto one of the four terminal outcomes.
 */
function classify(result) {
  if (result.ok) return OUTCOME.SUCCESS;
  if (result.record?.status === 'blocked') return OUTCOME.BLOCKED;
  return OUTCOME.FAILED;
}

/**
 * Scrape one platform, recording its state transitions and duration.
 * Never rejects — the outcome is always written to state.
 */
async function refreshOne(name, browser) {
  const startedAt = Date.now();
  state.platforms[name].state = OUTCOME.RUNNING;

  try {
    const outcome = await withTimeout(scrapeAndSave(SPECS[name], browser), PLATFORM_TIMEOUT_MS);
    const ms = Date.now() - startedAt;

    if (outcome.timedOut) {
      state.platforms[name] = {
        state: OUTCOME.TIMEOUT,
        ms,
        error: `exceeded ${PLATFORM_TIMEOUT_MS / 1000}s`,
        status: 'failed',
      };
      await logEvent(name, 'FAILURE', `timed out after ${ms}ms`);
      return;
    }

    const result = outcome.value;
    state.platforms[name] = {
      state: classify(result),
      ms,
      error: result.error || null,
      status: result.record?.status ?? null,
    };
  } catch (err) {
    // scrapeAndSave is supposed to contain its own errors; this is a backstop
    // so a platform can never be left stuck on "running".
    state.platforms[name] = {
      state: OUTCOME.FAILED,
      ms: Date.now() - startedAt,
      error: err.message,
      status: 'failed',
    };
  }
}

/**
 * Refresh every platform concurrently.
 *
 * Promise.allSettled is what makes "one failure must not stop the others"
 * structural rather than a convention — a rejection cannot escape and cancel
 * its siblings.
 *
 * @param {string[]} [only] restrict to these platforms
 */
async function runRefresh(only = null) {
  const names = ORDER.filter((name) => SPECS[name] && (!only || only.includes(name)));
  const startedAt = Date.now();

  state.running = true;
  state.startedAt = new Date().toISOString();
  state.finishedAt = null;
  state.totalMs = null;
  state.error = null;
  initProgress(names);

  /*
   * No cooldown.
   *
   * The artificial rate limit existed to stop repeated clicks firing Chromium
   * at Instagram. With the Graph API there is no browser and no scraping, so
   * every click can fetch fresh data. The only limit that applies now is Meta's
   * own, which arrives as a rate-limit error and is surfaced to the user.
   */

  let browser = null;
  try {
    /*
     * Launch Chromium only if something actually needs it.
     *
     * Instagram and Facebook go through the Meta Graph API now, so a refresh
     * limited to those two starts no browser at all — which is what makes them
     * work on Vercel and finish in milliseconds.
     */
    if (names.some((name) => needsBrowser(name))) {
      browser = await launchBrowser();
    }

    // Each scraper platform gets its own browser context inside scrapeAndSave,
    // so they are isolated from one another's cookies and navigation.
    await Promise.allSettled(names.map((name) => refreshOne(name, browser)));
  } catch (err) {
    // Only a browser-level failure reaches here (launch failed, OOM).
    state.error = err.message;
    await logEvent('system', 'FAILURE', `refresh job failed: ${err.message}`);
    for (const name of names) {
      if (state.platforms[name].state === OUTCOME.PENDING || state.platforms[name].state === OUTCOME.RUNNING) {
        state.platforms[name] = { state: OUTCOME.FAILED, ms: null, error: err.message, status: 'failed' };
      }
    }
  } finally {
    if (browser) await browser.close().catch(() => {});
    // The OCR worker holds a WASM runtime and would keep the process alive.
    await shutdownOcr();

    state.totalMs = Date.now() - startedAt;
    // Learn for the next run's ETA, smoothed so one slow run does not dominate.
    state.estimatedTotalMs = Math.round(state.estimatedTotalMs * 0.4 + state.totalMs * 0.6);

    state.running = false;
    state.finishedAt = new Date().toISOString();
  }

  return state.platforms;
}

/**
 * Start a refresh without waiting for it.
 * @returns {{started: boolean, reason?: string}}
 */
function startRefresh(only = null) {
  // One job at a time is still enforced — that is concurrency control, not a
  // cooldown; a second click while a fetch is in flight joins the running job.
  if (state.running) return { started: false, reason: 'already-running' };

  // Deliberately not awaited: the HTTP handler returns while this continues.
  runRefresh(only).catch((err) => {
    state.error = err.message;
    state.running = false;
  });

  return { started: true };
}

module.exports = { getState, startRefresh, runRefresh, OUTCOME, PLATFORM_TIMEOUT_MS };
