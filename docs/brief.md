# Card Desk Drops — product brief

This is the owner's brief, kept in the repo as the source of truth. There is no
`docs/research.md`: it never existed, so Phase 0 researches the sports side
from scratch alongside Pokémon. Findings live in `docs/phase0/` and are
consolidated in `SOURCES.md`.

## Amendments (2 Oct 2026)

- **Andorra is out entirely.** The owner lives in Gibraltar.
- **Ship-to regions are Gibraltar (primary) and Spain (fallback).** Prefer
  shipping to Gibraltar. When a retailer won't ship to Gibraltar, Spain is the
  alternative. Every retailer carries `ships_gi` and `ships_es`
  (`yes` / `no` / `unknown`). The "purchasable" gate passes on either; the UI
  shows which.
- **The sports research is done from scratch** in Phase 0, because
  `docs/research.md` never existed.

## What the product does

1. Discovers upcoming and live drops from official publishers, UK/EU retailers and release calendars.
2. Filters out noise and ranks what's left against the owner's buying rules (Desk Score).
3. Shows each drop with a countdown, confidence level, retailer links, price vs RRP, and whether it ships to Gibraltar and/or Spain.
4. Alerts before and when watched drops go live, and when dates change.
5. Needs near-zero maintenance and says loudly when a source breaks.

## v1 scope

- Categories: football/soccer, Formula 1 and Pokémon TCG (English-language products only). UFC exists in config but is switched off, with no adapter.
- Publishers: Topps/Fanatics (weighted higher) and Panini for sports; The Pokémon Company for Pokémon.
- Categories, publishers, product tiers, exclusions, score weights and watchlists live in one editable config file (`config/rules.yaml`). Nothing is hard-coded. Adding a category is a config change plus source adapters.
- Football player watchlist seed: Lamine Yamal, Endrick, Pau Cubarsí, Florian Wirtz, Francesco Camarda.
- Excluded by default: stickers, Match Attax / Turbo Attax, retail blasters and hangers, Pokémon single packs, blisters and mini tins, Japanese-language Pokémon, baseball.
- Out of scope for v1: secondary-market prices and comps, portfolio tracking, sign-up/auth UI, multi-user features. **Never** auto-checkout or any purchasing/bot behaviour.

## Single user, ready for more

- Single user behind Cloudflare Access, with no auth system.
- Shared data (products, drops, retailers, prices, sources) is kept separate from personal data (watchlist, score overrides, pins, notifications, push subscriptions).
- Every personal table has an `owner_id`, seeded with one owner.

## Architecture

- One Cloudflare Worker (TypeScript):
  - Hono API.
  - Static assets for the PWA (Vite + React + TS).
  - A scheduled handler.
- Storage: D1 (relational), KV (last-seen hashes, fast state) and R2 (product images).
- Sentry for errors. Secrets live in wrangler secrets (`.dev.vars` locally) and are never committed.
- Cloudflare Access protects the UI and API. The iCal feed and the push delivery-receipt endpoint bypass Access and are protected by long random path tokens.
- Times are stored in UTC and displayed in Europe/Gibraltar. Prices are kept in the original currency plus GBP and EUR conversions.

## Ingestion and cadence

- Each source is an adapter with one interface: fetch → parse → normalise → upsert. Every parser has saved fixtures and unit tests.
- One cron trigger runs every 15 minutes and a scheduler decides what is due:

  | What | Cadence |
  |---|---|
  | Release calendars | Daily |
  | Retailer polling | Every 6 h |
  | Watched drops, or drops due within 48 h | Hourly |
  | Final 2 h before a drop | Every 15 min |

- Polite scraping: descriptive User-Agent, respect robots.txt, ETag/If-Modified-Since, back off on 403/429.
- De-duplicate across retailers and naming conventions. A cheap Claude API pass (model ID in env config) handles only titles that fail deterministic matching, and its results are cached.
- Release dates are never silently overwritten:
  - Every change is kept in a history.
  - Each date has a confidence level: rumoured / announced / confirmed date / confirmed time.
  - "Date moved" is an event.
- Market-signal capture from day one (not displayed in v1):
  - Stock transitions per product per retailer, with timestamps.
  - Every price change relative to RRP.

## Desk Score

**Hard gates.** A drop that fails any gate is greyed out and never alerts unless it's watched.

- Category, publisher and product line are in scope and not excluded.
- Purchasable to Gibraltar or Spain (`unknown` is allowed but flagged).
- Sealed product priced at or below RRP × 1.05 (configurable). Above that, the label is "Above RRP — buy singles instead".

**Score 0–100.** Weights are configurable per category, and every point is explained in the UI.

| Component | Max | What counts |
|---|---|---|
| Product tier | 40 | Flagship lines in config |
| Configuration | 20 | Sports: hobby/breaker > jumbo > mega > retail. Pokémon: booster box/display > ETB > booster bundle > other |
| Scarcity | 20 | Print-to-order, timed window, numbered/limited run, retailer purchase limits |
| Relevance | 20 | Watchlist players or rookie class; Pokémon manual chase/set tag; manual tags until checklist ingestion exists |

**Labels and wording.**

- Priority (75+), Watch (50–74), Ignore (<50).
- Any score can be overridden and any drop pinned.
- No language implying returns or investment certainty. Never "rip for value". The strongest opening label is "At RRP — fine to rip for fun".

## Notifications

- Web Push (VAPID) is the primary channel. No Telegram.
- In-app notification centre: every alert is stored, with an unread count and an app-icon badge where supported.
- Delivery receipts: the service worker reports each push it receives. If a critical alert (T-1h, T-10m, live, or a date change on a watched drop) isn't confirmed within 5 minutes, it goes out by email via Resend. Email is fallback only.
- When the push service returns 404/410, the subscription is marked dead, a re-subscribe banner shows, and one email goes out.
- Triggers:
  - New Priority drop.
  - Watched drop at T-24h, T-1h, T-10m and when it goes live.
  - Date/time change on a watched drop.
  - Restock of a watched product.
  - Any source failing two consecutive runs.
- Weekly brief every Sunday at 18:00 Europe/Gibraltar: an in-app page covering the next 14 days, announced by push.
- Calendar: a token-protected iCal feed of watched drops, plus a per-drop .ics download with a VALARM.

## UI

- Upcoming: list/calendar toggle, with filters for category, label and ship-to region.
- Live now.
- Watchlist.
- Notifications.
- Weekly brief.
- Drop detail:
  - A countdown only when the exact time is confirmed; otherwise "expected week of" plus a confidence badge.
  - Retailers with price, stock, ships-to flags and links.
  - The Desk Score breakdown.
  - Date history.
- Source health.
- Settings: rules config viewer, notification toggles, push status.

Mobile-first, dark mode, no clutter.

## Phases

| Phase | Content |
|---|---|
| 0 | Verify and research, then **stop for approval** |
| 1 | MVP: ingestion, schema, de-dup, market signals, Upcoming/Live/Detail, PWA + push + receipts + email fallback, notification centre, iCal, deployed behind Access |
| 2 | Desk Score + rules config, watchlist, Source health with alerts, iOS Add to Home Screen coach, weekly brief |
| 3 | Checklist ingestion, a secondary-market price source (owner chooses), price history, Sector signals view |
| 4 | Additional categories as config modules |

**v1 acceptance.** For 14 consecutive days:

- Every in-scope release due in the next 30 days from the primary calendar sources appears in the app.
- No source fails silently.
- Every critical alert for a watched drop is delivered by push or fallback email.
