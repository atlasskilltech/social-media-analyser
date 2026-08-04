'use strict';

/**
 * Small pure helpers shared by every scraper.
 *
 * The central idea here is the "field" wrapper. Different extraction
 * strategies disagree on precision: Instagram's meta tags say "38K followers"
 * while its embedded JSON says 38015. Both are correct, one is better. So each
 * strategy returns values tagged with whether they are approximate, and
 * mergePartials() lets an exact value upgrade an approximate one.
 */

/**
 * Wrap an extracted value with its confidence.
 * @param {*} value
 * @param {boolean} approx true when the number was rounded at the source ("38K")
 * @returns {{v: string, approx: boolean}|null} null when the value is unusable
 */
function field(value, approx = false) {
  if (value === null || value === undefined) return null;
  const v = String(value).trim();
  if (!v) return null;
  return { v, approx: Boolean(approx) };
}

/**
 * Parse a human-readable count into an exact integer string.
 * Handles "38015", "4,570", "38K", "1.2M", "3.4 B" and numeric input.
 * @param {string|number} raw
 * @returns {{v: string, approx: boolean}|null}
 */
function parseCount(raw) {
  if (raw === null || raw === undefined) return null;

  if (typeof raw === 'number') {
    return Number.isFinite(raw) ? field(String(Math.trunc(raw)), false) : null;
  }

  // Normalise non-breaking spaces and unicode digits separators.
  const s = String(raw).replace(/ /g, ' ').trim();
  const m = s.match(/(\d[\d.,\s]*)\s*([KMB])?/i);
  if (!m) return null;

  const suffix = (m[2] || '').toUpperCase();
  const numPart = m[1].replace(/\s/g, '');

  if (suffix) {
    // With a suffix, a dot is a real decimal point: "1.2M" -> 1200000.
    const n = parseFloat(numPart.replace(/,/g, ''));
    if (!Number.isFinite(n)) return null;
    const mult = suffix === 'K' ? 1e3 : suffix === 'M' ? 1e6 : 1e9;
    // Flagged approximate: the source rounded it before we ever saw it.
    return field(String(Math.round(n * mult)), true);
  }

  // No suffix: separators are thousands separators. "4,570" -> 4570.
  const digits = numPart.replace(/[.,]/g, '');
  if (!/^\d+$/.test(digits)) return null;
  return field(digits, false);
}

/**
 * Collapse whitespace and trim. Returns '' for nullish input.
 * @param {string} s
 */
function cleanText(s) {
  if (s === null || s === undefined) return '';
  return String(s).replace(/\s+/g, ' ').trim();
}

/**
 * Decode a raw JSON string body (the bit between the quotes) into plain text.
 * Used when we regex values out of an embedded JSON blob.
 * @param {string} raw
 */
function decodeJsonString(raw) {
  try {
    return JSON.parse('"' + raw + '"');
  } catch {
    return raw;
  }
}

/**
 * Merge a strategy's partial result into the accumulator.
 *
 * Rules:
 *   - an empty accumulator slot is always filled
 *   - an approximate value is upgraded by a later exact value
 *   - an exact value is never downgraded
 *
 * @param {Object} acc   accumulator of {key: {v, approx}}
 * @param {Object} partial
 * @param {string} source strategy name, recorded for logging
 * @returns {string[]} the keys this partial actually contributed
 */
function mergePartials(acc, partial, source) {
  const contributed = [];
  for (const [key, val] of Object.entries(partial || {})) {
    if (!val || !val.v) continue;

    const current = acc[key];
    const isNew = !current;
    const isUpgrade = current && current.approx && !val.approx;

    if (isNew || isUpgrade) {
      acc[key] = { ...val, source };
      contributed.push(key);
    }
  }
  return contributed;
}

/**
 * Flatten the {v, approx, source} accumulator down to plain strings for JSON.
 * @param {Object} acc
 * @param {string[]} keys the exact keys (and order) the output file should have
 */
function finalize(acc, keys) {
  const out = {};
  for (const key of keys) out[key] = acc[key] ? acc[key].v : '';
  return out;
}

/** Current time as an ISO-8601 string. */
function nowIso() {
  return new Date().toISOString();
}

module.exports = {
  field,
  parseCount,
  cleanText,
  decodeJsonString,
  mergePartials,
  finalize,
  nowIso,
};
