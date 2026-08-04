import { NextResponse } from 'next/server';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * GET /api/diagnostics
 *
 * Read-only environment report — no scraping, no writes beyond a probe file
 * that is immediately deleted. Answers, for whatever machine is actually
 * serving the request:
 *
 *   - is the project directory writable, is /tmp writable
 *   - does the playwright package resolve
 *   - does a Chromium binary exist at the path Playwright expects
 *   - how much memory the runtime has
 *
 * This is the endpoint to hit first when the deployed app misbehaves; it
 * distinguishes "code is broken" from "platform cannot support this".
 */
export async function GET() {
  try {
    const { probeEnvironment } = await import('@/lib/diagnostics.js');
    const { CACHE_DIR, WRITE_CACHE_DIR, IS_SERVERLESS } = await import('@/lib/storage.js');
    const { readCache } = await import('@/lib/storage.js');

    const environment = probeEnvironment();
    const cached = await readCache('instagram');

    return NextResponse.json({
      success: true,
      environment,
      storage: {
        readSnapshotDir: CACHE_DIR,
        writeDir: WRITE_CACHE_DIR,
        serverless: IS_SERVERLESS,
        ephemeralWrites: IS_SERVERLESS,
        hasCachedInstagram: Boolean(cached),
        cachedLastUpdated: cached?.lastUpdated ?? null,
      },
    });
  } catch (err) {
    return NextResponse.json(
      {
        success: false,
        stage: 'diagnostics',
        error: err?.message || String(err),
        stack: err?.stack ? err.stack.split('\n').slice(0, 12).join('\n') : null,
      },
      { status: 500 }
    );
  }
}
