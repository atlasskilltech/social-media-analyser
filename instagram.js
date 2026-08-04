'use strict';

/**
 * Instagram public profile scraper.
 *
 * Run directly:  node instagram.js
 * Output:        cache/instagram.json  +  the same JSON printed to stdout
 *
 * Four independent extraction strategies run in order and their results are
 * merged. None of them is trusted to work on its own — Instagram changes its
 * markup constantly and serves different HTML to different visitors.
 *
 *   1. DOM          — the rendered profile header ("38K followers")
 *   2. Embedded JSON— Instagram's own hydration payload (exact: 38015)
 *   3. Meta tags    — og:description ("38K Followers, 27 Following, 4,570 Posts")
 *   4. JSON-LD      — schema.org ProfilePage, when present
 *
 * Strategies 1 and 3 give rounded follower counts; strategy 2 gives the exact
 * number. The merge in lib/utils.js lets the exact value replace the rounded
 * one, and post count — which only strategy 3 exposes — still gets filled in.
 */

const URLS = require('./config');
const { parseCount, field, cleanText, decodeJsonString } = require('./lib/utils');
const { runStandalone } = require('./lib/runner');

const PLATFORM = 'instagram';
const URL = URLS.instagram;

/** Output key order for cache/instagram.json. */
const FIELDS = ['username', 'followers', 'following', 'posts', 'bio', 'profileImage'];

/** If none of these were extracted, the previous cache is left untouched. */
const REQUIRED = ['username', 'followers'];

/* ------------------------------------------------------------------ *
 * Strategy 1 — DOM
 * ------------------------------------------------------------------ */

/**
 * Read the rendered profile header.
 *
 * Instagram's class names are generated and change weekly, so we deliberately
 * avoid them: counts are pulled out of the page's visible text, and the avatar
 * is found by its stable, accessibility-driven alt text.
 */
async function fromDom(page) {
  const raw = await page.evaluate(() => {
    const text = document.body ? document.body.innerText : '';

    /** First capture group of the first matching pattern. */
    const grab = (patterns) => {
      for (const re of patterns) {
        const m = text.match(re);
        if (m) return m[1];
      }
      return null;
    };

    // The avatar's alt text is "<username>'s profile picture" — stable for years.
    const avatar =
      document.querySelector('img[alt$="profile picture"]') ||
      document.querySelector('header img');

    // Username also appears in that alt text, which is more reliable than
    // guessing which heading element holds it this week.
    let username = null;
    if (avatar && avatar.alt) {
      const m = avatar.alt.match(/^(.+?)'s profile picture$/);
      if (m) username = m[1];
    }

    return {
      username,
      followers: grab([/([\d.,]+\s*[KMB]?)\s*followers/i]),
      following: grab([/([\d.,]+\s*[KMB]?)\s*following/i]),
      posts: grab([/([\d.,]+\s*[KMB]?)\s*posts/i]),
      profileImage: avatar ? avatar.src : null,
    };
  });

  return {
    username: field(raw.username),
    followers: parseCount(raw.followers),
    following: parseCount(raw.following),
    posts: parseCount(raw.posts),
    profileImage: field(raw.profileImage),
  };
}

/* ------------------------------------------------------------------ *
 * Strategy 2 — Embedded JSON (Instagram's hydration payload)
 * ------------------------------------------------------------------ */

/**
 * Instagram ships the profile as JSON inside <script> tags so its own client
 * can hydrate without an extra request. That payload holds exact counts.
 *
 * Two passes: first a structured walk over the parseable JSON blobs, then a
 * regex sweep over the raw script text. The second pass exists because parts
 * of the payload are JSON *encoded inside* JSON strings, which the walker
 * cannot reach.
 */
async function fromEmbeddedJson(page) {
  const raw = await page.evaluate(() => {
    const result = {};

    /** Depth-limited search for the object that carries follower_count. */
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

    // Pass 1 — structured walk.
    for (const script of document.querySelectorAll('script[type="application/json"]')) {
      const txt = script.textContent || '';
      if (!txt.includes('follower_count')) continue;
      try {
        const user = walk(JSON.parse(txt));
        if (user) {
          result.structured = {
            username: user.username || null,
            followers: typeof user.follower_count === 'number' ? user.follower_count : null,
            following: typeof user.following_count === 'number' ? user.following_count : null,
            posts:
              typeof user.media_count === 'number'
                ? user.media_count
                : typeof user.all_media_count === 'number'
                  ? user.all_media_count
                  : null,
            bio: user.biography || null,
            profileImage: user.profile_pic_url_hd || user.profile_pic_url || null,
          };
          break;
        }
      } catch {
        // Not valid standalone JSON — the regex pass below will handle it.
      }
    }

    // Pass 2 — raw text of every script, for values the walker cannot reach.
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
      return m ? m[1] : null; // still JSON-escaped; decoded in Node
    };

    result.regex = {
      username: str('username'),
      followers: num('follower_count'),
      following: num('following_count'),
      posts: num('media_count') ?? num('all_media_count'),
      bio: str('biography'),
      profileImage: str('profile_pic_url_hd') || str('profile_pic_url'),
    };

    return result;
  });

  // Structured results win; regex fills the gaps.
  const s = raw.structured || {};
  const r = raw.regex || {};
  const pick = (key) => (s[key] !== null && s[key] !== undefined ? s[key] : r[key]);

  const bio = pick('bio');
  const image = pick('profileImage');

  return {
    username: field(pick('username')),
    followers: parseCount(pick('followers')),
    following: parseCount(pick('following')),
    posts: parseCount(pick('posts')),
    // Regex values arrive JSON-escaped (@, \n) — decode before storing.
    bio: field(bio ? decodeJsonString(bio) : null),
    profileImage: field(image ? decodeJsonString(image) : null),
  };
}

/* ------------------------------------------------------------------ *
 * Strategy 3 — Meta tags
 * ------------------------------------------------------------------ */

/**
 * og:description carries all three counts in one predictable sentence:
 *   "38K Followers, 27 Following, 4,570 Posts - See Instagram photos and ..."
 *
 * This is the most durable source on the page — it is what link previews on
 * WhatsApp and Slack read, so Instagram has strong reasons to keep it stable.
 * It is also the only place the post count reliably appears.
 */
async function fromMetaTags(page) {
  const meta = await page.evaluate(() => {
    const get = (name) => {
      const el =
        document.querySelector(`meta[property="${name}"]`) ||
        document.querySelector(`meta[name="${name}"]`);
      return el ? el.getAttribute('content') : null;
    };
    return {
      description: get('og:description') || get('description'),
      title: get('og:title'),
      image: get('og:image'),
      url: get('og:url'),
    };
  });

  const desc = meta.description || '';
  const count = (label) => {
    const m = desc.match(new RegExp('([\\d.,]+\\s*[KMB]?)\\s*' + label, 'i'));
    return m ? parseCount(m[1]) : null;
  };

  // "ATLAS SkillTech University (@atlasskilltechuniversity) • Instagram ..."
  let username = null;
  const handle = (meta.title || '').match(/\(@([A-Za-z0-9._]+)\)/);
  if (handle) username = handle[1];
  if (!username && meta.url) {
    const fromUrl = meta.url.match(/instagram\.com\/([A-Za-z0-9._]+)/);
    if (fromUrl) username = fromUrl[1];
  }

  // The plain `description` tag appends the bio after the counts:
  //   '... - ATLAS SkillTech University (@handle) on Instagram: "the bio"'
  let bio = null;
  const quoted = desc.match(/on Instagram:\s*"([\s\S]*)"\s*$/);
  if (quoted) bio = quoted[1];

  return {
    username: field(username),
    followers: count('Followers'),
    following: count('Following'),
    posts: count('Posts'),
    bio: field(bio),
    profileImage: field(meta.image),
  };
}

/* ------------------------------------------------------------------ *
 * Strategy 4 — JSON-LD
 * ------------------------------------------------------------------ */

/**
 * schema.org ProfilePage markup. Instagram serves this inconsistently — often
 * not at all for logged-out visitors — but when it is there it is clean and
 * exact, so it stays in the chain as a free win.
 */
async function fromJsonLd(page) {
  const blocks = await page.evaluate(() =>
    [...document.querySelectorAll('script[type="application/ld+json"]')].map((s) => s.textContent || '')
  );

  for (const block of blocks) {
    let data;
    try {
      data = JSON.parse(block);
    } catch {
      continue;
    }

    const nodes = Array.isArray(data) ? data : [data];
    for (const node of nodes) {
      const main = node.mainEntity || node;
      const stats = [].concat(node.interactionStatistic || main.interactionStatistic || []);

      const statFor = (type) => {
        const hit = stats.find((s) => {
          const it = s && (s.interactionType || '');
          const name = typeof it === 'string' ? it : it['@type'] || '';
          return String(name).toLowerCase().includes(type);
        });
        return hit ? parseCount(hit.userInteractionCount) : null;
      };

      const username = main.alternateName || main.name || node.alternateName;
      if (!username && !stats.length) continue;

      return {
        username: field(username ? String(username).replace(/^@/, '') : null),
        followers: statFor('follow'),
        bio: field(main.description || node.description || null),
        profileImage: field(main.image || node.image || null),
      };
    }
  }

  return {};
}

/* ------------------------------------------------------------------ *
 * Spec
 * ------------------------------------------------------------------ */

const spec = {
  platform: PLATFORM,
  url: URL,
  fields: FIELDS,
  requiredKeys: REQUIRED,

  /**
   * Instagram throws a "Sign up / Log in" modal over the profile a few seconds
   * after load. It does not hide the header text we read, but dismissing it
   * keeps the DOM strategy honest if that ever changes.
   */
  async prepare(page) {
    const closeButton = page.locator('[role="dialog"] [aria-label="Close"]').first();
    if (await closeButton.isVisible({ timeout: 2000 }).catch(() => false)) {
      await closeButton.click({ timeout: 2000 }).catch(() => {});
    }
    await page.keyboard.press('Escape').catch(() => {});
  },

  strategies: [
    { name: 'dom', run: fromDom },
    { name: 'embedded-json', run: fromEmbeddedJson },
    { name: 'meta-tags', run: fromMetaTags },
    { name: 'json-ld', run: fromJsonLd },
  ],
};

module.exports = spec;

// `node instagram.js`
if (require.main === module) {
  runStandalone(spec).catch((err) => {
    console.error('Unexpected failure:', err);
    process.exitCode = 1;
  });
}
