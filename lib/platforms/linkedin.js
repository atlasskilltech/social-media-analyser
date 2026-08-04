'use strict';

/**
 * LinkedIn school/company page scraper.
 *
 * Produces: displayName, followers, bio (industry), profileImage
 *
 * Measured reality, recorded here so nobody re-derives it later:
 *
 *   /school/atlasuniversity/home/   browser  -> 302 to /login, login wall
 *   /school/atlasuniversity/        curl     -> HTTP 999 (LinkedIn's block code)
 *   /company/atlasuniversity/       curl     -> HTTP 999
 *   in.linkedin.com/school/...      curl     -> HTTP 999
 *   any of the above                Googlebot-> HTTP 999 or login wall
 *
 * LinkedIn gates logged-out company data behind authentication and returns 999
 * to non-browser clients. Every strategy below is real and correct; they will
 * simply find nothing while that holds. When it fails, the runner marks the
 * platform `blocked`, keeps the last good cache, and the other three platforms
 * are unaffected.
 *
 * We do not work around this with credentials or by faking values.
 */

const URLS = require('../../config');
const {
  readMetaTags,
  readBodyText,
  readJsonLd,
  fetchRawHtml,
  metaFromHtml,
  countBefore,
  field,
  cleanText,
  firstOf,
} = require('../extractor');
const { createOcrStrategy } = require('../ocr');

const URL = URLS.linkedin;

/** Strip LinkedIn's title suffix: "Atlas University | LinkedIn" -> "Atlas University" */
function cleanCompanyName(title) {
  if (!title) return null;
  const name = cleanText(String(title).replace(/\s*\|\s*LinkedIn\s*$/i, ''));
  // The login page also has a title; never let it through as a company name.
  return /linkedin login|sign in/i.test(name) ? null : name;
}

/* ---------------------------------------------------- Strategy 1: DOM text */

async function fromDom(page) {
  const text = await readBodyText(page);

  // Guard: on the login wall these patterns can still match stray copy.
  if (/sign in|join now|new to linkedin/i.test(text) && !/followers/i.test(text)) {
    return {};
  }

  const industry = text.match(/\n([A-Z][A-Za-z &,]+)\n[\d,.]+\s*followers/);

  return {
    followers: countBefore(text, 'followers'),
    bio: field(industry ? cleanText(industry[1]) : null),
  };
}

/* --------------------------------------------------- Strategy 2: meta tags */

async function fromMetaTags(page) {
  const meta = await readMetaTags(page);
  const name = cleanCompanyName(meta.ogTitle);
  if (!name) return {}; // login page — nothing real to take

  const desc = meta.ogDescription || meta.description || '';

  return {
    displayName: field(name),
    followers: countBefore(desc, 'followers'),
    bio: field(desc || null),
    profileImage: field(meta.ogImage),
  };
}

/* ----------------------------------------------------- Strategy 3: JSON-LD */

/**
 * Public LinkedIn pages carry schema.org Organization markup when they render
 * at all, including an interactionStatistic for follower count.
 */
async function fromJsonLd(page) {
  const nodes = await readJsonLd(page);

  for (const node of nodes) {
    const org = node['@type'] === 'Organization' ? node : node.mainEntity;
    if (!org) continue;

    const stats = [].concat(org.interactionStatistic || []);
    const followerStat = stats.find((s) =>
      /follow/i.test(typeof s?.interactionType === 'string' ? s.interactionType : s?.interactionType?.['@type'] || '')
    );

    return {
      displayName: field(cleanCompanyName(org.name)),
      followers: followerStat ? countBefore(String(followerStat.userInteractionCount), '') : null,
      bio: field(firstOf(org.description, org.industry)),
      profileImage: field(typeof org.logo === 'string' ? org.logo : org.logo?.url),
    };
  }

  return {};
}

/* ------------------------------------------- Strategy 4: raw HTML (no JS) */

async function fromRawHtml(page) {
  const { status, html } = await fetchRawHtml(page, URL);

  // 999 is LinkedIn's documented "request denied" code for automated clients.
  if (status === 999) throw new Error('LinkedIn returned HTTP 999 (automated request blocked)');
  if (status >= 400) throw new Error(`raw fetch returned HTTP ${status}`);

  const name = cleanCompanyName(metaFromHtml(html, 'og:title'));
  if (!name) throw new Error('response was the login page, not the company page');

  const desc = metaFromHtml(html, 'og:description') || '';

  return {
    displayName: field(name),
    followers: countBefore(desc, 'followers') || countBefore(html, 'followers'),
    bio: field(desc || null),
    profileImage: field(metaFromHtml(html, 'og:image')),
  };
}

module.exports = {
  platform: 'linkedin',
  label: 'LinkedIn',
  url: URL,
  fields: ['displayName', 'followers', 'bio', 'profileImage'],
  requiredKeys: ['displayName', 'followers'],

  /* Fixed pipeline order — first strategy to satisfy requiredKeys wins. */
  strategies: [
    { name: 'dom-selectors', run: fromDom },
    { name: 'json-ld', run: fromJsonLd },
    { name: 'meta-tags', run: fromMetaTags },
    // needsPage: false — own HTTP request, survives a failed navigation.
    { name: 'raw-html-fetch', run: fromRawHtml, needsPage: false },
    createOcrStrategy('linkedin'),
  ],
};
