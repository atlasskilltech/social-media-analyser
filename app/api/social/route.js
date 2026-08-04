import { NextResponse } from 'next/server';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

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

    return NextResponse.json({ success: true, platforms, serverTime: new Date().toISOString() });
  } catch (err) {
    return NextResponse.json(
      { success: false, error: err?.message || String(err) },
      { status: 500 }
    );
  }
}
