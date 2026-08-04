import { NextResponse } from 'next/server';
import { readCache } from '@/lib/storage.js';

/*
 * Must run on the Node runtime (it touches the filesystem) and must never be
 * cached — the whole point is to reflect whatever the scraper last wrote.
 */
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * GET /api/social/instagram
 *
 * Returns the latest scraped Instagram data straight from cache/instagram.json.
 * This route never scrapes; it only reads.
 *
 * 200 — { ok: true, data }
 * 404 — { ok: false, error } when no cache file exists yet
 */
export async function GET() {
  try {
    const data = await readCache('instagram');

    if (!data) {
      return NextResponse.json(
        { ok: false, error: 'No data available.' },
        { status: 404 }
      );
    }

    return NextResponse.json({ ok: true, data });
  } catch (err) {
    return NextResponse.json(
      { ok: false, error: `Could not read cached data: ${err.message}` },
      { status: 500 }
    );
  }
}
