import { NextResponse } from 'next/server';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 300;

/**
 * POST /api/refresh   start a refresh of every platform
 * GET  /api/refresh   current progress
 *
 * The POST returns 202 immediately rather than holding the connection for the
 * ~60s four platforms take. The client polls the GET and renders per-platform
 * ticks as each finishes.
 *
 * 202 started · 409 already running. There is no cooldown.
 */
export async function POST(request) {
  try {
    const { startRefresh, getState } = await import('@/lib/refresh.js');
    const { isSupported } = await import('@/lib/platforms/index.js');

    // Optional { platforms: [...] } narrows the run; omitted means all.
    let only = null;
    try {
      const body = await request.json();
      if (Array.isArray(body?.platforms) && body.platforms.length) {
        only = body.platforms.filter(isSupported);
      }
    } catch {
      /* no body is the normal case */
    }

    const { started, reason } = startRefresh(only);

    if (started) {
      return NextResponse.json({ success: true, started: true, refresh: getState() }, { status: 202 });
    }

    /*
     * The only reason a start is refused is that one is already in flight.
     * There is no cooldown — see lib/refresh.js.
     */
    return NextResponse.json(
      {
        success: false,
        started: false,
        reason,
        message: 'A refresh is already running.',
        refresh: getState(),
      },
      { status: 409 }
    );
  } catch (err) {
    return NextResponse.json(
      { success: false, stage: 'start-refresh', error: err?.message || String(err) },
      { status: 500 }
    );
  }
}

export async function GET() {
  try {
    const { getState } = await import('@/lib/refresh.js');
    return NextResponse.json({ success: true, refresh: getState(), serverTime: new Date().toISOString() });
  } catch (err) {
    return NextResponse.json(
      { success: false, error: err?.message || String(err) },
      { status: 500 }
    );
  }
}
