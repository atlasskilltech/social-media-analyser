'use strict';

/**
 * Shared extraction primitives.
 *
 * Every platform needs the same handful of operations — read meta tags, parse
 * JSON-LD, scan the rendered text, fetch the raw HTML without JavaScript — so
 * they live here once instead of four times. A platform module supplies only
 * the part that is genuinely platform-specific: which pattern means what.
 */

const { field, parseCount, cleanText } = require('./utils');

/**
 * A plain HTTP-client user agent.
 *
 * Not cosmetic. Measured against Instagram:
 *   Chrome UA -> 606 KB, og:description ABSENT
 *   curl UA   -> 703 KB, og:description "38K Followers, 27 Following, ..."
 *
 * Sites render Open Graph tags server-side for non-browser clients (this is how
 * WhatsApp and Slack build link previews without running JS) and defer them to
 * hydration for real browsers. Asking as a browser loses the data.
 */
const PLAIN_CLIENT_UA = 'curl/8.4.0';

/* ------------------------------------------------------------------ *
 * Rendered-page readers
 * ------------------------------------------------------------------ */

/**
 * Read Open Graph and description meta tags from the rendered page.
 * @returns {Promise<{ogTitle, ogDescription, ogImage, ogUrl, description}>}
 */
async function readMetaTags(page) {
  return page.evaluate(() => {
    const get = (name) => {
      const el =
        document.querySelector(`meta[property="${name}"]`) ||
        document.querySelector(`meta[name="${name}"]`);
      return el ? el.getAttribute('content') : null;
    };
    return {
      ogTitle: get('og:title'),
      ogDescription: get('og:description'),
      ogImage: get('og:image'),
      ogUrl: get('og:url'),
      description: get('description'),
    };
  });
}

/** The rendered page's visible text. */
async function readBodyText(page) {
  return page.evaluate(() => (document.body ? document.body.innerText : ''));
}

/** Parsed application/ld+json blocks, malformed ones skipped. */
async function readJsonLd(page) {
  const blocks = await page.evaluate(() =>
    [...document.querySelectorAll('script[type="application/ld+json"]')].map((s) => s.textContent || '')
  );

  const parsed = [];
  for (const block of blocks) {
    try {
      const data = JSON.parse(block);
      parsed.push(...(Array.isArray(data) ? data : [data]));
    } catch {
      // A broken block must not hide the valid ones.
    }
  }
  return parsed;
}

/* ------------------------------------------------------------------ *
 * Raw HTML (no JavaScript)
 * ------------------------------------------------------------------ */

/**
 * Fetch a URL over plain HTTP and return the body.
 *
 * No JavaScript runs, so client-side login walls never appear. Uses
 * Playwright's request context rather than adding an HTTP dependency.
 *
 * @param {import('playwright-core').Page} page
 * @param {string} url
 * @param {{userAgent?: string, timeout?: number}} [opts]
 * @returns {Promise<{status: number, html: string}>}
 */
async function fetchRawHtml(page, url, opts = {}) {
  const response = await page.request.get(url, {
    headers: {
      'User-Agent': opts.userAgent || PLAIN_CLIENT_UA,
      'Accept-Language': 'en-US,en;q=0.9',
    },
    timeout: opts.timeout || 20000,
    maxRedirects: 5,
  });

  const html = await response.text();
  return { status: response.status(), html };
}

/**
 * Read a meta tag out of a raw HTML string, without assuming attribute order.
 * @param {string} html
 * @param {string} name e.g. 'og:description'
 */
function metaFromHtml(html, name) {
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const patterns = [
    new RegExp(`<meta[^>]+(?:property|name)=["']${escaped}["'][^>]+content=["']([^"']*)["']`, 'i'),
    new RegExp(`<meta[^>]+content=["']([^"']*)["'][^>]+(?:property|name)=["']${escaped}["']`, 'i'),
  ];

  for (const re of patterns) {
    const m = html.match(re);
    if (m) return decodeHtmlEntities(cleanText(m[1]));
  }
  return null;
}

/**
 * Decode the entities that appear in server-rendered meta content.
 * Facebook in particular emits numeric entities (&#xb7; for the separator).
 */
function decodeHtmlEntities(str) {
  if (!str) return str;
  return str
    .replace(/&#x([0-9a-f]+);/gi, (_, hex) => String.fromCodePoint(parseInt(hex, 16)))
    .replace(/&#(\d+);/g, (_, dec) => String.fromCodePoint(Number(dec)))
    .replace(/&quot;/g, '"')
    .replace(/&#0?39;/g, "'")
    .replace(/&apos;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&');
}

/* ------------------------------------------------------------------ *
 * Pattern helpers
 * ------------------------------------------------------------------ */

/**
 * Pull "<number> <label>" out of a blob of text.
 * Handles "38K followers", "2,022 likes", "566 videos", "4.15K subscribers".
 *
 * @param {string} text
 * @param {string} label word following the number, e.g. 'followers'
 * @returns {{v: string, approx: boolean}|null}
 */
function countBefore(text, label) {
  if (!text) return null;
  const m = text.match(new RegExp('([\\d.,]+\\s*[KMB]?)\\s*' + label, 'i'));
  return m ? parseCount(m[1]) : null;
}

/**
 * Extract a handle (@name) from text or a URL path.
 * @param {string} source
 */
function handleFrom(source) {
  if (!source) return null;
  const at = source.match(/@([A-Za-z0-9._-]+)/);
  if (at) return at[1];
  return null;
}

/** First non-null value, or null. */
function firstOf(...values) {
  for (const v of values) if (v !== null && v !== undefined && v !== '') return v;
  return null;
}

module.exports = {
  PLAIN_CLIENT_UA,
  readMetaTags,
  readBodyText,
  readJsonLd,
  fetchRawHtml,
  metaFromHtml,
  decodeHtmlEntities,
  countBefore,
  handleFrom,
  firstOf,
  // re-exported so platform modules import from one place
  field,
  parseCount,
  cleanText,
};
