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

/** Display order on the dashboard. */
const ORDER = ['instagram', 'youtube', 'facebook', 'linkedin'];

/** Human labels, taken from the specs so they cannot drift. */
const LABELS = Object.fromEntries(ORDER.map((name) => [name, SPECS[name].label]));

/** @returns {boolean} whether a provider exists for this platform. */
function isSupported(platform) {
  return Object.prototype.hasOwnProperty.call(SPECS, platform);
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

module.exports = { SPECS, ORDER, LABELS, isSupported, getSpec, needsBrowser };
