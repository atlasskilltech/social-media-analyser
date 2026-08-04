'use strict';

/**
 * Facebook page scraper.
 *
 * Produces: displayName, followers, likes, bio (category/intro), profileImage
 *
 * Facebook is unusual in that its server-rendered og:description is richer than
 * the logged-out DOM: it carries the exact like count ("2,022 likes") while the
 * rendered page only shows a rounded follower figure ("2K followers"). Both are
 * collected and merged.
 */

const URLS = require('../../config');
const {
  readMetaTags,
  readBodyText,
  fetchRawHtml,
  metaFromHtml,
  countBefore,
  field,
  cleanText,
} = require('../extractor');

const URL = URLS.facebook;

/** "ATLAS SkillTech University | Mumbai " -> "ATLAS SkillTech University" */
function cleanPageName(title) {
  if (!title) return null;
  return cleanText(String(title).split('|')[0]);
}

/* ---------------------------------------------------- Strategy 1: DOM text */

/**
 * The logged-out page renders "2K followers • 0 following" and an intro block
 * containing "Page · University".
 */
async function fromDom(page) {
  const text = await readBodyText(page);

  // Category appears as "Page · <Category>".
  const categoryMatch = text.match(/Page\s*·\s*([^\n|]+)/i);

  return {
    followers: countBefore(text, 'followers'),
    following: countBefore(text, 'following'),
    likes: countBefore(text, 'likes'),
    bio: field(categoryMatch ? cleanText(categoryMatch[1]) : null),
  };
}

/* --------------------------------------------------- Strategy 2: meta tags */

/**
 * og:description reads:
 *   "ATLAS SkillTech University, Mumbai. 2,022 likes · 408 talking about
 *    this · 1,386 were here. India's 1st SkillTech University ..."
 */
async function fromMetaTags(page) {
  const meta = await readMetaTags(page);
  const desc = meta.ogDescription || meta.description || '';

  return {
    displayName: field(cleanPageName(meta.ogTitle)),
    likes: countBefore(desc, 'likes'),
    followers: countBefore(desc, 'followers'),
    profileImage: field(meta.ogImage),
  };
}

/* ------------------------------------------- Strategy 3: raw HTML (no JS) */

/**
 * The most reliable Facebook source: no login overlay, no JavaScript, and the
 * exact like count is present in the server-rendered og:description.
 */
async function fromRawHtml(page) {
  const { status, html } = await fetchRawHtml(page, URL);
  if (status >= 400) throw new Error(`raw fetch returned HTTP ${status}`);

  const desc = metaFromHtml(html, 'og:description') || '';

  return {
    displayName: field(cleanPageName(metaFromHtml(html, 'og:title'))),
    likes: countBefore(desc, 'likes'),
    followers: countBefore(desc, 'followers'),
    profileImage: field(metaFromHtml(html, 'og:image')),
    // Everything after the counts sentence is the page's own blurb.
    bio: field((desc.split(/were here\.|talking about this\./i)[1] || '').trim() || null),
  };
}

module.exports = {
  platform: 'facebook',
  label: 'Facebook',
  url: URL,
  fields: ['displayName', 'followers', 'following', 'likes', 'bio', 'profileImage'],
  requiredKeys: ['displayName', 'followers', 'likes'],

  async prepare(page) {
    // Facebook overlays a login dialog over the public page; close it so the
    // DOM strategy can read the intro block underneath.
    const close = page
      .locator('[role="dialog"] [aria-label="Close"], div[aria-label="Close"]')
      .first();
    if (await close.isVisible({ timeout: 2000 }).catch(() => false)) {
      await close.click({ timeout: 2000 }).catch(() => {});
    }
    await page.keyboard.press('Escape').catch(() => {});
  },

  strategies: [
    { name: 'dom-selectors', run: fromDom },
    { name: 'meta-tags', run: fromMetaTags },
    { name: 'raw-html-fetch', run: fromRawHtml },
  ],
};
