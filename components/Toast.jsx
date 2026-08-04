'use client';

import { useEffect } from 'react';

/**
 * A single auto-dismissing toast, fixed to the bottom-right.
 *
 * Deliberately not a library: one message at a time is all this dashboard
 * needs, and a toast package would be a dependency for ~30 lines of markup.
 *
 * @param {{message: string, tone?: 'error'|'warn'|'ok', onDismiss: () => void, duration?: number}} props
 */
export default function Toast({ message, tone = 'error', onDismiss, duration = 5000 }) {
  useEffect(() => {
    if (!message) return undefined;
    const id = setTimeout(onDismiss, duration);
    return () => clearTimeout(id);
  }, [message, duration, onDismiss]);

  if (!message) return null;

  const tones = {
    error: 'border-red-300 bg-red-50 text-red-800 dark:border-red-900 dark:bg-red-950 dark:text-red-200',
    warn: 'border-amber-300 bg-amber-50 text-amber-900 dark:border-amber-900 dark:bg-amber-950 dark:text-amber-200',
    ok: 'border-emerald-300 bg-emerald-50 text-emerald-800 dark:border-emerald-900 dark:bg-emerald-950 dark:text-emerald-200',
  };

  return (
    <div
      role="status"
      aria-live="polite"
      className={`fixed right-5 bottom-5 z-50 flex max-w-sm items-start gap-3 rounded-xl border px-4 py-3 text-sm font-medium shadow-lg ${tones[tone]}`}
    >
      <span className="flex-1">{message}</span>
      <button
        type="button"
        onClick={onDismiss}
        aria-label="Dismiss"
        className="-mr-1 cursor-pointer px-1 leading-none opacity-60 hover:opacity-100"
      >
        ×
      </button>
    </div>
  );
}
