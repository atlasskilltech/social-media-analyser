'use strict';

/**
 * Chromium resolution — the one place that knows where a browser comes from.
 *
 * Two very different environments:
 *
 *   local / VPS   `playwright` ships its own Chromium, downloaded by
 *                 `npx playwright install chromium`. Nothing special needed.
 *
 *   serverless    There is no browser on the machine and no way to install one:
 *                 the filesystem is read-only and nothing runs before the
 *                 function is invoked. @sparticuz/chromium solves this by
 *                 shipping a brotli-compressed Chromium inside the deployment
 *                 and decompressing it to /tmp on first launch.
 *
 * Everything above this layer — lib/browser.js, lib/runner.js, the scrapers —
 * is unchanged and unaware of the difference.
 */

const { isServerless } = require('./diagnostics');
const config = require('../playwright.config');

/**
 * Args stripped from @sparticuz/chromium's defaults before handing them to
 * Playwright. Verified present in the package's arg list (22 flags as of
 * v149) — this is not a precaution against a hypothetical.
 *
 * That package targets puppeteer, which tolerates --single-process. Playwright
 * does not: it drives the browser over CDP and needs separate browser and
 * renderer processes, so with a single process the connection never completes
 * and launch hangs until timeout. This is the usual cause of "works with
 * puppeteer, hangs with playwright" on Lambda.
 *
 * If a launch still hangs after this, `--no-zygote` is the next candidate to
 * remove; it is left in place for now because it is not known to break CDP.
 */
const INCOMPATIBLE_ARGS = new Set(['--single-process']);

/**
 * Pick the right Chromium and launch options for this environment.
 *
 * @returns {Promise<{browserType: object, launchOptions: object, source: string}>}
 */
async function resolveChromium() {
  if (!isServerless()) {
    // Full playwright package, with the browser it downloaded at install time.
    const { chromium } = require('playwright');
    return { browserType: chromium, launchOptions: config.launch, source: 'playwright (local browser)' };
  }

  // ---------------------------------------------------------- serverless path
  /*
   * Loaded with dynamic import(), not require().
   *
   * @sparticuz/chromium is `"type": "module"`. require()-ing an ES module only
   * works on Node >= 20.19 / >= 22.12; on anything older it throws
   * ERR_REQUIRE_ESM. Since the deployed Node version is the platform's choice,
   * not ours, import() is the only safe way to load it — and Next's build
   * warns about the require() form for exactly this reason.
   */
  const sparticuz = await import('@sparticuz/chromium');
  const chromiumPack = sparticuz.default || sparticuz;

  // playwright-core has no bundled browser — exactly what we want here, since
  // the binary comes from @sparticuz/chromium instead.
  const { chromium } = require('playwright-core');

  /*
   * Skip the swiftshader/WebGL payload. We only read DOM and meta tags, so
   * software rendering is dead weight: it costs decompression time on every
   * cold start and a meaningful chunk of the memory limit.
   */
  chromiumPack.setGraphicsMode = false;

  // Decompresses the bundled brotli archive into /tmp on first call, then
  // returns the path. Subsequent calls on a warm instance are cheap.
  const executablePath = await chromiumPack.executablePath();

  const args = chromiumPack.args.filter((arg) => !INCOMPATIBLE_ARGS.has(arg));

  return {
    browserType: chromium,
    launchOptions: {
      args,
      executablePath,
      headless: true,
    },
    source: '@sparticuz/chromium + playwright-core',
  };
}

module.exports = { resolveChromium, INCOMPATIBLE_ARGS };
