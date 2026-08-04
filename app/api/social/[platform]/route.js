import { NextResponse } from 'next/server';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * GET /api/social/[platform]
 *
 * One platform's cached record. Reads only — never scrapes.
 * One handler serves all four platforms; there is no per-platform route file.
 */
export async function GET(_request, { params }) {
  const { platform } = await params;

  try {
    const { isSupported, LABELS, SPECS } = await import('@/lib/platforms/index.js');
    const { readCache } = await import('@/lib/storage.js');

    if (!isSupported(platform)) {
      return NextResponse.json(
        { success: false, error: `Unknown platform "${platform}".` },
        { status: 404 }
      );
    }

    const data = await readCache(platform);
    if (!data) {
      return NextResponse.json(
        { success: false, platform, error: 'No data available.' },
        { status: 404 }
      );
    }

    return NextResponse.json({
      success: true,
      platform,
      label: LABELS[platform],
      profileUrl: SPECS[platform].url,
      data,
    });
  } catch (err) {
    return NextResponse.json(
      { success: false, platform, error: err?.message || String(err) },
      { status: 500 }
    );
  }
}
