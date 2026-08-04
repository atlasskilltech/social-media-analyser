'use strict';

/**
 * YouTube channel scraper.
 *
 * Produces: username (handle), displayName, subscribers, videos, bio, profileImage
 *
 * Note on precision: YouTube itself only publishes rounded subscriber counts
 * ("4.15K"), so that value is approximate at the source. The video count is
 * exact. We do not invent precision the platform does not give.
 */

const URLS = require('../../config');
const {
  readMetaTags,
  readBodyText,
  fetchRawHtml,
  metaFromHtml,
  countBefore,
  handleFrom,
  field,
  parseCount,
  cleanText,
} = require('../extractor');

const URL = URLS.youtube;

/* ---------------------------------------------------- Strategy 1: DOM text */

/**
 * The channel header renders as
 *   "ATLAS SkillTech University, Mumbai @handle • 4.15K subscribers • 566 videos"
 * Read from visible text rather than class names, which YouTube regenerates.
 */
async function fromDom(page) {
  const text = await readBodyText(page);

  return {
    username: field(handleFrom(text)),
    subscribers: countBefore(text, 'subscribers?'),
    videos: countBefore(text, 'videos?'),
  };
}

/* ------------------------------------------------- Strategy 2: ytInitialData */

/**
 * YouTube embeds its own hydration payload as `var ytInitialData = {...}`.
 * Shapes shift between rollouts, so this searches for the known count fields
 * rather than walking a fixed path.
 */
async function fromInitialData(page) {
  const raw = await page.evaluate(() => {
    const scripts = [...document.querySelectorAll('script')].map((s) => s.textContent || '');
    const blob = scripts.find((t) => t.includes('ytInitialData'));
    if (!blob) return null;

    const str = (key) => {
      const m = blob.match(new RegExp('"' + key + '"\\s*:\\s*{\\s*"simpleText"\\s*:\\s*"([^"]+)"'));
      if (m) return m[1];
      const direct = blob.match(new RegExp('"' + key + '"\\s*:\\s*"([^"]+)"'));
      return direct ? direct[1] : null;
    };

    return {
      subscriberCountText: str('subscriberCountText'),
      videosCountText: str('videosCountText'),
      channelHandle: str('channelHandleText') || str('canonicalBaseUrl'),
    };
    /*
     * Deliberately no `title` here. A loose "title" match returns the first one
     * in the payload, which is whatever dialog YouTube happens to embed — it
     * produced the channel name "Want to subscribe to this channel?". The
     * channel name comes from og:title, which is unambiguous.
     */
  });

  if (!raw) return {};

  return {
    username: field(handleFrom(raw.channelHandle || '')),
    subscribers: raw.subscriberCountText ? countBefore(raw.subscriberCountText, 'subscribers?') : null,
    videos: raw.videosCountText ? countBefore(raw.videosCountText, 'videos?') : null,
  };
}

/* --------------------------------------------------- Strategy 3: meta tags */

async function fromMetaTags(page) {
  const meta = await readMetaTags(page);

  return {
    displayName: field(meta.ogTitle),
    bio: field(meta.ogDescription || meta.description),
    profileImage: field(meta.ogImage),
    username: field(handleFrom(meta.ogUrl || URL)),
  };
}

/* --------------------------------------- Strategy 4: raw HTML (no JS) */

/**
 * YouTube serves og: tags server-side, so this works without rendering.
 * It supplies name, description and avatar even when the page is walled;
 * the counts still need the rendered header.
 */
async function fromRawHtml(page) {
  const { status, html } = await fetchRawHtml(page, URL);
  if (status >= 400) throw new Error(`raw fetch returned HTTP ${status}`);

  return {
    displayName: field(metaFromHtml(html, 'og:title')),
    bio: field(metaFromHtml(html, 'og:description')),
    profileImage: field(metaFromHtml(html, 'og:image')),
    // Counts occasionally appear in the server-rendered payload.
    subscribers: countBefore(html, 'subscribers'),
    videos: countBefore(html, 'videos'),
  };
}

module.exports = {
  platform: 'youtube',
  label: 'YouTube',
  url: URL,
  fields: ['username', 'displayName', 'subscribers', 'videos', 'bio', 'profileImage'],
  requiredKeys: ['displayName', 'subscribers'],

  async prepare(page) {
    // Google's consent interstitial appears in some regions; dismiss if present.
    const consent = page.locator('button[aria-label*="Accept"], button:has-text("Accept all")').first();
    if (await consent.isVisible({ timeout: 2000 }).catch(() => false)) {
      await consent.click({ timeout: 2000 }).catch(() => {});
      await page.waitForTimeout(1500);
    }
  },

  /*
   * meta-tags runs first: og:title is the authoritative channel name, and for
   * text fields the first non-empty value wins. Counts are unaffected by order
   * because the merge lets an exact value replace a rounded one either way.
   */
  strategies: [
    { name: 'meta-tags', run: fromMetaTags },
    { name: 'dom-selectors', run: fromDom },
    { name: 'yt-initial-data', run: fromInitialData },
    { name: 'raw-html-fetch', run: fromRawHtml },
  ],
};
