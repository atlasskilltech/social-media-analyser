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

  // Can the package even be resolved, and is a browser binary actually present?
  // These are two separate failures and get reported separately.
  try {
    const playwright = require('playwright');
    report.playwright = { resolved: true };

    try {
      report.playwright.version = require('playwright/package.json').version;
    } catch {
      /* version is a nice-to-have */
    }

    try {
      const exe = playwright.chromium.executablePath();
      report.playwright.executablePath = exe;
      report.playwright.executableExists = fsSync.existsSync(exe);
    } catch (err) {
      report.playwright.executablePathError = err.message;
    }
  } catch (err) {
    report.playwright = { resolved: false, error: err.message, code: err.code };
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
