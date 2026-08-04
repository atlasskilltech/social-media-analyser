import { NextResponse } from 'next/server';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

/**
 * POST /api/social/instagram/refresh
 *
 * Runs the existing Playwright scraper and returns the freshly written JSON.
 *
 * Every stage is tracked and every failure returns structured JSON:
 *   { success, stage, error, code, stack, platform, environment }
 *
 * Nothing is imported at module scope. That is deliberate — a module-level
 * import that throws produces a bare 500 with an empty body and no way to see
 * why, which is exactly what the Vercel deployment was returning. Importing
 * inside the try block turns that same failure into a readable response.
 */
export async function POST() {
  const startedAt = Date.now();
  const log = [];

  /** Record a stage transition; echoed to stdout so it lands in platform logs. */
  const mark = (stage, detail = '') => {
    const entry = { stage, at: Date.now() - startedAt, detail };
    log.push(entry);
    console.log(`[refresh] ${stage} +${entry.at}ms ${detail}`);
  };

  let stage = 'import';
  let diagnostics = null;
  let browser = null;

  try {
    mark('import', 'loading scraper modules');

    // Dynamic imports: a resolution failure lands in the catch below with a
    // real message instead of crashing the function during module evaluation.
    const [{ scrapeAndSave }, { launchBrowser }, storage, diag, specModule] = await Promise.all([
      import('@/lib/runner.js'),
      import('@/lib/browser.js'),
      import('@/lib/storage.js'),
      import('@/lib/diagnostics.js'),
      import('@/instagram.js'),
    ]);

    const { readCache } = storage;
    const { failure, probeEnvironment } = diag;
    const instagramSpec = specModule.default ?? specModule;
    diagnostics = { failure, probeEnvironment };

    mark('import', 'ok');

    // ---------------------------------------------------------------- cooldown
    stage = 'cooldown-check';
    const { isActive, secondsRemaining, markRun } = await import('@/lib/cooldown.js');

    if (isActive()) {
      const retryAfter = secondsRemaining();
      mark('cooldown-check', `blocked, ${retryAfter}s remaining`);
      return NextResponse.json(
        {
          success: false,
          ok: false,
          stage,
          reason: 'cooldown',
          retryAfter,
          error: `Cooldown active — retry in ${retryAfter}s.`,
          platform: probeEnvironment().platform,
          data: await readCache('instagram'),
          log,
        },
        { status: 429 }
      );
    }

    // Claim the slot before launching so a concurrent request cannot slip past.
    markRun();
    mark('cooldown-check', 'ok');

    // ----------------------------------------------------------- launch browser
    stage = 'launch-browser';
    mark('launch-browser', 'starting chromium');
    browser = await launchBrowser();
    mark('launch-browser', 'ok');

    // ------------------------------------------------------------------ scrape
    stage = 'scrape';
    mark('scrape', 'running strategies');

    // The scraper itself is untouched — same call `node instagram.js` makes,
    // reusing the browser we just launched so the stages stay separable.
    const result = await scrapeAndSave(instagramSpec, browser);
    mark('scrape', result.ok ? 'ok' : `failed: ${result.error}`);

    if (!result.ok) {
      stage = 'extract';

      /*
       * Extraction failed. "no required field extracted" on its own is useless,
       * so the response carries what the page actually was: its classification,
       * title, URL, saved artifacts, an HTML preview, and the per-strategy
       * outcome. That distinguishes stale selectors from a login wall, which
       * need completely different fixes.
       */
      return NextResponse.json(
        {
          ...failure(stage, result.error || 'Scrape produced no usable data.'),
          page: result.forensics
            ? {
                detectedType: result.forensics.pageType,
                url: result.forensics.url,
                title: result.forensics.title,
                htmlLength: result.forensics.htmlLength,
                hasProfileData: result.forensics.hasProfileData,
                htmlPath: result.forensics.htmlPath,
                screenshotPath: result.forensics.screenshotPath,
                htmlPreview: result.forensics.htmlPreview,
                captureErrors: result.forensics.errors,
              }
            : null,
          strategies: (result.report || []).map((r) => ({
            strategy: r.name,
            result: r.status === 'ok' ? 'success' : r.status === 'empty' ? 'failed' : 'error',
            detail: r.detail,
          })),
          data: await readCache('instagram'),
          log,
        },
        { status: 502 }
      );
    }

    // ----------------------------------------------------------------- respond
    stage = 'respond';
    mark('respond', 'ok');

    return NextResponse.json({
      success: true,
      ok: true,
      stage: 'complete',
      durationMs: Date.now() - startedAt,
      // Which strategies actually contributed — the answer to "how did this work
      // today", which matters when Instagram changes its markup next week.
      strategies: (result.report || []).map((r) => ({
        strategy: r.name,
        result: r.status === 'ok' ? 'success' : r.status === 'empty' ? 'failed' : 'error',
        detail: r.detail,
      })),
      succeededVia: result.strategies || [],
      page: result.forensics
        ? { detectedType: result.forensics.pageType, title: result.forensics.title }
        : null,
      data: result.data,
      log,
    });
  } catch (err) {
    console.error(`[refresh] FAILED at stage "${stage}":`, err);

    // diagnostics may itself have failed to import — degrade, never re-throw.
    if (diagnostics?.failure) {
      let previous = null;
      try {
        const { readCache } = await import('@/lib/storage.js');
        previous = await readCache('instagram');
      } catch {
        /* cache unreadable too; report without it */
      }
      return NextResponse.json({ ...diagnostics.failure(stage, err), data: previous, log }, { status: 502 });
    }

    return NextResponse.json(
      {
        success: false,
        ok: false,
        stage,
        error: err?.message || String(err),
        code: err?.code,
        stack: err?.stack ? err.stack.split('\n').slice(0, 12).join('\n') : null,
        platform: process.env.VERCEL ? 'vercel' : 'local',
        note: 'diagnostics module failed to load; reporting raw error',
        log,
      },
      { status: 502 }
    );
  } finally {
    // Always close, even on failure — an orphaned Chromium would hold the
    // function alive until the platform kills it.
    if (browser) {
      try {
        await browser.close();
      } catch {
        /* already gone */
      }
    }
  }
}
