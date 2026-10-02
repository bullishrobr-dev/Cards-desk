# Phase 1 build plan: MVP

This plan is for approval; nothing gets built until the owner says go. It is based on `SOURCES.md` and `docs/phase0/*`.

## 1. Changes to the original assumptions

| # | Assumption in the brief | What Phase 0 found | Change |
|---|---|---|---|
| 1 | Sports research exists in `docs/research.md` | It never existed | The research was done from scratch and lives in `docs/phase0/`. `SOURCES.md` replaces it as the source of truth. |
| 2 | Ship-to regions Gibraltar + Andorra | Owner's amendment | `ships_gi` (primary) and `ships_es` (fallback). Andorra removed everywhere. |
| 3 | Ship-to flags can be determined per retailer | They can, but only through a cart check, and robots.txt disallows `/cart/` on every Shopify shop | **The flags are manual config**, seeded from the 2 Oct evidence with a `verified_at` date. The app re-checks only the cheap, allowed `/meta.json` `ships_to_countries` list. If that list changes, the app raises a "re-verify shipping" alert. It never adds to cart. Flags older than 120 days are shown as stale. |
| 4 | Topps official sites are a primary source | Blocked from the sandbox IP by the Cloudflare WAF | Phase 1 step 1 is a **probe from the deployed Worker**. If it's blocked there too, Topps coverage comes from collectosk plus retailers, and Topps shipping stays `unknown`. |
| 5 | Pokémon Center is a buy source (assumed not to ship to GI/AD) | It ships to UK addresses only (official). The forwarder-cancellation claim is UNVERIFIED | It is used **only as a signal** (its Zendesk pre-order article). It is never shown as a place to buy. |
| 6 | KV for fast state | KV Free allows 1,000 writes a day | Per-source fetch state (ETag, next-due time, back-off, consecutive failures) lives in **D1**. KV only holds rarely written values such as the FX snapshot and cached config. |
| 7 | Cloudflare Free plan is implied | Free cron gets 10 ms CPU and 50 subrequests per run | **Workers Paid, $5/month, is required.** |
| 8 | Access identity is available in the Worker | `ctx.access` isn't passed to Workers with static assets | Hono middleware validates `Cf-Access-Jwt-Assertion` with `jose` against the team's JWKS. Two separate Access apps with **Bypass** cover `/ical/*` and `/push-receipt/*`. The `workers.dev` URL is turned off. |
| 9 | Gibraltar import duty applies | Since 15 Jul 2026 (the UK–EU treaty), a 15% Transaction Tax replaces import duty, clearance happens at EU posts in Spain, and the frontier has no customs controls. Since 1 Jul 2026, UK→ES parcels of €150 or less pay €3 per item plus 21% IVA | Tax and fee rates go in `config/rules.yaml` as an **informational** cost note per region. Ranking prefers an EU shop over a UK shop for the Spain fallback. The RRP gate stays on the item price (see decision D3). |
| 10 | The LLM is a cheap Claude model | Haiku 4.5 is the cheapest, but its retirement is listed as "not sooner than 15 Oct 2026" | The model ID lives in env config (`CLAUDE_MATCH_MODEL`), so a replacement is a one-line change. |

## 2. Decisions I need from you (each with my recommendation)

- **D1. Cloudflare Workers Paid ($5 a month).** Recommendation: **yes**. It's a requirement, not an option.
- **D2. Domain.** Cloudflare Access and Resend both need a domain on your Cloudflare account. Recommendation: use a subdomain of a domain you already own on Cloudflare, e.g. `drops.<yourdomain>`. Without a verified domain, Resend can only send to your own sign-up address from `onboarding@resend.dev`. That's acceptable to start with.
- **D3. Where RRP comes from.** Neither the brief nor any source gives UK RRPs for sports products. Recommendation:
  - Pokémon RRP comes from config, per product type (ETB, booster bundle, display), with an override per product.
  - Sports RRP is **entered by you** per product on the detail page.
  - Until you enter one, an estimate is used: the **median first-seen pre-order price across the shops**, labelled "Estimated RRP".
  - The ≤ RRP × 1.05 gate uses the item price only. Shipping and tax are shown alongside it, not folded in.
- **D4. Which shops go live in Phase 1.** Recommendation:
  - All "ships to GI" shops in both categories: Sports Cards Worldwide, Sports Cards Direct, Sports Trading Cards UK, King of Hoops, Tacticgames, Panini UK, Zatu, Pokemillon, Poke-Geek and Southern Light.
  - The best Spain-only shops: DutchBreakers, Sport Cards Center, SportyCards, Panini España, Total Cards, Pikamon, Metamorph and Titan Cards.
  - That's about 18 adapters. Most share one Shopify adapter plus per-shop config (pre-order tag rule, English marker).
- **D5. App name and URL path tokens.** No decision needed from you. The tokens are generated with `crypto.getRandomValues` (32 bytes, base64url) and stored as secrets.

## 3. Build order (each step is a reviewable commit or a few)

1. **Topps probe.** A minimal deployed Worker fetches the Topps robots.txt, `/release-calendar` and `/products.json` once, then logs status and headers. That settles assumption #4 before any code depends on it.
2. **Project skeleton.**
   - Wrangler 4 with `wrangler.jsonc`, the Cloudflare Vite plugin, React and TypeScript strict.
   - Hono, Vitest, ESLint and Prettier.
   - `compatibility_date: 2026-10-02` and `nodejs_compat` (needed by Sentry).
   - Assets in SPA mode with `run_worker_first` for `/api/*`, `/ical/*` and `/push-receipt/*`.
3. **`config/rules.yaml` + schema.** A zod-validated loader covering categories (UFC off), publishers and weights, tiers, configurations, exclusions, watchlist seeds, ship-to regions with tax notes, the RRP tolerance, cadences, and retailer definitions (platform, endpoint, pre-order rule, English marker, ships_gi/es with `verified_at`).
4. **D1 schema** (migrations):
   - **Shared:**
     - `sources`
     - `source_runs`: one row per run, with status, item count, error, duration.
     - `source_state`: ETag, last-modified, next_due_at, backoff_until, consecutive_failures.
     - `retailers`
     - `products`: canonical, with category, publisher, line, config, language and RRP.
     - `product_aliases`: raw title → product, with match method deterministic or llm.
     - `drops`: product × channel, with expected_at, precision and confidence.
     - `drop_date_history`
     - `listings`: product × retailer, with URL and current price/stock.
     - `stock_events`: in→out and out→in, timestamped.
     - `price_events`: price, currency, ratio to RRP, timestamped.
     - `fx_rates`
     - `llm_match_cache`
   - **Personal** (all with `owner_id`): `owners` (seeded with 1 row), `watchlist`, `score_overrides`, `pins`, `notifications`, `notification_deliveries`, `push_subscriptions`, `ical_tokens`.
5. **Adapter framework.**
   - The `SourceAdapter` interface: `fetch → parse → normalise → upsert`.
   - A polite fetcher:
     - UA `CardDeskDrops/<ver> (personal release tracker)`, robots.txt cached per host, and crawl-delay honoured.
     - Conditional GET.
     - Bot-challenge detection: 429/403 bodies, `cf-mitigated`, the Incapsula 200 body. A challenge counts as a **failure with no data**, never as an empty result.
     - Exponential back-off.
   - **Scheduler:** the one 15-minute cron picks due sources with the cadence rules (daily, 6 h, hourly when due within 48 h or watched, 15 min in the final 2 h). Work is spread across runs so each stays within limits.
6. **Adapters, each with fixtures and parser tests:**
   - `collectosk`, `checklistinsider`, `press-pokemon-na`, `press-pokemon-eu`, `pc-zendesk`, `tcg-sitemap`, `serebii`.
   - The generic `shopify` adapter, configured per shop.
   - `woocommerce-store` (SportyCards) and `panini-magento` (UK and ES).
   - `ecb-fx`.
   - The fixtures saved in `fixtures/phase0/` are the starting test data.
7. **Normalisation and de-duplication.**
   - The deterministic pass:
     - Title normalisation: season formats such as 2025-26 and 2025/26, "Hobby Box" and "Hobby", publisher, line, category, configuration keywords, and language markers in English, Spanish, French, Italian and Dutch.
     - Exclusion rules: stickers, Match Attax, blasters, hangers, single packs, blisters, mini tins, Japanese and other non-English stock, and baseball.
   - The LLM pass handles only titles that fail it. Results are cached in `llm_match_cache` and capped per day.
8. **Release-date handling.**
   - Confidence levels: rumoured, announced, confirmed date, confirmed time.
   - Source precedence: official > primary calendar > retailer.
   - Every change writes `drop_date_history` and a **date-moved event**. Conflicts between sources are stored and shown, not resolved silently.
9. **Market-signal capture.** Every listing poll diffs stock and price and appends `stock_events` and `price_events`. Nothing is displayed in v1.
10. **API + UI:**
    - Upcoming as a list plus a calendar, with category, label and region filters.
    - Live now.
    - Drop detail:
      - Countdown only when the time is confirmed; otherwise "Expected week of…" with a confidence badge.
      - Retailers with price, stock, the GI/ES flags with their verified date, and direct links.
      - Date history.
    - Mobile-first and dark.
11. **PWA and push.**
    - Manifest and service worker.
    - Push with `@block65/webcrypto-web-push` ≥ 2, sending Declarative Web Push JSON for iOS 18.4+ while the service worker parses the same payload.
    - The VAPID JWT is cached for ≤ 1 h.
    - The subscription flow is started from a user tap.
    - Badging API where supported.
12. **Delivery receipts and fallback.**
    - The service worker POSTs to `/push-receipt/<token>`.
    - Any critical alert without a receipt after 5 minutes goes out through Resend, checked on the next cron.
    - 404/410 marks the subscription dead, shows a banner and sends one email.
13. **Notification centre** with an unread count, plus the **iCal feed** at `/ical/<token>.ics` and per-drop `.ics` files with a VALARM.
14. **Sentry** (`@sentry/cloudflare` wrapping the whole export, so the cron is covered), then **deploy** behind Access with a custom domain.

Desk Score, the watchlist UI, the Source health page and the weekly brief remain Phase 2, as in the brief.

The Phase 1 alert triggers that need neither score nor watchlist ship with Phase 1. "New Priority drop" waits for the score in Phase 2.

The "source failing twice" alert ships with Phase 1, since failing silently is a v1 acceptance criterion.

## 4. What you'll need to provide during Phase 1

- A Cloudflare account on Workers Paid, with the domain on it.
- An API token for deployment, given to me as a session secret or run by you.
- A Resend API key.
- A Sentry DSN.
- An Anthropic API key, for the LLM match pass.

Secrets go in through `wrangler secret put`, never into the repo.
