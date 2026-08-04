import { useCallback, useEffect, useRef, useState } from 'react';
import { fetchData, fetchStatus, triggerRefresh } from './api.js';
import PlatformCard from './components/PlatformCard.jsx';
import { timeAgo } from './format.js';

/** How often to poll the API while a scrape is running. */
const POLL_INTERVAL_MS = 2000;

export default function App() {
  const [payload, setPayload] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [notice, setNotice] = useState(null);
  const [cooldown, setCooldown] = useState(0);

  const pollTimer = useRef(null);

  /** Pull the full dashboard payload and sync the cooldown counter. */
  const load = useCallback(async () => {
    try {
      const data = await fetchData();
      setPayload(data);
      setCooldown(data.refresh.cooldownRemaining);
      setError(null);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  /*
   * Local cooldown countdown.
   *
   * Purely cosmetic — it keeps the button label ticking without hammering the
   * API once a second. The server enforces the real limit and rejects an early
   * request with 429 regardless of what this counter says.
   */
  useEffect(() => {
    if (cooldown <= 0) return undefined;
    const id = setInterval(() => setCooldown((c) => Math.max(0, c - 1)), 1000);
    return () => clearInterval(id);
  }, [cooldown]);

  /** Poll /api/status until the running scrape finishes, then reload data. */
  const startPolling = useCallback(() => {
    clearInterval(pollTimer.current);

    pollTimer.current = setInterval(async () => {
      try {
        const { refresh } = await fetchStatus();

        if (!refresh.running) {
          clearInterval(pollTimer.current);
          await load();

          const failed = refresh.results.filter((r) => !r.ok);
          setNotice(
            failed.length
              ? {
                  type: 'warn',
                  text: `Finished with ${failed.length} failure(s): ${failed
                    .map((f) => f.platform)
                    .join(', ')}. Previous data kept for those.`,
                }
              : { type: 'ok', text: 'Refresh complete — data is live.' }
          );
        }
      } catch (err) {
        clearInterval(pollTimer.current);
        setError(err.message);
      }
    }, POLL_INTERVAL_MS);
  }, [load]);

  // Never leave a timer running after unmount.
  useEffect(() => () => clearInterval(pollTimer.current), []);

  /** Ask the server to scrape, then watch for completion. */
  const handleRefresh = async () => {
    setNotice(null);
    setError(null);

    try {
      const result = await triggerRefresh();
      setPayload((prev) => (prev ? { ...prev, refresh: result.refresh } : prev));
      setNotice({ type: 'info', text: 'Scraping in progress — Playwright is opening Chromium…' });
      startPolling();
    } catch (err) {
      // 429 (cooldown) and 409 (already running) are expected, not errors.
      if (err.status === 429) {
        setCooldown(err.body?.refresh?.cooldownRemaining ?? 60);
        setNotice({ type: 'warn', text: err.message });
      } else if (err.status === 409) {
        setNotice({ type: 'info', text: err.message });
        startPolling();
      } else {
        setError(err.message);
      }
    }
  };

  const refresh = payload?.refresh;
  const busy = Boolean(refresh?.running);
  const blocked = busy || cooldown > 0;

  const buttonLabel = busy
    ? 'Scraping…'
    : cooldown > 0
      ? `Cooldown ${cooldown}s`
      : 'Refresh data';

  return (
    <div className="app">
      <header className="topbar">
        <div>
          <h1 className="topbar__title">Social Media Dashboard</h1>
          <p className="topbar__sub">
            ATLAS SkillTech University — public profile data
            {refresh?.finishedAt && !busy && (
              <> · last run {timeAgo((Date.now() - new Date(refresh.finishedAt)) / 1000)}</>
            )}
          </p>
        </div>

        <button className="refresh" onClick={handleRefresh} disabled={blocked}>
          {busy && <span className="spinner" aria-hidden="true" />}
          {buttonLabel}
        </button>
      </header>

      {error && (
        <div className="banner banner--error">
          <strong>Unable to load data.</strong> {error}
        </div>
      )}

      {notice && <div className={`banner banner--${notice.type}`}>{notice.text}</div>}

      {loading ? (
        <div className="grid">
          {[0, 1, 2, 3].map((i) => (
            <div className="card card--skeleton" key={i} />
          ))}
        </div>
      ) : (
        <div className="grid">
          {payload?.platforms.map((p) => (
            <PlatformCard key={p.platform} payload={p} busy={busy && p.implemented} />
          ))}
        </div>
      )}

      <footer className="foot">
        React + Vite · Node API · Playwright — data scraped from public pages only
      </footer>
    </div>
  );
}
