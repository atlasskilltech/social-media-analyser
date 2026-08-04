# Social Media Dashboard

Read-only dashboard showing public data for four fixed ATLAS SkillTech University
profiles. No login, no database, no accounts — Playwright scrapes, JSON files
store, React displays.

```
React (Vite)  ──/api──▶  Node API  ──▶  Playwright  ──▶  public pages
     ▲                       │
     └───── cache/*.json ◀───┘
```

## Requirements

Node.js 18+ (developed on 22). No PHP, no database.

## Install

```bash
npm install
npx playwright install chromium
```

## Run (development)

```bash
npm run dev
```

Starts both processes: the API on **:3001** and Vite on **:5173**.
Open <http://localhost:5173>. Vite proxies `/api` to the API, so the browser
stays on one origin and no CORS config is needed.

To run them separately: `npm run dev:api` and `npm run dev:web`.

## Run (production)

```bash
npm run build   # emits dist/
npm start       # API serves dist/ and the API on :3001
```

## Scrapers

Each platform runs standalone and prints its JSON:

```bash
npm run instagram     # node instagram.js
```

Scrapers are fully independent — one failing never affects the others.

## API

| Method | Route | Purpose |
|---|---|---|
| GET | `/api/data` | All platforms' cached data + refresh state |
| GET | `/api/status` | Refresh state only (polled while scraping) |
| POST | `/api/refresh` | Start a scrape. `202` started · `429` cooldown · `409` already running |

`POST /api/refresh` returns immediately rather than holding the connection for
the duration of the scrape; the client polls `/api/status` until it completes.

## Layout

```
config.js              the four fixed URLs
playwright.config.js   shared browser settings
instagram.js           one scraper per platform
server.js              the Node API
lib/
  browser.js           browser lifecycle + strategy chain runner
  runner.js            shared scrape → save → log path
  storage.js           JSON cache + error log (never destructive)
  cooldown.js          server-side rate limit on scrape triggers
  refresh.js           background scrape job + state
  platforms.js         platform registry
  utils.js             count parsing + merge rules
src/                   React app
cache/*.json           scraper output
logs/error.log         one line per scrape attempt
```

## Design notes

**Strategies merge, they don't just fall back.** Each scraper runs several
extraction strategies (DOM, embedded JSON, meta tags, JSON-LD) and merges the
results. Instagram's DOM reports a rounded `38K`; its embedded JSON reports the
exact `38015`; only the meta tags carry the post count. An exact value may
overwrite a rounded one, never the reverse. Every strategy always runs — one
throwing costs nothing.

**Good data is never replaced by empty data.** If a scrape returns nothing
usable, the previous JSON is left untouched and the failure is logged. Writes
go to a temp file and are renamed, so a crash cannot leave a half-written file.

**Scrapes are rate limited server-side** (`lib/cooldown.js`, 60s). This is not
optional politeness — an early version re-fired on every page reload and sent
eleven Chromium runs at Instagram in eight minutes, which is how an IP gets
blocked.

## Status

- [x] Instagram
- [ ] YouTube
- [ ] Facebook
- [ ] LinkedIn
