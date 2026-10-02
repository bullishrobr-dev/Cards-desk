# Phase 0: official Pokémon sources and Pokémon Center UK

Verified live on **2026-10-02** with curl through the session proxy, using
`User-Agent: CardDeskDrops/0.1 (personal release tracker; research)`. I kept the
request count low and respected `Crawl-Delay: 5` on the GamesPress press sites.
Raw samples are under `fixtures/phase0/<slug>/`. Many are reduced to stripped text (`.txt`) so they stay small.

Scope: English-language Pokémon TCG sealed product (booster displays, ETBs,
booster bundles, special/premium sets and collections). Ship-to: Gibraltar (primary) and Spain (fallback).

---

## 1. Summary table

| Source | URL | Status (2026-10-02) | Shape | Conditional GET | Bot protection | Notes |
|---|---|---|---|---|---|---|
| pokemon.com (main site, news, product gallery, `/uk/`, sitemap, robots) | https://www.pokemon.com/… | **Blocked** (HTTP 403 on every path tried) | Incapsula block page | n/a | Imperva Incapsula (`visid_incap_2884021`, `x-iinfo`, "Request unsuccessful. Incapsula incident ID") | robots.txt is also 403. `pokemon.co.uk` 302s to `www.pokemon.com/uk/` (blocked). Not pollable. |
| events.pokemon.com Event Locator | https://events.pokemon.com/EventLocator/ | **Blocked** (403) | Incapsula | n/a | Incapsula | Prerelease dates have to come from press releases instead (see §2.4). |
| op-core.pokemon.com | https://op-core.pokemon.com/ | **Blocked** (403) | n/a | n/a | Incapsula | Tried as a possible API host. Nothing usable. |
| **TPCi press site (North America)** | https://press.pokemon.com/en/Items/Schedule/Pokemon-Trading-Card-Game?types=3 | **Live, HTML only** (200) | Server-rendered HTML table: product title, release date, link to `/en/products/<slug>` | **No** (no ETag or Last-Modified; `cache-control: private, s-maxage=0`) | None seen (GamesPress platform, ASP.NET) | **Best official source for set names and dates.** robots.txt: `Crawl-Delay: 5`, disallows only `/Files/*` and `/User/*`. No RSS (`/en/rss` 302s to a 404). |
| **TPCi press site (Europe / UK)** | https://pokemon.gamespress.com/en-GB/ | **Live, HTML only** (200) | Home page lists the latest releases. Each release is a static HTML page with EU-format dates | No (same platform) | None seen | **Best official source for EU/UK dates and prerelease dates.** Same robots policy (`Crawl-Delay: 5`). Also available in es, de, fr, it, nl, pl, pt and other locales. The schedule page is JS-hash driven (`/Items/Schedule#?itemType=N`), so parse the home page and release pages instead. |
| **tcg.pokemon.com** (TCG microsite) | https://tcg.pokemon.com/sitemap.xml, `/en-gb/all-expansions/`, `/en-gb/expansions/<slug>/` | **Live, HTML + XML sitemap** (200), with intermittent Incapsula interstitials | Static S3 + CloudFront. The sitemap lists every expansion slug per locale | **Yes**: ETag + Last-Modified, and both `If-None-Match` and `If-Modified-Since` returned **304** | Incapsula "Pardon Our Interruption" interstitial on some paths (e.g. `/en-gb/news/`, `/en-gb/where-to-buy/`) after a handful of requests | Good **change detector**: a new `expansions/<slug>` entry appears in the sitemap when an expansion page goes live. As of 2026-09-23 lastmod it has no `delta-reign` slug yet. No dates or product lineups in structured form. No robots.txt (404). |
| play.pokemon.com | https://play.pokemon.com/en-gb/ | Live, HTML (200, S3/CloudFront) | "What's New" list with dates | Not tested | Incapsula script present but did not block | News links point at www.pokemon.com, which is blocked. Low value. |
| **Pokémon Center support (Zendesk Help Center API)** | https://support.pokemoncenter.com/api/v2/help_center/en-us/articles.json | **Live JSON** (200) | Zendesk HC v2 JSON (`articles[]` with `id`, `title`, `body` HTML, `updated_at`) | **Yes**: `ETag` W/…, `If-None-Match` returned **304** | Cloudflare challenge on HTML `/hc/en-gb` pages. The JSON API passed | Only locale is `en-us`. Article **4407702295572 "Estimated Preorder Release Dates"** (updated 2026-10-01) lists PC preorders by region (US/CA/UK) with estimated ship windows. **High value.** robots.txt does not disallow `/api/v2/help_center/*/articles*` except `/stats/view`. |
| Pokémon Center UK storefront | https://www.pokemoncenter.com/en-gb (also `/robots.txt`, `/en-gb/shipping`, `/en-gb/category/trading-card-game`, `/en-de`) | **Blocked** (HTTP **200** but the body is an Incapsula challenge iframe, about 1 KB) | Incapsula challenge (`visid_incap_2682446`, `distil_referrer`) | n/a | Imperva Incapsula (Distil). Plus an official "virtual queue" (see §3.3) | Even robots.txt returns the challenge. **A naive poller would see a "200" status, so you must check the body for `Incapsula`.** No product listing or JSON reachable. |
| Global-e help centre (PC Germany/AU/NZ support) | https://service.global-e.com/de?id=258fdc3f-… | Live HTML (200) | Generic Global-e WordPress help centre | Not tested | None (robots `Crawl-delay: 10`) | Generic, not Pokémon-specific. It has no country list for PC Germany. |
| **Serebii** English set list | https://www.serebii.net/card/english.shtml | **Live, HTML** (200) | HTML table: set name, card count, release date | No validators seen (nginx) | None | Already lists **Delta Reign, Nov 6th 2026**. The card count is inconsistent: the index says 210, the set page says "???" with cards shown as "/128". robots.txt only disallows `/hidden/ranch/` and `/crossword/`. Good secondary. |
| **PokeBeach** | https://www.pokebeach.com/ | **Home page live** (200, has Last-Modified). **Articles and /feed: Cloudflare challenge** (403, `cf-mitigated: challenge`) | WordPress home: headlines + dates only | Last-Modified present on home | Cloudflare | Best rumour and lineup news source, but article bodies and RSS were not fetchable by curl. robots.txt allows everything. Use headlines only as signals. |
| Bulbapedia | https://bulbapedia.bulbagarden.net/ (wiki and `/w/api.php`) | **Blocked** (403, Cloudflare challenge, robots.txt included) | n/a | n/a | Cloudflare | Not pollable. |
| pokemontcg.io v2 API | https://api.pokemontcg.io/v2/sets | **Dead** (HTTP 500, empty body) | n/a | n/a | Cloudflare | The home page says "Pokémon TCG API – Now part of **Scrydex**". |
| Scrydex API (pokemontcg.io successor) | https://api.scrydex.com/pokemon/v1/expansions | 401 JSON `INVALID_CREDENTIALS` | JSON (needs an API key) | Not tested | Auth | **UNVERIFIED**: I guessed the path. The 401 JSON suggests it exists. It needs an account and key, and terms were not reviewed. |
| **TCGdex API** | https://api.tcgdex.net/v2/en/sets, `/v2/en/sets/<id>` | **Live JSON** (200) | JSON list of sets. The set detail has `releaseDate`, `serie`, `cardCount`, `abbreviation` | **Yes**: weak ETag, and `If-None-Match` returned **304** | None | **Released sets only.** Delta Reign is not listed yet; the last entry is `30th` with releaseDate 2026-09-16. Useful for canonical set IDs and names after release, not for upcoming drops. |
| PokéCottage release calendar | https://pokecottage.com/pokemon-set-release-calendar | Live HTML (Squarespace) | Prose calendar (EN + JP) | Not tested | None. robots.txt blocks AI crawlers (ClaudeBot, GPTBot, anthropic-ai, etc.) and `?format=json` | **Stale/inaccurate on 2026-10-02**: it still says "30th Celebration is Coming Soon" and gives the wrong market in the FAQ. Do not use as a source. |
| Cardmarket expansions | https://www.cardmarket.com/en/Pokemon/Expansions | Blocked (403 Cloudflare) | n/a | n/a | Cloudflare | Owned by the retailer agent. Only noted here. |

**Recommendation (official schedule):** poll **press.pokemon.com** (NA schedule table)
and **pokemon.gamespress.com/en-GB/** (EU releases) at most once a day, at ≥5 s
spacing. Use the **Pokémon Center Zendesk "Estimated Preorder Release Dates"
article** (JSON with ETag) for PC UK product lineups and ship windows. Use the
**tcg.pokemon.com sitemap** (ETag/304) as a cheap "new expansion page" signal.
Use **Serebii** as a secondary cross-check, and **PokeBeach headlines** as
rumour/early-signal input (always at confidence "rumoured" until confirmed by a press release).

---

## 2. Official English-language release schedule

### 2.1 pokemon.com is not pollable
Every www.pokemon.com path I tried returned **HTTP 403** with an Imperva Incapsula block page:
`/robots.txt`, `/us/pokemon-tcg/product-gallery`, `/uk/pokemon-news`,
`/us/pokemon-news/rss`, `/sitemap.xml`, `/uk/`, `/us/play-pokemon`, `/us/api/news`.
Evidence: `set-cookie: visid_incap_2884021=…` and the body text "Request unsuccessful. Incapsula incident ID: 1015000071761602616-…".
Fixtures: `fixtures/phase0/pokemon-com/robots-403.txt` and `product-gallery-403.headers`.
I made no attempt to get around it. Product pages on pokemon.com (where TPCi
posts full product lineups) are therefore **unavailable** to the app.

### 2.2 press.pokemon.com (TPCi NA press site, GamesPress platform), recommended
- The TCG schedule at `https://press.pokemon.com/en/Items/Schedule/Pokemon-Trading-Card-Game?types=3` is a server-rendered list of
  `Product | Release date` rows, newest first, each linking to `/en/products/<slug>`.
  Fixture: `fixtures/phase0/press-pokemon/schedule-tcg.html`.
- Top rows as of 2026-10-02 (quoted):
  - "Pokémon TCG: Mega Evolution—Delta Reign · November 6, 2026"
  - "Pokémon TCG: 30th Celebration · September 16, 2026"
  - "Pokémon TCG: Mega Evolution—Pitch Black · July 17, 2026"
  - "Pokémon TCG: Mega Evolution—Chaos Rising · May 22, 2026"
  - "Pokémon TCG: Mega Evolution—Perfect Order · March 27, 2026"
  - "Pokémon TCG: Mega Evolution—Ascended Heroes · January 30, 2026"
- Product pages (e.g. `/en/products/Pokemon-TCG-Mega-EvolutionDelta-Reign`) show Title and Release date. Media alerts load through JS (`/en/Items/FetchTabContent?productId=514…`). I did not reverse-engineer that endpoint (a guessed parameter returned 404).
- Press releases (`/en/releases/<slug>`) contain **product lineups**. For example, the 30th Celebration media alert (9/16/2026) lists the Elite Trainer Box, Poster Collection, Tech Sticker Collection, Pokémon ex Box and Knock Out Collection, and says "Fans can also look forward to more *30th Celebration* products releasing later in 2026."
  Fixture: `press-pokemon/rel-MEDIA-ALERT-…30th-Celebration….txt`.
- No RSS, no ETag. The page is about 41 KB, so a daily poll with a content hash is cheap.
- Caveat: these are **North America (US)** dates. EU dates usually match but should be checked against the EU press site.

### 2.3 pokemon.gamespress.com (TPCi Europe press site), recommended for UK/EU
- Home `https://pokemon.gamespress.com/` (en-GB) lists recent releases, including
  `/en-GB/MEDIA-ALERT-New-Pokemon-Trading-Card-Game-Mega-EvolutionDelta-Reign-Ex`.
- That release (dated **20/08/2026**) states:
  > "The Pokémon Company International announced today that a new expansion for the bestselling Pokémon Trading Card Game (TCG) will be available at participating retailers around the world beginning 6 November 2026."
  > "Fans of the Pokémon TCG can find *Mega Evolution—Delta Reign* in booster packs, Elite Trainer Boxes and various collections at participating retailers worldwide."
  > "…Prerelease tournaments held as part of the Play! Pokémon program, taking place beginning 24 October 2026 at participating independent retailers."
  > "…starting 5 November 2026 via the Pokémon TCG Live app…"

  Fixture: `fixtures/phase0/pokemon-gamespress-eu/delta-reign-media-alert.txt`.
- EU PR contact listed: Hope & Glory. A Spain locale exists (`/es/`).

### 2.4 Play! Pokémon / prerelease dates
- `events.pokemon.com` (Event Locator) is **blocked** (Incapsula 403).
- `play.pokemon.com/en-gb/` loads (S3). Its "What's New" shows "28 September 2026 – Get a Pokémon TCG: Mega Evolution—Delta Reign Build & Battle Box Early", but the article link is on www.pokemon.com (blocked).
- **Best available official prerelease date:** EU press release, "beginning 24 October 2026" for Delta Reign (quoted above).

### 2.5 tcg.pokemon.com (TCG microsite)
- Static S3/CloudFront site with `https://tcg.pokemon.com/sitemap.xml` (about 150 KB, 1,182 URLs, all locales including `en-gb` and `es-es`). It sends `ETag` and `Last-Modified`, and **304 works**.
- `/en-gb/all-expansions/` lists: 30th Celebration, Pitch Black, Chaos Rising, Perfect Order, Ascended Heroes, Phantasmal Flames, Mega Evolution, then Scarlet & Violet sets. **Delta Reign is not present yet** (sitemap lastmod 2026-09-23).
- Expansion pages are marketing HTML ("Available now!") with no release date or product list in structured form.
- Some paths (`/en-gb/news/`, `/en-gb/where-to-buy/`) returned Incapsula's "Pardon Our Interruption" interstitial, so poll this site lightly.
- Fixtures: `tcg-pokemon-com/sitemap-head.xml`, `en-gb_all-expansions.txt`, `en-gb_expansions_30th-celebration.txt`, `en-gb_news-incapsula-interstitial.html`.

### 2.6 Secondary calendars, assessed
| Source | Accuracy vs official (spot check) | Freshness | Verdict |
|---|---|---|---|
| Serebii `/card/english.shtml` | All six 2026 dates match press.pokemon.com exactly (Jan 30, Mar 27, May 22, Jul 17, Sep 16, Nov 6) | Already has Delta Reign | **Good secondary.** Treat card counts as unreliable (210 on the index vs "???" on the set page). |
| PokeBeach | Headlines only (articles behind a Cloudflare challenge) | Same-day (e.g. 2026-10-01 "Pokemon to Release First-Ever Valentine's Day TCG Set!"; 2026-09-30 "'Delta Reign' Preorders Now Live on Pokemon Center!") | **Early-signal only**: headlines without bodies, so mark as rumoured. |
| TCGdex API | `30th` releaseDate 2026-09-16 matches | Released sets only | Use for canonical set IDs after release. |
| pokemontcg.io | n/a (API returns 500) | Dead / migrated to Scrydex | Do not use. |
| Bulbapedia | not reachable | n/a | Do not use (Cloudflare). |
| PokéCottage | Wrong ("30th Celebration is Coming Soon"; FAQ says 30th releases "in Japan on September 16, 2026") | Stale | Do not use. robots.txt disallows AI crawlers. |

---

## 3. Pokémon Center UK

### 3.1 Platform and bot protection
- `https://www.pokemoncenter.com/en-gb` and every other storefront path tried (including `/robots.txt`, `/en-gb/shipping`, `/en-gb/help`, `/en-gb/category/trading-card-game`, `/en-de`, `/de-de`) return **HTTP 200 with a roughly 1 KB Imperva Incapsula challenge page** (cookies `visid_incap_2682446`, `incap_ses_…`; inline `distil_referrer` script; "Request unsuccessful. Incapsula incident ID").
  Fixture: `fixtures/phase0/pokemoncenter-uk/en-gb-root.txt`.
- **No product listing or JSON is reachable.** I did not verify any storefront API path. A guessed `/tpci-ecommweb-api/product` also returned the challenge, so it is **UNVERIFIED**.
- Storefront platform: **UNVERIFIED** (I could not see the page source past the challenge).
- Regions operated (official): "The Pokémon Company International operates Pokémon Center websites for the US, Canada, the UK, Germany, Australia, and New Zealand." (support article 360000247054). Regional URLs from article 360051729272: UK `https://www.pokemoncenter.com/en-gb`, Germany `https://www.pokemoncenter.com/en-de`. **There is no Spain, Gibraltar or other EU storefront.**

### 3.2 Shipping coverage (official, quoted)
Source: Zendesk article **"Pokémon Center UK FAQ"**,
https://support.pokemoncenter.com/hc/en-us/articles/4410136975892 (updated 2026-07-16), fetched as JSON from `/api/v2/help_center/en-us/articles.json`:

> "Where does Pokémon Center UK ship?
> Orders from Pokémon Center UK are only shipped to addresses in the United Kingdom. We are unable to ship to PO boxes and BFPO addresses."

- **Gibraltar:** the FAQ does not name Gibraltar. Gibraltar is a British Overseas Territory and is not part of the United Kingdom, so under the quoted rule **PC UK does not ship to Gibraltar**. This is an inference from the official wording. The PC UK shipping-page country selector (`/en-gb/shipping`) is behind Incapsula and could not be checked, so the explicit country list is **UNVERIFIED**.
- **Spain:** PC UK ships only to UK addresses, so not to Spain (official). **Pokémon Center Germany** (`/en-de`) is the only EU storefront. Its support "is managed by our global fulfilment partner, Global-e" (article 38669040904212). **Whether PC Germany ships to Spain is UNVERIFIED**: its shipping page is behind Incapsula, and the Global-e help centre is generic with no country list. Recommended follow-up: a manual browser check of `https://www.pokemoncenter.com/en-de` → footer "Shipping".
- Also from the UK FAQ: "Pokémon Center UK shares credentials only with Pokémon Center Germany." It also gives the shipping cost as "Free shipping for all orders £20 and over" and "£5 flat fee" below that.
- General support article "Where does Pokémon Center Ship?" (360000380473) only says: "Navigate to Pokémon Center and scroll to 'Shipping' at the bottom of the page to see where we ship in your region."

### 3.3 Forwarders / reshippers and cancellations
- **Official (quoted):** "30th Celebration TCG FAQ", https://support.pokemoncenter.com/hc/en-us/articles/51588609258644 (updated 2026-08-24), under "Why can't I check out?":
  > "Use your own trusted and accurate address rather than an alternate or forwarding address."
- **Official (quoted), cancellation reasons:** "Why was my order canceled?" (360000554174):
  > "The most common reasons why an order gets canceled or partially canceled is if a product is no longer available or the credit card on file has changed since the order was placed."
- Virtual Queue article (37286495522452): "Only shop within your region… Refrain from using a VPN."
- **Not found in official text:** an explicit statement that orders shipped to package-forwarder or reshipper addresses **will be cancelled**. The official text above only advises against forwarding addresses as a checkout-failure cause. The Terms of Use / Shipping Policy pages on pokemoncenter.com are behind Incapsula, so I could not check them. The working assumption "PC may CANCEL orders to forwarders" is therefore **UNVERIFIED** as an official policy, though official guidance does discourage forwarding addresses.
- **Community reports (anecdotal):** none collected. PokeBeach article bodies and Reddit were not fetched. Treat any such claim as anecdotal until sourced.
- Practical conclusion for the app: mark Pokémon Center UK as **`ships_to_gibraltar: no` (inferred from the official "UK addresses only" wording)** and **`ships_to_spain: no`**, with Pokémon Center Germany → Spain as **`unknown`**.

### 3.4 How drops and releases are announced
- **Virtual queue** (official article 37286495522452): "Pokémon Center uses a virtual queue to access the site… does not necessarily mean a product is launching. Waiting in line does not guarantee product availability." The queue vendor is **UNVERIFIED** (Imperva Waiting Room is plausible given the Incapsula front, but I have not confirmed it).
- **Early Access** (35134190572564): invitation by newsletter email. "Currently, only customers in the United States, Canada, and the United Kingdom are eligible…"
- **Restocks** (23363169957012): "Announcements and information regarding upcoming products will be featured on the Pokémon Center website or Pokémon's social media feeds."
- **Estimated Preorder Release Dates** (4407702295572, "Last updated: October 2026", `updated_at` 2026-10-01T16:18:08Z), quoted rows relevant to scope:

| Item | Region | Est. ship |
|---|---|---|
| Pokémon TCG: Mega Evolution—Delta Reign Pokémon Center Elite Trainer Box | US, CA, UK | Early November 2026 |
| Pokémon TCG: Mega Evolution—Delta Reign Booster Bundle (6 Packs) | US, CA, UK | Early November 2026 |
| Pokémon TCG: Mega Evolution—Delta Reign Booster Display Box (36 Packs) | US, CA, UK | Early November 2026 |
| Pokémon TCG: 30th Celebration Booster Bundle (6 Packs) (+ Mini Tins, out of scope) | US, CA, UK | Early October 2026 |
| Pokémon TCG: 30th Celebration Pokémon Center Elite Trainer Box; 30th Tech Sticker Collection (Alolan Exeggutor / Lucario); 30th Celebration Knock Out Collection; Eevee Card with 2 Booster Packs & Coin | UK | Mid to late November 2026 |

  Fixture: `fixtures/phase0/pokemoncenter-uk/zendesk-article-4407702295572-preorder-dates.json` (ETag W/"5f23a6d1…", 304 confirmed).
  This is the **only machine-readable official PC lineup source** I found.
- PC UK operational notice (50307248393748, updated 2026-08-12): "We are currently experiencing delays affecting some orders for our UK customers."

---

## 4. English-language product availability in Spain
- No official TPCi statement on English-language distribution in Spain was found.
- `tcg.pokemon.com/es-es/` is the Spanish-language site (Spanish set names, e.g. "Megaevolución-Oscuridad Absoluta" for Pitch Black). That indicates Spanish-language product is the local edition. **English-product availability at Spanish retail is UNVERIFIED** and is left to the retailer agent.
- The EU press site has a Spanish locale (`pokemon.gamespress.com/es/`), which is also Spanish-language PR.

---

## 5. Upcoming English set / product schedule (next ~6 months from 2026-10-02)

Confidence levels: **confirmed date** = an official TPCi source gives a specific date. **announced** = officially announced, but no date or product detail. **rumoured** = secondary or unofficial only.

| Date | Set / product | Product types (in scope) | Confidence | Source |
|---|---|---|---|---|
| 2026-10-24 (start) | Mega Evolution—Delta Reign **prerelease** events (Play! Pokémon) | n/a (events; Build & Battle Box) | confirmed date | pokemon.gamespress.com Delta Reign media alert, 20/08/2026 |
| Early Oct 2026 (PC ship est.) | 30th Celebration Booster Bundle (PC UK preorder) | Booster bundle | confirmed (PC ship window, not a street date) | PC Zendesk 4407702295572 |
| 2026-11-06 | **Pokémon TCG: Mega Evolution—Delta Reign** | Booster packs, Elite Trainer Boxes, "various collections" (official). PC lists PC ETB, Booster Bundle (6), Booster Display Box (36) | **confirmed date** | press.pokemon.com TCG schedule; pokemon.gamespress.com media alert; PC Zendesk 4407702295572 ("Early November 2026") |
| Mid–late Nov 2026 (PC UK ship est.) | 30th Celebration PC ETB, Tech Sticker Collections, Knock Out Collection (PC UK) | ETB, collections | confirmed (PC UK ship window) | PC Zendesk 4407702295572 |
| "later in 2026" | Additional 30th Celebration products | unspecified | announced (no date or lineup) | press.pokemon.com 30th Celebration media alert, 9/16/2026 |
| TBD | ex★ Series (Raikou, Entei, Suicune). Mega Rayquaza ex, Mega Darkrai ex, Mega Greninja ex, Mega Zygarde ex, Mega Lucario Z ex "coming soon" | unspecified | announced (no date, set name or product) | press.pokemon.com "Pokémon Celebrates 30 Years…" 8/31/2026 |
| TBD (likely early 2027) | "First-Ever Valentine's Day TCG Set" | unknown | **rumoured** (headline only, article body blocked) | PokeBeach headline 2026-10-01 |
| Jan–Mar 2027 | Next main English expansion after Delta Reign | unknown | **UNVERIFIED**: no official or secondary source found | none (press.pokemon.com schedule ends at Delta Reign) |

Recently released, for context (all confirmed, press.pokemon.com): 30th Celebration 2026-09-16; Pitch Black 2026-07-17.

---

## 6. Open items / UNVERIFIED
1. Explicit PC UK / PC Germany shipping country lists: the storefront `/shipping` pages are behind Incapsula. Needs a manual browser check.
2. Whether PC Germany ships to Spain: unverified.
3. An official forwarder-cancellation policy: not found. Only "use your own… address rather than an alternate or forwarding address" (official).
4. Virtual-queue vendor: unverified.
5. Next main set after Delta Reign (early 2027): not yet officially scheduled on any reachable source.
6. Scrydex API terms and endpoints: not reviewed (needs an API key).
