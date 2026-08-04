'use strict';

/**
 * The unified record shape.
 *
 * Every platform returns exactly these keys in this order, so the dashboard,
 * the cache files and the API all speak one language. Fields a platform does
 * not have are null — never absent, never invented, never an empty string
 * standing in for "unknown".
 */

/** Canonical key order for every cache file and API response. */
const RECORD_FIELDS = [
  'platform',
  'status',
  'username',
  'displayName',
  'followers',
  'following',
  'posts',
  'subscribers',
  'videos',
  'likes',
  'profileImage',
  'bio',
  'profileUrl',
  'lastUpdated',
  'scrapeTime',
  'strategy',
];

/** Metric keys — the subset a platform can populate with numbers. */
const METRIC_FIELDS = ['followers', 'following', 'posts', 'subscribers', 'videos', 'likes'];

/**
 * Statuses a record can carry.
 *   success  every required field was extracted this run
 *   partial  some data present, but this run did not refresh it (kept previous)
 *   blocked  the platform served a login wall / challenge instead of the profile
 *   failed   the scrape errored outright
 */
const STATUS = { SUCCESS: 'success', PARTIAL: 'partial', BLOCKED: 'blocked', FAILED: 'failed' };

/**
 * Build a complete record, filling every unlisted key with null.
 *
 * @param {string} platform
 * @param {Object} values     scraped values (plain strings), any subset
 * @param {Object} meta       { status, profileUrl, lastUpdated, scrapeTime, strategy }
 * @returns {Object} a record with exactly RECORD_FIELDS, in order
 */
function toRecord(platform, values = {}, meta = {}) {
  const merged = {
    ...values,
    platform,
    status: meta.status || STATUS.SUCCESS,
    profileUrl: meta.profileUrl ?? values.profileUrl ?? null,
    lastUpdated: meta.lastUpdated ?? null,
    scrapeTime: meta.scrapeTime ?? null,
    strategy: meta.strategy ?? null,
  };

  const record = {};
  for (const key of RECORD_FIELDS) {
    const value = merged[key];
    // Empty string means "we looked and found nothing" — normalise to null so
    // the UI has exactly one way to test for missing data.
    record[key] = value === undefined || value === '' ? null : value;
  }
  return record;
}

module.exports = { RECORD_FIELDS, METRIC_FIELDS, STATUS, toRecord };
