'use strict';

/**
 * Platform registry — the single list of what the dashboard supports.
 *
 * Two kinds of provider sit side by side behind one interface:
 *
 *   kind: 'api'      queries an official API (no browser, exact numbers)
 *   kind: 'scraper'  drives Playwright through the strategy pipeline
 *
 * lib/runner.js dispatches on `kind`, so everything downstream — the unified
 * record, cache writing, logging, the API routes and the UI — is shared.
 *
 * Instagram and Facebook use the Meta Graph API. YouTube and LinkedIn have no
 * usable official API for this data and keep the scraper pipeline.
 */

const instagram = require('../meta/instagram');
const facebook = require('../meta/facebook');
const youtube = require('./youtube');
const linkedin = require('./linkedin');

const SPECS = { instagram, youtube, facebook, linkedin };

/** Every platform the codebase knows about, in dashboard order. */
const ALL_PLATFORMS = ['instagram', 'youtube', 'facebook', 'linkedin'];

/**
 * Temporarily disabled platforms.
 *
 * Their modules are left intact — this is the single switch that takes them out
 * of the dashboard, the refresh job, the API routes and the CLI. Removing a
 * name from this set brings the platform back with no other changes.
 *
 * YouTube and LinkedIn are disabled while the project runs API-only: they have
 * no official API for this data and would drag Playwright back in.
 */
const DISABLED = new Set(['youtube', 'linkedin']);

/** Active platforms, in display order. Everything downstream reads this. */
const ORDER = ALL_PLATFORMS.filter((name) => !DISABLED.has(name));

/** Human labels, taken from the specs so they cannot drift. */
const LABELS = Object.fromEntries(ORDER.map((name) => [name, SPECS[name].label]));

/**
 * @returns {boolean} whether this platform is active. Disabled platforms are
 * treated as unknown, so API routes 404 rather than quietly serving stale data.
 */
function isSupported(platform) {
  return Object.prototype.hasOwnProperty.call(SPECS, platform) && !DISABLED.has(platform);
}

/** @returns {boolean} whether the platform exists but is switched off. */
function isDisabled(platform) {
  return DISABLED.has(platform);
}

/** @returns {Object|null} */
function getSpec(platform) {
  return SPECS[platform] || null;
}

/** @returns {boolean} true when the platform needs a browser. */
function needsBrowser(platform) {
  const spec = SPECS[platform];
  return Boolean(spec) && spec.kind !== 'api';
}

module.exports = {
  SPECS,
  ORDER,
  ALL_PLATFORMS,
  DISABLED,
  LABELS,
  isSupported,
  isDisabled,
  getSpec,
  needsBrowser,
};
