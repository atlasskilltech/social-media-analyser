'use client';

import { InstagramIcon, Spinner } from './icons';
import { formatCount, timeAgo, formatTimestamp } from '@/utils/format';

/**
 * Instagram profile card — presentational only.
 *
 * State and data fetching live in the parent so this stays reusable; the same
 * shape works for the other three platforms when they are built.
 *
 * @param {{
 *   data: Object|null,
 *   loading: boolean,
 *   refreshing: boolean,
 *   onRefresh: () => void
 * }} props
 */
export default function InstagramCard({ data, loading, refreshing, onRefresh }) {
  if (loading) {
    return (
      <article className="animate-pulse rounded-card border border-line bg-surface p-5 shadow-card">
        <div className="h-4 w-24 rounded bg-line" />
        <div className="mt-5 flex items-center gap-3">
          <div className="size-14 rounded-full bg-line" />
          <div className="flex-1 space-y-2">
            <div className="h-4 w-40 rounded bg-line" />
            <div className="h-3 w-52 rounded bg-line" />
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

  const stats = [
    { label: 'Followers', value: data?.followers },
    { label: 'Following', value: data?.following },
    { label: 'Posts', value: data?.posts },
  ];

  return (
    <article className="relative overflow-hidden rounded-card border border-line bg-surface p-5 shadow-card">
      {/* Brand accent along the top edge */}
      <div className="absolute inset-x-0 top-0 h-1 bg-linear-to-r from-[#833AB4] via-brand-ig to-[#F77737]" />

      <header className="mb-4 flex items-center gap-2">
        <InstagramIcon className="size-5 text-brand-ig" />
        <span className="text-[13px] font-semibold">Instagram</span>
        <span
          className={`ml-auto rounded-full px-2.5 py-0.5 text-[10.5px] font-bold tracking-wide uppercase ${
            hasData
              ? 'bg-emerald-50 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300'
              : 'bg-amber-50 text-amber-700 dark:bg-amber-950 dark:text-amber-300'
          }`}
        >
          {refreshing ? 'Refreshing…' : hasData ? 'Live' : 'No data'}
        </span>
      </header>

      {!hasData ? (
        <div className="py-8 text-center">
          <p className="text-sm font-semibold text-ink-soft">No data available.</p>
          <p className="mt-1 text-xs text-ink-soft">Press Refresh to run the scraper.</p>
        </div>
      ) : (
        <>
          <div className="mb-5 flex items-center gap-3.5">
            {data.profileImage ? (
              /*
               * A plain <img>, not next/image, and deliberately so: these are
               * signed Instagram CDN URLs that expire, and the optimizer would
               * fetch and cache them server-side where they 403. The browser
               * loads them fine as long as no referer is sent.
               */
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={data.profileImage}
                alt={`${data.username} profile`}
                referrerPolicy="no-referrer"
                loading="lazy"
                className="size-14 shrink-0 rounded-full border-2 border-brand-ig object-cover"
              />
            ) : (
              <div className="size-14 shrink-0 rounded-full border-2 border-dashed border-brand-ig bg-canvas" />
            )}

            <div className="min-w-0">
              <h2 className="text-[15.5px] leading-tight font-semibold break-words">
                @{data.username}
              </h2>
              {data.bio && (
                <p className="mt-1 line-clamp-2 text-xs whitespace-pre-line text-ink-soft">
                  {data.bio}
                </p>
              )}
            </div>
          </div>

          <dl className="grid grid-cols-3 gap-2.5">
            {stats.map(({ label, value }) => (
              <div
                key={label}
                className="rounded-xl border border-line bg-canvas px-1.5 py-3 text-center"
              >
                <dt className="text-[10.5px] font-semibold tracking-wide text-ink-soft uppercase">
                  {label}
                </dt>
                <dd className="mt-0.5 text-lg font-bold tabular-nums">{formatCount(value)}</dd>
              </div>
            ))}
          </dl>
        </>
      )}

      <footer className="mt-5 flex items-center justify-between gap-3 border-t border-line pt-3.5">
        <span className="text-xs text-ink-soft" title={hasData ? formatTimestamp(data.lastUpdated) : ''}>
          {hasData ? `Updated ${timeAgo(data.lastUpdated)}` : ''}
        </span>
        {data?.url && (
          <a
            href={data.url}
            target="_blank"
            rel="noopener noreferrer"
            className="text-xs font-semibold text-brand-ig hover:underline"
          >
            Visit ↗
          </a>
        )}
      </footer>

      <button
        type="button"
        onClick={onRefresh}
        disabled={refreshing}
        className="mt-4 flex w-full cursor-pointer items-center justify-center gap-2 rounded-lg bg-ink px-4 py-2.5 text-sm font-semibold text-canvas transition hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"
      >
        {refreshing && <Spinner />}
        {refreshing ? 'Scraping…' : 'Refresh'}
      </button>
    </article>
  );
}
