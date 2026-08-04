'use strict';

/**
 * The strategy pipeline.
 *
 * Strategies run in a fixed order and the pipeline stops at the first one that
 * satisfies every required field — later strategies are never reached. Each
 * failure records why, so a run that falls all the way through explains itself.
 *
 * Ordering is defined per platform; the canonical sequence is:
 *   1. DOM extraction
 *   2. JSON-LD extraction
 *   3. Meta tags extraction
 *   4. Embedded JSON extraction
 *   5. Raw HTML fetch      (no JavaScript — survives a blocked page)
 *   6. OCR screenshot      (last resort)
 */

const { finalize, mergePartials } = require('./utils');

/**
 * Why did a strategy not satisfy the requirements?
 * Turns an empty result into a sentence someone can act on.
 */
function describeFailure(strategyName, partial, missing) {
  const found = Object.entries(partial || {})
    .filter(([, v]) => v && v.v)
    .map(([k]) => k);

  if (!found.length) {
    const reasons = {
      'dom-selectors': 'DOM selectors not found',
      'json-ld': 'JSON-LD missing',
      'meta-tags': 'meta tags missing',
      'embedded-json': 'embedded JSON unavailable',
      'raw-html-fetch': 'raw HTML contained no profile data',
      'ocr-screenshot': 'OCR produced no usable values',
      'shared-data': 'window._sharedData not present',
      'additional-data-loaded': 'window.__additionalDataLoaded not present',
      'yt-initial-data': 'ytInitialData not present',
    };
    return reasons[strategyName] || 'no fields extracted';
  }

  return `partial only — found ${found.join(', ')}; still missing ${missing.join(', ')}`;
}

/**
 * Run strategies in order, stopping at the first complete success.
 *
 * @param {import('playwright-core').Page} page
 * @param {Array<{name, run, needsPage}>} strategies  already filtered for reachability
 * @param {string[]} fields        the platform's output keys
 * @param {string[]} requiredKeys  all must be present to count as success
 * @returns {Promise<{values, report, succeededVia, exhausted}>}
 */
async function runPipeline(page, strategies, fields, requiredKeys) {
  const report = [];

  for (const strategy of strategies) {
    const startedAt = Date.now();

    try {
      const partial = await strategy.run(page);

      /*
       * Each strategy is judged on its own output, not on an accumulation.
       * That is what "return immediately on success" means: the strategy that
       * succeeds is the one whose data is returned.
       */
      const acc = {};
      mergePartials(acc, partial, strategy.name);
      const values = finalize(acc, fields);
      const missing = requiredKeys.filter((key) => !values[key]);

      if (missing.length === 0) {
        report.push({
          name: strategy.name,
          status: 'ok',
          detail: `satisfied ${requiredKeys.join(', ')}`,
          ms: Date.now() - startedAt,
        });
        console.log(`[pipeline] ✅ ${strategy.name} — success`);

        return { values, report, succeededVia: strategy.name, exhausted: false };
      }

      const reason = describeFailure(strategy.name, partial, missing);
      report.push({ name: strategy.name, status: 'empty', detail: reason, ms: Date.now() - startedAt });
      console.log(`[pipeline] ❌ ${strategy.name} — ${reason}`);
    } catch (err) {
      const reason = err.message.split('\n')[0];
      report.push({ name: strategy.name, status: 'error', detail: reason, ms: Date.now() - startedAt });
      console.log(`[pipeline] ❌ ${strategy.name} — ${reason}`);
      // Never stop on an error; the next strategy still gets its turn.
    }
  }

  // Every strategy ran and none satisfied the requirements.
  return { values: finalize({}, fields), report, succeededVia: null, exhausted: true };
}

module.exports = { runPipeline, describeFailure };
