'use client';

import { PLATFORM_META, STATUS_STYLES } from './platformMeta';
import { formatCount, timeAgo, formatTimestamp } from '@/utils/format';

/**
 * One platform card — identical layout for all four.
 *
 * Everything platform-specific comes from PLATFORM_META, so this component has
 * no branching per platform and adding a fifth needs no changes here.
 *
 * @param {{
 *   payload: {platform, label, profileUrl, hasData, data},
 *   loading: boolean,
 *   busy: boolean
 * }} props
 */
export default function PlatformCard({ payload, loading, busy }) {
  const { platform, label, profileUrl, data } = payload;
  const meta = PLATFORM_META[platform];
  const Icon = meta.icon;

  if (loading) {
    return (
      <article className="animate-pulse rounded-card border border-line bg-surface p-5 shadow-card">
        <div className="h-4 w-24 rounded bg-line" />
        <div className="mt-5 flex items-center gap-3">
          <div className="size-14 rounded-full bg-line" />
          <div className="flex-1 space-y-2">
            <div className="h-4 w-32 rounded bg-line" />
            <div className="h-3 w-44 rounded bg-line" />
          </div>
        </div>
        <div className="mt-5 grid grid-cols-3 gap-2.5">
          {[0, 1, 2].map((i) => (
            <div key={i} className="h-16 rounded-xl bg-line" />
          ))}
        </div>
      </article>
    );
  }

  const hasData = Boolean(data);
  const status = hasData ? data.status || 'success' : 'none';
  const badge = STATUS_STYLES[status] || STATUS_STYLES.none;
  const title = hasData ? meta.title(data) : null;
  const subtitle = hasData ? meta.subtitle(data) : null;

  return (
    <article className="relative flex flex-col overflow-hidden rounded-card border border-line bg-surface p-5 shadow-card">
      {/* Brand accent along the top edge */}
      <div className={`absolute inset-x-0 top-0 h-1 ${meta.accent}`} aria-hidden="true" />

      <header className="mb-4 flex items-center gap-2">
        <Icon className={`size-5 ${meta.text}`} />
        <span className="text-[13px] font-semibold">{label}</span>
        <span
          className={`ml-auto rounded-full px-2.5 py-0.5 text-[10.5px] font-bold tracking-wide uppercase ${badge.className}`}
        >
          {busy ? 'Refreshing…' : badge.label}
        </span>
      </header>

      {!hasData ? (
        <div className="my-auto py-8 text-center">
          <p className="text-sm font-semibold text-ink-soft">No data available.</p>
          <p className="mt-1 text-xs text-ink-soft">Press “Refresh All” to run the scrapers.</p>
        </div>
      ) : (
        <>
          <div className="mb-5 flex items-center gap-3.5">
            {data.profileImage ? (
              /*
               * Plain <img>, not next/image: these are signed CDN URLs that
               * expire, and the optimizer would fetch and cache them
               * server-side where they 403. Browsers load them fine as long as
               * no referer is sent.
               */
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={data.profileImage}
                alt={`${title || label} profile`}
                referrerPolicy="no-referrer"
                loading="lazy"
                className={`size-14 shrink-0 rounded-full border-2 object-cover ${meta.border}`}
              />
            ) : (
              <div className={`size-14 shrink-0 rounded-full border-2 border-dashed bg-canvas ${meta.border}`} />
            )}

            <div className="min-w-0">
              <h2 className="text-[15.5px] leading-tight font-semibold break-words">
                {title || label}
              </h2>
              {subtitle && (
                <p className="mt-1 line-clamp-2 text-xs whitespace-pre-line text-ink-soft">{subtitle}</p>
              )}
            </div>
          </div>

          <dl
            className="grid gap-2.5"
            style={{ gridTemplateColumns: `repeat(${meta.metrics.length}, minmax(0, 1fr))` }}
          >
            {meta.metrics.map(({ label: metricLabel, key }) => (
              <div key={key} className="rounded-xl border border-line bg-canvas px-1.5 py-3 text-center">
                <dt className="text-[10.5px] font-semibold tracking-wide text-ink-soft uppercase">
                  {metricLabel}
                </dt>
                <dd className="mt-0.5 text-lg font-bold tabular-nums">{formatCount(data[key])}</dd>
              </div>
            ))}
          </dl>
        </>
      )}

      {/*
        A record whose last scrape did not succeed is still showing the previous
        good values — say so, rather than letting stale numbers look live.
      */}
      {hasData && status !== 'success' && (
        <p className="mt-3 rounded-lg bg-amber-50 px-2.5 py-1.5 text-center text-[11px] font-semibold text-amber-700 dark:bg-amber-950 dark:text-amber-300">
          Showing Cached Data
        </p>
      )}

      <footer className="mt-auto flex items-center justify-between gap-3 border-t border-line pt-3.5">
        <span className="text-xs text-ink-soft" title={hasData ? formatTimestamp(data.lastUpdated) : ''}>
          {hasData && data.lastUpdated ? `Updated ${timeAgo(data.lastUpdated)}` : 'Never updated'}
        </span>
        <a
          href={profileUrl}
          target="_blank"
          rel="noopener noreferrer"
          className={`text-xs font-semibold hover:underline ${meta.text}`}
        >
          Visit Profile ↗
        </a>
      </footer>
    </article>
  );
}
