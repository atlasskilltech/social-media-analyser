'use strict';

/**
 * Page forensics — what did the site actually serve us?
 *
 * When extraction returns nothing there are two very different causes, and
 * they need opposite responses:
 *
 *   1. the profile rendered but our selectors are stale  -> fix the scraper
 *   2. the site served a login wall / challenge instead   -> no selector helps
 *
 * Guessing between them wastes time, so this module captures the evidence:
 * the raw HTML, a screenshot, and a classification of the page.
 */

const fs = require('fs/promises');
const path = require('path');

/**
 * Page classifications, checked in order — the first match wins, so the more
 * specific patterns are listed before the general ones.
 */
const PAGE_SIGNATURES = [
  {
    type: 'checkpoint',
    test: ({ url, text }) =>
      /\/challenge|\/checkpoint/i.test(url) || /suspicious login attempt|confirm it'?s you/i.test(text),
  },
  {
    type: 'rate-limited',
    test: ({ text }) =>
      /please wait a few minutes before you try again|try again later|too many requests/i.test(text),
  },
  {
    type: 'captcha',
    test: ({ text }) => /confirm you'?re not a robot|solve this puzzle|captcha/i.test(text),
  },
  {
    type: 'login-wall',
    test: ({ url, text, hasProfileData }) =>
      !hasProfileData && (/\/accounts\/login/i.test(url) || /log in to instagram|phone number, username, or email/i.test(text)),
  },
  {
    type: 'consent',
    test: ({ text }) =>
      /allow the use of cookies|we use cookies|accept all|manage your preferences/i.test(text),
  },
  {
    type: 'please-wait',
    test: ({ text, htmlLength }) => htmlLength > 0 && /please wait|loading\.\.\./i.test(text) && text.length < 400,
  },
  { type: 'empty', test: ({ htmlLength, text }) => htmlLength < 2000 || text.trim().length === 0 },
  { type: 'profile', test: ({ hasProfileData }) => hasProfileData },
];

/**
 * Classify a page from cheap signals.
 * @returns {string} one of the PAGE_SIGNATURES types, or 'unknown'
 */
function detectPageType(signals) {
  for (const { type, test } of PAGE_SIGNATURES) {
    try {
      if (test(signals)) return type;
    } catch {
      // A broken matcher must never mask the others.
    }
  }
  return 'unknown';
}

/**
 * Capture everything about the current page, and write the artifacts to disk.
 *
 * Never throws: forensics failing must not replace the original error with a
 * different one.
 *
 * @param {import('playwright-core').Page} page
 * @param {string} platform
 * @param {string} outDir  writable directory (on serverless this is under /tmp)
 */
async function captureForensics(page, platform, outDir) {
  const artifact = {
    url: null,
    title: null,
    htmlLength: 0,
    pageType: 'unknown',
    htmlPath: null,
    screenshotPath: null,
    htmlPreview: null,
    errors: [],
  };

  let html = '';
  let text = '';

  try {
    artifact.url = page.url();
  } catch (err) {
    artifact.errors.push(`url: ${err.message}`);
  }

  try {
    artifact.title = await page.title();
  } catch (err) {
    artifact.errors.push(`title: ${err.message}`);
  }

  try {
    html = await page.content();
    artifact.htmlLength = html.length;
    // First 2000 chars travel in the API response so the shape of the page is
    // visible without needing filesystem access to the function instance.
    artifact.htmlPreview = html.slice(0, 2000);
  } catch (err) {
    artifact.errors.push(`content: ${err.message}`);
  }

  try {
    text = await page.evaluate(() => (document.body ? document.body.innerText : ''));
  } catch (err) {
    artifact.errors.push(`innerText: ${err.message}`);
  }

  // Does the markup carry profile data at all? Distinguishes "wrong selectors"
  // from "wrong page" — the single most useful bit in this whole report.
  const hasProfileData =
    /og:description/i.test(html) && /(followers|seguidores)/i.test(html + text);

  artifact.pageType = detectPageType({
    url: artifact.url || '',
    text,
    html,
    htmlLength: artifact.htmlLength,
    hasProfileData,
  });
  artifact.hasProfileData = hasProfileData;

  // ------------------------------------------------------------- artifacts
  try {
    await fs.mkdir(outDir, { recursive: true });

    const htmlPath = path.join(outDir, `debug-${platform}.html`);
    await fs.writeFile(htmlPath, html, 'utf8');
    artifact.htmlPath = htmlPath;
  } catch (err) {
    artifact.errors.push(`write html: ${err.message}`);
  }

  try {
    const shotPath = path.join(outDir, `debug-${platform}.png`);
    await page.screenshot({ path: shotPath, fullPage: false });
    artifact.screenshotPath = shotPath;
  } catch (err) {
    artifact.errors.push(`screenshot: ${err.message}`);
  }

  console.log(
    `[forensics] ${platform} url=${artifact.url} title="${artifact.title}" ` +
      `htmlLength=${artifact.htmlLength} pageType=${artifact.pageType} ` +
      `hasProfileData=${hasProfileData} html=${artifact.htmlPath} shot=${artifact.screenshotPath}`
  );

  return artifact;
}

module.exports = { captureForensics, detectPageType, PAGE_SIGNATURES };
