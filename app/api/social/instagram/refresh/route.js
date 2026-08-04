import { NextResponse } from 'next/server';
import { scrapeAndSave } from '@/lib/runner.js';
import { readCache } from '@/lib/storage.js';
import { isActive, secondsRemaining, markRun } from '@/lib/cooldown.js';
import instagramSpec from '@/instagram.js';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Playwright needs roughly 15 seconds. The Next default would cut it off, and
 * on Vercel this maps to the function timeout.
 */
export const maxDuration = 60;

/**
 * POST /api/social/instagram/refresh
 *
 * Runs the existing Playwright scraper, waits for it to finish, and returns the
 * freshly written JSON. The scraper itself is untouched: this calls the same
 * scrapeAndSave(spec) that `node instagram.js` uses.
 *
 * 200 — { ok: true, data }                 scrape succeeded, cache updated
 * 429 — { ok: false, reason: 'cooldown' }  too soon; previous data returned
 * 502 — { ok: false, error }               scrape failed; previous data returned
 *
 * Failures always include the last known good data so the UI can keep
 * displaying it instead of blanking the card.
 */
export async function POST() {
  // Server-side rate limit. A client-side guard is bypassed by a reload, and an
  // earlier version of this dashboard fired eleven Chromium runs at Instagram
  // in eight minutes because the limit lived in the browser.
  if (isActive()) {
    return NextResponse.json(
      {
        ok: false,
        reason: 'cooldown',
        retryAfter: secondsRemaining(),
        data: await readCache('instagram'),
      },
      { status: 429 }
    );
  }

  // Claim the slot before launching, so a second request arriving mid-scrape
  // cannot slip through while this one is still running.
  markRun();

  try {
    const result = await scrapeAndSave(instagramSpec);

    if (!result.ok) {
      // scrapeAndSave already logged the reason and left the cache intact.
      return NextResponse.json(
        {
          ok: false,
          error: result.error || 'Scrape failed.',
          data: await readCache('instagram'),
        },
        { status: 502 }
      );
    }

    return NextResponse.json({ ok: true, data: result.data });
  } catch (err) {
    return NextResponse.json(
      {
        ok: false,
        error: err.message,
        data: await readCache('instagram'),
      },
      { status: 502 }
    );
  }
}
