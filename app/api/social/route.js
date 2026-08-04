import { NextResponse } from 'next/server';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const revalidate = 0;
export const fetchCache = 'force-no-store';

/** Stop the CDN, any proxy and the browser from holding on to this response. */
const NO_STORE = {
  'Cache-Control': 'no-store, no-cache, must-revalidate, max-age=0',
  Pragma: 'no-cache',
  Expires: '0',
};

/**
 * GET /api/social
 *
 * Every platform's cached record, in dashboard order. One request renders the
 * whole dashboard. Platforms never scraped yet come back with `data: null`.
 */
export async function GET() {
  try {
    const { ORDER, LABELS, SPECS } = await import('@/lib/platforms/index.js');
    const { readCache } = await import('@/lib/storage.js');

    const platforms = await Promise.all(
      ORDER.map(async (platform) => {
        const data = await readCache(platform);
        return {
          platform,
          label: LABELS[platform],
          profileUrl: SPECS[platform].url,
          hasData: Boolean(data),
          data,
        };
      })
    );

    return NextResponse.json(
      { success: true, platforms, serverTime: new Date().toISOString() },
      { headers: NO_STORE }
    );
  } catch (err) {
    return NextResponse.json(
      { success: false, error: err?.message || String(err) },
      { status: 500, headers: NO_STORE }
    );
  }
}
