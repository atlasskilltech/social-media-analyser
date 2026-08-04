'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import PlatformCard from './PlatformCard';
import RefreshModal from './RefreshModal';
import Toast from './Toast';
import { Spinner } from './icons';

/**
 * How often to poll while a refresh runs.
 *
 * Faster than the old 1.5s: platforms run in parallel now and can finish within
 * a couple of seconds of each other, so a slow poll would make several rows
 * flip at once instead of progressing visibly.
 */
const POLL_INTERVAL_MS = 600;

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

  const pollTimer = useRef(null);
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

  /** Pull every platform's cached record. */
  const load = useCallback(async () => {
    try {
      const res = await fetch('/api/social');
      const body = await res.json();
      if (body.success) setPlatforms(body.platforms);
    } catch {
      setToast({ tone: 'error', message: 'Unable to load dashboard data.' });
    } finally {
      setLoading(false);
    }
  }, []);

  /** Poll until the job finishes, then reload every card at once. */
  const startPolling = useCallback(() => {
    clearInterval(pollTimer.current);

    pollTimer.current = setInterval(async () => {
      try {
        const res = await fetch('/api/refresh');
        const body = await res.json();
        if (!body.success) return;

        setRefresh(body.refresh);

        if (!body.refresh.running) {
          clearInterval(pollTimer.current);
          // Refresh the cards behind the modal so they are current when it closes.
          await load();

          const entries = Object.entries(body.refresh.platforms || {});
          const failed = entries.filter(([, i]) => i.state !== 'success');

          if (failed.length) {
            setToast({
              tone: 'warn',
              message: `Refreshed ${entries.length - failed.length} of ${entries.length}. Previous data kept for: ${failed
                .map(([name]) => labelsRef.current[name] || name)
                .join(', ')}.`,
            });
          }
        }
      } catch (err) {
        clearInterval(pollTimer.current);
        setToast({ tone: 'error', message: err.message });
      }
    }, POLL_INTERVAL_MS);
  }, [load]);

  useEffect(() => {
    load();
    // Pick up a refresh that was already running when the page opened.
    fetch('/api/refresh')
      .then((r) => r.json())
      .then((b) => {
        if (b.success) {
          setRefresh(b.refresh);
          if (b.refresh.running) {
            setModalOpen(true);
            startPolling();
          }
        }
      })
      .catch(() => {});
  }, [load, startPolling]);

  useEffect(() => () => clearInterval(pollTimer.current), []);

  /** Start a refresh of all platforms. */
  const handleRefreshAll = async () => {
    setStarting(true);
    setToast(null);
    // Open immediately — the modal must appear on click, not after the round trip.
    setModalOpen(true);

    try {
      const res = await fetch('/api/refresh', { method: 'POST' });
      const body = await res.json();

      if (res.status === 202) {
        setRefresh(body.refresh);
        startPolling();
        return;
      }

      // A refresh already in flight is not a failure — join it.
      if (res.status === 409) {
        setRefresh(body.refresh);
        startPolling();
      } else {
        setModalOpen(false);
        setToast({ tone: 'error', message: body.error || 'Unable to start refresh.' });
      }
    } catch {
      setModalOpen(false);
      setToast({ tone: 'error', message: 'Unable to start refresh.' });
    } finally {
      setStarting(false);
    }
  };

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
