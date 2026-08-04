'use strict';

/**
 * Instagram provider — Meta Graph API only.
 *
 * No Playwright, no Chromium, no scraping, no OCR. The Instagram Business
 * account is queried directly, which returns exact counts rather than the
 * rounded figures the public page exposes, and works from any IP.
 *
 * Requires: instagram_basic, pages_show_list  (verified against the token).
 */

const URLS = require('../../config');
const { graphGet, asString } = require('./common');

/** Exactly the fields the dashboard needs — nothing speculative. */
const FIELDS = [
  'username',
  'name',
  'biography',
  'followers_count',
  'follows_count',
  'media_count',
  'profile_picture_url',
];

module.exports = {
  platform: 'instagram',
  label: 'Instagram',
  /** Tells the runner to call fetch() instead of driving a browser. */
  kind: 'api',
  url: URLS.instagram,

  fields: ['username', 'displayName', 'followers', 'following', 'posts', 'bio', 'profileImage'],
  requiredKeys: ['username', 'followers'],

  /** Named in the record so the UI can show where the data came from. */
  source: 'meta-graph-api',

  /**
   * Fetch the profile and map it onto the unified record shape.
   * @returns {Promise<Object>} values keyed by the unified field names
   */
  async fetch() {
    const node = await graphGet(process.env.META_INSTAGRAM_BUSINESS_ID, FIELDS, {
      required: ['META_INSTAGRAM_BUSINESS_ID'],
    });

    return {
      username: asString(node.username),
      displayName: asString(node.name),
      followers: asString(node.followers_count),
      following: asString(node.follows_count),
      posts: asString(node.media_count),
      bio: asString(node.biography),
      profileImage: asString(node.profile_picture_url),
    };
  },
};
