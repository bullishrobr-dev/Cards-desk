# CLAUDE.md — Card Desk Drops

A personal PWA that tracks trading-card drops (football, F1, Pokémon EN) for one collector in Gibraltar.

The product brief is `docs/brief.md`; read it first. Verified sources are listed in `SOURCES.md`, and the raw Phase 0 evidence is in `docs/phase0/`.

## Current phase

Phase 0 (verify and research). No application code yet. Phase 1 starts only after the owner approves `docs/phase1-plan.md`.

## Non-negotiables

- **Never invent endpoints, selectors, dates or shipping facts.** Verify live. If you can't, mark it `UNVERIFIED` and say so.
- **No purchasing behaviour, ever.** That means no auto-checkout, no add-to-cart in production code and no queue bypass.
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

## Layout (planned for Phase 1)

```
config/rules.yaml        buying rules, categories, tiers, weights, watchlists
src/worker/              Hono API, scheduled handler, adapters, scoring, notifications
src/web/                 Vite + React PWA (service worker, push, notification centre)
migrations/              D1 SQL migrations
fixtures/<source>/       saved responses for parser tests
docs/                    brief, Phase 0 findings, plans
```
