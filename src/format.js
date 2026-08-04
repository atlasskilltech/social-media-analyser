/**
 * Display formatting helpers.
 *
 * The scrapers store exact integers as strings ("38016"); all rounding for
 * human eyes happens here, so the stored data stays precise.
 */

/** "38016" -> "38,016". Non-numeric values pass through; empty becomes an em dash. */
export function formatCount(value) {
  if (value === null || value === undefined || value === '') return '—';
  const n = Number(value);
  return Number.isFinite(n) ? n.toLocaleString('en-US') : String(value);
}

/** "38016" -> "38K". Used where space is tight. */
export function compactCount(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return formatCount(value);
  if (n < 1000) return String(n);
  if (n < 1_000_000) return (n / 1000).toFixed(n < 10_000 ? 1 : 0).replace(/\.0$/, '') + 'K';
  return (n / 1_000_000).toFixed(1).replace(/\.0$/, '') + 'M';
}

/** Seconds since an event -> "just now" / "4 minutes ago" / "2 days ago". */
export function timeAgo(seconds) {
  if (seconds === null || seconds === undefined) return 'never';
  if (seconds < 10) return 'just now';
  if (seconds < 60) return `${Math.floor(seconds)} seconds ago`;
  if (seconds < 3600) {
    const m = Math.floor(seconds / 60);
    return `${m} minute${m === 1 ? '' : 's'} ago`;
  }
  if (seconds < 86400) {
    const h = Math.floor(seconds / 3600);
    return `${h} hour${h === 1 ? '' : 's'} ago`;
  }
  const d = Math.floor(seconds / 86400);
  return `${d} day${d === 1 ? '' : 's'} ago`;
}

/** ISO timestamp -> local date/time string, or '—'. */
export function formatTimestamp(iso) {
  if (!iso) return '—';
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? '—' : date.toLocaleString();
}
