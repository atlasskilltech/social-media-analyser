'use strict';

/**
 * Runtime environment probe.
 *
 * Exists because a serverless failure is otherwise invisible: the platform
 * returns a bare 500 and the real exception never reaches the client. Every
 * value here is something that differs between a laptop and a Vercel function
 * and can independently break the scraper.
 */

const os = require('node:os');
const fsSync = require('node:fs');
const path = require('node:path');

/** True when running on a serverless platform with a read-only project dir. */
function isServerless() {
  return Boolean(process.env.VERCEL || process.env.AWS_LAMBDA_FUNCTION_NAME);
}

/** 'vercel' | 'aws-lambda' | 'local' */
function platformName() {
  if (process.env.VERCEL) return 'vercel';
  if (process.env.AWS_LAMBDA_FUNCTION_NAME) return 'aws-lambda';
  return 'local';
}

/** Actually attempt a write — never infer writability from the platform name. */
function canWrite(dir) {
  const probe = path.join(dir, `.probe-${process.pid}-${Date.now()}`);
  try {
    fsSync.writeFileSync(probe, 'x');
    fsSync.unlinkSync(probe);
    return true;
  } catch (err) {
    return `${err.code || 'ERROR'}: ${err.message}`;
  }
}

/**
 * Full environment report. Safe to call anywhere — every probe is guarded, so
 * this never throws even when Playwright is entirely absent.
 */
function probeEnvironment() {
  const report = {
    platform: platformName(),
    serverless: isServerless(),
    node: process.version,
    os: process.platform,
    arch: process.arch,
    cwd: process.cwd(),
    tmpdir: os.tmpdir(),
    totalMemoryMB: Math.round(os.totalmem() / 1048576),
    freeMemoryMB: Math.round(os.freemem() / 1048576),
    writable: {
      cwd: canWrite(process.cwd()),
      tmpdir: canWrite(os.tmpdir()),
    },
  };

  /*
   * Can the driver be resolved, and is a browser binary actually reachable?
   * Two independent failures, reported separately.
   *
   * playwright-core is tried first deliberately. It is the package the
   * serverless path uses, and requiring the full `playwright` package is what
   * pulls in browsers.json — the very file whose absence we are diagnosing.
   * Probing with the heavier package made this endpoint crash for the same
   * reason as the endpoint it was meant to diagnose.
   */
  report.playwright = { resolved: false };

  try {
    require('playwright-core');
    report.playwright = { resolved: true, package: 'playwright-core' };
    try {
      report.playwright.version = require('playwright-core/package.json').version;
    } catch {
      /* version is a nice-to-have */
    }
  } catch (err) {
    report.playwright = { resolved: false, package: 'playwright-core', error: err.message, code: err.code };
  }

  /*
   * Did the runtime data files actually ship?
   *
   * Checked as plain paths under the deployment root rather than with
   * require.resolve, for two reasons: @sparticuz/chromium's "exports" map
   * rejects subpath resolution (ERR_PACKAGE_PATH_NOT_EXPORTED), and calling
   * require.resolve on an ESM package inside the bundle both warns at build
   * time and fails at runtime.
   *
   * These two booleans are the direct test of whether outputFileTracingIncludes
   * worked. browsers.json is the file whose absence produced
   * "Cannot find module /var/task/node_modules/playwright-core/browsers.json".
   */
  const modulesRoot = path.join(process.cwd(), 'node_modules');
  const browsersJson = path.join(modulesRoot, 'playwright-core', 'browsers.json');
  const chromiumPayload = path.join(modulesRoot, '@sparticuz', 'chromium', 'bin', 'chromium.br');

  report.bundledFiles = {
    browsersJson,
    browsersJsonExists: fsSync.existsSync(browsersJson),
    chromiumPayload,
    chromiumPayloadExists: fsSync.existsSync(chromiumPayload),
  };

  if (isServerless()) {
    // The binary comes from @sparticuz/chromium. Deliberately not calling
    // executablePath() here — that inflates ~250 MB into /tmp on every probe.
    report.chromium = {
      source: '@sparticuz/chromium',
      payloadShipped: report.bundledFiles.chromiumPayloadExists,
    };
  } else {
    try {
      const { chromium } = require('playwright');
      const exe = chromium.executablePath();
      report.chromium = { source: 'playwright', executablePath: exe, executableExists: fsSync.existsSync(exe) };
    } catch (err) {
      report.chromium = { source: 'playwright', error: err.message, code: err.code };
    }
  }

  return report;
}

/**
 * Build the structured error payload returned by every failing route.
 *
 * @param {string} stage   where it broke: 'import' | 'launch-browser' | 'scrape' | 'cache-write'
 * @param {Error|string} error
 * @param {Object} [extra]
 */
function failure(stage, error, extra = {}) {
  const err = typeof error === 'string' ? new Error(error) : error;
  return {
    success: false,
    ok: false,
    stage,
    error: err?.message || String(error),
    code: err?.code,
    // Trimmed: enough to locate the throw without dumping the whole bundle.
    stack: err?.stack ? err.stack.split('\n').slice(0, 12).join('\n') : null,
    platform: platformName(),
    environment: probeEnvironment(),
    ...extra,
  };
}

module.exports = { isServerless, platformName, canWrite, probeEnvironment, failure };
