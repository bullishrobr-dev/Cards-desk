# SOURCES.md — verified sources for Card Desk Drops

These sources were verified live on **2 October 2026** from the build sandbox. That sandbox is a US datacentre IP behind a proxy.

Evidence, quotes and raw samples are in `docs/phase0/*.md` and `fixtures/phase0/<slug>/`.

**Status values:**

- **live JSON**: a machine-readable endpoint works.
- **HTML only**: the page loads, but the data has to be parsed from server-rendered HTML.
- **blocked**: bot protection or a WAF stops us. These were tested from the sandbox, so they must be re-tested from the Worker.
- **dead**: gone, broken or stale.

**Ship-to values:** `yes` / `no` / `unknown`.

Retailer verdicts come from adding one item to a cart and asking the shop for shipping rates, done once by hand on 2 Oct. Shopify robots.txt disallows `/cart/`, so **the app will never repeat that check**. The flags live in config and are re-checked by hand (see the plan).

---

## 1. Release calendars and official sources (drive "what is coming")

| ID | Source | Category | Status | Endpoint used | Conditional GET | Cadence | Role |
|---|---|---|---|---|---|---|---|
| `collectosk` | collectosk.com release calendar | Football, F1 | **live JSON** (WP REST) + HTML table | `/wp-json/wp/v2/pages?slug=new-release-calendar&_fields=id,modified_gmt,content`; product posts at `/wp-json/wp/v2/posts?slug=…` | ETag + Last-Modified → 304 | Daily | **Primary sports calendar.** It covers Europe-only Topps releases (club tins, Bundesliga). `*/feed/` is disallowed, so no RSS. |
| `checklistinsider` | checklistinsider.com/release-calendar | Football, F1 | HTML only (`<time datetime>`) | `/release-calendar` | None | Daily | Cross-check only. It is US-centric, and its Panini date disagreed with collectosk once. |
| `press-pokemon-na` | press.pokemon.com TCG schedule | Pokémon | HTML only | `/en/Items/Schedule/Pokemon-Trading-Card-Game?types=3` | None | Daily (`Crawl-Delay: 5`) | **Primary Pokémon calendar** (official): set name and release date. |
| `press-pokemon-eu` | pokemon.gamespress.com/en-GB | Pokémon | HTML only | Home page and release pages | None | Daily (`Crawl-Delay: 5`) | Official UK/EU dates, prereleases and product lineups. |
| `pc-zendesk` | Pokémon Center help-centre API | Pokémon | **live JSON** | `support.pokemoncenter.com/api/v2/help_center/en-us/articles.json` (article "Estimated Preorder Release Dates") | ETag → 304 | Daily | Lineup and ship-window signal (UK rows). **Not a buy source** (see §3). |
| `tcg-sitemap` | tcg.pokemon.com sitemap | Pokémon | live XML | `/sitemap.xml` | ETag + LM → 304 | Daily | Cheap "new expansion page appeared" signal. |
| `serebii` | serebii.net English set list | Pokémon | HTML only | `/card/english.shtml` | None | Daily | Secondary cross-check. It matched all six official 2026 dates. |
| `pokebeach` | pokebeach.com home page | Pokémon | HTML (home only; articles are Cloudflare-challenged) | `/` | Last-Modified | Daily | Headlines only, always at confidence **rumoured**. |

**Upcoming confirmed (2 Oct 2026):**

- Topps Chrome F1 2026: 15 Oct (collectosk).
- Stadium Club Chrome UCL: 6 Oct (collectosk).
- Pokémon Mega Evolution—Delta Reign: 6 Nov, prereleases from 24 Oct (official press).

## 2. Retailers (drive "where to buy, price, stock")

All Shopify shops poll `/products.json?limit=250&page=N`, the full catalogue, because collection pages miss products. They send weak ETags that return 304 when nothing has changed. Shopify's Cloudflare layer sometimes returns a 429 "Verifying your connection" page that clears after about 5 s. That page must be treated as **no data**, never as an empty catalogue.

### 2a. Sports: football and F1

| Rank | ID | Retailer | Country | Platform / status | GI | ES | Pre-order signal | Notes |
|---|---|---|---|---|---|---|---|---|
| 1 | `sportscardsworldwide` | Sports Cards Worldwide | UK | Shopify, live JSON | **yes**, RM Intl Tracked £19.99 | yes, £19.99 | tag `status:Pre-Order` | Best tags (`sport:`, `format:`). Policy says the shop covers customs and import fees. |
| 2 | `sportscardsdirect` | Sports Cards Direct | UK | Shopify, live JSON | **yes**, DHL 41/49 (quoted in USD) | yes | tag `PRE-ORDER` | Widest football and F1 range. Already lists 2026 Chrome F1 Hobby and Mega. |
| 3 | `sportstradingcardsuk` | Sports Trading Cards UK | UK | Shopify, live JSON | **yes**, DHL 48 (USD) | yes, 53 (USD) | title prefix `Pre Order - ` | Buyer pays duties. |
| 4 | `kingofhoops` | King of Hoops | UK | Shopify, live JSON | **yes**, £9.99 (cart) / £14.99 (policy) | yes | none | Mostly basketball, small catalogue. |
| 5 | `tacticgames` | Tacticgames | FR | Shopify, live JSON | **yes**, €30 | yes, €20 | tag `Précommande` | |
| 6 | `dutchbreakers` | DutchBreakers | NL | Shopify, live JSON | no | yes, DHL 23 (USD) | none | Has 2026 Chrome F1 Hobby. |
| 7 | `sportcardscenter` | Sport Cards Center | ES (Madrid) | Shopify, live JSON | no | yes, €4.50 | release date in body text | Small catalogue. |
| 8 | `sportycards` | SportyCards | IT | WooCommerce Store API, live JSON | no | yes, €15 | title `PREORDER:` | No conditional GET. |
| 9 | `panini-uk` | Panini UK (official) | UK | Magento, HTML only (GraphQL 403) | **yes** (policy: £20 min order, 3–5 days) | n/a | none | Panini hobby lines. Category HTML parse. |
| 10 | `panini-es` | Panini España (official) | ES | Magento, HTML only | no | yes | none | |
| — | `deichcards` | deichcards.de | DE | Shopify | no | no | | **Price and release signal only.** Good `product_type: Fussball`. |

Not used: Get Sports Cards (UK-only for now), ScuzzCards and Otakura (no relevant stock), Stickerpoint (stickers). SuperCollectors and Collectorage are blocked.

### 2b. Pokémon (English sealed)

| Rank | ID | Retailer | Country | Platform / status | GI | ES | English marker | Pre-order signal |
|---|---|---|---|---|---|---|---|---|
| 1 | `zatu` | Zatu | UK | Shopify, live JSON (we wait 10 s between requests as a courtesy; its `Crawl-delay: 10` only names SEO bots) | **yes**, FedEx £17–22 | yes, £9.50–10.29 | default English | collection `pokemon-pre-orders` |
| 2 | `pokemillon` | Pokemillon | ES | Shopify, live JSON | **yes**, €19.90 certified | yes, from €4.50 | variant option `Idioma: Inglés` | tag `Reserva` |
| 3 | `pokegeek` | Poke-Geek | FR | Shopify, live JSON | **yes**, €33–42.50 | yes, from €6.99 | collection `etb-anglaise` | |
| 4 | `southernlight` | Southern Light TCG | **GI** | Shopify, live JSON | **yes**, local £0 | no | collection `pokemon-english` | Mostly JP/CN/KR; local pickup. |
| 5 | `totalcards` | Total Cards | UK | Shopify, live JSON | no | yes, £5.27–16.35 | | tag `pre-order` + "Release Date:" in body |
| 6 | `pikamon` | Pikamon | NL | Shopify, live JSON | no | yes, €18.95 | "– English" in title | tag `pre-order-Q42026` |
| 7 | `metamorph` | Metamorph Center | ES | Shopify, live JSON | no | yes, €4.95 | "- Inglés" | `[ RESERVA ]` prefix |
| 8 | `titancards` | Titan Cards | UK | Shopify, live JSON | no | yes, ~17 (USD) | | Household purchase limits |
| 9 | `thecardvault` | The Card Vault | UK | Shopify, live JSON (`Crawl-delay: 10`) | no (in practice) | yes, £17.77 | | |
| 10 | `todohits` | TodoHits | ES | Shopify, live JSON | unknown | likely (meta.json; cart test failed) | "\| Inglés" | `[Reserva]` |

Lower value, kept in reserve: Poke Iberian, PokedealTCG, PokeFamily, BaruZcard (ES only, small or unlabelled English ranges); Card-Corner (DE, HTML only, ES €14.99).

**Unverified:** Magic Madhouse is BigCommerce with a JavaScript-rendered grid, and Chaos Cards is behind a Cloudflare challenge.

## 3. Sources that don't work

| Source | Verdict | Consequence |
|---|---|---|
| **Topps official** (www, uk, de, es, fr, it, shop-uk) | **blocked from the sandbox**: Cloudflare WAF 403 on every path, including robots.txt, with any user agent | Topps GI/ES shipping and its `/release-calendar` are **UNVERIFIED**. First task of Phase 1: probe from the deployed Worker. Until then, Topps coverage comes from collectosk and retailers. |
| **pokemon.com** | blocked (Imperva 403 on every path) | Use the press sites instead. |
| **Pokémon Center UK storefront** | blocked (HTTP 200 with an Imperva challenge body) | **Ships to UK addresses only** (official FAQ quote), so it is useless for GI and ES. It is not a buy source; only the Zendesk article is used. Whether orders to forwarders get cancelled is UNVERIFIED: the FAQ only says "use your own… address rather than an alternate or forwarding address". |
| Pokémon Center Germany | shipping page blocked | ES shipping UNVERIFIED. Not used. |
| Panini America | JavaScript SPA, no data endpoint found | Not used. |
| Beckett | redirects to a maintenance page | dead for now |
| TCDB, Bulbapedia, Sports Collectors Daily, Cardmarket | Cloudflare challenge / 403 | blocked |
| Cardboard Connection | last updated Feb 2026 | dead (stale) |
| pokemontcg.io | HTTP 500 (moved to Scrydex, which needs a key) | dead |
| PokéCottage | stale; robots.txt blocks AI crawlers | not used |
| futbol.cards | only gives "Mid-October" windows | not used |
| Waxstat | client-rendered, no endpoint found | not used |

## 4. Reference data

| ID | Source | Status | Use |
|---|---|---|---|
| `ecb-fx` | ECB euro reference rates, `https://www.ecb.europa.eu/stats/eurofxref/eurofxref-daily.xml` | live XML, Last-Modified (verified 2 Oct) | Daily GBP/EUR/USD conversion. |
| `tcgdex` | api.tcgdex.net | live JSON, ETag → 304 | Canonical Pokémon set IDs **after** release (useful for de-dup). |
