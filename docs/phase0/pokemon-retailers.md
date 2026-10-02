# Phase 0: UK and EU retailers for English Pokémon sealed product

*Checked live on 2026-10-02. Covers UK and EU online shops only; Pokémon Center and other official sources are covered in a separate report.*

## How this was checked

- **Finding shops:** WebSearch in English, Spanish, Dutch, German, Italian and French. The egress proxy blocked tcgradar.eu, poketracker.co.uk, packratt.co.uk and chaoscards.co.uk for WebFetch, and Reddit was not reached. The candidate list therefore comes from search results and known names, not from community threads.
- **Live checks:** curl through the session proxy with `-A "CardDeskDrops/0.1 (personal release tracker; research)"`, waiting 2–4 s between requests to the same host and backing off on HTTP 429. The proxy egresses from the **US (Shopify `edge;desc="IAD"`, `country;desc="US"`)**, so some Shopify stores quote rates in USD, their presentment currency for US visitors (marked † below).
- **Shopify shipping test:** in a cookie jar, `POST /cart/add.js` with one in-stock item, then `GET /cart/shipping_rates.json?shipping_address[country]=Gibraltar&shipping_address[zip]=GX11 1AA`, and the same for `Spain`, zip `11300` (La Línea, Cádiz), province `CA`. The cart was cleared and the jar deleted afterwards. Nothing went past the cart: no checkout, no account, no personal data. Results were read as follows:
  - **rates array** means the store ships there (the price applies to that test item only).
  - **HTTP 422 `{"country":["Country/region not supported"]}`** means it does not ship there.
  - **`{"shipping_rates":[]}`** means the country sits in a shipping zone but no rate matched the item. This counts as **no** for practical purposes, but it is weaker evidence.
  - **Caveat:** after a query returns `[]`, later queries on the *same cart* can also return `[]`. One Total Cards cart returned Spain rates, then `[]` for Spain right after a Gibraltar query. Every ambiguous result was therefore re-run on a fresh cart with Spain queried first.
- **`/meta.json` (Shopify):** returns `ships_to_countries`. It is a cheap machine-readable hint but **not authoritative**:
  - Poke-Geek omits GI but returns GI rates.
  - The Card Vault lists GI but returns no GI rates.
- **robots.txt:** every Shopify store disallows `/cart/` for `User-agent: *`. The cart checks were a one-off, manual research step you explicitly authorised; **the PWA must never automate them.** `/products.json` and `/collections/*/products.json` are not disallowed on any store checked. Zatu, The Card Vault and Poke Iberian set `Crawl-delay: 10`.

## Ranked summary

Ranking order:

1. Shops verified to ship to Gibraltar.
2. Shops that ship to Spain only.
3. Shops with Spain or Gibraltar unverified.
4. Shops that ship to neither, or have no English stock.

Within each group, shops are ordered by how machine-readable and relevant they are.

| # | Retailer | Country | Platform | Status | Endpoint | GI | ES | Cond. GET | Notes |
|---|---|---|---|---|---|---|---|---|---|
| 1 | **Zatu Games** (zatu.com, ex board-game.co.uk) | UK | Shopify | live JSON | `/collections/booster-boxes-pokemon/products.json`, `/collections/pokemon-pre-orders/products.json` | **YES**: FedEx Intl Connect £17.06 (845 g item), £21.97 (heavier item) | **YES**: Intl Tracked £9.50–10.29, FedEx £9.63–10.80 | ETag → 304 | IOSS for EU under €150; English is the default language. Crawl-delay 10 |
| 2 | **Pokemillon** (pokemillon.com) | ES (Salou) | Shopify | live JSON | `/collections/cartas-pokemon-inglesas/products.json` | **YES**: "Envío Certificado" €19.90 (tested with the EN Perfect Order ETB) | **YES**: from €4.50 (24–48 h) | ETag → 304 (1st try got 200 because the content changed) | Language is a variant option (`Idioma: Inglés`); tag `Reserva` marks pre-orders |
| 3 | **Poke-Geek** (poke-geek.fr) | FR | Shopify | live JSON | `/collections/etb-anglaise/products.json` | **YES**: UPS €33.00, Colissimo Intl €42.50 | **YES**: Mondial Relay €6.99, UPS €11.25 | ETag → 304 | Small English range (12 ETBs, mostly sold out); mostly French and Japanese stock |
| 4 | Southern Light TCG (southernlight.store) | **GI** (local) | Shopify | live JSON | `/collections/pokemon-english/products.json` (2 items) | **YES**: "Local Delivery" £0.00 | NO (`[]`) | ETag → 304 | In Gibraltar but mostly JP/CN/KR stock; English range is very small. Useful for local pickup |
| 5 | **Total Cards** (totalcards.net) | UK | Shopify | live JSON | `/collections/new-pokemon/products.json` (388 items) | NO (`[]` on 3 items, fresh carts) | **YES**: Royal Mail AirMail £5.27 (large letter), Tracked AirMail £7.09 (parcel), Heavy £16.35 | ETag → 304 | `pre-order` tag plus "Release Date: …" text in `body_html` |
| 6 | **Titan Cards** (titancards.co.uk) | UK | Shopify | live JSON (intermittent 429) | `/collections/pokemon/products.json` | NO (422) | **YES**: "International Tracked" $17.00† | ETag → 304 | Policy says they may limit quantity per household |
| 7 | **The Card Vault** (thecardvault.co.uk) | UK | Shopify | live JSON (429 on 1st probe) | per-set collections, e.g. `/collections/pokemon-tcg-mega-evolution-me02-5-ascended-heroes/products.json` | NO in practice (`[]` on 3 items, although meta.json lists GI) | **YES**: "Shipping" £17.77 | ETag → 304 | Crawl-delay 10; policy page body is empty |
| 8 | **Pikamon** (pikamon.eu) | NL | Shopify | live JSON (429 on 1st probe) | `/collections/pokemon-english/products.json` (93 items) | NO (422) | **YES**: Tracked & insured up to 5 kg, €18.95 | ETag → 304 | Best English labelling of the EU shops ("– English" in titles); pre-order tag `pre-order-Q42026` |
| 9 | **Metamorph Center** (metamorphcenter.com) | ES | Shopify | live JSON | `/collections/elite-trainer-box-pokemon/products.json` (7 of 24 English) | NO (422) | **YES**: Correos Express €4.95 | ETag → 304 | Title suffix "- Inglés"; prefix "[ RESERVA ]" marks pre-orders |
| 10 | Poke Iberian Coleccionables | ES | Shopify | live JSON | `/collections/elite-trainer-box-pokemon/products.json` | NO (422) | **YES**: "Exprés" $6.00† | ETag → 304 | Small catalogue (123 products); English items say "Inglés" in the title. Crawl-delay 10 |
| 11 | PokedealTCG (pokedealtcg.es) | ES | Shopify | live JSON | `/products.json` (no useful Pokémon collection handle found) | NO (422) | **YES**: "Estándar" €6.95 | ETag → 304 | Language rarely labelled, so English stock is UNVERIFIED; has a PREVENTA menu |
| 12 | PokeFamily (pokefamily.nl) | NL | Shopify | live JSON | `/collections/pokemon-booster-box/products.json` | NO (422) | **YES**: Standard €12.95 (test item was One Piece) | ETag → 304 | English set names used but language not labelled, so English is UNVERIFIED |
| 13 | BaruZcard (baruzcard.it) | IT | Shopify | live JSON | `/collections/pokemon/products.json` | NO (422) | **YES**: "Standard Internazionale" €15.00 | ETag → 304 | Mostly Italian; a few "ENG" items |
| 14 | TodoHits (todohits.com) | ES | Shopify | live JSON | `/collections/pokemon/products.json` (628 items) | UNVERIFIED (meta.json: no GI) | likely YES (meta.json `["AD","ES","FR","PT"]`); cart test UNVERIFIED (add.js returned 422 / HTML) | ETag → 304 | Title suffix "\| Inglés"; prefix "[Reserva]" marks pre-orders |
| 15 | Card-Corner (card-corner.de) | DE | JTL-Shop | HTML only | `/Pokemon-Karten-Englisch` | NO (not in country list) | **YES** (policy): "Alle anderen EU Länder 14,99€" | no ETag / Last-Modified | HTML shows "Release: 16.09.2026 Sprache: Englisch" per item |
| 16 | Magic Madhouse (magicmadhouse.co.uk) | UK | BigCommerce (Stencil) + Klevu search | HTML only | `/pokemon`, `/pokemon-tcg-release-dates-pre-orders` | UNVERIFIED | UNVERIFIED (ships internationally per policy) | `cache-control: no-store`, no ETag | Cart-based check is disallowed by robots (`/cart.php`). Product grid is rendered by Klevu JS |
| 17 | Chaos Cards (chaoscards.co.uk) | UK | custom ("evocms") | **blocked** (Cloudflare "Just a moment..." 403) | none | UNVERIFIED | UNVERIFIED (search snippet: ships to "Europe… 200 countries") | n/a | robots.txt has `Crawl-delay:3`; WebFetch also blocked |
| 18 | Cards by Beard (cardsbybeard.eu) | NL | Shopify | live JSON | `/collections/engels-sealed/products.json` (161 items) | NO (422) | NO (`[]`, fresh cart; meta.json lists 5 countries without ES) | ETag → 304 | Large English range but NL/BE focused |
| 19 | Troll Trader (trolltradercards.com) | UK | Shopify | live JSON | `/collections/pokemon-booster-boxes/products.json` | NO (422) | NO (`[]`, fresh cart) | ETag → 304 | Booster boxes are mostly JP/CN/KR; policy notes a €3 EU flat duty from 1 Jul 2026 |
| 20 | Obsidia TCG (obsidia-tcg.store) | UK | Shopify | live JSON | `/collections/pokemon-tcg/products.json` | NO (422) | NO (`[]`) | ETag → 304 | meta.json `ships_to_countries` has 1 entry (UK only) |
| 21 | Geeksheaven (geeksheaven.de) | DE | Shopify | live JSON | `/collections/pokemon-displays/products.json` | NO (`[]`) | NO (`[]`) | ETag → 304 | meta.json ships_to `["DE","LU"]` |
| — | Reino de Cartas (reinodecartas.com) | ES | WooCommerce | live JSON (Store API) | `/wp-json/wc/store/v1/products?search=pokémon` | not tested | not tested | Last-Modified sent, If-Modified-Since → 200 (no 304) | **Excluded:** all 24 Pokémon items are Spanish or Chinese, none English |
| — | Dracotienda (dracotienda.com) | ES | PrestaShop | HTML only | none | not tested | not tested | — | English Pokémon range UNVERIFIED; search URLs are disallowed by robots |

† Rate shown in USD because the proxy egresses from the US; the store's base currency is GBP or EUR.

**Not pursued:**
- Poke-Collect: in the US (meta.json `country: US`).
- TCG Stadium: in the US and ships to the US only.
- GamesQuest: `/products.json` returned 0 products.
- Big Orbit Cards and Patriot Games Leeds: meta.json returned 403.
- tcgshopuk.co.uk, davidptcg.nl, tcgcompany.nl, oppacards.com, sapphire-cards.de, mangaloco.com, ilcovodelnerd.com: not Shopify (`/products.json` 404). They may have other feeds; not checked.
- playingcardshop.eu and playingcards.de: `/products.json` 410.
- tbhstore.nl: 403.
- Several guessed hosts did not resolve or connect (curl 000).

## Main findings

1. **Only Zatu, Pokemillon, Poke-Geek and the local Southern Light store showed real Gibraltar rates.** Zatu is the strongest UK option: English is its default, it has a large range and a dedicated `pokemon-pre-orders` collection (0 items today), and GI shipping is FedEx at about £17–22. Pokemillon is the strongest Spanish option: GI €19.90 certified, Spain from €4.50, and English is a variant-level option.
2. **Most UK specialists do not ship to Gibraltar:**
   - Total Cards, The Card Vault, Titan Cards, Troll Trader and Obsidia either return no rate or reject the country with 422.
   - Total Cards, The Card Vault and Titan Cards do ship to Spain.
3. **Shopify gives a uniform machine-readable source:**
   - `/products.json` and `/collections/<handle>/products.json` take `limit≤250` and `page=N`.
   - Weak ETags (`W/"page_cache:<shop_id>:ProductListController:<hash>"`) returned 304 on every store tested.
   - No store sends `Last-Modified`.
   - HTTP 429 shows up intermittently on a first request from the shared proxy IP (Titan, Pikamon, PokeFamily, Card Vault, Obsidia, Southern Light, Pokemillon, PokedealTCG). A 10–30 s backoff cleared it every time.
4. **How pre-orders and release dates appear varies by store, and none uses a structured date field:**
   - Zatu: tag `Manual Release Date`, with the date not exposed in the JSON.
   - Total Cards: tag `pre-order`, plus `Release Date: 16th September 2026` in `body_html`.
   - Pokemillon: tag `Reserva`.
   - Metamorph and TodoHits: `[ RESERVA ]` or `[Reserva]` in the title.
   - Pikamon: tag `pre-order-Q42026`.
   - Card-Corner (HTML): `Release: 16.09.2026`.
   - Availability always comes from `variants[].available`.
5. **Purchase limits** are not exposed in products.json. Titan Cards' policy keeps the right to "place limits on the quantity of certain items which can be ordered by an individual, household or on a single order". The WooCommerce Store API (Reino) exposes `add_to_cart.maximum`.

## VAT and customs notes (from store text only)

- **Zatu:** "Zatu is operating under an IOSS (International One Stop Shop) delivery system to our EU customers. IOSS is available on all shipments to the EU under … €150 … Zatu will charge and collect VAT during th[e checkout]". Above €150 they ship "Delivery Duty Unpaid (DDU) … EU customers … may be subject to import VAT upon their goods landing". So Spain under €150 has VAT collected at checkout, and over €150 the buyer pays import VAT.
- **Troll Trader:** "As of July 1st 2026, imports into countries within the EU will carry a flat customs duty of 3€, regardless of IOSS."
- **Magic Madhouse:** "customers are responsible for any customs charges or import duties payable on receipt of international deliveries."
- **Total Cards:** "customs duties, taxes, and fees may apply upon delivery … responsibility of the customer".
- **Metamorph (ES):** non-EU territories ("Islas Canarias, Ceuta, Melilla …") "puede haber impuestos de aduana o IVA" ("there may be customs duties or VAT").
- **Poke-Geek (FR):** "Pour les destinations hors Union européenne … des droits de douane, taxes locales … peuvent être réclamés au destinataire" ("For destinations outside the European Union … customs duties and local taxes may be charged to the recipient").
- **Gibraltar:** Gibraltar is outside both the UK and EU VAT areas. **No store stated whether it zero-rates UK or EU VAT for GI orders, and no store gave Gibraltar import-duty handling.** Both are UNVERIFIED. Confirm with a basket at checkout or by asking the store.

## Per-retailer evidence

Raw samples for each store are in `fixtures/phase0/<slug>/`:
- `meta.json`
- `products_sample.json`: one trimmed Pokémon product
- `probe_result.json`: the full probe output, including the shipping-rate arrays. These are first-pass rates, queried in the order home country, then GI, then ES. Where they differ from this report (Total Cards ES, The Card Vault ES, Zatu and Poke-Geek heavier items, Pokemillon English ETB), the figures here come from the later fresh-cart re-runs
- `robots.txt`

### 1. Zatu (`zatu`)
- **meta.json:** `"name":"Zatu Games","country":"GB","currency":"GBP","myshopify_domain":"zatu-games.myshopify.com"`. It lists 180 countries in `ships_to_countries`, including GI and ES.
- **Pokémon collections:**
  - `booster-boxes-pokemon` (93)
  - `booster-packs-pokemon` (97)
  - `pokemon-pre-orders` (0 today)
  - `best-sellers-pokemon` (70)
  - `pokemon-japanese` (130): exclude it.
- **Product JSON:** `published_at`, `tags`, and `variants[].available/price/grams`. Example: "Pokemon TCG: Mega Evolution Chaos Rising - Booster Box", tags `['Booster Boxes','Manual Release Date','Pokemon','Pokemon TCG','Pokemon: Chaos Rising',…]`, `available: false`.
- **Rates:**
  - GI: `[('FedEx International Connect','17.06','GBP')]` for an 845 g item, `21.97` for a heavier one.
  - ES: `[('International Tracked','9.50'),('FedEx International Connect','9.63'),('Geopost Tracked','19.49')]`.
  - UK sanity check: Evri £2.99 and others.
- **Policy:** "Zatu currently delivers to the countries listed below … Gibraltar 3-5 Days … Spain 3-5 Days". Pre-orders "are charged at the point of purchase. We always aim to dispatch pre-order items to arrive on the day of release."
- **robots.txt:** `Crawl-delay: 10`; `/cart` disallowed.

### 2. Pokemillon (`pokemillon`)
- **meta.json:** `"POKEMILLON - La Tienda Pokémon" | ES | EUR`, 237 countries, GI and ES included.
- **Collections:**
  - `cartas-pokemon-inglesas` (352)
  - `cajas-de-sobres` (178)
  - `cajas-elite-de-entrenador` (30)
- **Language as a variant option:** `options: [('Idioma', ['Español','Inglés'])]`. For example, "Caja 36 Sobres Escarlata y Púrpura" has Español €169.90 and Inglés €239.90. The tracker must filter on variant title `Inglés`.
- **Pre-orders:** tag `Reserva`, as on "Caja Premium Umbreon & Espeon Pokémon 30th Anniver…".
- **Rates:**
  - GI: `('🚚 Envío Certificado','19.90','EUR')`, confirmed with the English "ETB Equilibrio Perfecto | Perfect Order" variant and the "Caja Iono Bellibolt ex Premium".
  - ES: Envío 24-48h €4.50, Express €6.90, insured express €30.00.
- **Policy:** the policy page body is empty, so cart rates are the only evidence.

### 3. Poke-Geek (`poke-geek`)
- **meta.json:** FR / EUR, 44 countries, **GI not listed**, yet the cart returned GI rates.
- **Rates:**
  - GI: `('Livraison UPS','33.00','EUR'), ('La poste - Colissimo International contre signature','42.50','EUR')`.
  - ES: Mondial Relay €6.99, UPS €11.25, CTT €14.49.
- **Collections:** `etb-anglaise` (12 items, e.g. "Pokémon TCG Celebrations Elite Trainer Box – Anglais", sold out) and `pokebox-mini-tin-anglaise` (excluded category).
- **Release date:** written only in body text ("Sortie octobre 2021").

### 4. Southern Light TCG (`southern-light`)
- **meta.json:** `country: GI`, `ships_to_countries: []`.
- **Rates:** GI `('Local Delivery','0.00','GBP')`; ES `[]`.
- **Catalogue:** 42 products, including `pokemon-english` (2), `pokemon-chinese` and `japanese-tcg` (27). The search snippet describes it as "Gibraltar's first established Japanese, Chinese and Korean TCG collectables store".

### 5. Total Cards (`total-cards`)
- **meta.json:** GB / GBP, 62 countries, ES yes, GI no.
- **Rates:**
  - GI: `[]` on 3 different items in fresh carts.
  - ES (large letter): `('Royal Mail - AirMail (Large Letter)','5.27','GBP'), ('Royal Mail - Tracked AirMail (Large Letter)','5.54')`.
  - ES (parcel): `('Royal Mail - Tracked AirMail (Parcel)','7.09'), ('… Heavy Weight','16.35'), ('… Heavy Weight Extra Comp','18.90')`.
- **Pre-orders:** tags `['No Free Shipping','pre-order']`; `body_html` contains "Release Date: 16th September 2026".
- **Policy:** "International orders may take longer … Please allow up to 30 working days".
- **Note:** test products include event tickets ("Pre-Release Event") where `requires_shipping` is false. Filter them out.

### 6. Titan Cards (`titan-cards`)
- **meta.json:** GB / GBP, 42 countries, ES yes, GI no.
- **Rates:** GI 422 "Country/region not supported"; ES `('International Tracked','17.00','USD')`†.
- **Stock:** `pokemon-accessories` (246), `collection-boxes` (178), per-set collections. Language is not labelled: English is the default and others are marked "Japanese", "Korean" or "Chinese".
- **Limits:** "Titan Cards reserves the right … to place limits on the quantity of certain items which can be ordered by an individual, household or on a single order."

### 7. The Card Vault (`the-card-vault`)
- **meta.json:** lists GI and ES (83 countries).
- **Rates:** ES `('Shipping','17.77','GBP')`; GI `[]` on 3 items of different weights. Treat GI as **no**.
- **robots.txt:** `Crawl-delay: 10`.

### 8. Pikamon (`pikamon`)
- **Rates:** GI 422; ES `('Tracked & insured — up to 5 kg','18.95','EUR')`; NL €14.95.
- **Collections:** `pokemon-english` (106), `box-sets-1`.
- **Labelling:** titles such as "Pokémon TCG: Destined Rivals - Elite Trainer Box - English", which makes English filtering easy.

### 9–14. Spanish, Dutch and Italian Shopify stores
All return 422 for GI.
- **Metamorph Center:** ES `('Correos | Envío Express 24h - 72h','4.95')`. Policy: "realizamos envíos a toda España, varios países de Europa" ("we ship across Spain and to several European countries").
- **Poke Iberian:** ES `('Exprés','6.00','USD')`†.
- **PokedealTCG:** ES `('Estándar','6.95','EUR')`.
- **PokeFamily:** ES `('Standard','12.95','EUR')`. Policy: "Wij leveren bestellingen in alle landen binnen de Europese Unie" ("We deliver orders to all countries in the European Union").
- **BaruZcard:** ES `('Standard Internazionale','15.00','EUR')`.
- **TodoHits:**
  - `cart/add.js` returned 422 for the test item, and a fresh-cart retry returned an HTML page, so ES is backed only by meta.json `["AD","ES","FR","PT"]`.
  - The country selector lists "Gibraltar GBP £", but that is a Shopify Markets currency list, **not** shipping evidence.

### 15. Card-Corner (`card-corner`): JTL-Shop, HTML
- **Shipping policy:** "Die Lieferung erfolgt im Inland (Deutschland) und in die nachstehenden Länder: Österreich, Luxemburg, Niederlande, Belgien, Frankreich, Italien, Spanien, Dänemark … Alle anderen EU Länder 14,99€" ("Delivery within Germany and to the countries below: Austria, Luxembourg, Netherlands, Belgium, France, Italy, Spain, Denmark … All other EU countries €14.99"). Gibraltar is absent.
- **Listing excerpt:** "Pokemon 30th Celebration Booster (Englisch) … Release: 16.09.2026 Sprache: Englisch Artikelnummer: ME5.5-EN-Booster 16,99 €". The text is parseable, but there is no JSON.
- **robots.txt:** `Disallow:` (empty, so everything is allowed). No ETag.

### 16. Magic Madhouse (`magic-madhouse`): BigCommerce, HTML
- **robots.txt:** BigCommerce default, which disallows `/cart.php` and `/checkout`. AI bots get `Crawl-delay: 3`.
- **Delivery page:** "International shipping is currently suspended in the Middle East … INTERNATIONAL SHIPPING Please note, Magic Madhouse customers are responsible for any customs charges or import duties …". No country list is given, so GI and ES are UNVERIFIED.
- **Release page:** `/pokemon-tcg-release-dates-pre-orders` has a release table, e.g. "Mega Zygarde ex Premium Collection Box Expected release date is 2nd May 2025 Pre-Order Now".
- **Product listing:** loaded client-side via Klevu (`js.klevu.com`). Klevu's JSON API was **not** reverse-engineered, so it is UNVERIFIED.

### 17. Chaos Cards (`chaos-cards`): blocked
- **Homepage:** `403`, `<title>Just a moment...</title>` (Cloudflare managed challenge). robots.txt is readable: `Crawl-delay:3`.
- **Shipping:** WebSearch snippets of `/worldwide-shipping` say they ship to "Europe … more than 200 countries … from £9.95" and offer "International Swift … all import taxes … paid by Chaos Cards". Not fetched, so UNVERIFIED.

### 18–21. Stores that ship to neither
- **Cards by Beard:** GI 422, ES `[]`.
- **Troll Trader:** GI 422, ES `[]`.
- **Obsidia:** GI 422, ES `[]`, meta.json UK only.
- **Geeksheaven:** GI and ES `[]`, meta.json `["DE","LU"]`.

### Reino de Cartas (`reino-de-cartas`): WooCommerce Store API, excluded
- **Endpoint:** `GET /wp-json/wc/store/v1/products?search=pokémon&per_page=50` returned 200 JSON with `x-wp-total: 24` and `last-modified: Wed, 30 Sep 2026 16:59:33 GMT`. `If-Modified-Since` returned 200, not 304.
- **Item shape:** `{"id":4402,"name":"Pokémon TCG: Oscuridad Absoluta | Caja de Entrenador Élite ETB (Español)","prices":{"price":"6499","currency_code":"EUR"},"is_in_stock":true,"add_to_cart":{"maximum":2},…}`.
- **Why excluded:** no English Pokémon. English is used only for Naruto, MTG and Lorcana.

## Implications for the tracker

1. **Primary sources:**
   - Zatu: `booster-boxes-pokemon` and `pokemon-pre-orders`.
   - Pokemillon: `cartas-pokemon-inglesas`, filtered on variant `Inglés`.
   - Poke-Geek: `etb-anglaise`.
   - Optionally Southern Light, for local GI stock.
2. **Spain fallback:**
   - Total Cards (`new-pokemon`)
   - Pikamon (`pokemon-english`)
   - Metamorph and TodoHits (filter on "Inglés")
   - Titan Cards
   - The Card Vault
3. **Polling:**
   - At most one request per collection every 15–30 min, sending `If-None-Match`.
   - Respect `Crawl-delay: 10` on Zatu, The Card Vault and Poke Iberian.
   - Back off for 30 s or more on 429.
   - Never call `/cart/*`.
4. **Pre-order detection** needs per-store rules: tags (`pre-order`, `Reserva`, `pre-order-Q42026`, `Manual Release Date`), title prefixes (`[Reserva]`), and body regex for "Release Date:".
