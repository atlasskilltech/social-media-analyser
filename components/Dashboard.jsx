'use client';

import { useCallback, useEffect, useState } from 'react';
import InstagramCard from './InstagramCard';
import Toast from './Toast';

/**
 * Dashboard container.
 *
 * Owns data fetching and refresh state; the cards stay presentational.
 * A failed refresh never clears what is already on screen — the API returns
 * the last good data alongside the error, and we simply keep displaying it.
 */
export default function Dashboard() {
  const [instagram, setInstagram] = useState(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [toast, setToast] = useState(null);

  const dismissToast = useCallback(() => setToast(null), []);

  // Initial load — read whatever the scraper last wrote.
  useEffect(() => {
    let cancelled = false;

    (async () => {
      try {
        const res = await fetch('/api/social/instagram');
        const body = await res.json();
        if (cancelled) return;

        // A 404 simply means nothing has been scraped yet; that is not an error
        // worth a toast, the card renders its own "No data available" state.
        if (res.ok && body.data) setInstagram(body.data);
      } catch {
        if (!cancelled) setToast({ tone: 'error', message: 'Unable to load Instagram data.' });
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, []);

  /** Trigger a scrape and swap in the fresh data when it lands. */
  const handleRefresh = useCallback(async () => {
    setRefreshing(true);
    setToast(null);

    try {
      const res = await fetch('/api/social/instagram/refresh', { method: 'POST' });
      const body = await res.json();

      if (res.ok && body.ok) {
        setInstagram(body.data);
        setToast({ tone: 'ok', message: 'Instagram data updated.' });
        return;
      }

      // Cooldown is a guard, not a failure — say so plainly.
      if (res.status === 429) {
        setToast({
          tone: 'warn',
          message: `Please wait ${body.retryAfter ?? 60}s before refreshing again.`,
        });
      } else {
        // Surface where it broke rather than a bare "something went wrong".
        // The full structured payload goes to the console for debugging.
        console.error('[refresh] failed', body);
        setToast({
          tone: 'error',
          message: body.stage
            ? `Unable to refresh Instagram — failed at "${body.stage}": ${body.error}`
            : 'Unable to refresh Instagram.',
        });
      }

      // Both paths return the last good data; keep showing it.
      if (body.data) setInstagram(body.data);
    } catch {
      setToast({ tone: 'error', message: 'Unable to refresh Instagram.' });
    } finally {
      setRefreshing(false);
    }
  }, []);

  return (
    <main className="mx-auto max-w-5xl px-5 py-12">
      <header className="mb-7">
        <h1 className="text-2xl font-bold tracking-tight">Social Media Dashboard</h1>
        <p className="mt-1 text-sm text-ink-soft">
          ATLAS SkillTech University — public profile data
        </p>
      </header>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        <InstagramCard
          data={instagram}
          loading={loading}
          refreshing={refreshing}
          onRefresh={handleRefresh}
        />
      </div>

      <Toast message={toast?.message} tone={toast?.tone} onDismiss={dismissToast} />
    </main>
  );
}
