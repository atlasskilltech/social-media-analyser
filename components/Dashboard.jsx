'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import PlatformCard from './PlatformCard';
import RefreshProgress from './RefreshProgress';
import Toast from './Toast';
import { Spinner } from './icons';

/** How often to poll while a refresh runs. */
const POLL_INTERVAL_MS = 1500;

/**
 * Dashboard container.
 *
 * Owns data fetching and refresh state; cards stay presentational. One
 * "Refresh All" button starts a single job covering every platform, and the
 * progress readout updates as each finishes. A failed platform never clears
 * what is already on screen — the cache keeps the last good record.
 */
export default function Dashboard() {
  const [platforms, setPlatforms] = useState([]);
  const [refresh, setRefresh] = useState(null);
  const [loading, setLoading] = useState(true);
  const [starting, setStarting] = useState(false);
  const [toast, setToast] = useState(null);

  const pollTimer = useRef(null);
  const dismissToast = useCallback(() => setToast(null), []);

  const labels = Object.fromEntries(platforms.map((p) => [p.platform, p.label]));

  /*
   * The polling callback is created once, so reading `labels` from its closure
   * captures the empty first render and toasts show raw ids ("linkedin"
   * instead of "LinkedIn"). A ref always holds the current map.
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

  useEffect(() => {
    load();
    // Pick up a refresh that was already running when the page opened.
    fetch('/api/refresh')
      .then((r) => r.json())
      .then((b) => {
        if (b.success) {
          setRefresh(b.refresh);
          if (b.refresh.running) startPolling();
        }
      })
      .catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [load]);

  useEffect(() => () => clearInterval(pollTimer.current), []);

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
          await load();

          const entries = Object.entries(body.refresh.platforms || {});
          const failed = entries.filter(([, i]) => i.state === 'failed');

          setToast(
            failed.length
              ? {
                  tone: 'warn',
                  message: `Refreshed ${entries.length - failed.length} of ${entries.length}. Previous data kept for: ${failed
                    .map(([name]) => labelsRef.current[name] || name)
                    .join(', ')}.`,
                }
              : { tone: 'ok', message: 'All platforms updated.' }
          );
        }
      } catch (err) {
        clearInterval(pollTimer.current);
        setToast({ tone: 'error', message: err.message });
      }
    }, POLL_INTERVAL_MS);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [load]);

  /** Start a refresh of all four platforms. */
  const handleRefreshAll = async () => {
    setStarting(true);
    setToast(null);

    try {
      const res = await fetch('/api/refresh', { method: 'POST' });
      const body = await res.json();

      if (res.status === 202) {
        setRefresh(body.refresh);
        startPolling();
        return;
      }

      // A cooldown or an already-running job is a guard, not a failure.
      if (res.status === 429) {
        setToast({
          tone: 'warn',
          message: body.message || 'Please wait before refreshing again.',
        });
      } else if (res.status === 409) {
        setToast({ tone: 'info', message: body.message });
        setRefresh(body.refresh);
        startPolling();
      } else {
        setToast({ tone: 'error', message: body.error || 'Unable to start refresh.' });
      }
    } catch {
      setToast({ tone: 'error', message: 'Unable to start refresh.' });
    } finally {
      setStarting(false);
    }
  };

  const cooldown = refresh?.cooldownRemaining ?? 0;
  const blocked = running || cooldown > 0;

  return (
    <main className="mx-auto max-w-6xl px-5 py-12">
      <header className="mb-7 flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Social Media Dashboard</h1>
          <p className="mt-1 text-sm text-ink-soft">
            ATLAS SkillTech University — public profile data
          </p>
        </div>

        <button
          type="button"
          onClick={handleRefreshAll}
          disabled={blocked}
          className="flex cursor-pointer items-center gap-2 rounded-lg bg-ink px-5 py-2.5 text-sm font-semibold text-canvas transition hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {running && <Spinner />}
          {running ? 'Refreshing…' : cooldown > 0 ? `Cooldown ${cooldown}s` : 'Refresh All'}
        </button>
      </header>

      {refresh?.platforms && Object.keys(refresh.platforms).length > 0 && (
        <RefreshProgress platforms={refresh.platforms} labels={labels} running={running} />
      )}

      {toast && <Toast message={toast.message} tone={toast.tone} onDismiss={dismissToast} />}

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {loading
          ? [0, 1, 2, 3].map((i) => (
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
    </main>
  );
}
