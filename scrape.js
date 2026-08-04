'use strict';

/**
 * Command-line scraper — one entry point for every platform.
 *
 *   node scrape.js                 scrape all platforms
 *   node scrape.js instagram       scrape one
 *   node scrape.js youtube facebook
 *
 * The platform list comes from the registry, so this never needs editing when
 * a platform is added.
 */

const { ORDER, SPECS, isSupported } = require('./lib/platforms');
const { scrapeAndSave, printResult } = require('./lib/runner');
const { launchBrowser } = require('./lib/browser');
const { shutdownOcr } = require('./lib/ocr');

async function main() {
  const requested = process.argv.slice(2).map((a) => a.toLowerCase());

  const unknown = requested.filter((name) => !isSupported(name));
  if (unknown.length) {
    console.error(`Unknown platform(s): ${unknown.join(', ')}`);
    console.error(`Available: ${ORDER.join(', ')}`);
    process.exitCode = 1;
    return;
  }

  const targets = requested.length ? requested : ORDER;

  // One browser for the whole run; each platform still gets its own context.
  const browser = await launchBrowser();
  const results = [];

  try {
    for (const name of targets) {
      const result = await scrapeAndSave(SPECS[name], browser);
      printResult(result);
      results.push(result);
    }
  } finally {
    await browser.close().catch(() => {});
    // The OCR worker holds a WASM runtime and would keep the process alive.
    await shutdownOcr();
  }

  console.log(`\n${'='.repeat(52)}\nSUMMARY`);
  for (const r of results) {
    const mark = r.ok ? 'OK  ' : 'FAIL';
    const via = r.ok ? `${r.record.status} via ${r.record.strategy}` : r.error;
    console.log(`  ${mark} ${r.platform.padEnd(12)} ${via}`);
  }

  if (results.some((r) => !r.ok)) process.exitCode = 1;
}

main().catch((err) => {
  console.error('Unexpected failure:', err);
  process.exitCode = 1;
});
