'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import PlatformCard from './PlatformCard';
import RefreshModal from './RefreshModal';
import Toast from './Toast';
import { Spinner } from './icons';

/**
 * Dashboard container.
 *
 * Owns data fetching and refresh state; cards stay presentational. One
 * "Refresh All" button starts a single job covering every platform, and a modal
 * reports live progress. A failed platform never clears what is already on
 * screen — the cache keeps the last good record.
 */
export default function Dashboard() {
  const [platforms, setPlatforms] = useState([]);
  const [refresh, setRefresh] = useState(null);
  const [loading, setLoading] = useState(true);
  const [starting, setStarting] = useState(false);
  const [modalOpen, setModalOpen] = useState(false);
  const [toast, setToast] = useState(null);

  const dismissToast = useCallback(() => setToast(null), []);
  const closeModal = useCallback(() => setModalOpen(false), []);

  const labels = Object.fromEntries(platforms.map((p) => [p.platform, p.label]));

  /*
   * The polling callback is created once, so reading `labels` from its closure
   * captures the empty first render. A ref always holds the current map.
   */
  const labelsRef = useRef(labels);
  labelsRef.current = labels;

  const running = Boolean(refresh?.running) || starting;

  /**
   * Pull every platform's cached record — used for the initial paint only.
   * `cache: 'no-store'` so a browser or proxy cache can never satisfy this.
   */
  const load = useCallback(async () => {
    try {
      const res = await fetch('/api/social', { cache: 'no-store' });
      const body = await res.json();
      if (body.success) setPlatforms(body.platforms);
    } catch {
      setToast({ tone: 'error', message: 'Unable to load dashboard data.' });
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  /**
   * Refresh every active platform.
   *
   * The fresh records come back in this response and are applied straight to
   * state. Nothing is re-read from the cache afterwards — that round trip is
   * exactly what showed stale data on serverless, where the read can be served
   * by a different instance than the one that did the write.
   */
  const handleRefreshAll = async () => {
    setStarting(true);
    setToast(null);
    // Open immediately — the modal must appear on click, not after the round trip.
    setModalOpen(true);
    setRefresh({ running: true, startedAt: new Date().toISOString(), platforms: pendingProgress() });

    try {
      const res = await fetch('/api/refresh', {
        method: 'POST',
        cache: 'no-store',
        headers: { 'Cache-Control': 'no-cache' },
      });
      const body = await res.json();

      if (!body.success) {
        setModalOpen(false);
        setToast({ tone: 'error', message: body.error || 'Unable to refresh.' });
        return;
      }

      // Drive the modal from the completed result.
      setRefresh({
        running: false,
        startedAt: null,
        finishedAt: new Date().toISOString(),
        totalMs: body.totalMs,
        platforms: body.platforms,
      });

      /*
       * Apply the returned records directly. This is the fix for stale data:
       * the UI renders what the API just returned rather than asking for it
       * again and hoping the same instance answers.
       */
      setPlatforms((prev) =>
        prev.map((p) => {
          const fresh = body.platforms?.[p.platform];
          return fresh?.data ? { ...p, data: fresh.data, hasData: true } : p;
        })
      );

      const failed = Object.entries(body.platforms || {}).filter(([, i]) => i.state !== 'success');
      if (failed.length) {
        setToast({
          tone: 'warn',
          message: failed
            .map(([name, i]) => `${labelsRef.current[name] || name}: ${i.error || 'failed'}`)
            .join(' · '),
        });
      } else {
        setToast({ tone: 'ok', message: body.message });
      }
    } catch {
      setModalOpen(false);
      setToast({ tone: 'error', message: 'Unable to refresh.' });
    } finally {
      setStarting(false);
    }
  };

  /** Every active platform marked pending, for the modal's first paint. */
  function pendingProgress() {
    return Object.fromEntries(
      platforms.map((p) => [p.platform, { state: 'running', ms: null, error: null }])
    );
  }

  /*
   * Only the in-flight state disables the button. There is no cooldown: with
   * the Graph API every click may fetch fresh data.
   */
  const blocked = running;

  return (
    <main className="mx-auto max-w-6xl px-4 py-10 sm:px-5 sm:py-12">
      <header className="mb-7 flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0">
          <h1 className="text-xl font-bold tracking-tight sm:text-2xl">Social Media Dashboard</h1>
          <p className="mt-1 text-sm text-ink-soft">
            ATLAS SkillTech University — public profile data
          </p>
        </div>

        <button
          type="button"
          onClick={handleRefreshAll}
          disabled={blocked}
          className="flex w-full cursor-pointer items-center justify-center gap-2 rounded-lg bg-ink px-5 py-2.5 text-sm font-semibold text-canvas transition hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50 sm:w-auto"
        >
          {running && <Spinner />}
          {running ? 'Refreshing…' : 'Refresh All'}
        </button>
      </header>

      {toast && <Toast message={toast.message} tone={toast.tone} onDismiss={dismissToast} />}

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {loading
          ? [0, 1].map((i) => (
              <PlatformCard
                key={i}
                payload={{ platform: 'instagram', label: '', profileUrl: '#', data: null }}
                loading
              />
            ))
          : platforms.map((p) => (
              <PlatformCard
                key={p.platform}
                payload={p}
                loading={false}
                busy={refresh?.platforms?.[p.platform]?.state === 'running'}
              />
            ))}
      </div>

      <footer className="mt-9 text-center text-xs text-ink-soft">
        Next.js · Playwright — public data only, no login required
      </footer>

      <RefreshModal open={modalOpen} refresh={refresh} labels={labels} onClose={closeModal} />
    </main>
  );
}
