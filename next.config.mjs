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
  serverExternalPackages: ['playwright'],

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
