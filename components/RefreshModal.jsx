'use client';

import { useEffect, useMemo, useRef, useState } from 'react';

/**
 * Refresh progress modal.
 *
 * Shows a live elapsed timer, an ETA derived from observed run times, and each
 * platform's state as it changes. On completion it switches to a summary and
 * closes itself.
 *
 * The timer runs on its own interval rather than off the polling response, so
 * the seconds tick smoothly even when the network is slow.
 */

/** Per-state presentation. Every platform must land on one of the terminal four. */
const STATE_UI = {
  pending: { icon: '⏳', label: 'Waiting', className: 'text-ink-soft' },
  running: { icon: '⏳', label: 'Running…', className: 'text-ink-soft', pulse: true },
  success: { icon: '✅', label: 'Success', className: 'text-emerald-600 dark:text-emerald-400' },
  failed: { icon: '❌', label: 'Failed', className: 'text-red-600 dark:text-red-400' },
  blocked: { icon: '⚠️', label: 'Blocked', className: 'text-amber-600 dark:text-amber-400' },
  timeout: { icon: '⏱️', label: 'Timeout', className: 'text-orange-600 dark:text-orange-400' },
};

const TERMINAL = new Set(['success', 'failed', 'blocked', 'timeout']);

/** 8437 -> "8.4 sec" */
function seconds(ms) {
  if (ms === null || ms === undefined) return '';
  return `${(ms / 1000).toFixed(1)} sec`;
}

/** 63000 -> "01:03" */
function clock(ms) {
  const total = Math.floor(ms / 1000);
  const mm = String(Math.floor(total / 60)).padStart(2, '0');
  const ss = String(total % 60).padStart(2, '0');
  return `${mm}:${ss}`;
}

/**
 * @param {{
 *   open: boolean,
 *   refresh: Object,
 *   labels: Record<string,string>,
 *   onClose: () => void
 * }} props
 */
export default function RefreshModal({ open, refresh, labels, onClose }) {
  const [now, setNow] = useState(Date.now());
  const closeTimer = useRef(null);

  const startedAtMs = refresh?.startedAt ? new Date(refresh.startedAt).getTime() : null;
  const running = Boolean(refresh?.running);

  // Tick once a second while the modal is open and the job is live.
  useEffect(() => {
    if (!open || !running) return undefined;
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, [open, running]);

  const entries = useMemo(() => Object.entries(refresh?.platforms || {}), [refresh]);
  const finished = entries.filter(([, p]) => TERMINAL.has(p.state));
  const total = entries.length;

  const elapsedMs = running
    ? Math.max(0, now - (startedAtMs ?? now))
    : (refresh?.totalMs ?? (startedAtMs ? Math.max(0, now - startedAtMs) : 0));

  const progress = total ? Math.round((finished.length / total) * 100) : 0;

  /*
   * Estimated remaining.
   *
   * Seeded from the server's learned average of previous runs, then floored at
   * one second while work is outstanding — claiming "0 sec" on a job that is
   * still going reads as broken. Platforms run in parallel, so the estimate
   * tracks total wall-clock rather than summing per-platform times.
   */
  const remainingMs = useMemo(() => {
    if (!running) return 0;
    const estimate = refresh?.estimatedTotalMs ?? 15000;
    const projected = finished.length === total ? elapsedMs : Math.max(estimate, elapsedMs + 1000);
    return Math.max(0, projected - elapsedMs);
  }, [running, refresh, elapsedMs, finished.length, total]);

  const counts = useMemo(
    () => ({
      success: finished.filter(([, p]) => p.state === 'success').length,
      failed: finished.filter(([, p]) => p.state === 'failed' || p.state === 'timeout').length,
      blocked: finished.filter(([, p]) => p.state === 'blocked').length,
    }),
    [finished]
  );

  const complete = !running && total > 0 && finished.length === total;

  // Auto-close three seconds after the summary appears.
  useEffect(() => {
    clearTimeout(closeTimer.current);
    if (open && complete) {
      closeTimer.current = setTimeout(onClose, 3000);
    }
    return () => clearTimeout(closeTimer.current);
  }, [open, complete, onClose]);

  if (!open) return null;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Refreshing social media data"
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4 backdrop-blur-sm"
    >
      <div className="max-h-[90vh] w-full max-w-lg overflow-y-auto rounded-2xl border border-line bg-surface p-6 shadow-2xl sm:p-7">
        {/* ---------------------------------------------------------- header */}
        <div className="mb-5">
          <h2 className="text-lg font-bold tracking-tight">
            {complete ? 'Refresh Completed' : 'Refreshing Social Media Data'}
          </h2>
          <p className="mt-0.5 text-sm text-ink-soft">
            {complete ? 'All platforms finished.' : 'Fetching latest information…'}
          </p>
        </div>

        {/* -------------------------------------------------------- progress */}
        <div className="mb-2 flex items-end justify-between">
          <span className="text-xs font-semibold tracking-wide text-ink-soft uppercase">
            Overall Progress
          </span>
          <span className="text-sm font-bold tabular-nums">{progress}%</span>
        </div>
        <div className="mb-5 h-2 w-full overflow-hidden rounded-full bg-line">
          <div
            className="h-full rounded-full bg-ink transition-all duration-500 ease-out"
            style={{ width: `${progress}%` }}
          />
        </div>

        {/* ----------------------------------------------------- timer + eta */}
        <div className="mb-6 grid grid-cols-2 gap-3">
          <div className="rounded-xl border border-line bg-canvas p-3 text-center">
            <div className="text-[10.5px] font-semibold tracking-wide text-ink-soft uppercase">
              Elapsed Time
            </div>
            <div className="mt-0.5 text-xl font-bold tabular-nums">{clock(elapsedMs)}</div>
          </div>
          <div className="rounded-xl border border-line bg-canvas p-3 text-center">
            <div className="text-[10.5px] font-semibold tracking-wide text-ink-soft uppercase">
              {complete ? 'Total Time' : 'Estimated Remaining'}
            </div>
            <div className="mt-0.5 text-xl font-bold tabular-nums">
              {complete ? seconds(refresh?.totalMs ?? elapsedMs) : `~${Math.ceil(remainingMs / 1000)} sec`}
            </div>
          </div>
        </div>

        {/* ------------------------------------------------------- platforms */}
        <ul className="space-y-2">
          {entries.map(([platform, info]) => {
            const ui = STATE_UI[info.state] || STATE_UI.pending;
            return (
              <li
                key={platform}
                className="flex items-center gap-3 rounded-xl border border-line bg-canvas px-3.5 py-2.5"
              >
                <span className={`text-base ${ui.pulse ? 'animate-pulse' : ''}`} aria-hidden="true">
                  {ui.icon}
                </span>
                <span className="min-w-0 flex-1 truncate text-sm font-semibold">
                  {labels?.[platform] || platform}
                </span>
                <span className={`text-xs font-semibold whitespace-nowrap ${ui.className}`}>
                  {ui.label}
                </span>
                {info.ms != null && (
                  <span className="w-16 text-right text-xs tabular-nums text-ink-soft">
                    {seconds(info.ms)}
                  </span>
                )}
              </li>
            );
          })}
        </ul>

        {/* --------------------------------------------------------- summary */}
        {complete && (
          <>
            <div className="mt-5 grid grid-cols-3 gap-2 border-t border-line pt-4">
              {[
                ['Successful', counts.success, 'text-emerald-600 dark:text-emerald-400'],
                ['Failed', counts.failed, 'text-red-600 dark:text-red-400'],
                ['Blocked', counts.blocked, 'text-amber-600 dark:text-amber-400'],
              ].map(([label, value, tone]) => (
                <div key={label} className="rounded-xl border border-line bg-canvas p-3 text-center">
                  <div className={`text-xl font-bold tabular-nums ${tone}`}>{value}</div>
                  <div className="mt-0.5 text-[10.5px] font-semibold tracking-wide text-ink-soft uppercase">
                    {label}
                  </div>
                </div>
              ))}
            </div>

            <div className="mt-4 flex items-center justify-between gap-3">
              <span className="text-xs text-ink-soft">Closing automatically…</span>
              <button
                type="button"
                onClick={onClose}
                className="cursor-pointer rounded-lg bg-ink px-4 py-2 text-sm font-semibold text-canvas transition hover:opacity-90"
              >
                Close
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
