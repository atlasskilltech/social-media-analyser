'use strict';

/**
 * Facebook provider — Meta Graph API only.
 *
 * No Playwright, no Chromium, no scraping, no OCR. The Page node returns the
 * exact follower and fan counts; the public page only ever showed a rounded
 * follower figure.
 *
 * Requires: pages_read_engagement, pages_show_list  (verified against the token).
 */

const URLS = require('../../config');
const { graphGet, asString } = require('./common');

/**
 * `picture` is requested with an explicit size so Graph returns a stable URL
 * rather than the 50px default thumbnail.
 */
const FIELDS = [
  'username',
  'name',
  'about',
  'followers_count',
  'fan_count',
  'picture.width(320).height(320){url}',
];

module.exports = {
  platform: 'facebook',
  label: 'Facebook',
  kind: 'api',
  url: URLS.facebook,

  fields: ['username', 'displayName', 'followers', 'likes', 'bio', 'profileImage'],
  requiredKeys: ['displayName', 'followers'],

  source: 'meta-graph-api',

  /**
   * Fetch the page and map it onto the unified record shape.
   * @returns {Promise<Object>} values keyed by the unified field names
   */
  async fetch() {
    const node = await graphGet(process.env.META_FACEBOOK_PAGE_ID, FIELDS, {
      required: ['META_FACEBOOK_PAGE_ID'],
    });

    return {
      username: asString(node.username),
      displayName: asString(node.name),
      followers: asString(node.followers_count),
      likes: asString(node.fan_count),
      bio: asString(node.about),
      profileImage: asString(node.picture?.data?.url),
    };
  },
};
