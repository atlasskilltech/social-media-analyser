'use strict';

/**
 * Platform registry — the single list of what the dashboard supports.
 *
 * Adding a platform means writing its module and adding one line here.
 * Nothing else in the codebase enumerates platforms.
 */

const instagram = require('./instagram');
const youtube = require('./youtube');
const facebook = require('./facebook');
const linkedin = require('./linkedin');

/** Display order on the dashboard. */
const SPECS = { instagram, youtube, facebook, linkedin };

const ORDER = ['instagram', 'youtube', 'facebook', 'linkedin'];

/** Human labels, taken from the specs so they cannot drift. */
const LABELS = Object.fromEntries(ORDER.map((name) => [name, SPECS[name].label]));

/** @returns {boolean} whether a scraper exists for this platform. */
function isSupported(platform) {
  return Object.prototype.hasOwnProperty.call(SPECS, platform);
}

/** @returns {import('../runner').ScraperSpec|null} */
function getSpec(platform) {
  return SPECS[platform] || null;
}

module.exports = { SPECS, ORDER, LABELS, isSupported, getSpec };
