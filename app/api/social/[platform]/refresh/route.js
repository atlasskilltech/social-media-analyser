import { NextResponse } from 'next/server';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

/**
 * POST /api/social/[platform]/refresh
 *
 * Scrape a single platform and wait for the result. Useful for retrying one
 * failed platform without re-running the others; the dashboard's "Refresh All"
 * uses /api/refresh instead.
 *
 * Every failure returns structured JSON: stage, error, page classification and
 * the per-strategy outcome, never a bare message.
 */
export async function POST(_request, { params }) {
  const { platform } = await params;
  const startedAt = Date.now();
  let stage = 'import';

  try {
    const { getSpec, isSupported } = await import('@/lib/platforms/index.js');

    if (!isSupported(platform)) {
      return NextResponse.json(
        { success: false, error: `Unknown platform "${platform}".` },
        { status: 404 }
      );
    }

    const { scrapeAndSave } = await import('@/lib/runner.js');
    const { readCache } = await import('@/lib/storage.js');
    const { failure } = await import('@/lib/diagnostics.js');

    // No cooldown: the Graph API path has no browser to protect.
    stage = 'scrape';
    const result = await scrapeAndSave(getSpec(platform));

    if (!result.ok) {
      stage = 'extract';
      return NextResponse.json(
        {
          ...failure(stage, result.error || 'Scrape produced no usable data.'),
          platform,
          page: result.forensics
            ? {
                detectedType: result.forensics.pageType,
                url: result.forensics.url,
                title: result.forensics.title,
                htmlLength: result.forensics.htmlLength,
                htmlPath: result.forensics.htmlPath,
                screenshotPath: result.forensics.screenshotPath,
                htmlPreview: result.forensics.htmlPreview,
              }
            : null,
          strategies: (result.report || []).map((r) => ({
            strategy: r.name,
            result: r.status === 'ok' ? 'success' : r.status === 'empty' ? 'failed' : 'error',
            detail: r.detail,
          })),
          data: await readCache(platform),
        },
        { status: 502 }
      );
    }

    return NextResponse.json({
      success: true,
      platform,
      stage: 'complete',
      durationMs: Date.now() - startedAt,
      strategies: (result.report || []).map((r) => ({
        strategy: r.name,
        result: r.status === 'ok' ? 'success' : r.status === 'empty' ? 'failed' : 'error',
        detail: r.detail,
      })),
      data: result.record,
    });
  } catch (err) {
    console.error(`[refresh:${platform}] failed at "${stage}":`, err);
    return NextResponse.json(
      {
        success: false,
        platform,
        stage,
        error: err?.message || String(err),
        stack: err?.stack ? err.stack.split('\n').slice(0, 10).join('\n') : null,
      },
      { status: 502 }
    );
  }
}
