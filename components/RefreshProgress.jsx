'use client';

import { Spinner } from './icons';

/** Per-platform tick list shown while a refresh runs. */
const MARKS = {
  pending: { glyph: '·', className: 'text-ink-soft' },
  running: { glyph: null, className: 'text-ink-soft' }, // spinner instead
  done: { glyph: '✓', className: 'text-emerald-600 dark:text-emerald-400' },
  failed: { glyph: '✗', className: 'text-red-600 dark:text-red-400' },
};

/**
 * Refresh progress readout.
 *
 * Shows every platform with its own state, so a failure is visible as one ✗
 * beside three ✓ rather than collapsing the whole run into "error".
 *
 * @param {{platforms: Record<string, {state, status, error}>, labels: Record<string,string>, running: boolean}} props
 */
export default function RefreshProgress({ platforms, labels, running }) {
  const entries = Object.entries(platforms || {});
  if (!entries.length) return null;

  return (
    <div className="mb-5 rounded-card border border-line bg-surface p-4 shadow-card">
      <p className="mb-3 flex items-center gap-2 text-sm font-semibold">
        {running && <Spinner />}
        {running ? 'Refreshing…' : 'Last refresh'}
      </p>

      <ul className="grid gap-1.5 sm:grid-cols-2 lg:grid-cols-4">
        {entries.map(([platform, info]) => {
          const mark = MARKS[info.state] || MARKS.pending;
          return (
            <li key={platform} className="flex items-center gap-2 text-sm">
              <span className={`w-4 text-center font-bold ${mark.className}`}>
                {info.state === 'running' ? <Spinner className="!size-3" /> : mark.glyph}
              </span>
              <span className={info.state === 'pending' ? 'text-ink-soft' : ''}>
                {labels[platform] || platform}
              </span>
              {info.state === 'failed' && info.status === 'blocked' && (
                <span className="text-xs text-ink-soft">(blocked)</span>
              )}
            </li>
          );
        })}
      </ul>

      {/* Surface the reason for any failure rather than only a ✗. */}
      {entries.some(([, i]) => i.state === 'failed' && i.error) && (
        <ul className="mt-3 space-y-1 border-t border-line pt-3">
          {entries
            .filter(([, i]) => i.state === 'failed' && i.error)
            .map(([platform, i]) => (
              <li key={platform} className="text-xs text-ink-soft">
                <span className="font-semibold">{labels[platform] || platform}:</span> {i.error}
              </li>
            ))}
        </ul>
      )}
    </div>
  );
}
