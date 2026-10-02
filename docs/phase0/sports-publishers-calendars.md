# Phase 0 — Official publisher sources & release calendars (football/soccer + F1)

Verified 2026-10-02 (07:20–07:40 UTC) from the Claude Code cloud container through its HTTPS egress proxy.
User-Agent: `CardDeskDrops/0.1 (personal release tracker; research)`. About 1–8 requests per host, with 1–2 s between them.
Raw samples are in `fixtures/phase0/<slug>/`.

**Caveat on vantage point:** "blocked" here means blocked **from this container's egress IP**. Cloudflare and Akamai decisions depend on the IP, so every "blocked" verdict must be re-tested from the real deployment runtime (for example a Vercel or Supabase edge function, or a home IP) before it is final. Discovery used WebSearch, whose snippets are search-engine summaries. Anything marked *search-only* was **not** confirmed by a live fetch.

## Summary table

| # | Source | Primary URL(s) | Status (from here) | Soccer | F1 | Fresh? | Structured? | robots for poll path | Conditional GET | Ships GI / ES |
|---|---|---|---|---|---|---|---|---|---|---|
| 1 | **collectosk** release calendar | `https://www.collectosk.com/new-release-calendar/` + `/wp-json/wp/v2/...` | **HTML (server-rendered table) + live WP REST JSON** | Yes (14 rows) | Yes (Topps F1 under "Racing") | Yes. Rows from 2026-09-26; posts published 2026-10-01 | wpDataTables `<tr id="table_2_row_N">` with ISO dates; WP REST posts JSON | Allowed (`*/feed/` disallowed, so **no RSS**) | **Yes**: ETag→304, Last-Modified→304 | n/a (not a store) |
| 2 | **Checklist Insider** release calendar | `https://www.checklistinsider.com/release-calendar` | **HTML only** (REST at `/ci-api/` → 401) | Yes (NWSL, K League, FIFA WC) | Yes (Chrome F1, Chrome Sapphire F1, Williams) | Yes. Oct 2026 to Feb 2027 | `<time datetime="2026-10-15T00:00:00-04:00">` + link + title | Allowed (only `/cdn-cgi/` disallowed) | **No** validators (no ETag/LM) | n/a |
| 3 | Topps official (`www.topps.com`, `uk.`, `de.`, `es.`, `fr.`, `it.`, `jp.`, `shop-uk.`) | `/release-calendar`, `/products.json`, `/collections/*/products.json`, `/cart/shipping_rates.json` | **Blocked**: Cloudflare WAF 403 "Sorry, you have been blocked" on every path incl. robots.txt, with any UA | Yes (search-only) | Yes: Topps NOW F1 (search-only) | Official `/release-calendar` "updates daily, 2-week overview" (search-only) | Shopify (strong secondary evidence; not verified live) | **Unverifiable** (robots.txt itself 403) | Untestable | GI: **UNVERIFIED** (search-summary says yes). ES: **UNVERIFIED** (es.topps.com exists per search) |
| 4 | Panini UK store | `https://www.panini.co.uk/shp_gbr_en/...` | **HTML only** (Magento/Adobe Commerce behind Fastly; `/graphql` → 403) | Yes (Panini England Luminance hobby, Prizm WC, plus stickers/Adrenalyn) | No F1 seen | Category pages live; stock flags present | Magento product-item HTML (`data-product-id`, `data-price-amount`, `stock unavailable`) | Category paths allowed. Disallows `*product_list_*`, `*price=*`, `catalogsearch/result` | No ETag/LM on HTML; sitemap has ETag/LM | **GI: YES (quoted).** ES: not from this store |
| 5 | Panini Spain store | `https://www.panini.es/shp_esp_es/...` | **HTML only** (Magento, same platform) | Yes (cromos/cards fútbol) | Not checked | — | Same Magento HTML | Same rule set as UK | Not tested | **ES: YES (quoted). GI: NO** (not in the list of non-Spain countries served) |
| 6 | Panini America | `https://www.paniniamerica.net/` | **HTML shell (React SPA)**. Data API not identified; blog `blog.paniniamerica.net` times out except robots.txt | Some US soccer (NWSL, etc.) | No | — | SPA; product data not server-rendered | Very permissive (only `/cdn-cgi/`, `/upload/invoice/`, `/upload/tax/`, `/support/*.pdf`) | Root has Last-Modified only; not tested | GI/ES: **UNVERIFIED** (third-party sources say no direct intl shipping) |
| 7 | Cardboard Connection | `https://www.cardboardconnection.com/new-release-calender` | HTML (TablePress) | Yes | Yes (historic) | **STALE**: ld+json `dateModified 2026-02-09`; newest table ends about mid-Feb 2026 | TablePress `<tr class="row-N"><td class="column-1">2/5</td>...` | Allowed for `*` (blocks GPTBot/CCBot/Google-Extended; `/?*` disallowed) | **ETag→304 works** | n/a |
| 8 | Waxstat | `https://www.waxstat.com/2026-soccer-cards-release-calendar` (+ racing variants) | **HTML shell**: AngularJS client-rendered; no rows in HTML; JSON endpoint not found (XHR-style GET → 302 to `/`) | Yes (per titles) | "Racing" calendars exist | Unknown | Not accessible | `User-agent: *` with no Disallow (sitemaps incl. `release-dates.xml`) | No validators (`cache-control: no-store`) | n/a |
| 9 | futbol.cards | `https://futbol.cards/release-calendar/` | HTML | Yes (soccer only) | No | Updated, but **only approximate windows** ("Mid-October 2026") | HTML table | `Allow: /` | No validators | n/a |
| 10 | Beckett | `https://www.beckett.com/news/...` | **Unavailable**: every URL incl. robots.txt 302 → `https://maintenance.beckett.com/` (also with a browser UA) | (search: covers soccer & racing) | (search: yes) | — | — | Untestable | — | n/a |
| 11 | Sports Collectors Daily | `/category/.../new-sports-card-release-calendar/` | **Blocked**: nginx 403 on page **and** robots.txt | (search: biweekly US calendar posts) | — | — | — | Untestable | — | n/a |
| 12 | TCDB | `https://www.tcdb.com/ReleaseDates.cfm` | **Blocked**: Cloudflare managed challenge (`cf-mitigated: challenge`, "Just a moment...") incl. robots.txt | — | — | — | — | Untestable | — | n/a |
| 13 | Sports Card Investor | `/release-calendar/` | **Dead**: 404 (no release-calendar page found by search either) | — | — | — | — | robots 200 | — | n/a |

**Recommended primary calendar: collectosk** (EU-centric, covers European-only Topps releases, soccer + F1, server-rendered, conditional GET works, WP REST JSON for product detail).
**Secondary/cross-check: Checklist Insider** (US-centric but fresh, ISO datetimes, clean markup).
Topps' own `/release-calendar` would be ideal but cannot be reached from here.

---

## 1. collectosk (recommended primary)

- **Confirmed to exist.** WordPress site (Astra theme, Apache) with EN plus `/de/ /es/ /fr/ /it/` language variants (per robots sitemaps). It describes itself (page body, via REST): *"Stay informed with the detailed collectosk stickers & cards release calendar, covering all upcoming sticker and trading card releases from Panini, Topps, Upper Deck, Leaf, Rittenhouse, and many other manufacturers… The listed dates generally refer to the hobby release date."*
- **URLs**
  - Calendar: `https://www.collectosk.com/new-release-calendar/` (HTTP 200, 381 KB raw / 56 KB brotli)
  - Same calendar through WP REST: `https://www.collectosk.com/wp-json/wp/v2/pages?slug=new-release-calendar&_fields=id,modified_gmt,link,content`. HTTP 200 JSON (65 KB). `content.rendered` contains the **same 52 server-rendered `table_2_row_*` rows**.
  - Product posts: `https://www.collectosk.com/wp-json/wp/v2/posts?per_page=3&_fields=id,date_gmt,modified_gmt,slug,link,title,categories`. HTTP 200 JSON, `x-wp-total: 658`, `x-wp-totalpages: 220`, with a `Link: rel="next"` header.
  - Categories: `/wp-json/wp/v2/categories?per_page=100`. Relevant IDs: `358` "Soccer Season 2026/27" (5), `308` "Soccer Season 2025/26" (86), `180` "Soccer Tournaments" (41), `355` "Racing Season 2026" (4). The "Football" categories mean American football.
  - Archive pages also exist, e.g. `/2024-release-dates/` (search-only, not fetched).
- **Status:** live HTML (server-rendered table) **and** live JSON (WP REST). There is **no** iCal (none found). RSS exists in WordPress, but robots.txt disallows `*/feed/`, so **do not use RSS**.
- **Shape (calendar row):** 4 columns: `Date` (ISO `YYYY-MM-DD` or `TBD`) | `Collection Name` (with an optional link to the product post) | `CL` (checklist icon link) | `Category` (`Soccer`, `Racing`, `Football`, `Baseball`, `Basketball`, `Sports`, `Entertainment`). Excerpt:
  ```html
  <tr id="table_2_row_7" data-row-index="7">
    <td style="">2026-10-01</td>
    <td style=""><a href="https://www.collectosk.com/2026-topps-williams-racing-cards/"><strong>2026 TOPPS Williams Racing Cards</strong></a> 🏎️</td>
    <td style=""><a href="https://www.collectosk.com/2026-topps-williams-racing-cards/#checklist"><img ... alt="Checkliste verfügbar" /></a></td>
    <td style="">Racing</td>
  </tr>
  ```
  The table is wpDataTables with `"serverSide":false`, so all rows are in the HTML. Column keys in the config are `releasedate, collection_name, checklist_link, category_group`. A loader `<div>` precedes the rows inside `<tbody>`, so the parser must match `<tr id="table_2_row_` and not rely on a strict DOM.
- **Content on 2026-10-02:** 52 rows, from 2026-09-26 through TBD. Soccer 14, Racing 4, Football (US) 8, Baseball 7, Basketball 5, Sports 7, Entertainment 7. In-scope rows include:
  - 2026-10-06 2025-26 TOPPS Stadium Club Chrome UEFA Champions League (Pre-order)
  - 2026-10-06 2026-27 TOPPS Arsenal FC Collector Tin
  - 2026-10-15 2026 TOPPS Chrome Formula 1 Racing Cards
  - 2026-10-23 2026-27 TOPPS Paris Saint-Germain Collector Tin
  - 2026-11-04 2025-26 PANINI National Treasures Road to FIFA World Cup 26
  - 2026-11-11 2026-27 TOPPS Liverpool FC Collector Tin
  - TBD 2026 TOPPS Carbon Formula 1
  - TBD 2026-27 TOPPS Flagship Bundesliga
  - TBD 2026 PANINI Flawless FIFA World Cup 2026

  European-only Topps products (club tins, Bundesliga) appear here and **do not** appear on Checklist Insider.
- **Product post via REST** (`/wp-json/wp/v2/posts?slug=2026-topps-chrome-formula-1-racing-cards`): `content.rendered` contains a "Facts" block: *"Release Date October 15 2026 Manufacturer Brand Chrome Category 🏎️ Racing Competition / Season Formula 1 Season 2026 Base Set 200 Cards … Product Formats 6 Formats Checklist Status ✓ included: Checklist"*. This is useful for enrichment but is free text, so parsing needs care. `modified_gmt` 2026-09-20T18:43:28.
- **robots.txt** (HTTP 200, `last-modified: Tue, 18 Aug 2026`):
  ```
  User-agent: YouBot
  Disallow: /
  User-agent: *
  Disallow: /wp-admin/
  Allow: /wp-admin/admin-ajax.php
  Disallow: */feed/
  Disallow: /*?feed=
  Disallow: /*/comments/
  ...
  ```
  Verdict: `/new-release-calendar/` and `/wp-json/wp/v2/...` are **allowed**. Feeds are **disallowed**.
- **Conditional GET (tested):** the response carries `etag: "5d189-65cd6356b145b;65cc32a8494ab` (malformed: no closing quote; store and echo it verbatim) and `last-modified: Fri, 02 Oct 2026 07:09:09 GMT`, with `cache-control: no-cache, must-revalidate, max-age=0`.
  - `If-None-Match: <etag>` → **304**, 0 bytes.
  - `If-Modified-Since: <lm>` → **304**, 0 bytes.

  Last-Modified was today, about 17 min before the fetch. This looks like a page-cache regeneration time (WP-Optimize), so a 200 does not guarantee that rows changed. Diff the parsed rows. The REST `pages.modified_gmt` (2026-08-09) does **not** move when the table changes, so do not use it for change detection. REST responses carry no ETag/LM.
- **Bot protection:** none seen (Apache, no CDN challenge). No 429s at about 8 requests.
- **Fixtures:** `fixtures/phase0/collectosk/`
  - `2026-10-02_robots.txt`
  - `2026-10-02_new-release-calendar_headers.txt`
  - `2026-10-02_new-release-calendar_table-snippet.html`
  - `2026-10-02_wp-json_wp_v2_pages_slug-new-release-calendar_truncated.json`
  - `2026-10-02_wp-json_wp_v2_posts_per_page-3.json`
  - `2026-10-02_wp-json_wp_v2_posts_slug-2026-topps-chrome-formula-1-racing-cards_truncated.json`

## 2. Checklist Insider (secondary / cross-check)

- **URL:** `https://www.checklistinsider.com/release-calendar`. HTTP 200, 28.6 KB, Cloudflare (`cf-cache-status: DYNAMIC`) in front of LiteSpeed (`x-litespeed-cache: hit`).
- **Status:** HTML only. WordPress REST was moved: `/wp-json/...` returns 404, and `/ci-api/wp/v2/posts` returns **401** `{"code":"rest_unauthorized","message":"Access Denied. You must log in or provide valid credentials to read API data."}`.
- **Shape:** month groups `<h2 ... data-group="202610"><time datetime="2026-10">October 2026</time></h2>`, then items. Excerpt:
  ```html
  <div class="release-date-stamp shadow-sm" title="Release Date: October 1, 2026"><time datetime="2026-10-01T00:00:00-04:00">Oct 1</time></div><a href="https://www.checklistinsider.com/2026-topps-williams-racing"> ...
  <a href="https://www.checklistinsider.com/2026-topps-williams-racing">2026 Topps Atlassian Williams Racing Checklist Guide</a>
  ```
  The page had 42 items from 2026-10-01 to 2027-02-24. Soccer/F1 items: Williams Racing (10-01), Donruss NWSL (10-02), Donruss Optic NWSL (10-14), Panini Obsidian K League (10-14), **Topps Chrome F1 (10-15)**, Crown Royale NWSL (10-28), Panini NT Road to FIFA WC 2026 (11-04), **Topps Chrome Sapphire F1 (11-12)**.
- **Discrepancy noted:** Panini Obsidian K League is dated **2026-09-30** on collectosk but **2026-10-14** on Checklist Insider. Expect source disagreement and keep per-source dates.
- **Coverage gap:** this site is US-centric. It is missing the Topps club Collector Tins, Bundesliga Flagship and Stadium Club Chrome UCL that collectosk lists.
- **robots.txt:**
  ```
  Sitemap: https://www.checklistinsider.com/sitemap_index.xml
  User-agent: *
  Disallow: /cdn-cgi/
  ```
  Verdict: allowed.
- **Conditional GET:** none. There is no ETag and no Last-Modified, and `cache-control: public, max-age=86400, must-revalidate, no-store`. Poll at most daily and diff the content.
- **Bot protection:** Cloudflare in front, but no challenge at 3 requests.
- **Fixtures:** `fixtures/phase0/checklistinsider/` (robots, headers, first 3 items).

## 3. Topps / Fanatics official (blocked from here)

- **Hosts tried:**

  | Host | Result |
  |---|---|
  | `www.topps.com` | 403 Cloudflare |
  | `uk.topps.com` | 403 Cloudflare |
  | `shop-uk.topps.com` | 403 Cloudflare |
  | `de.topps.com` | 403 Cloudflare |
  | `es.topps.com` | 403 Cloudflare |
  | `fr.topps.com` | 403 Cloudflare |
  | `it.topps.com` | 403 Cloudflare |
  | `jp.topps.com` | 403 Cloudflare |
  | `topps.com` | 301 → `www.topps.com` |
  | `eu.topps.com` | proxy CONNECT 502 (host likely doesn't exist, or egress refused) |
  | `ca.topps.com` | proxy CONNECT 502 (host likely doesn't exist, or egress refused) |
  | `www.toppsuk.com` | proxy CONNECT 502 (host likely doesn't exist, or egress refused) |
  | `www.topps.co.uk` | connection reset |
  | `www.toppsdirect.com` | TLS certificate name mismatch (not a Topps store) |

- **Block evidence** (`fixtures/phase0/topps/2026-10-02_www.topps.com_root_403_*`):
  ```
  HTTP/2 403
  server: cloudflare
  cf-ray: a441f7308aa116af-IAD
  <title>Attention Required! | Cloudflare</title> ... "Sorry, you have been blocked" ... "You are unable to access"
  ```
  The same 403 came back for `/robots.txt`, `/products.json`, `/collections/all/products.json?limit=1`, `/sitemap.xml`, `/release-calendar`, `uk.topps.com/collections/topps-now/formula-1/products.json?limit=2` and `uk.topps.com/cart/shipping_rates.json`, and also with a desktop Chrome UA. This is an **IP/WAF-level block, not a UA block**. WebFetch is also egress-blocked for `uk.topps.com`, and web.archive.org is not on the egress allowlist, so archived copies could not be read either.
- **What search indexing shows (search-only, NOT live-verified):**
  - The official calendar exists at `https://www.topps.com/release-calendar`. Topps' own Threads post says it *"updates daily with a 2-week overview of all our newest hobby products"*.
  - URL patterns `/products/<handle>`, `/collections/<handle>`, `/pages/<handle>` appear on all Topps hosts. Examples:
    - `https://www.topps.com/collections/formula-1-topps-now-archive?stock_status=ALL_STOCK`
    - `https://uk.topps.com/collections/topps-now/formula-1`
    - `https://www.topps.com/products/lewis-hamilton-2026-formula-1%C2%AE-topps-now%C2%AE-card-38`
    - `https://www.topps.com/pages/racing`
  - These URL patterns are Shopify-style. Search also shows that Topps moved to a Shopify-powered site (X post by @SatchelPrice, Jan 2025: *"It's official: Topps is moving to a Shopify-powered website"*), and the StellarAIO bot guide (fetched live, HTTP 200) says *"This is for Topps US & EU which is Shopify."* **Conclusion: Shopify is very likely, but whether `/products.json` is exposed is UNVERIFIED.**
  - Topps NOW is time-limited print-to-order, with sales windows "as little as 24 hours". Print runs are revealed afterwards (titles like "Card 11 - PR: 8897"). An F1 NOW archive collection exists (search-only).
- **Shipping (all UNVERIFIED):**
  - Search snippets of `uk.topps.com/support/shipping-handling` say UK customers order on UK, *"EU customers… should place their order on the appropriate EU website"* (DE/FR/ES/IT), and that customers outside the UK and EU may use either site. If a country is missing at checkout, Topps cannot ship there.
  - A search-engine summary claimed Gibraltar is listed at UK checkout. **Not verifiable from here.** Gibraltar is outside the EU VAT/customs area, so it would plausibly route to the UK site, but this is unconfirmed.
  - Spain: search snippets of `es.topps.com/pages/envios-y-devoluciones-es` show free shipping over €75 and *"TOPPS NOW, On Demand Sets… will take up to 20 business days after the sale period ends."*
- **Next step:** re-test from the production runtime IP:
  - `uk.topps.com/robots.txt`
  - `/products.json?limit=1`
  - `/release-calendar`
  - Shopify `GET /cart/shipping_rates.json?shipping_address[country]=GI` (requires a cart; may be blocked)

  If it is still blocked, treat Topps as **link-out only**, with drops discovered through collectosk.

## 4. Panini UK (`panini.co.uk`): ships to Gibraltar ✔

- **Platform:** Magento / Adobe Commerce behind Fastly (`x-served-by: cache-fra-…`, `x-cache`, `x-platform-server`). Store code `shp_gbr_en`. `/` → 301 `/shp_gbr_en/`.
- **Status:** HTML only. `GET /graphql` → **403** Varnish "Error 54113", so GraphQL is blocked.
- **Relevant category** (HTTP 200, 228 KB): `/shp_gbr_en/stickers-and-trading-cards/men-s-football/men-s-national-team-collections/2026-panini-luminance-england-football-hobby-trading-cards.html`. It has 2 product items:
  ```
  ('…/2026-panini-luminance-england-football-hobby-trading-cards-hobby-team-set-400009box10-uk02.html', '2026 Panini Luminance England Football Hobby Trading Cards - Hobby Team Set') price 170, data-product-id 339200, <div class="stock unavailable" …><span>Unavai…
  ('…-hobby-team-set-case-bundle-bundle400009box10c20-uk02.html', '… Case Bundle') price 3400, id 339356, stock unavailable
  ```
  Other in-scope categories are under `/stickers-and-trading-cards/men-s-football/` (FIFA, EFL, men's national team collections). Most of the catalogue is stickers or Adrenalyn (out of scope), so filter by "Hobby" or "Trading Cards". No F1 was seen.
- **robots.txt** (excerpt):
  ```
  Sitemap: https://www.panini.co.uk/sitemap_gbr.xml
  Sitemap: https://www.panini.co.uk/sitemap_hob_gbr.xml
  User-agent: *
  Disallow: /shp_gbr_en/catalogsearch/result/
  Disallow: /checkout/
  Disallow: *product_list_*
  Disallow: *skip_default_filters=*
  Disallow: *pnn_*
  Disallow: *price=*
  ```
  Verdict: plain category and product URLs are allowed. Do **not** poll with `?product_list_order=`/`limit` params or site search.
- **Conditional GET:** category HTML has no ETag/LM (`cache-control: no-store, no-cache…`). `sitemap_hob_gbr.xml` has `etag: W/"6ab9f57f-18f"` and `last-modified: Mon, 28 Sep 2026` (a 304 was not tested). It is a sitemap index pointing to `/media/hob_gbr_en/*.xml`.
- **Shipping, quoted from `https://www.panini.co.uk/delivery-terms-and-costs`:**
  > "FREE express delivery for orders £50 and over (excluding orders sent from Italy to Eire or Gibraltar)"
  > "Delivery of product being sent to Eire or Gibraltar ! Please note that there is a minimum order value of £20 for orders placed by customers in Eire and Gibraltar where products are sent from the UK or from both the UK and Italy."
  > "Deliveries to Gibraltar: Your order should usually arrive 3-5 working days from the date of dispatch"
  > "For orders from £20 to £49.99 items will be sent by express delivery (£4.95). For orders £50 and over, you will receive FREE express delivery."

  **GI = YES.** ES = not served by the UK store (the page covers UK, Eire and Gibraltar; Spain → panini.es).
- **Fixtures:** `fixtures/phase0/panini-uk/` (robots, delivery-terms text excerpt, first product-item HTML).

## 5. Panini Spain (`panini.es`): ships to Spain ✔, not Gibraltar

- **Platform:** same Magento stack, store `shp_esp_es`, with a soccer category `/shp_esp_es/cromos-coleccionables/deporte/futbol.html`.
- **Shipping, quoted from `https://www.panini.es/coste-y-tiempo-de-envio`:**
  > "El importe de los gastos de envío de los pedidos con domicilio de entrega en España y Andorra es: Península y Andorra: 5,50 € Baleares: 8,50 € Canarias, Ceuta y Melilla: 13,50 €."
  > "El website Panini.es no realiza venta fuera de España exceptuando los siguientes países: Albania, Arabia Saudí, Argentina, Bolivia, Chile, China, Colombia, Cuba, Ecuador, El Salvador, Emiratos Árabes Unidos, Guatemala, Honduras, India, Macedonia, Nicaragua, Panamá, Paraguay, Perú, República Dominicana, Singapur, Túnez, Ucrania, Uruguay y Venezuela."

  **ES = YES. GI = NO** (Gibraltar is not in the exception list).
- **robots.txt:** same rule set as the UK (`Disallow: *product_list_*`, `*price=*`, `/shp_esp_es/catalogsearch/result/`, …).
- **Not done:** conditional GET and product-level structure were not tested here (assumed the same as the UK; mark UNVERIFIED).
- **Fixture:** `fixtures/phase0/panini-es/2026-10-02_coste-y-tiempo-de-envio_text-excerpt.txt`.
- Other Panini EU stores exist (`panini.de` → `/shp_deu_de/`, `paninistore.com/shp_int_en/`). Their shipping was not checked.

## 6. Panini America (`paniniamerica.net`)

- **Root:** HTTP 200, 14 KB **React SPA shell** (`webpackChunkpanini_cx_web`). Cloudflare is in front, with no challenge for the root or robots. Headers include `last-modified: Wed, 23 Sep 2026` and `cache-control: no-cache`. ld+json holds only Organization/WebSite data.
- **Product data:** not server-rendered. The data API was **not identified** after inspecting 3 of about 28 JS chunks, and further digging was stopped to keep request volume low. **UNVERIFIED.**
- **Blog:** `blog.paniniamerica.net/robots.txt` returned 200 (`Disallow: /wp-admin/`, `/wp-includes/`, `/usa-marriage-site/`). The homepage and `/wp-json/wp/v2/posts` both **timed out** (40–60 s, 0 bytes) twice. Treat it as unreliable.
- **robots.txt (store):** `User-Agent: * Disallow: /cdn-cgi/ /upload/invoice/ /upload/tax/ /support/*.pdf`. It explicitly allows ClaudeBot, GPTBot and Google-Extended.
- **Shipping GI/ES:** UNVERIFIED. Third-party pages (douglashollis.com, forwarders) say Panini America does not ship internationally. **Low priority:** its soccer output (NWSL, K League, FIFA) already appears on both calendars.
- **Fixtures:** `fixtures/phase0/panini-america/`.

## 7. Cardboard Connection: stale

- **URL:** `https://www.cardboardconnection.com/new-release-calender` (note the site's own misspelling "calender"). HTTP 200, 115 KB, LiteSpeed.
- **Shape:** TablePress, one table per year. The newest table (`tablepress-18`, 90 rows) runs from `1/7` to about `2/18` 2026. Example: `['2/5', 'Topps - 2026 Topps Chrome Premier League Soccer']`.
  - Dates are `M/D` with no year in the cell.
  - ld+json `"dateModified":"2026-02-09T19:46:38+00:00"`.
  - **Not maintained since Feb 2026, so do not use it.**
- **robots:** `User-agent: * Disallow: /images/e/* /sports-collectibles-* /partners/* /?* /*.htm$`. It disallows `GPTBot`, `CCBot` and `Google-Extended` entirely. Our UA falls under `*`, so the calendar path is allowed.
- **Conditional GET:** `etag: "509947-1790898879;br"`. `If-None-Match` → **304**.
- **Fixtures:** `fixtures/phase0/cardboardconnection/`.

## 8. Waxstat: JS-only

- **URL:** `https://www.waxstat.com/2026-soccer-cards-release-calendar`. HTTP 200, 22 KB, Rails on Heroku behind Cloudflare.
- **The HTML is an AngularJS template** (`{{b.release_date}}`, `{{b.name}}`, columns "Product Name | UPC | Release Date | Year | Sport | Type | Brand | Avg Price"). No rows are server-rendered.
- **Data endpoint:** the app bundle calls `wax_tracker_url` with `{page, per_page, sport, year, brand, box_type_ids}`, but that URL is not present in the page. A GET to the calendar URL with `Accept: application/json` → 302 to `/`. The JSON endpoint is **UNVERIFIED**. Search snippets show it covers soccer (e.g. "2026-27 Panini Donruss Road to FIFA World Cup 26 Soccer Hobby Box - October 5, 2026") and has "Racing" calendars.
- **robots:** `User-agent: *` with sitemaps only (including `sitemaps/release-dates.xml`), so everything is allowed.
- **Conditional GET:** `cache-control: no-store`, no validators.
- **Fixtures:** `fixtures/phase0/waxstat/`.

## 9. futbol.cards

- **URL:** `https://futbol.cards/release-calendar/`. HTTP 200 (Astro behind Cloudflare). robots: `User-agent: * Allow: /`.
- **Content:** soccer only, with **approximate windows** ("2025-26 Panini Flawless Soccer — Mid-October 2026", "2025-26 Topps UEFA Club Competitions Finest — November 2026"). It is an affiliate site, and the page itself says *"Exact on-sale dates shift… always confirm the release date with the manufacturer."* **Not suitable as a date source.** At most it is a "what's coming this season" hint.
- **Fixtures:** `fixtures/phase0/futbolcards/`.

## 10–13. Unavailable calendars

- **Beckett:** `www.beckett.com/*` (including `/robots.txt` and `/news/...`) → `302 https://maintenance.beckett.com/` (CloudFront `x-cache: Error from cloudfront`), with both our UA and a browser UA. The maintenance page title is "Express Submissions Remain Open | Beckett". Search snippets show Beckett runs a release-calendar page covering soccer and racing, but it is **unavailable now**. Re-check later.
- **Sports Collectors Daily:** page and `/robots.txt` → `403` from `server: sitedistrict-nginx`. Blocked (it publishes biweekly "Sports Card Release Calendar" posts, search-only).
- **TCDB:** `/ReleaseDates.cfm` and `/robots.txt` → `403`, `cf-mitigated: challenge`, "Just a moment...". Blocked by a Cloudflare managed challenge. Do not attempt to bypass.
- **Sports Card Investor:** `/release-calendar/` → 404, and search found no calendar page. Dead or non-existent.

---

## Recommendations for Phase 1

1. **Primary calendar: collectosk.**
   - Poll `https://www.collectosk.com/new-release-calendar/` with `If-None-Match`/`If-Modified-Since` (verified 304) about every 6–12 h.
   - Parse `tr[id^=table_2_row_]` into `{date|TBD, name, url?, category}`. Keep `Soccer` and `Racing`, then drop baseball, stickers and Match Attax/Turbo Attax by name. Collectosk lists stickers and TCGs under the same categories (e.g. "Match Attax", "Adrenalyn XL").
   - Optionally enrich from `/wp-json/wp/v2/posts?slug=<slug>` for linked rows. Never use `/feed/`.
   - Do not hard-code the table id (`table_2`). Note the second table id in config (`wpDataTableID-2`).
2. **Cross-check: Checklist Insider** `/release-calendar`, daily, with no validators. Use it to fill US-hobby dates such as Topps Chrome F1 and Chrome Sapphire F1. Flag disagreements.
3. **Stores for GI/ES ship-to:**
   - Panini UK covers **GI** (quoted).
   - Panini ES covers **ES** (quoted; no GI).
   - Topps UK/ES: **unknown until re-tested from the deployment IP**. Until then, link out only.
4. **Drop:** Cardboard Connection (stale), Sports Card Investor (none), futbol.cards (approximate windows). **Watch:** Beckett (maintenance). **Do not scrape:** TCDB, Sports Collectors Daily (blocked/challenged), Waxstat (JS-only, endpoint unknown).
