# Phase 0 follow-up: Spain re-check (MA 29691) and Pokémon TCG RRPs

*Checked live on 2026-10-05 (UTC) from the build sandbox: a US datacentre IP behind a proxy.*

This note covers two pieces of work:

1. A re-check of Spain shipping to the owner's real fallback destination (province **MA**, postcode **29691**), with two Gibraltar spot checks.
2. Verifiable recommended retail prices (RRPs) for English Pokémon TCG sealed products from the Mega Evolution era.

Raw rate responses are in `fixtures/phase0/<slug>/es-29691-rates*.json`. The RRP evidence is in `fixtures/phase0/asmodee-uk/pokemon-rrp-2026-10-05.tsv`.

---

## Task 1: Spain shipping re-check to MA 29691

### Method

This followed the 2 October method exactly. It was a one-off manual research step the owner asked for; the app must never automate it, because robots.txt disallows `/cart/`.

- **Shopify:** each check started with a fresh cookie jar (a new `requests.Session`).
  - `POST /cart/add.js` with one item that `products.json` reported as available.
  - `GET /cart/shipping_rates.json?shipping_address[country]=Spain&shipping_address[province]=MA&shipping_address[zip]=29691`.
  - `POST /cart/clear.js`, then the jar was discarded.
- **SportyCards (WooCommerce Store API):**
  - `GET /cart` to get the Nonce and Cart-Token.
  - `POST /cart/add-item` with variation 130928 ("Spedito a casa").
  - `POST /cart/update-customer` with `{country:"ES", state:"MA", postcode:"29691"}`.
  - `DELETE /cart/items`.
- **What was sent and what was not:** only country, province and postcode. There was no checkout, no account, and no name, email or street address.
- **Politeness:**
  - UA `CardDeskDrops/0.1 (personal release tracker; research)`.
  - 3.5 s between requests per host, or 10.5 s for Zatu and The Card Vault (`Crawl-delay: 10`).
  - A 429 challenge got one retry after 10 s.
- **Gibraltar:** not re-tested, except for The Card Vault and TodoHits. Each got one fresh-cart attempt with `country=Gibraltar, zip=GX11 1AA`.
- **Currency:** rates marked † are in USD because the proxy egresses from the US. That is the presentment currency, not the shop's base currency.
- **Test items:** the item affects the rate. Shopify rates depend on weight, price and the item's shipping profile, so a price here applies to that test item only. Earlier test items were not always the same as these. Several shops report `grams: 0` for the item used, which makes weight-based tiers unreliable.

### Results

| Shop | Slug | Earlier ES verdict (2 Oct) | ES MA 29691 result (5 Oct) | ES verdict | Changed? |
|---|---|---|---|---|---|
| Sports Cards Worldwide | `sportscardsworldwide` | yes, £19.99 | Royal Mail International Tracked **£19.99** | yes | no |
| Sports Cards Direct | `sportscardsdirect` | yes (DHL) | 1st cart: HTTP 500 with empty body (transient). Fresh cart: ECONOMY SELECT **42.00 USD†**, EXPRESS WORLDWIDE 49.00 USD† | yes | no |
| Sports Trading Cards UK | `sportstradingcardsuk` | yes, 53 USD† | DHL Express Worldwide **53.00 USD†** | yes | no |
| King of Hoops | `kingofhoops` | yes, £9.99 | Express International **£9.99** (2–11 d) | yes | no |
| Tacticgames | `tacticgames` | yes, €20 | Standard International **€20.00** (2–8 d) | yes | no |
| DutchBreakers | `dutchbreakers` | yes, DHL 23 / 26 USD† | Package with insurance **26.00 USD†** (3–5 d); the 23 USD standard rate was not offered for this item (0 g Japanese box) | yes | no |
| Sport Cards Center | `sportcardscenter` | yes, €4.50 | Estándar **€4.50** | yes | no |
| SportyCards (WooCommerce) | `sportycards` | yes, €15 | Tariffa unica **€15.00**, `needs_shipping:true`; the address echo was ES/MA/29691 | yes | no |
| Zatu | `zatu` | yes, £9.50–10.29 | International Tracked **£9.50**, FedEx International Connect £9.63, Geopost Tracked £19.49 (Mega Moonlit Tin, 250 g) | yes | no |
| Pokemillon | `pokemillon` | yes, from €4.50 | Envío 24-48h **€4.50**; Certificado + fundas €6.30; Express €6.90; Express Seguro €30.00 | yes | no |
| Poke-Geek | `poke-geek` | yes, from €6.99 | Mondial Relay **€6.99**, UPS €11.25, CTT €14.49, Colissimo €17.00 and others | yes | no |
| Southern Light TCG | `southern-light` | no (`[]`) | `{"shipping_rates":[]}` (test item 0 g, not a TCG product: every product in the shop reports 0 g) | no | no |
| Total Cards | `total-cards` | yes, £5.27–16.35 | Tracked AirMail (Letter) **£5.50**, Tracked & Signed (Letter) £5.96, Heavy Weight £16.35, Heavy Extra Comp £18.90 | yes | no (the letter rate is now £5.50, not £5.27) |
| Pikamon | `pikamon` | yes, €18.95 | Tracked & insured up to 5 kg **€18.95** | yes | no |
| Metamorph Center | `metamorph-center` | yes, €4.95 | Correos Envío Express 24–72 h **€4.95** | yes | no |
| Titan Cards | `titan-cards` | yes, 17 USD† | International Standard (Non-Tracked) **13.00 USD†**, International Tracked 17.00 USD† | yes | no |
| **The Card Vault** | `the-card-vault` | **yes, £17.77** | **`[]` on two fresh carts**: Palworld playmat (0 g), then a Yu-Gi-Oh! booster box (400 g) | **unknown** (see below) | **YES** |
| TodoHits | `todohits` | likely (meta.json); cart test failed | **Not testable.** `add.js` returned 422 "ya está agotado" for two items that `products.json` listed as `available:true`. Later attempts hit a persistent Cloudflare 429 "Verifying your connection" page on `add.js`, still there after the 10 s retry. | still UNVERIFIED (meta.json lists ES) | no |

### Gibraltar spot checks (GX11 1AA, fresh cart)

| Shop | Earlier GI verdict | Result (5 Oct) | GI verdict | Changed? |
|---|---|---|---|---|
| The Card Vault | no in practice (`[]` ×3, though meta.json lists GI) | `{"shipping_rates":[]}` on two fresh carts (same items as the ES test) | no in practice | no |
| TodoHits | UNVERIFIED (meta.json: no GI) | Not testable: 429 challenge on `add.js` on every attempt | UNVERIFIED | no |

### The Card Vault: notes

- **What the record shows:**
  - On 2 Oct, the first-pass probe also returned `[]` for Spain (League Battle Deck, 300 g; `fixtures/phase0/the-card-vault/probe_result.json`).
  - The "yes, £17.77" figure came from a later fresh-cart re-run.
  - Today both fresh carts returned `[]` for ES MA 29691, which makes its Spain shipping inconsistent at best.
- **Possible causes (UNVERIFIED):**
  - a postcode or province rule;
  - a shipping profile per product type (today's items were not Pokémon; the £17.77 run's item is not recorded);
  - a rate-table change since 2 Oct.
- **Recommendation for the owner to decide:**
  - Set `ships_es: unknown` for `thecardvault` now.
  - Approve one control test: the same Pokémon sealed item on two fresh carts, one with ES CA 11300 and one with ES MA 29691. That would show whether 29691 itself is excluded.
  - Or confirm with the shop by email.

  This is outside the brief, so no further carts were created.

### Fixtures written

- `fixtures/phase0/<slug>/es-29691-rates.json`, for each of the 18 shops: test item, HTTP codes, the query sent, the rates, and the clear status.
- `sportscardsdirect/es-29691-rates-attempt1-http500.json`
- `the-card-vault/es-29691-rates-confirm.json`, the confirming re-run, which also holds the GI check.
- `todohits/es-29691-rates-attempt{2,3,4}.json`, holding the 422 and 429 evidence.

---

## Task 2: Pokémon TCG RRPs (English, Mega Evolution era)

### Sources tried

| Source | Result |
|---|---|
| press.pokemon.com (TPCi NA press) | Product pages carry title, release date and assets only. **No MSRP** on the Delta Reign or 30th Celebration pages (saved fixtures in `fixtures/phase0/press-pokemon/` were grepped for `$`, `MSRP` and `price`: none). |
| pokemon.gamespress.com (TPCi EU press) | WebFetch got HTTP 401 today. The saved fixtures (`fixtures/phase0/pokemon-gamespress-eu/`) contain **no RRP, SRP, £ or €**. |
| pokemon.com/uk product gallery (Mega Evolution PC ETB) | Fetched: "No price, RRP, or SRP is stated". |
| Pokémon Center UK / US storefront | **Blocked** (HTTP 403, Imperva). PC prices could not be read. |
| Smyths Toys UK | Bot-check page; no price readable. |
| **Asmodee UK (asmodee.co.uk)**, the official UK distributor of the Pokémon TCG | **Works.** It is a Shopify trade store: `products.json` gives the **trade price (ex VAT)**, and each product page shows a labelled **"RRP:"** field (`<div class="product-rrp-price__value">`). This is the best UK source found. |
| Third-party guides (billsarchive.com, drawpie.com, pokeled.com) | Fetched. Used only as secondary or single-source evidence. |

Asmodee's status as distributor is supported by Better Retailing (7 Nov 2025): *"Shop owners have accused Pokémon and its official distributor Asmodee of cutting supply to independents…"* (https://www.betterretailing.com/pokemon-independent-stores-stock/). Its `meta.json` reads `"name":"Asmodee UK","country":"GB","currency":"GBP"`.

### UK (GBP) RRPs

All rows below were read from asmodee.co.uk product pages on 2026-10-05. The quote is the page's `RRP:` value.

"Distributor RRP" ranks just below a Pokémon Company statement. It is the UK distributor's published recommended retail price, but no TPCi document was found that confirms it.

| Product type | GBP RRP | Quote / evidence | Products checked (SKU) | Confidence |
|---|---|---|---|---|
| **Elite Trainer Box** (standard, 9 packs) | **£49.99** | `RRP: £49.99` | ME Lucario POK1010047110, Phantasmal Flames POK1010186101, Ascended Heroes POK1010315101, Perfect Order POK1010372111, Chaos Rising POK1010399111, Pitch Black POK1010416111, Delta Reign POK1010438111 | **distributor RRP**, the same on 7 products. Also agrees with drawpie.com ("Two independent UK sellers listed it at exactly that figure on release day") and billsarchive.com ("£49.99 (UK)… Asmodee UK RRP") |
| **30th Celebration ETB** | **£49.99** | `RRP: £49.99` | POK1010447101 | distributor RRP; agrees with billsarchive.com and drawpie.com |
| **Booster Bundle** (6 packs) | **£24.99** each | `RRP: 25 units at £24.99` (the case of 25 is the trade unit) | Phantasmal Flames POK1010191101, Ascended Heroes POK1010311114, Perfect Order POK1010377109, Chaos Rising POK1010403109, Pitch Black POK1010422109, Delta Reign POK1010439109, 30th Celebration POK1010451101 | distributor RRP, the same on 7 products. billsarchive.com lists the 30th Celebration UK bundle RRP as "TBC", so it is out of date there. |
| **Booster Display (36 packs)** | **No box RRP stated.** The per-pack RRP is **£4.29**, so 36 × £4.29 = **£154.44** (derived, not stated) | `RRP: 36 units at £4.29` | ME POK1010057125, Phantasmal Flames POK1010190119, Perfect Order POK1010380119, Chaos Rising POK1010407119, Pitch Black POK1010425120, Delta Reign POK1010446101 | distributor RRP for the **single pack**. A whole-box RRP is **UNVERIFIED**. |
| **Pokémon Center Elite Trainer Box** (11 packs) | **UNVERIFIED** | The PC UK store is blocked. Search-engine snippets show £54.99 (Perfect Order, Phantasmal Flames and ME Lucario PC ETBs) and £56.99 (ME Gardevoir PC ETB). drawpie.com says the 30th Celebration PC ETB is "£56.99", citing "Pokémon Center UK product page for SKU 10-10447-108"; billsarchive.com also says "£56.99 (UK)". | n/a | single or secondary sources only. Not sold through Asmodee. |
| 30th Celebration ex Box / ex Tin (Sylveon, Greninja) | £21.99 | `RRP: 6 units at £21.99` | POK1010463108/114, POK1010466108/114 | distributor RRP |
| 30th Celebration Binder Collection | £37.99 | `RRP: 6 units at £37.99` | POK1010450101 | distributor RRP |
| 30th Celebration Poster Collection | £19.99 | `RRP: 6 units at £19.99` | POK1010467101 | distributor RRP |
| 30th Celebration Tech Sticker Collection | £16.99 | `RRP: 12 units at £16.99` | POK1010449101 | distributor RRP |
| 30th Celebration Mini Tin | £12.99 | `RRP: 10 units at £12.99` | POK1010465101 | distributor RRP |
| 30th Celebration 2-pack blister | £9.99 | `RRP: 12 units at £9.99` | POK1010666102 | distributor RRP |
| 30th Celebration Ultra-Premium Collection | **UNVERIFIED** | Not listed on Asmodee UK. billsarchive.com gives the UK RRP as "TBC". | n/a | n/a |
| Mega Charizard Ultra-Premium Collection | £124.99 | `RRP: £124.99` | POK1010065109 | distributor RRP |
| Mega Greninja ex / Mega Zygarde ex Premium Collection | £39.99 | `RRP: 6 units at £39.99` | POK1010413108, POK1010359108 | distributor RRP |
| Ascended Heroes ex Box (Feraligatr, Emboar, Meganium) | £21.99 | `RRP: 6 units at £21.99` | POK1010313127/128/129 | distributor RRP |
| Ascended Heroes Premium Poster Collection | £49.99 | `RRP: 6 units at £49.99` | POK1010302120 | distributor RRP |
| Ascended Heroes Mini Tin | £10.99 | `RRP: 10 units at £10.99` | POK1010318138 | distributor RRP |
| 3-pack blister (ME sets) | £13.99 | `RRP: 12 units at £13.99` | 5 products | distributor RRP |
| Premium Checklane blister | £6.99 | `RRP: 12 units at £6.99` | 4 products | distributor RRP |

**Caveats:**

- **VAT:** the RRP field does not say whether it includes VAT. The trade price is labelled "ex VAT" in the store's widget config. £49.99 matches UK consumer shelf prices, so it is almost certainly VAT-inclusive, but the page does not say so.
- **Gibraltar:** this is a UK RRP. Gibraltar has no VAT, so GI shops may price differently.
- **Trade prices:** these are public in `products.json`, e.g. ETB £27.05 ex VAT and display £82.80 ex VAT. They must **never** be shown as a retail benchmark.
- **Booster Display:** the display RRP is a derivation. Label it "36 × pack RRP" in the UI, not "RRP".

### Spain / EU (EUR) RRPs

| Product type | EUR RRP | Evidence | Confidence |
|---|---|---|---|
| Elite Trainer Box (English) | **UNVERIFIED** | No official EUR RRP for **English-language** product was found. In Spain the official distribution is Spanish-language (Bandai España is named as distributor on retailer pages), so English stock there is imported. One French blog (pokeled.com, updated 2 Oct 2026) gives the 30th Celebration ETB as "€55.99 to €59.99 announced" and calls it "indicative". It cites no official document. | UNVERIFIED (single unofficial source) |
| Pokémon Center ETB | UNVERIFIED | The PC EU storefronts are blocked. | UNVERIFIED |
| Booster Bundle | UNVERIFIED | pokeled.com: 30th Celebration bundle "€35.99 to €39.99 announced" (indicative, no source). | UNVERIFIED |
| Booster Display (36) | UNVERIFIED | none found | UNVERIFIED |
| 30th Celebration UPC | UNVERIFIED | pokeled.com: "€239.99 announced" (no source) | UNVERIFIED |

Spanish-language ETB prices at Spanish shops (dungeonmarvels.com €69.95–74.95, comicstores.es €56.04–66.49) are **shop prices, not RRPs**, and they are for the Spanish edition. They are listed here for context only.

### US (USD) MSRP, for reference only

| Product | USD | Evidence | Confidence |
|---|---|---|---|
| ETB | $49.99 | billsarchive.com (updated 3 Oct 2026): "Elite Trainer Box: $49.99 (US)" (30th Celebration) | single secondary source |
| Pokémon Center ETB | $59.99 | billsarchive.com: "$59.99 (US)". Search snippets of pokemoncenter.com show $59.99 for several ME PC ETBs, but the site itself is blocked (403). | single secondary source |
| Booster Bundle | $26.94 | billsarchive.com: "$26.94 (US)" | single secondary source |
| 30th Celebration UPC | $179.99 | billsarchive.com: "$179.99 (US)" | single secondary source |

press.pokemon.com publishes no MSRP, so none of the US figures is official.

### Recommendations

1. **Seed `config/rules.yaml` with the UK figures as distributor RRPs:**
   - ETB £49.99.
   - Booster Bundle £24.99.
   - Pack £4.29, giving display = 36 × pack.
   - Store each with its source URL, the check date and `confidence: distributor`.
2. **Treat the EUR RRP as missing.** Two options:
   - **Recommended:** convert the GBP RRP at the ECB rate and label it "UK RRP (converted)".
   - Or leave the EUR RRP empty until an official source appears.

   Owner to decide.
3. **Pokémon Center ETB RRP:** keep it `UNVERIFIED` until the PC UK storefront can be read from the deployed Worker. It is a UK-only buy source in any case (see `SOURCES.md` §3).
4. **Asmodee UK as a source:** it could become a periodic RRP source through `products.json` (not disallowed in robots) plus the product page's RRP field. That would be a new source outside the current brief, so the owner needs to approve it.
