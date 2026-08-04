'use strict';

/**
 * Refresh coordinator.
 *
 * Owns the single in-flight refresh job and its per-platform progress, so the
 * dashboard can show which platform is being scraped right now and which have
 * finished. Four platforms take roughly a minute in total — far too long to
 * hold an HTTP request open — so the API starts a job here and the client
 * polls for progress.
 */

const { launchBrowser } = require('./browser');
const { scrapeAndSave } = require('./runner');
const { SPECS, ORDER } = require('./platforms');
const cooldown = require('./cooldown');
const { logEvent } = require('./storage');
const { shutdownOcr } = require('./ocr');

/** Per-platform progress states. */
const PROGRESS = { PENDING: 'pending', RUNNING: 'running', DONE: 'done', FAILED: 'failed' };

const state = {
  running: false,
  startedAt: null,
  finishedAt: null,
  /** @type {Record<string, {state, status, error, scrapeTime}>} */
  platforms: {},
  error: null,
};

/** Reset progress to "everything pending" for the platforms about to run. */
function initProgress(names) {
  state.platforms = {};
  for (const name of names) {
    state.platforms[name] = { state: PROGRESS.PENDING, status: null, error: null, scrapeTime: null };
  }
}

/** A snapshot of refresh state, safe to serialise. */
function getState() {
  return {
    running: state.running,
    startedAt: state.startedAt,
    finishedAt: state.finishedAt,
    platforms: state.platforms,
    error: state.error,
    cooldownRemaining: cooldown.secondsRemaining(),
    cooldownSeconds: cooldown.COOLDOWN_SECONDS,
  };
}

/**
 * Scrape platforms one after another, sharing a single Chromium instance.
 *
 * Platforms are fully independent: scrapeAndSave never throws, so one failing
 * cannot stop the rest. The browser is closed in a finally block.
 *
 * @param {string[]} [only] restrict to these platforms
 */
async function runRefresh(only = null) {
  const names = ORDER.filter((name) => SPECS[name] && (!only || only.includes(name)));

  state.running = true;
  state.startedAt = new Date().toISOString();
  state.finishedAt = null;
  state.error = null;
  initProgress(names);

  // Claim the cooldown slot up front — a second request arriving mid-run must
  // not see an expired cooldown and start again.
  cooldown.markRun();

  let browser = null;
  try {
    browser = await launchBrowser();

    for (const name of names) {
      state.platforms[name].state = PROGRESS.RUNNING;

      const result = await scrapeAndSave(SPECS[name], browser);

      state.platforms[name] = {
        state: result.ok ? PROGRESS.DONE : PROGRESS.FAILED,
        status: result.record?.status ?? null,
        error: result.error || null,
        scrapeTime: result.record?.scrapeTime ?? null,
      };
    }
  } catch (err) {
    // Only a browser-level failure reaches here (launch failed, OOM).
    state.error = err.message;
    await logEvent('system', 'FAILURE', `refresh job failed: ${err.message}`);
    for (const name of names) {
      if (state.platforms[name].state === PROGRESS.PENDING) {
        state.platforms[name] = { state: PROGRESS.FAILED, status: 'failed', error: err.message, scrapeTime: null };
      }
    }
  } finally {
    if (browser) await browser.close().catch(() => {});
    // The OCR worker holds a WASM runtime and would keep the process alive.
    await shutdownOcr();
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
  if (state.running) return { started: false, reason: 'already-running' };
  if (cooldown.isActive()) return { started: false, reason: 'cooldown' };

  // Deliberately not awaited: the HTTP handler returns while this continues.
  runRefresh(only).catch((err) => {
    state.error = err.message;
    state.running = false;
  });

  return { started: true };
}

module.exports = { getState, startRefresh, runRefresh, PROGRESS };
