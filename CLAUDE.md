# CLAUDE.md — Card Desk Drops

A personal PWA that tracks trading-card drops (football, F1, Pokémon EN) for one collector in Gibraltar.

The product brief is `docs/brief.md`; read it first. Verified sources are listed in `SOURCES.md`, and the raw Phase 0 evidence is in `docs/phase0/`.

## Current phase

Phases 1 (MVP) and 2 (Desk Score, watchlist, pins, tags, overrides, "New Priority drop" alerts, weekly brief, iOS coach) are built and tested locally. Deployment waits for the owner's Cloudflare account (`docs/deploy.md`).

Phase 3 is partly built:
- **Done:** collectosk release-page enrichment (box types, published RRPs, checklists with watchlist players and rookies), per-listing price history, and the Market signals view.
- **Secondary market:** Cardmarket price-guide files for Pokémon sealed, chosen on the owner's delegation. The 15.6 MB file can't be parsed within the Free plan's 10 ms CPU, so `.github/workflows/cardmarket.yml` runs `tools/cardmarket-import.ts` daily. It filters the file to single sealed boxes and posts them in batches of 50 to the public Worker at `/ingest/market/<INGEST_TOKEN>`. Market prices are shown for context only; they never touch the Desk Score gates. A box type Cardmarket sells does create the product, though.

The Desk Score lives in `src/worker/score/`. `desk-score.ts` is pure and unit-tested; `load.ts` builds its input from D1. Overrides and tags are per release (the scored unit); owner RRPs are per box type.

Hosting is the Workers **Free** plan by owner decision: keep every queue job small (one catalogue page, bulk reads, one batched D1 write; at most ~12 D1 calls per page, enforced by a test).

## Non-negotiables

- **Never invent endpoints, selectors, dates or shipping facts.** Verify live. If you can't, mark it `UNVERIFIED` and say so.
- **No purchasing behaviour, ever.** That means no auto-checkout, no add-to-cart in production code and no queue bypass. Shopify robots.txt disallows `/cart/`, so ship-to flags are manual config (see `SOURCES.md`).
- **Bot challenges are failures, not data.** A 429/403 "Verifying your connection" page, or an Imperva challenge served with HTTP 200, must never be parsed as an empty catalogue.
- **Ship-to regions are Gibraltar (primary) and Spain (fallback).** Andorra is out of scope. Retailer flags are `ships_gi` and `ships_es`, each `yes | no | unknown`.
- **Config, not code.** Categories, publishers, tiers, exclusions, score weights and watchlists live in `config/rules.yaml`.
- **Shared vs personal data.** Personal tables (watchlist, overrides, pins, notifications, push subscriptions) carry `owner_id`.
- **Never silently overwrite release dates.** Keep the history and a confidence level; a date change is an event.
- **Copy rules.** No language implying returns or investment certainty. Never "rip for value". The strongest label is "At RRP — fine to rip for fun".
- **Secrets.** Use wrangler secrets, with `.dev.vars` locally. Never commit them.

## Conventions

- British English in UI copy, docs and commit messages.
- Times are stored in UTC and displayed in Europe/Gibraltar.
- Money is stored in the original currency (minor units) plus GBP and EUR conversions.
- TypeScript strict throughout.
- Every source is an adapter: `fetch → parse → normalise → upsert`. Every parser has fixtures under `fixtures/<source>/` and unit tests. The scoring function has unit tests.
- Polite fetching: UA `CardDeskDrops/<version> (personal release tracker)`, robots.txt respected, conditional GET (ETag / If-Modified-Since), exponential back-off on 403/429.
- Small, reviewable commits. Work on the designated feature branch.
- When something isn't covered by the brief or `SOURCES.md`, stop and ask the owner, with a recommendation.

## Layout

```
config/rules.yaml         buying rules: categories, tiers, exclusions, synonyms, weights, cadence, alerts
config/sources.yaml       calendars and shops, with GI/ES shipping evidence
src/shared/               config schema (zod, validated at build), API types
src/worker/adapters/      parsers per source (pure; fixtures + tests)
src/worker/fetch/         polite fetch: robots.txt, challenge detection, back-off
src/worker/normalise/     title normalisation, classification, release matching
src/worker/ingest/        D1 ingestion, date decisions, market signals, LLM match pass
src/worker/jobs/          15-min dispatcher, queue job runner, hourly maintenance
src/worker/score/         Desk Score (pure) and its D1 loader
src/worker/notify/        notification engine, Web Push, email fallback, iCal, weekly brief
src/worker/alerts/        AlertScheduler Durable Object (exact-time alarms)
src/worker/api/           Hono API behind Cloudflare Access (JWT re-checked)
src/public-worker/        public Worker: push receipts, iCal feed, market import (token paths)
src/web/                  Vite + React PWA; public/sw.js is the service worker
migrations/               D1 schema
fixtures/<source>/        real captured responses used by tests
tools/                    deploy script, VAPID generator, fixture capture, local seed, Cardmarket import
.github/workflows/        daily Cardmarket import (needs two repository secrets, see docs/deploy.md)
```

## Commands

- `npm test` runs all tests (node:sqlite stands in for D1, against the real migration).
- `npm run typecheck`
- `npm run build`
- `npm run seed:local && npm run dev` gives a local app with real fixture data (`.dev.vars` sets `APP_ENV=development`).
- `node tools/deploy.mjs` deploys (see `docs/deploy.md`).
- **Static demo** (for showing the owner without a deployment):
  1. With `npm run dev` running on seeded data, run `node tools/demo-snapshot.mjs [extra drop ids]`.
  2. Run `npx vite build --config vite.demo.config.ts`. Set `VITE_DEMO_DATE` and `VITE_DEMO_HIGHLIGHTS` (a JSON array of `{label, to}`) for the banner.
  3. Run `node tools/demo-page.mjs <out.html>`. It inlines everything into one page.

  The snapshot and `dist-demo/` are gitignored. In the demo build, `/api` calls are answered by `src/web/demo/shim.ts` and routing lives in memory.

## Gotchas learnt the hard way

- **Day-precision release dates go live at midnight Europe/Gibraltar**, up to a day before the UTC date. Never compare `YYYY-MM-DD` against an ISO timestamp as strings without widening.
- **Box-type rules apply to shop listings only**; calendar rows name releases, not boxes.
- **Shopify collection pages are not reliable filters**, so poll full catalogues for sports shops.
- **A 304 on a full page still walks on to the next page.**
- **"Numbered to /22" in a shop description is about parallels, not the box.** Only a stated run size ("limited to 500 cases") counts as scarcity from a description.
- **RRP precedence is owner > rules.yaml > published (collectosk) > estimated.** An estimate (the median of the first shop prices) can hide a 2× markup: the Chrome F1 hobby box was estimated at £783 against a published £415.
- **"1st" badges on collectosk checklists are not rookies.** Legends get them too; only `RC` counts.
- **Schedule local wall-clock times with `localTimeUtc`, never midnight plus hours.** The brief falls on Sundays, which is when the clocks change.
- **Cardmarket names Asian and regional editions like English ones** ("30th Celebration Indonesian & Thai Booster Box", "151C: Collect 151 …"). Filter them out before matching, or they attach to the English release.
- **Never `git checkout -- .` with uncommitted work.**
