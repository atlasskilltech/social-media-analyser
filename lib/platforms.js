'use strict';

/**
 * The platform registry.
 *
 * Every platform the dashboard knows about is listed in ORDER; the ones with a
 * working scraper are in SPECS. The API reports the difference, so the UI can
 * render a "not built yet" placeholder without any hardcoded knowledge of
 * which scrapers exist.
 *
 * Adding YouTube is a one-line change here plus the scraper file itself.
 */

/** Display order on the dashboard. */
const ORDER = ['instagram', 'youtube', 'facebook', 'linkedin'];

/** Human labels, used by the UI. */
const LABELS = {
  instagram: 'Instagram',
  youtube: 'YouTube',
  facebook: 'Facebook',
  linkedin: 'LinkedIn',
};

/**
 * Scraper specs, keyed by platform. Only implemented platforms appear.
 * @type {Record<string, import('./runner').ScraperSpec>}
 */
const SPECS = {
  instagram: require('../instagram'),
  // youtube:  require('../youtube'),   <- next step
  // facebook: require('../facebook'),
  // linkedin: require('../linkedin'),
};

/** @returns {boolean} whether a working scraper exists for this platform. */
function isImplemented(platform) {
  return Object.prototype.hasOwnProperty.call(SPECS, platform);
}

module.exports = { ORDER, LABELS, SPECS, isImplemented };
