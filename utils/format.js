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

/** ISO timestamp -> "just now" / "4 minutes ago" / "2 days ago". */
export function timeAgo(iso) {
  if (!iso) return 'never';

  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return 'never';

  const seconds = Math.max(0, (Date.now() - then) / 1000);

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

/** ISO timestamp -> local date/time string, used for tooltips. */
export function formatTimestamp(iso) {
  if (!iso) return '—';
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? '—' : date.toLocaleString();
}
