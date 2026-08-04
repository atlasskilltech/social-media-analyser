/** @type {import('next').NextConfig} */
const nextConfig = {
  /*
   * Playwright must not be bundled.
   *
   * It resolves browser binaries at runtime and loads native modules, both of
   * which break when webpack/turbopack tries to trace and inline them. Listing
   * it here keeps it as a plain runtime require in the server build — this is
   * what lets the existing scraper code run unchanged from a route handler.
   */
  serverExternalPackages: ['playwright', 'playwright-core', '@sparticuz/chromium'],

  /*
   * Force these packages into the serverless bundle wholesale.
   *
   * Next traces imports statically. playwright-core loads browsers.json at
   * runtime via a computed path, so the tracer cannot see it and silently drops
   * it — the deployed function then dies at import with
   * "Cannot find module playwright-core/browsers.json" and returns a bare 500
   * with no body. @sparticuz/chromium has the same problem: its Chromium is a
   * brotli archive under bin/, referenced at runtime, never statically imported.
   *
   * Globbing the whole packages is the documented fix. Cost is ~80 MB of the
   * 250 MB function limit, which the measured sizes fit inside comfortably.
   */
  outputFileTracingIncludes: {
    '/api/social/instagram/refresh': [
      './node_modules/playwright-core/**',
      './node_modules/@sparticuz/chromium/**',
    ],
  },

  images: {
    /*
     * Profile avatars are served from the social platforms' own CDNs, which
     * sign URLs and expire them. Remote patterns are declared per-host so
     * next/image can optimise them instead of the UI falling back to raw tags.
     */
    remotePatterns: [
      { protocol: 'https', hostname: '**.cdninstagram.com' },
      { protocol: 'https', hostname: '**.fbcdn.net' },
      { protocol: 'https', hostname: '**.licdn.com' },
      { protocol: 'https', hostname: '**.ggpht.com' },
      { protocol: 'https', hostname: '**.ytimg.com' },
      { protocol: 'https', hostname: '**.googleusercontent.com' },
    ],
  },
};

export default nextConfig;
