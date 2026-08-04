'use strict';

/**
 * Strategy 5 — OCR of a rendered screenshot.
 *
 * The last resort, and deliberately so: it costs a screenshot, ~40 MB of WASM,
 * and several seconds, and it reads pixels rather than data, so it is the least
 * precise source we have.
 *
 * Know its one real limitation before relying on it: OCR reads whatever is on
 * screen. If the site served a login wall, the screenshot is of a login wall
 * and OCR returns "Log in", not a follower count. It rescues the case where the
 * profile *renders* but every machine-readable source has changed shape — not
 * the case where we were refused entry.
 */

const path = require('node:path');
const os = require('node:os');
const { field, parseCount, cleanText } = require('./extractor');
const { WRITE_CACHE_DIR } = require('./storage');

/** Reused across calls within a warm process — worker startup dominates cost. */
let workerPromise = null;

/**
 * Create (or reuse) a Tesseract worker.
 *
 * The language data is cached to a writable directory: the project folder is
 * read-only on serverless, and the default cache location would throw there.
 */
async function getWorker() {
  if (workerPromise) return workerPromise;

  workerPromise = (async () => {
    const { createWorker } = require('tesseract.js');
    const cachePath = path.join(os.tmpdir(), 'tesseract-cache');

    return createWorker('eng', 1, {
      cachePath,
      // Silence the progress chatter; failures still surface as exceptions.
      logger: () => {},
    });
  })();

  return workerPromise;
}

/**
 * Screenshot the page and OCR it.
 * @returns {Promise<string>} the recognised text
 */
async function readScreenText(page, platform) {
  const shotPath = path.join(WRITE_CACHE_DIR, `ocr-${platform}.png`);

  // Full page would be slower and mostly footer; the header carries the metrics.
  const buffer = await page.screenshot({ path: shotPath, fullPage: false });

  const worker = await getWorker();
  const { data } = await worker.recognize(buffer);

  console.log(`[ocr] ${platform} recognised ${data.text.length} chars from ${shotPath}`);
  return data.text || '';
}

/**
 * Pull metrics out of OCR text.
 *
 * OCR mangles thin glyphs, so the patterns stay loose and every value goes
 * through parseCount, which rejects anything that is not a plausible number.
 *
 * @param {string} text
 * @returns {Object} partial record in {v, approx} form
 */
function parseMetrics(text) {
  const flat = cleanText(text);

  const near = (label) => {
    // "38.0K followers" and "followers 38.0K" both occur depending on layout.
    const before = flat.match(new RegExp('([\\d.,]+\\s*[KMB]?)\\s*' + label, 'i'));
    if (before) return parseCount(before[1]);
    const after = flat.match(new RegExp(label + '\\s*([\\d.,]+\\s*[KMB]?)', 'i'));
    return after ? parseCount(after[1]) : null;
  };

  return {
    followers: near('followers?'),
    following: near('following'),
    posts: near('posts?'),
    subscribers: near('subscribers?'),
    videos: near('videos?'),
    likes: near('likes?'),
  };
}

/**
 * Build the OCR strategy for a platform.
 *
 * @param {string} platform
 * @param {(text: string) => Object} [identity] platform-specific extraction of
 *        username / displayName from the recognised text
 */
function createOcrStrategy(platform, identity = () => ({})) {
  return {
    name: 'ocr-screenshot',
    /** Needs a rendered page — there is nothing to photograph otherwise. */
    needsPage: true,
    async run(page) {
      const text = await readScreenText(page, platform);

      if (!text.trim()) throw new Error('OCR returned no text');

      return { ...parseMetrics(text), ...identity(text) };
    },
  };
}

/** Release the worker; called when a scrape run finishes. */
async function shutdownOcr() {
  if (!workerPromise) return;
  try {
    const worker = await workerPromise;
    await worker.terminate();
  } catch {
    /* already gone */
  } finally {
    workerPromise = null;
  }
}

module.exports = { createOcrStrategy, parseMetrics, readScreenText, shutdownOcr, field };
