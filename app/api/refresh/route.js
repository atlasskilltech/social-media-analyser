import { NextResponse } from 'next/server';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const revalidate = 0;
export const fetchCache = 'force-no-store';
export const maxDuration = 60;

/**
 * Headers that stop anything between here and the browser from holding on to a
 * response. Vercel's CDN, an intermediate proxy and the browser cache all
 * respect these.
 */
const NO_STORE = {
  'Cache-Control': 'no-store, no-cache, must-revalidate, max-age=0',
  Pragma: 'no-cache',
  Expires: '0',
};

/**
 * POST /api/refresh
 *
 * Fetches every active platform from its API and returns the fresh records in
 * the response.
 *
 * Synchronous by design. The previous version started a background job and had
 * the client poll for completion then re-read the cache — which cannot work on
 * serverless: the job state lives in one instance's memory and the cache write
 * lands in that instance's /tmp, so a poll or a follow-up read served by a
 * different instance saw neither. Two API calls take about a second, so the
 * work simply happens inline and the data comes back with it.
 *
 * Each platform reports whether its data actually changed, so the UI can say
 * "Data Updated Successfully" or "Already Up To Date" truthfully.
 */
export async function POST(request) {
  try {
    const { refreshNow } = await import('@/lib/refresh.js');
    const { isSupported } = await import('@/lib/platforms/index.js');

    // Optional { platforms: [...] } narrows the run; omitted means all active.
    let only = null;
    try {
      const body = await request.json();
      if (Array.isArray(body?.platforms) && body.platforms.length) {
        only = body.platforms.filter(isSupported);
      }
    } catch {
      /* no body is the normal case */
    }

    const result = await refreshNow(only);

    const entries = Object.values(result.platforms);
    const changed = entries.filter((p) => p.changed).length;
    const failed = entries.filter((p) => p.state !== 'success').length;

    return NextResponse.json(
      {
        success: true,
        totalMs: result.totalMs,
        changed,
        failed,
        // Truthful summary: only claim an update when something actually moved.
        message:
          failed === entries.length
            ? 'Refresh failed.'
            : changed > 0
              ? 'Data Updated Successfully'
              : 'Already Up To Date',
        platforms: result.platforms,
      },
      { headers: NO_STORE }
    );
  } catch (err) {
    console.error('[refresh] failed:', err);
    return NextResponse.json(
      { success: false, error: err?.userMessage || err?.message || String(err) },
      { status: 500, headers: NO_STORE }
    );
  }
}
