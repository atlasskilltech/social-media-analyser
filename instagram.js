'use strict';

/**
 * Instagram public profile scraper.
 *
 * Run directly:  node instagram.js
 * Output:        cache/instagram.json  +  the same JSON printed to stdout
 *
 * Seven independent extraction strategies run in order and their results are
 * merged. None is trusted on its own — Instagram changes markup constantly and
 * serves different HTML depending on who is asking.
 *
 *   1. dom-selectors          rendered profile header ("38K followers")
 *   2. additional-data-loaded legacy window.__additionalDataLoaded payload
 *   3. shared-data            legacy window._sharedData payload
 *   4. json-ld                schema.org ProfilePage
 *   5. meta-tags              og:description ("38K Followers, 27 Following, …")
 *   6. embedded-json          modern hydration payload (exact: 38015)
 *   7. raw-html-fetch         plain HTTP GET, no JavaScript executed
 *
 * Strategies 1 and 5 give rounded follower counts; 6 gives the exact number.
 * The merge in lib/utils.js lets an exact value replace a rounded one, and post
 * count — which only 5 exposes — still gets filled in.
 *
 * Strategy 7 exists for a specific failure mode: on datacenter IPs Instagram
 * often walls the *rendered* page behind a login modal via client-side JS while
 * the initial HTML response still carries the og: meta tags. Fetching the same
 * URL without executing JavaScript sidesteps that entirely.
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
 * Shared parsing helpers
 * ------------------------------------------------------------------ */

/**
 * Pull the three counts out of Instagram's og:description sentence:
 *   "38K Followers, 27 Following, 4,570 Posts - See Instagram photos and ..."
 */
function countsFromDescription(desc) {
  const grab = (label) => {
    const m = (desc || '').match(new RegExp('([\\d.,]+\\s*[KMB]?)\\s*' + label, 'i'));
    return m ? parseCount(m[1]) : null;
  };
  return {
    followers: grab('Followers'),
    following: grab('Following'),
    posts: grab('Posts'),
  };
}

/** Username out of an og:title ("Name (@handle) • Instagram ...") or a URL. */
function usernameFrom(title, url) {
  const handle = (title || '').match(/\(@([A-Za-z0-9._]+)\)/);
  if (handle) return handle[1];
  const fromUrl = (url || '').match(/instagram\.com\/([A-Za-z0-9._]+)/);
  return fromUrl ? fromUrl[1] : null;
}

/** Bio out of the plain description tag: '... on Instagram: "the bio"'. */
function bioFromDescription(desc) {
  const quoted = (desc || '').match(/on Instagram:\s*"([\s\S]*)"\s*$/);
  return quoted ? quoted[1] : null;
}

/**
 * Map a parsed user object (any of Instagram's payload shapes) onto our fields.
 */
function fromUserObject(user) {
  if (!user || typeof user !== 'object') return {};

  const followers =
    user.follower_count ?? user.edge_followed_by?.count ?? user.edge_followed_by ?? null;
  const following =
    user.following_count ?? user.edge_follow?.count ?? user.edge_follow ?? null;
  const posts =
    user.media_count ??
    user.all_media_count ??
    user.edge_owner_to_timeline_media?.count ??
    null;

  return {
    username: field(user.username),
    followers: parseCount(typeof followers === 'number' ? followers : followers?.count ?? followers),
    following: parseCount(typeof following === 'number' ? following : following?.count ?? following),
    posts: parseCount(posts),
    bio: field(user.biography),
    profileImage: field(user.profile_pic_url_hd || user.profile_pic_url),
  };
}

/* ------------------------------------------------------------------ *
 * Strategy 1 — DOM selectors
 * ------------------------------------------------------------------ */

/**
 * Read the rendered profile header.
 *
 * Instagram's class names are generated and change weekly, so we avoid them:
 * counts come out of the page's visible text and the avatar is found by its
 * accessibility-driven alt text, which has been stable for years.
 */
async function fromDom(page) {
  const raw = await page.evaluate(() => {
    const text = document.body ? document.body.innerText : '';
    const grab = (re) => {
      const m = text.match(re);
      return m ? m[1] : null;
    };

    const avatar =
      document.querySelector('img[alt$="profile picture"]') || document.querySelector('header img');

    let username = null;
    if (avatar && avatar.alt) {
      const m = avatar.alt.match(/^(.+?)'s profile picture$/);
      if (m) username = m[1];
    }

    return {
      username,
      followers: grab(/([\d.,]+\s*[KMB]?)\s*followers/i),
      following: grab(/([\d.,]+\s*[KMB]?)\s*following/i),
      posts: grab(/([\d.,]+\s*[KMB]?)\s*posts/i),
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
 * Strategy 2 — window.__additionalDataLoaded
 * ------------------------------------------------------------------ */

/**
 * Legacy hydration hook: Instagram used to call
 *   window.__additionalDataLoaded('/username/', { graphql: { user: {...} } })
 * from an inline script. Long deprecated, but free to check and it still shows
 * up on some cached or regional responses.
 */
async function fromAdditionalDataLoaded(page) {
  const user = await page.evaluate(() => {
    const scripts = [...document.querySelectorAll('script')].map((s) => s.textContent || '');

    for (const txt of scripts) {
      const idx = txt.indexOf('__additionalDataLoaded');
      if (idx === -1) continue;

      // Take everything from the first '{' after the call to the last '}'.
      const start = txt.indexOf('{', idx);
      const end = txt.lastIndexOf('}');
      if (start === -1 || end <= start) continue;

      try {
        const payload = JSON.parse(txt.slice(start, end + 1));
        const user = payload?.graphql?.user || payload?.user || payload?.data?.user;
        if (user) return user;
      } catch {
        // Malformed or not actually JSON — keep looking.
      }
    }
    return null;
  });

  return fromUserObject(user);
}

/* ------------------------------------------------------------------ *
 * Strategy 3 — window._sharedData
 * ------------------------------------------------------------------ */

/**
 * The original Instagram bootstrap payload:
 *   window._sharedData = { entry_data: { ProfilePage: [ { graphql: {...} } ] } };
 * Removed from modern responses; retained because it costs nothing and is the
 * shape most third-party guides still describe.
 */
async function fromSharedData(page) {
  const user = await page.evaluate(() => {
    // Prefer the live global if the page actually set it.
    const live = window._sharedData;
    const fromShared = (shared) =>
      shared?.entry_data?.ProfilePage?.[0]?.graphql?.user ||
      shared?.entry_data?.ProfilePage?.[0]?.user ||
      null;

    if (live) {
      const user = fromShared(live);
      if (user) return user;
    }

    for (const script of document.querySelectorAll('script')) {
      const txt = script.textContent || '';
      const idx = txt.indexOf('_sharedData');
      if (idx === -1) continue;

      const start = txt.indexOf('{', idx);
      const end = txt.lastIndexOf('}');
      if (start === -1 || end <= start) continue;

      try {
        const user = fromShared(JSON.parse(txt.slice(start, end + 1)));
        if (user) return user;
      } catch {
        /* keep looking */
      }
    }
    return null;
  });

  return fromUserObject(user);
}

/* ------------------------------------------------------------------ *
 * Strategy 4 — JSON-LD
 * ------------------------------------------------------------------ */

/**
 * schema.org ProfilePage markup. Served inconsistently — often not at all to
 * logged-out visitors — but clean and exact when present.
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

    for (const node of Array.isArray(data) ? data : [data]) {
      const main = node.mainEntity || node;
      const stats = [].concat(node.interactionStatistic || main.interactionStatistic || []);

      const statFor = (kind) => {
        const hit = stats.find((s) => {
          const it = s && s.interactionType;
          const name = typeof it === 'string' ? it : it?.['@type'] || '';
          return String(name).toLowerCase().includes(kind);
        });
        return hit ? parseCount(hit.userInteractionCount) : null;
      };

      const username = main.alternateName || main.name || node.alternateName;
      if (!username && !stats.length) continue;

      return {
        username: field(username ? String(username).replace(/^@/, '') : null),
        followers: statFor('follow'),
        bio: field(main.description || node.description || null),
        profileImage: field(typeof main.image === 'string' ? main.image : main.image?.url || null),
      };
    }
  }

  return {};
}

/* ------------------------------------------------------------------ *
 * Strategy 5 — Meta tags
 * ------------------------------------------------------------------ */

/**
 * og:description carries all three counts in one predictable sentence. This is
 * the most durable source on the page — it is what WhatsApp and Slack link
 * previews read, so Instagram has strong reasons to keep it stable — and the
 * only place the post count reliably appears.
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
      ogDescription: get('og:description'),
      description: get('description'),
      title: get('og:title'),
      image: get('og:image'),
      url: get('og:url'),
    };
  });

  const desc = meta.ogDescription || meta.description || '';
  const counts = countsFromDescription(desc);

  return {
    username: field(usernameFrom(meta.title, meta.url)),
    ...counts,
    // The plain description tag appends the bio after the counts.
    bio: field(bioFromDescription(meta.description || '')),
    profileImage: field(meta.image),
  };
}

/* ------------------------------------------------------------------ *
 * Strategy 6 — Embedded JSON (modern hydration payload)
 * ------------------------------------------------------------------ */

/**
 * Instagram ships the profile as JSON inside <script> tags so its own client
 * can hydrate without an extra request. This payload holds the exact counts.
 *
 * Two passes: a structured walk over parseable blobs, then a regex sweep over
 * raw script text — parts of the payload are JSON encoded *inside* JSON
 * strings, which the walker cannot reach.
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
          result.structured = {
            username: user.username || null,
            follower_count: user.follower_count ?? null,
            following_count: user.following_count ?? null,
            media_count: user.media_count ?? user.all_media_count ?? null,
            biography: user.biography || null,
            profile_pic_url: user.profile_pic_url_hd || user.profile_pic_url || null,
          };
          break;
        }
      } catch {
        /* the regex pass below handles non-standalone JSON */
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
      follower_count: num('follower_count'),
      following_count: num('following_count'),
      media_count: num('media_count') ?? num('all_media_count'),
      biography: str('biography'),
      profile_pic_url: str('profile_pic_url_hd') || str('profile_pic_url'),
    };

    return result;
  });

  const s = raw.structured || {};
  const r = raw.regex || {};
  const pick = (key) => (s[key] !== null && s[key] !== undefined ? s[key] : r[key]);

  const bio = pick('biography');
  const image = pick('profile_pic_url');

  return {
    username: field(pick('username')),
    followers: parseCount(pick('follower_count')),
    following: parseCount(pick('following_count')),
    posts: parseCount(pick('media_count')),
    // Regex values arrive JSON-escaped (\n, @) — decode before storing.
    bio: field(bio ? decodeJsonString(bio) : null),
    profileImage: field(image ? decodeJsonString(image) : null),
  };
}

/* ------------------------------------------------------------------ *
 * Strategy 7 — Raw HTML fetch (no JavaScript)
 * ------------------------------------------------------------------ */

/**
 * Fetch the same public URL over plain HTTP and parse the meta tags out of the
 * response body.
 *
 * The point is that no JavaScript runs. Instagram's login wall on datacenter
 * IPs is applied by client-side code after hydration; the initial HTML document
 * frequently still contains the og: tags. When every DOM-based strategy comes
 * back empty because the rendered page is a login modal, this one can still
 * return the counts.
 *
 * Uses Playwright's request context, so it reuses the browser's connection
 * settings rather than introducing an HTTP client dependency.
 */
async function fromRawHtmlFetch(page) {
  const response = await page.request.get(URL, {
    headers: {
      /*
       * A plain HTTP-client identifier, not a browser one, and this is load
       * bearing — verified by measurement:
       *
       *   Chrome UA  -> 606 KB, og:description ABSENT
       *   curl UA    -> 703 KB, og:description "38K Followers, 27 Following…"
       *
       * Instagram renders og: tags server-side for non-browser clients (this is
       * how WhatsApp and Slack build link previews, since they do not run JS)
       * and defers them to client-side hydration for real browsers. Claiming to
       * be a browser here would actively lose us the data.
       */
      'User-Agent': 'curl/8.4.0',
      'Accept-Language': 'en-US,en;q=0.9',
    },
    timeout: 20000,
  });

  if (!response.ok()) {
    throw new Error(`raw fetch returned HTTP ${response.status()}`);
  }

  const html = await response.text();

  /** Read a meta tag out of raw HTML, attribute order not assumed. */
  const meta = (name) => {
    const patterns = [
      new RegExp(`<meta[^>]+(?:property|name)=["']${name}["'][^>]+content=["']([^"']*)["']`, 'i'),
      new RegExp(`<meta[^>]+content=["']([^"']*)["'][^>]+(?:property|name)=["']${name}["']`, 'i'),
    ];
    for (const re of patterns) {
      const m = html.match(re);
      if (m) return cleanText(m[1]);
    }
    return null;
  };

  const desc = meta('og:description') || meta('description') || '';
  const title = meta('og:title');

  /*
   * The username must come from the response, never from the URL we requested.
   *
   * An earlier version passed `URL` as a fallback, which meant this strategy
   * reported a username even when the response contained no profile data at
   * all. Since username is a required field, that would have let a login wall
   * satisfy validation and overwrite the cache with an entry containing
   * nothing else — worse than an honest failure.
   */
  const username = usernameFrom(title, meta('og:url'));

  return {
    username: field(username),
    ...countsFromDescription(desc),
    bio: field(bioFromDescription(meta('description') || '')),
    profileImage: field(meta('og:image')),
  };
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
   * after load. Dismissing it keeps the DOM strategy honest.
   */
  async prepare(page) {
    const closeButton = page.locator('[role="dialog"] [aria-label="Close"]').first();
    if (await closeButton.isVisible({ timeout: 2000 }).catch(() => false)) {
      await closeButton.click({ timeout: 2000 }).catch(() => {});
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
    { name: 'raw-html-fetch', run: fromRawHtmlFetch },
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
