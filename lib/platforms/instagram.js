'use strict';

/**
 * Instagram profile scraper.
 *
 * Produces: username, displayName, followers, following, posts, bio, profileImage
 *
 * Precision note: the DOM and meta tags report a rounded follower count
 * ("38K"); the hydration payload carries the exact number (38015). The merge in
 * lib/utils.js lets an exact value replace a rounded one but never the reverse,
 * so whichever strategies happen to fire, the best available figure wins.
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
  parseCount,
  cleanText,
} = require('../extractor');
const { decodeJsonString } = require('../utils');

const URL = URLS.instagram;

/** Username out of an og:title ("Name (@handle) • Instagram …") or a URL. */
function usernameFrom(title, url) {
  const handle = (title || '').match(/\(@([A-Za-z0-9._]+)\)/);
  if (handle) return handle[1];
  const fromUrl = (url || '').match(/instagram\.com\/([A-Za-z0-9._]+)/);
  return fromUrl ? fromUrl[1] : null;
}

/** Display name is everything before the parenthesised handle. */
function displayNameFrom(title) {
  if (!title) return null;
  const m = title.match(/^(.+?)\s*\(@/);
  return m ? cleanText(m[1]) : null;
}

/** Bio out of the plain description tag: '… on Instagram: "the bio"'. */
function bioFromDescription(desc) {
  const quoted = (desc || '').match(/on Instagram:\s*"([\s\S]*)"\s*$/);
  return quoted ? quoted[1] : null;
}

/** Map any of Instagram's payload shapes onto our fields. */
function fromUserObject(user) {
  if (!user || typeof user !== 'object') return {};

  const num = (v) => (typeof v === 'number' ? v : v?.count ?? null);

  return {
    username: field(user.username),
    displayName: field(user.full_name),
    followers: parseCount(num(user.follower_count ?? user.edge_followed_by)),
    following: parseCount(num(user.following_count ?? user.edge_follow)),
    posts: parseCount(num(user.media_count ?? user.all_media_count ?? user.edge_owner_to_timeline_media)),
    bio: field(user.biography),
    profileImage: field(user.profile_pic_url_hd || user.profile_pic_url),
  };
}

/* ------------------------------------------------ Strategy 1: DOM selectors */

async function fromDom(page) {
  const text = await readBodyText(page);

  const avatar = await page.evaluate(() => {
    const img =
      document.querySelector('img[alt$="profile picture"]') || document.querySelector('header img');
    if (!img) return null;
    const m = (img.alt || '').match(/^(.+?)'s profile picture$/);
    return { src: img.src, username: m ? m[1] : null };
  });

  return {
    username: field(avatar?.username),
    followers: countBefore(text, 'followers'),
    following: countBefore(text, 'following'),
    posts: countBefore(text, 'posts'),
    profileImage: field(avatar?.src),
  };
}

/* --------------------------- Strategy 2: window.__additionalDataLoaded */

/** Legacy hydration hook. Long deprecated; free to check, occasionally present. */
async function fromAdditionalDataLoaded(page) {
  const user = await page.evaluate(() => {
    for (const script of document.querySelectorAll('script')) {
      const txt = script.textContent || '';
      const idx = txt.indexOf('__additionalDataLoaded');
      if (idx === -1) continue;

      const start = txt.indexOf('{', idx);
      const end = txt.lastIndexOf('}');
      if (start === -1 || end <= start) continue;

      try {
        const payload = JSON.parse(txt.slice(start, end + 1));
        const user = payload?.graphql?.user || payload?.user || payload?.data?.user;
        if (user) return user;
      } catch {
        /* keep looking */
      }
    }
    return null;
  });

  return fromUserObject(user);
}

/* ------------------------------------- Strategy 3: window._sharedData */

/** The original bootstrap payload. Removed from modern responses. */
async function fromSharedData(page) {
  const user = await page.evaluate(() => {
    const pick = (shared) =>
      shared?.entry_data?.ProfilePage?.[0]?.graphql?.user ||
      shared?.entry_data?.ProfilePage?.[0]?.user ||
      null;

    if (window._sharedData) {
      const user = pick(window._sharedData);
      if (user) return user;
    }

    for (const script of document.querySelectorAll('script')) {
      const txt = script.textContent || '';
      if (!txt.includes('_sharedData')) continue;
      const start = txt.indexOf('{');
      const end = txt.lastIndexOf('}');
      if (start === -1 || end <= start) continue;
      try {
        const user = pick(JSON.parse(txt.slice(start, end + 1)));
        if (user) return user;
      } catch {
        /* keep looking */
      }
    }
    return null;
  });

  return fromUserObject(user);
}

/* ----------------------------------------------------- Strategy 4: JSON-LD */

async function fromJsonLd(page) {
  const nodes = await readJsonLd(page);

  for (const node of nodes) {
    const main = node.mainEntity || node;
    const stats = [].concat(node.interactionStatistic || main.interactionStatistic || []);

    const followerStat = stats.find((s) => {
      const it = s?.interactionType;
      const name = typeof it === 'string' ? it : it?.['@type'] || '';
      return /follow/i.test(name);
    });

    const username = main.alternateName || main.name || node.alternateName;
    if (!username && !stats.length) continue;

    return {
      username: field(username ? String(username).replace(/^@/, '') : null),
      followers: followerStat ? parseCount(followerStat.userInteractionCount) : null,
      bio: field(main.description || node.description),
      profileImage: field(typeof main.image === 'string' ? main.image : main.image?.url),
    };
  }

  return {};
}

/* --------------------------------------------------- Strategy 5: meta tags */

async function fromMetaTags(page) {
  const meta = await readMetaTags(page);
  const desc = meta.ogDescription || meta.description || '';

  return {
    username: field(usernameFrom(meta.ogTitle, meta.ogUrl)),
    displayName: field(displayNameFrom(meta.ogTitle)),
    followers: countBefore(desc, 'Followers'),
    following: countBefore(desc, 'Following'),
    posts: countBefore(desc, 'Posts'),
    bio: field(bioFromDescription(meta.description || '')),
    profileImage: field(meta.ogImage),
  };
}

/* ----------------------------------------------- Strategy 6: embedded JSON */

/**
 * Instagram ships the profile as JSON inside <script> tags so its own client
 * can hydrate. This payload holds the exact counts.
 *
 * Two passes: a structured walk over parseable blobs, then a regex sweep over
 * raw script text — parts of the payload are JSON encoded inside JSON strings,
 * which the walker cannot reach.
 */
async function fromEmbeddedJson(page) {
  const raw = await page.evaluate(() => {
    const result = {};

    const walk = (node, depth = 0) => {
      if (!node || typeof node !== 'object' || depth > 12) return null;
      if (Object.prototype.hasOwnProperty.call(node, 'follower_count')) return node;
      for (const value of Object.values(node)) {
        if (value && typeof value === 'object') {
          const hit = walk(value, depth + 1);
          if (hit) return hit;
        }
      }
      return null;
    };

    for (const script of document.querySelectorAll('script[type="application/json"]')) {
      const txt = script.textContent || '';
      if (!txt.includes('follower_count')) continue;
      try {
        const user = walk(JSON.parse(txt));
        if (user) {
          result.structured = user;
          break;
        }
      } catch {
        /* regex pass below */
      }
    }

    const all = [...document.querySelectorAll('script')]
      .map((s) => s.textContent || '')
      .filter((t) => t.includes('follower_count') || t.includes('profile_pic_url'))
      .join('\n');

    const num = (key) => {
      const m = all.match(new RegExp('"' + key + '"\\s*:\\s*(\\d+)'));
      return m ? Number(m[1]) : null;
    };
    const str = (key) => {
      const m = all.match(new RegExp('"' + key + '"\\s*:\\s*"((?:[^"\\\\]|\\\\.)*)"'));
      return m ? m[1] : null;
    };

    result.regex = {
      username: str('username'),
      full_name: str('full_name'),
      follower_count: num('follower_count'),
      following_count: num('following_count'),
      media_count: num('media_count') ?? num('all_media_count'),
      biography: str('biography'),
      profile_pic_url: str('profile_pic_url_hd') || str('profile_pic_url'),
    };

    return result;
  });

  const structured = fromUserObject(raw.structured);
  const r = raw.regex || {};

  // Regex values arrive JSON-escaped (\n, @) — decode before storing.
  const decoded = fromUserObject({
    username: r.username,
    full_name: r.full_name ? decodeJsonString(r.full_name) : null,
    follower_count: r.follower_count,
    following_count: r.following_count,
    media_count: r.media_count,
    biography: r.biography ? decodeJsonString(r.biography) : null,
    profile_pic_url: r.profile_pic_url ? decodeJsonString(r.profile_pic_url) : null,
  });

  // Structured wins; regex fills gaps.
  const out = { ...decoded };
  for (const [key, value] of Object.entries(structured)) {
    if (value && value.v) out[key] = value;
  }
  return out;
}

/* ------------------------------------------- Strategy 7: raw HTML (no JS) */

/**
 * Instagram renders og: tags server-side for non-browser clients and defers
 * them to hydration for real browsers — so this plain fetch returns data even
 * when the rendered page is a login modal.
 *
 * The username must come from the response, never from the URL we requested:
 * deriving it from our own input would let a login wall satisfy validation.
 */
async function fromRawHtml(page) {
  const { status, html } = await fetchRawHtml(page, URL);
  if (status >= 400) throw new Error(`raw fetch returned HTTP ${status}`);

  const title = metaFromHtml(html, 'og:title');
  const desc = metaFromHtml(html, 'og:description') || metaFromHtml(html, 'description') || '';

  return {
    username: field(usernameFrom(title, metaFromHtml(html, 'og:url'))),
    displayName: field(displayNameFrom(title)),
    followers: countBefore(desc, 'Followers'),
    following: countBefore(desc, 'Following'),
    posts: countBefore(desc, 'Posts'),
    bio: field(bioFromDescription(metaFromHtml(html, 'description') || '')),
    profileImage: field(metaFromHtml(html, 'og:image')),
  };
}

module.exports = {
  platform: 'instagram',
  label: 'Instagram',
  url: URL,
  fields: ['username', 'displayName', 'followers', 'following', 'posts', 'bio', 'profileImage'],
  requiredKeys: ['username', 'followers'],

  async prepare(page) {
    // Instagram drops a "Sign up / Log in" modal over the profile after load.
    const close = page.locator('[role="dialog"] [aria-label="Close"]').first();
    if (await close.isVisible({ timeout: 2000 }).catch(() => false)) {
      await close.click({ timeout: 2000 }).catch(() => {});
    }
    await page.keyboard.press('Escape').catch(() => {});
  },

  strategies: [
    { name: 'dom-selectors', run: fromDom },
    { name: 'additional-data-loaded', run: fromAdditionalDataLoaded },
    { name: 'shared-data', run: fromSharedData },
    { name: 'json-ld', run: fromJsonLd },
    { name: 'meta-tags', run: fromMetaTags },
    { name: 'embedded-json', run: fromEmbeddedJson },
    // needsPage: false — issues its own HTTP request, so it still runs when the
    // rendered page was bounced to a login wall.
    { name: 'raw-html-fetch', run: fromRawHtml, needsPage: false },
  ],
};
