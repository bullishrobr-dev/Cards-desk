# Phase 0 — UK & EU sports-card retailers (football / F1 sealed)

Verified live on **2026-10-02** with curl/requests through the session proxy, UA
`CardDeskDrops/0.1 (personal release tracker; research)`, 1.5–2 s between requests per host.
Scope: UK + EU shops selling sealed Topps/Panini football & F1 (hobby / breaker / jumbo / mega / premium).
Official publisher stores (topps.com regional stores etc.) are out of scope (other agent).

Shipping was tested **only** by adding one item to a cart and asking the platform for rates
(Shopify `POST /cart/add.js` → `GET /cart/shipping_rates.json`; WooCommerce Store API
`POST /cart/add-item` → `POST /cart/update-customer`). Only country + postcode (+ ES province) were sent.
Cart cleared afterwards. No checkout, no account, no personal data.

Raw samples: `fixtures/phase0/<slug>/` (products truncated to a few items, `body_html` cut to 300 chars).

## Ranked summary

Rank = ships to GI > ships to ES only > neither, then machine-readability.

| # | Retailer | Country | Platform | Status | JSON endpoint | GI | ES | Cond. GET | Notes |
|---|---|---|---|---|---|---|---|---|---|
| 1 | Sports Cards Direct (sportscardsdirect.co.uk) | UK (Plymouth) | Shopify | live JSON (intermittent CF challenge) | `/products.json`, `/collections/<h>/products.json` | **YES** — DHL Economy Select 41.00 / Express 49.00 (shown in USD, 4 d / 2 d) | **YES** — same, 3 d / 1 d | ETag → **304** | Best football+F1 breadth; pre-orders = tag `PRE-ORDER` + title suffix `- Pre-Order`; `product_type` `f1`/`football` |
| 2 | Sports Cards Worldwide (sportscardsworldwide.com) | UK (Plymouth) | Shopify | live JSON (intermittent CF challenge) | `/products.json` | **YES** — Royal Mail International Tracked £19.99 | **YES** — £19.99 | ETag → **304** | Best structured tags (`status:Pre-Order`, `sport:Soccer`, `format:Hobby Box`, `year:`, `league:`); policy says shop covers customs/import fees |
| 3 | King of Hoops (kingofhoops.co.uk) | UK | Shopify | live JSON | `/products.json` | **YES** — "Express International" £9.99 (cart); policy lists Gibraltar, £14.99 Europe | **YES** — £9.99 (cart) | ETag → **304** | Small catalogue (108), mostly basketball; soccer/F1 tagged `Soccer`/`F1`; no pre-order marker seen |
| 4 | Sports Trading Cards UK (sportstradingcardsuk.com) | UK | Shopify | live JSON (CF challenge on meta.json once) | `/products.json` | **YES** — DHL Express Worldwide 48.00 (USD) | **YES** — 53.00 (USD) | ETag → **304** | Pre-orders = title prefix `Pre Order - `; tags/product_type mostly empty; duties = buyer |
| 5 | Tacticgames (tacticgames.fr) | FR (Paris) | Shopify | live JSON (intermittent CF challenge) | `/products.json` | **YES** — Standard International €30.00 | **YES** — €20.00 (2–8 d) | ETag → **304** | Pre-order tag `Précommande`; shipping-policy page empty |
| 6 | DutchBreakers (dutchbreakers.com) | NL (Eindhoven) | Shopify | live JSON (CF challenge first try) | `/products.json` | **NO** — 422 "Country/region not supported" | **YES** — Standard DHL 23.00 / insured 26.00 (USD), 3–5 d | ETag → **304** | Has 2026 Chrome F1 Hobby; tags empty; no pre-order marker |
| 7 | Sport Cards Center (sportcardscenter.com) | ES (Navalcarnero, Madrid) | Shopify | live JSON (CF challenge on robots / first try) | `/products.json` | **NO** — 422 "El país o la región no se admite." | **YES** — Estándar €4.50 | ETag → **304** | Small (68 products); tags are SEO noise; release date sometimes in body (`RELEASE DATE: 27/08/2026`) |
| 8 | SportyCards (sportycards.it) | IT (Sesto San Giovanni) | WooCommerce | live JSON (Store API) | `/wp-json/wc/store/v1/products` | **NO rates** (cart accepted GI, 0 rates) | **YES** — "Tariffa unica" €15.00 | **none** (no ETag / Last-Modified) | Pre-orders = title prefix `PREORDER:` + category `Preordini`; variations "apri in live" vs "spedito a casa" |
| 9 | ScuzzCards (scuzzcards.com) | ES (inferred) | WooCommerce | live JSON (Store API) | `/wp-json/wc/store/v1/products` | **NO rates** | **YES** — €2.00–€7.00 (Ordinario/Certificado/Vinted Go/InPost) | Last-Modified sent, IMS → **200** (not honoured) | Mostly singles/tins; few sealed hobby boxes |
| 10 | Otakura (otakura.com) | IT | Shopify | live JSON | `/products.json` | **NO** — 422 "Paese o area geografica non supportati" | **YES** — BRT Express 30.00 / FedEx 44.00 (USD) | ETag → **304** | Now ~all Pokémon/One Piece; no football in first 250 — low value |
| 11 | Stickerpoint (stickerpoint.es) | ES storefront, ships from DE (DHL/Deutsche Post) | osCommerce-style PHP | HTML only | none found | **UNVERIFIED** — not in country list | **YES** (policy) — €9.90 | none observed | Mostly stickers (excluded); has a "Topps Hobby Boxes" category |
| 12 | deichcards.de | DE (Bremen) | Shopify | live JSON | `/products.json` | **NO** — 422 "Land/Region wird nicht unterstützt" | **NO** — 0 rates; Spain absent from EU table in policy | ETag → **304** | Good football catalogue with `product_type: Fussball`; useful as price/release signal only |
| 13 | Get Sports Cards (getsportscards.co.uk) | UK (Wellington) | Shopify | live JSON | `/products.json` | **NO** — 0 rates | **NO** — 0 rates; "Shipping quotes for orders outside the UK will be available soon." | ETag → **304** | UK-only for now |
| — | SuperCollectors (supercollectors.es) | ES | unknown (SiteGround) | **BLOCKED** | — | UNVERIFIED | UNVERIFIED | — | every request → 202 + `sg-captcha: challenge` meta-refresh |
| — | Collectorage (collectorage.com) | ES (Madrid) | WordPress (per URL shape; unverified) | **BLOCKED** | — | UNVERIFIED | UNVERIFIED | — | 403 `cf-mitigated: challenge` ("Just a moment...") incl. robots.txt and wc/store API |

Dropped after checking (not EU/UK card retailers): **sidekicks.co.uk** (Shopify fashion store — `products.json` returns UGG/hoodies; the Topps article is just a blog), **distritomax.com** (`meta.json`: `"country":"MX","currency":"MXN"`), **cardsbype.nl** (custom PHP, title "Pokémon TCG shop met live pack openings op Twitch"; `/products.json` 404). Zavvi (value boxes only) not probed.

## Cross-cutting findings

- **Shopify is the dominant platform** (10 of 13 working shops). `/products.json?limit=250` works on all 10; fields per product: `id, title, handle, body_html, published_at, created_at, updated_at, vendor, product_type, tags[], variants[], images[], options[]`; per variant: `id, title, price, compare_at_price, available, sku, grams, requires_shipping, taxable, option1-3, created_at, updated_at`. Prices are in the shop's base currency (see `/meta.json` `currency`). No release-date field anywhere; release dates only occasionally in `body_html` free text.
- **Conditional GET works on every Shopify shop tested**: response carries weak `ETag: W/"page_cache:<shop_id>:ProductListController:<hash>"`; replaying with `If-None-Match` returned **304** on all 10. No `Last-Modified` on Shopify.
- **Bot protection (Shopify edge / Cloudflare)**: intermittent `HTTP/2 429` + `cf-mitigated: challenge` + HTML "Verifying your connection..." on `/products.json` and `/meta.json` (seen on SCD, SCW, Tacticgames, STC-UK, Otakura, DutchBreakers, Sport Cards Center). Always cleared on retry after ~4–5 s. Our egress was a US datacenter (cf-ray `…-IAD`) — production poller needs retry-with-backoff and must treat 429 HTML as "no data", never as "empty catalogue".
- **robots.txt**: all Shopify shops use the stock Shopify file — `/products.json` and `/collections/*/products.json` are **not** disallowed; disallowed are `/collections/*sort_by*`, `/collections/*+*`, `*/collections/*filter*&*filter*`, `/recommendations/products`, cart/checkout/account. WooCommerce shops (scuzz, sportycards) don't disallow `/wp-json/`.
- **Shipping-rate currency**: several Shopify shops returned rates in **USD** (`"currency":"USD"`) because the request geolocated to the US; amounts above are as returned, not converted. Spain requires a province on Shopify (`{"province":["Select a province"]}` 422 without it; `province=MA` worked).
- **Customs/VAT**: no shop page fetched mentions **IOSS** or DDP (grep across all fetched HTML/policy text = 0 hits); Shopify rate objects all had `"incoterm": null`. No retailer says anything specific about Gibraltar duties. Statements found are quoted per retailer below. UK→ES and anything→GI should be assumed **duties/VAT may be collected on delivery** unless the shop states otherwise (only SCW does).
- **Pre-order signalling is per-shop**: tag `PRE-ORDER` (SCD), tag `status:Pre-Order` (SCW), tag `Précommande` (Tacticgames), title prefix `Pre Order - ` (STC-UK), title prefix `PREORDER:` + category `Preordini` (SportyCards). Others: none — pre-orders look like normal products with `available:false` or `true`.
- **Collection endpoints are not reliable filters**: SCD `/collections/formula-1/products.json` returned McLaren / Turbo Attax items but **not** the three 2026 Chrome F1 pre-orders (those carry `product_type:"f1"` and tags `["formula 1","PRE-ORDER"]`). Poll the full `/products.json` (paged) and filter client-side.

---

## Per-retailer evidence

### 1. Sports Cards Direct — https://www.sportscardsdirect.co.uk  (slug `sportscardsdirect`)
- `/meta.json`: `"name":"Sports Cards Direct","city":"Plymouth","province":"England","country":"GB","currency":"GBP","myshopify_domain":"sports-cards-direct-uk.myshopify.com"`.
- Platform: Shopify (`powered-by: Shopify`, `server: cloudflare`). First `/products.json?limit=3` → **429 `cf-mitigated: challenge`** (headers in `fixtures/phase0/sportscardsdirect/challenge_429.headers.txt`); retry → 200.
- 250 newest products span only 2026-09-10 → 2026-10-01 (lots of singles/slabs) → must paginate (`&page=N`).
- Excerpt:
  ```json
  {"id":15890331926902,"title":"Topps Chrome Formula 1 2026 Hobby Box - Pre-Order","handle":"topps-chrome-formula-1-2026-hobby-box-pre-order","published_at":"2026-10-01T14:07:27+01:00","vendor":"Topps","product_type":"f1","tags":["formula 1","PRE-ORDER"],"variants[0]":{"price":"649.99","compare_at_price":null,"available":false,"grams":450}}
  ```
  Also: `Topps Chrome Formula 1 2026 Mega Box - Pre-Order` 174.99, `Topps Royalty Premier League EPL 2026 Hobby Box` 2499.99 (`product_type: football`). Top tags: `Margin Scheme`(173), `Slab`, `football`(16), `PRE-ORDER`(12), `formula 1`(3).
- Conditional GET: `ETag: W/"page_cache:53098676400:ProductListController:d929…"` → `If-None-Match` → **304**.
- Shipping (cart test item £74.99, 50 g):
  - GI (`country=GI, zip=GX11 1AA`): `ECONOMY SELECT 41.00 USD (4 days)`, `EXPRESS WORLDWIDE 49.00 USD (2 days)`, source `DHL Commerce`.
  - ES (`country=ES, province=MA, zip=29001`): same prices, 3 d / 1 d.
  - Homepage localization list includes `iso_code: 'GI', name: 'Gibraltar', currency_code: 'GBP'`.
  - `/policies/shipping-policy` covers **UK delivery only** (DPD tiers, "Free Shipping - DPD £200.00 and up"); no international, customs or IOSS text.

### 2. Sports Cards Worldwide — https://sportscardsworldwide.com  (slug `sportscardsworldwide`)
- `/meta.json`: `"city":"Plymouth","country":"GB","currency":"GBP","myshopify_domain":"8415bc-2.myshopify.com"` (same city as SCD; relationship not verified).
- Shopify; first `/products.json` call → 429 challenge, retry OK.
- Rich structured tags: `availability:Active`, `sport:Soccer`(154/250), `brand:Panini`, `format:Hobby Box`, `status:New Release`, `status:Pre-Order`, `year:2025/26`, `product-line:Prizm`, `league:Serie A`. 28/250 bodies contain "Release date: …" text (e.g. "Release date: October 20th, 2023").
- Excerpt: `{"title":"Panini Serie A Soccer 2025/26 International Box","product_type":"Sports Card","tags":["availability:Active","brand:Panini","format:Hobby Box","league:Serie A","sport:Soccer","status:New Release","status:Pre-Order","year:2025/26"],"price":"129.99","available":false}`
- Conditional GET → **304**.
- Shipping (cart item £59.99): GI → `Royal Mail International Tracked 19.99 GBP`; ES → same.
- Policy quote: "Royal Mail - International £20 on orders between £0 and £500 / Free over £500 Fully Tracked … Customs and import fees for international buyers: We cover any customs or import fees that may occur. Everything is covered on our end." (Mechanism — IOSS/DDP — not stated.)

### 3. King of Hoops — https://kingofhoops.co.uk  (slug `kingofhoops`)
- Shopify, 108 products total, mostly basketball; football hits e.g. `2026 Panini Prizm FIFA World Cup Soccer - Hobby Box` 749.99 `available:false`, tags `["Hobby Boxes","Soccer"]`. Tags include `F1`(3). No pre-order marker.
- Conditional GET → **304**.
- Shipping (cart item £674.99): GI → `Express International 9.99 GBP (2–11 d)`; ES → same.
- Policy: "We deliver to: … Gibraltar (EU) … Spain (EU) …" (sic — Gibraltar is not EU); "Europe International Tracked & Signed Delivery … Spain … 3-4 working days £14.99"; "Import duties, taxes and charges for shipment to Non-EU counties are not included". Note £14.99 policy vs £9.99 cart rate — discrepancy, trust checkout.

### 4. Sports Trading Cards UK — https://sportstradingcardsuk.com  (slug `sportstradingcardsuk`)
- Shopify; `/meta.json` hit 429 challenge once. Tags and `product_type` essentially empty; vendor = shop name.
- Pre-orders: title prefix, e.g. `Pre Order - 2025-26 Upper Deck Splendor Hockey Hobby Box` (tags `[]`).
- Football: `2025-26 Topps UEFA Club Competitions Museum Collection Soccer Hobby Box` 595.00 available; `2025/26 Panini Prizm FIFA Soccer Hobby Box` 425.00.
- Conditional GET → **304**.
- Shipping (cart item £70): GI → `DHL Express Worldwide 48.00 USD`; ES → `53.00 USD`. Country selector `<option value="GI">Gibraltar (GBP £)` and `Spain (EUR €)`.
- Policy: "DHL Worldwide available at checkout for international customers - cost is for shipping only, any additional customs or local taxes are not included and are the receiving customers responsibility." FAQ: "If ordering to an address in Europe please make sure you are aware of any additional charges you may incur before placing an order."

### 5. Tacticgames — https://tacticgames.fr  (slug `tacticgames`)
- `/meta.json`: `"city":"Paris","country":"FR","currency":"EUR"`. Shopify; `/products.json` 429 challenge first try.
- Pre-order tag `Précommande` (e.g. `2026 Topps Universe WWE - Hobby Box`). Football: `Topps Flagship Premier League 2026/27 - Hobby Box` 289.90 available (tags `[]`), `Topps Chrome Arsenal 2025/26 - Hobby Box` 399.90.
- Conditional GET → **304**.
- Shipping (cart item €29.90): GI → `Standard International 30.00 EUR`; ES → `Standard International 20.00 EUR (2–8 d)`. `/policies/shipping-policy` body empty. No customs text found. (FR→GI is an export outside EU VAT area — VAT/duty treatment not stated.)

### 6. DutchBreakers — https://dutchbreakers.com  (slug `dutchbreakers`)
- `/meta.json`: `"city":"Eindhoven","country":"NL","currency":"EUR"`. Shopify; robots.txt and first conditional-GET try → 429 challenge.
- `2026 Topps Chrome Formula 1- Hobby Box` 749.00 `available:true`, tags `[]`, `product_type ""`.
- Conditional GET → **304** (after retry).
- Shipping: GI → **422** `{"country":["Country/region not supported"]}`; ES → `Standard DHL 23.00 USD`, `Package with insurance 26.00 USD` (3–5 d). Policy: "We Currently ship in Europe to … Spain …"; Spain in "Shipping Zone 3"; "All Countries outside of the European Union are excluding taxes and duties".

### 7. Sport Cards Center — https://sportcardscenter.com  (slug `sportcardscenter`)
- `/meta.json`: `"city":"Navalcarnero","province":"Madrid","country":"ES","currency":"EUR"`. Shopify, 68 products.
- E.g. `Panini Obsidian Soccer 2025/26 - Hobby Box` 460.00 available; tags are identical SEO lists (`Cajas Topps España`, …) — useless for filtering.
- Conditional GET → **304**.
- Shipping: GI → **422** `"El país o la región no se admite."`; ES → `Estándar 4.50 EUR`. Policy: "todos nuestros envíos se realizan desde España … Envíos Internacionales … desde 10€".

### 8. SportyCards — https://sportycards.it  (slug `sportycards`)
- WooCommerce (Yoast robots: `Disallow:` empty). Store API `GET /wp-json/wc/store/v1/products?per_page=3&orderby=date&order=desc` → 200 JSON, `x-wp-total: 1111`.
- Fields: `id, name, slug, permalink, prices{price,regular_price,currency_code,currency_minor_unit}, is_in_stock, is_on_backorder, is_purchasable, categories[], tags[], type, variations[], attributes[]…` (prices in minor units).
- Excerpt: `{"id":131190,"name":"PREORDER: Panini National Treasures Road to FIFA World Cup 2026 – Hobby Box","prices":{"price":"189900","currency_code":"EUR","currency_minor_unit":2},"is_in_stock":true,"categories":["Box","Preordini"],"tags":["2026","FIFA","Hobby Box","National Treasures","panini"]}`. Boxes are `variable` with attribute "BOX": `apri-in-live` (opened on stream) vs `spedito-a-casa` (shipped sealed) — use the latter.
- Conditional GET: no ETag, no Last-Modified → no 304.
- Shipping (variation 130928 "spedito a casa"): GI → `needs_shipping: true`, **0 rates**; ES → `Tariffa unica 15.00 EUR`. (Single card variant returned `needs_shipping:false`.)

### 9. ScuzzCards — https://scuzzcards.com  (slug `scuzzcards`)
- WooCommerce Store API 200, `x-wp-total: 405`, `last-modified` header present; `If-Modified-Since` → still **200**.
- Mostly team tins/singles: `Topps Manchester United Soccer Collector Tin 2026/2027` €34.00.
- Shipping: GI → 0 rates; ES → `Envío Ordinario 2.00`, `Envío Certificado 7.00`, `Vinted Go 3.00`, `Envio InPost Punto Pack/Taquilla 5.00` EUR. Country = ES inferred from EUR + Spanish shipping services (legal address not checked).

### 10. Otakura — https://otakura.com  (slug `otakura`)
- Shopify (Italy). First 250 products: 0 football/F1, 86 tagged `preordine` (all TCG). Has a `/collections/topps` page per search, not probed further.
- Conditional GET → **304**. Shipping: GI → 422 "Paese o area geografica non supportati"; ES → `BRT Express 30.00 USD`, `Express FedEx 44.00 USD`. Policy: "Europa UE FedEx International 2–3 giorni lavorativi €12,50 … Non sono previste spese doganali aggiuntive per le spedizioni intra-UE."

### 11. Stickerpoint — https://www.stickerpoint.es  (slug `stickerpoint`)
- robots.txt → 404 (HTML page). `Set-Cookie: cookie_test=please_accept_for_session` (osCommerce signature), `Server: Apache`, product URLs `…-p-6967.html`, category `topps-topps-hobby-boxes-c-3_173.html`. No JSON API found; no ETag/Last-Modified.
- Shipping page `/envio-y-entrega.php`: "Enviamos todos nuestros artículos con DHL, o en casos excepcionales con Deutsche Post. Gastos de envio a España … 9,90 €" then a list of other countries (DE, AT, FR, PT, NL, IT, BE, CH, MT, …, United Kingdom 14,90 €, Canada) — **Gibraltar not listed** → GI UNVERIFIED (likely no). Catalogue dominated by stickers (excluded type).

### 12. deichcards.de  (slug `deichcards`)
- `/meta.json`: Bremen, DE, EUR. Good football coverage: `product_type: "Fussball"`, tags `Hobby Box`, `garantiert Autographs`, `2025/2026`. E.g. `Topps Flagship Premier League Hobby Box 2026/2027` 190.00, `compare_at_price` 190.00, `available:false`. No pre-order tag.
- Conditional GET → **304**.
- Shipping: GI → 422 "Land/Region wird nicht unterstützt"; ES → `{"shipping_rates":[]}` (DE control: `DHL 4.90 EUR`). Policy EU table lists BE/LU/NL, CZ/DK/FR/PL/SE, IT/PT/HU/GR/FI — **Spain absent**. → neither.

### 13. Get Sports Cards — https://getsportscards.co.uk  (slug `getsportscards`)
- `/meta.json`: Wellington, England, GBP. Good tags (`Soccer`, `Hobby Box`), product_type `Collectible Trading Cards`.
- Conditional GET → **304**.
- Shipping: GB control → `Royal Mail Tracked 48 2.99 GBP`; GI → `[]`; ES → `[]`. Page `/pages/delivery-shipping`: "International Shipping Shipping quotes for orders outside the UK will be available soon."

### Blocked
- **SuperCollectors** (supercollectors.es): `/robots.txt`, `/`, `/wp-json/wc/store/v1/products` all → `HTTP/2 202`, `sg-captcha: challenge`, body `<meta http-equiv="refresh" content="0;/.well-known/sgcaptcha/?r=%2Frobots.txt…">`. Not bypassed. Shipping UNVERIFIED.
- **Collectorage** (collectorage.com): all → `HTTP/2 403`, `cf-mitigated: challenge`, "Just a moment...". Not bypassed. Shipping UNVERIFIED.

## Recommendations for the poller
1. Tier-1 GI sources: SCD, SCW, King of Hoops, STC-UK, Tacticgames — poll `/products.json?limit=250&page=N` with stored ETag (`If-None-Match`), back off on 429/`cf-mitigated`.
2. Tier-2 ES-only: DutchBreakers, Sport Cards Center, SportyCards (Store API, no validators — poll sparingly, `orderby=date`), ScuzzCards.
3. Signal-only (no GI/ES shipping): deichcards, Get Sports Cards.
4. Per-shop pre-order rules as listed above; release dates must come from the publisher calendar, not retailers.
5. Re-check shipping quarterly (Get Sports Cards says international "available soon").
