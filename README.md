# Social Media Dashboard

Read-only dashboard showing public data for four fixed ATLAS SkillTech
University profiles. No login, no database, no accounts — Playwright scrapes,
JSON files store, Next.js displays.

```
Next.js (App Router)  ──/api──▶  Playwright  ──▶  public pages
        ▲                            │
        └──────  cache/*.json  ◀─────┘
```

## Requirements

Node.js 20.9+ (developed on 22).

## Install

```bash
npm install
npx playwright install chromium
```

## Run

```bash
npm run dev      # http://localhost:3000
npm run build && npm start
```

## Scrapers

```bash
npm run scrape              # all four platforms
npm run scrape instagram    # or: node scrape.js youtube facebook
```

Each platform is fully independent — one failing never affects the others.

## API

| Method | Route | Purpose |
|---|---|---|
| GET | `/api/social` | All platforms' cached records |
| GET | `/api/social/[platform]` | One platform's record |
| POST | `/api/refresh` | Start a refresh of all platforms (`202`) |
| GET | `/api/refresh` | Per-platform progress (polled by the UI) |
| POST | `/api/social/[platform]/refresh` | Re-scrape one platform and wait |
| GET | `/api/diagnostics` | Runtime environment report |

`POST /api/refresh` returns immediately rather than holding the connection for
the ~60s four platforms take; the client polls `/api/refresh` and ticks each
platform off as it completes.

## Layout

```
config.js              the four fixed URLs
playwright.config.js   shared browser settings
scrape.js              CLI entry point for every platform
lib/
  platforms/           one module per platform + registry
    instagram.js  youtube.js  facebook.js  linkedin.js  index.js
  extractor.js         shared extraction primitives
  runner.js            scrape → classify → save → log
  browser.js           browser lifecycle + strategy chain
  chromium.js          which Chromium to launch (local vs serverless)
  storage.js           JSON cache + error log, never destructive
  schema.js            the unified record shape
  cooldown.js          server-side rate limit
  refresh.js           background job + per-platform progress
  pageForensics.js     what the site actually served
  diagnostics.js       runtime environment probe
components/            React UI (one card component, all platforms)
utils/format.js        display formatting
cache/*.json           one record per platform
logs/error.log         one line per scrape attempt
```

## The unified record

Every platform writes the same keys. Fields a platform does not have are
`null` — never absent, never invented.

```json
{
  "platform": "instagram", "status": "success",
  "username": "...", "displayName": "...",
  "followers": "38015", "following": "27", "posts": "4570",
  "subscribers": null, "videos": null, "likes": null,
  "profileImage": "...", "bio": "...", "profileUrl": "...",
  "lastUpdated": "...", "scrapeTime": 11305, "strategy": "dom-selectors, meta-tags"
}
```

`status` is one of `success`, `partial`, `blocked`, `failed`. **`blocked` means
the platform refused us, not that the scraper is broken** — the distinction
saves you hunting for a bug that isn't there.

## Design notes

**Strategies merge, they don't just fall back.** Each platform runs several
extraction strategies and merges the results. Instagram's DOM reports a rounded
`38K`; its hydration payload reports the exact `38015`; only the meta tags carry
the post count. An exact value may overwrite a rounded one, never the reverse.
Every strategy always runs — one throwing costs nothing.

**Not all rounding is ours.** YouTube publishes only rounded subscriber counts
(`4.15K`) and Facebook only a rounded follower count (`2K`) while giving exact
likes (`2,022`). Those values are approximate at the source; we don't invent
precision the platform withholds.

**A plain HTTP client sees more than a browser.** Sites render Open Graph tags
server-side for non-browser clients — that's how link previews work without
JavaScript — and defer them to hydration for real browsers. Measured against
Instagram: Chrome UA → 606 KB with no `og:description`; curl UA → 703 KB with
the full counts. The `raw-html-fetch` strategy exploits this and needs no JS.

**Good data is never replaced by empty data.** A scrape returning nothing leaves
the previous JSON untouched and logs the failure. Writes go to a temp file and
are renamed, so a crash can't leave a half-written file.

**Scrapes are rate limited server-side** (`lib/cooldown.js`, 60s). An early
version re-fired on every page reload and sent eleven Chromium runs at Instagram
in eight minutes, which is how an IP gets blocked.

## Platform status

| Platform | Works | Notes |
|---|---|---|
| Instagram | yes | Exact follower count from the hydration payload |
| YouTube | yes | Subscribers rounded by YouTube itself |
| Facebook | yes | Exact likes; followers rounded by Facebook |
| LinkedIn | **no** | Returns HTTP 999 to automated clients and a login wall to browsers |

LinkedIn gates logged-out company data behind authentication. Every variant was
tested — `/school/`, `/company/`, regional hosts, browser and plain-client user
agents — and all return 999 or a login page. Its scraper is implemented and
correct; it reports `blocked` and the other three are unaffected. This is not
worked around with credentials or fabricated values.
