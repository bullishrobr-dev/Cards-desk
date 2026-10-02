# Phase 0: platform and GI/ES logistics research

Researched on **2026-10-02**. Official pages were fetched live with curl through the session proxy (Cloudflare docs as `index.md`, gov.uk through its content API, PDFs converted with `pdftotext`). npm versions come from `registry.npmjs.org`.

Status markers:

- **VERIFIED** means an official source was fetched today and the statement is a direct reading of it.
- **UNVERIFIED** means it rests on secondary sources, search-result snippets or inference, or the official source could not be fetched. Confirm it before relying on it.

> **Headline changes for the architecture and the shipping logic**
> 1. **Workers Paid ($5/month) is required.** The Free plan gives 10 ms of CPU per cron invocation and 50 subrequests, which is not enough to poll and parse about 40 retailer pages. KV Free also allows only 1,000 writes a day. (§A.6)
> 2. **`ctx.access` is not available to Workers that use Static Assets**, so the Worker has to validate `Cf-Access-Jwt-Assertion` itself, with `jose` against the team JWKS. (§A.7)
> 3. **@block65/webcrypto-web-push must be ≥ 2.0.0.** Version 1.x used `aesgcm` encoding and the draft `WebPush` scheme, both of which Apple rejects. (§B.1)
> 4. **Claude Haiku 4.5 is the cheapest current model**, but its listed retirement is "not sooner than 15 October 2026", so the model ID must be configurable. (§D)
> 5. **The Gibraltar side changed on 15 July 2026.** The UK–EU Gibraltar Agreement is provisionally applied. There is now an EU–Gibraltar customs union, Gibraltar **import duty has been replaced by a 15% Transaction Tax** (16% in 2027, 17% in 2028), the land frontier has **no customs controls**, and the **old 12% import-duty and £25 RGPO assumptions are obsolete or uncertain**. Goods for Gibraltar are cleared at EU designated customs posts in Spain (Algeciras, La Línea and others), and **only passenger luggage may arrive on commercial flights**. (§E)
> 6. **The EU €150 duty de minimis ended on 1 July 2026.** Non-EU parcels of €150 or less now pay a **€3 customs duty per item (tariff line)** until 1 July 2028, plus 21% Spanish import VAT. This hits UK→Spain orders. (§E.4)

---

## A. Cloudflare

### A.1 Wrangler and configuration format

| Claim | Status | Source |
|---|---|---|
| The current Wrangler is **4.146.0** (major **v4**), published 2026-10-01. | VERIFIED (npm registry) | https://registry.npmjs.org/wrangler |
| `@cloudflare/vite-plugin` is at 1.62.4 and Vite at 8.3.2 (both published 2026-10-01). | VERIFIED (npm registry) | https://registry.npmjs.org/@cloudflare/vite-plugin, https://registry.npmjs.org/vite |
| Cloudflare's React guide scaffolds with `npm create cloudflare@latest -- my-react-app --framework=react`. It uses the Cloudflare Vite plugin and sets `assets.not_found_handling = "single-page-application"`, "which means that routes that are handled by your React SPA do not go to the Worker, and are thus free". | VERIFIED | https://developers.cloudflare.com/workers/framework-guides/web-apps/react/ |
| Docs examples use `wrangler.jsonc` with `"$schema": "./node_modules/wrangler/config-schema.json"`. | VERIFIED | https://developers.cloudflare.com/workers/static-assets/binding/ |
| Types: "We recommend you generate types for your Worker by running `wrangler types`". `@cloudflare/workers-types` v5 exposes only the latest runtime types, and the dated entrypoints have been removed. | VERIFIED | https://developers.cloudflare.com/workers/languages/typescript/ |

### A.2 Static assets and the SPA

| Claim | Status | Source |
|---|---|---|
| An SPA needs `assets.directory` and `assets.not_found_handling: "single-page-application"`. An unmatched request is served `/index.html` with a 200. | VERIFIED | https://developers.cloudflare.com/workers/static-assets/routing/single-page-application/ |
| With `compatibility_date` ≥ 2025-04-01 (flag `assets_navigation_prefers_asset_serving`), **navigation requests** (`Sec-Fetch-Mode: navigate`) do not invoke the Worker. A browser *navigating* to `/api/x` therefore gets index.html, while `fetch('/api/x')` reaches the Worker. | VERIFIED | same |
| `assets.run_worker_first` accepts `true` or an **array of route patterns** with `*` globs and `!` negations, e.g. `["/api/*", "!/api/docs/*"]`. Negative patterns take precedence. | VERIFIED | https://developers.cloudflare.com/workers/static-assets/binding/ |
| The ASSETS binding (`"binding": "ASSETS"`) lets the Worker call `env.ASSETS.fetch(request)`. | VERIFIED | https://developers.cloudflare.com/workers/static-assets/routing/worker-script/ |

Recommended for this project (a design choice, not a doc claim). The iCal feed is fetched by calendar clients, which do not send `Sec-Fetch-Mode: navigate`, but opening the feed URL in a browser would. Listing the routes explicitly removes that ambiguity:

```jsonc
{
  "$schema": "./node_modules/wrangler/config-schema.json",
  "name": "card-desk-drops",
  "main": "src/worker/index.ts",
  "compatibility_date": "2026-10-02",
  "compatibility_flags": ["nodejs_compat"],          // required by @sentry/cloudflare (§C.1)
  "assets": {
    "directory": "./dist/client",
    "binding": "ASSETS",
    "not_found_handling": "single-page-application",
    "run_worker_first": ["/api/*", "/ical/*", "/push-receipt/*"]
  },
  "triggers": { "crons": ["*/15 * * * *"] },
  "version_metadata": { "binding": "CF_VERSION_METADATA" },
  "upload_source_maps": true
  // d1_databases, kv_namespaces, r2_buckets ...
}
```

### A.3 compatibility_date

| Claim | Status | Source |
|---|---|---|
| "When you start your project, you should always set `compatibility_date` to the current date." Old dates are supported forever, and new features sometimes need a current date. If the date is omitted on an API upload, it defaults to 2021-11-02. **Use `2026-10-02`.** | VERIFIED | https://developers.cloudflare.com/workers/configuration/compatibility-dates/ |

### A.4 Cron triggers and Worker limits (page last updated 2026-09-05)

| Limit | Workers Free | Workers Paid | Status | Source |
|---|---|---|---|---|
| Cron Triggers per **account** | 5 | 250 | VERIFIED | https://developers.cloudflare.com/workers/platform/limits/ |
| CPU time per Cron Trigger | **10 ms** | **30 s for schedules more frequent than hourly**; 15 min for hourly or slower | VERIFIED | same |
| Wall-clock duration per cron invocation | 15 min | 15 min | VERIFIED | same |
| Subrequests per invocation (fetch **plus** calls to R2, KV and D1) | **50** | 10,000 by default (configurable up to 10M through `limits`) | VERIFIED | same |
| "Subrequests to internal services" | 1,000 | matches the configured limit | VERIFIED | same |
| Simultaneous open outgoing connections per request | 6 | 6 | VERIFIED | same |
| Requests | 100,000/day | unlimited | VERIFIED | same |
| Memory | 128 MB | 128 MB | VERIFIED | same |
| Redirects count toward subrequests. Waiting on fetch does **not** count as CPU time. | — | — | VERIFIED | same |
| Cron runs in UTC. Changes take up to 15 min to propagate. Cron Events keep the last 100 invocations. Local test: `/cdn-cgi/local/scheduled?cron=...` | — | — | VERIFIED | https://developers.cloudflare.com/workers/configuration/cron-triggers/ |
| Paid includes 10M requests and 30M CPU-ms a month, with a $5 minimum. The pricing page phrases the cron CPU cap as "max of 15 minutes of CPU time per Cron Trigger". The limits page is more specific (30 s if the cron runs more often than hourly), so **plan for 30 s**. | VERIFIED (the two pages differ slightly) | https://developers.cloudflare.com/workers/platform/pricing/ |

### A.5 D1, KV, R2

| Item | Free | Paid | Status | Source |
|---|---|---|---|---|
| D1 databases per account | 10 | 50,000 | VERIFIED | https://developers.cloudflare.com/d1/platform/limits/ |
| D1 max database size | 500 MB | 10 GB | VERIFIED | same |
| D1 storage per account | 5 GB | 1 TB | VERIFIED | same |
| D1 queries per Worker invocation | 50 | 1,000 | VERIFIED | same |
| D1 Time Travel | 7 days | 30 days | VERIFIED | same |
| D1 rows read | 5M/day | 25B/month included | VERIFIED | https://developers.cloudflare.com/d1/platform/pricing/ |
| D1 rows written | 100k/day | 50M/month included | VERIFIED | same |
| KV reads | 100k/day | 10M/month included | VERIFIED | https://developers.cloudflare.com/kv/platform/pricing/ |
| **KV writes (different keys)** | **1,000/day** | 1M/month included | VERIFIED | https://developers.cloudflare.com/kv/platform/limits/ |
| KV writes to the same key | 1/second | 1/second | VERIFIED | same |
| KV operations per invocation | 1,000 | 1,000 | VERIFIED | same |
| R2 free tier (Standard) | 10 GB-month storage, 1M Class A ops/month, 10M Class B ops/month, free egress | — | VERIFIED (page updated 2026-10-01) | https://developers.cloudflare.com/r2/pricing/ |

### A.6 Is Workers Paid needed? **Yes.** (inference from the VERIFIED limits above)

Assumed workload: about 40 sources with cadences from 15 min to 24 h. Any one 15-minute tick might poll 10–40 sources. Each poll is 1–3 fetches (conditional GET, sometimes a sitemap plus a page), followed by parsing, D1 upserts, push sends and an occasional Claude call.

- **CPU:** the Free plan allows 10 ms per cron invocation. Parsing even one HTML retailer page (HTMLRewriter or a DOM parser) can use several ms, and 40 pages will not fit. Paid allows 30 s.
- **Subrequests:** Free allows 50 per invocation, and **D1, KV and R2 calls count**. Forty fetches plus about 40 D1 statements plus push sends exceeds that. Paid allows 10,000.
- **KV writes:** writing per-source state (ETag or last-run) in KV on every tick would be 40 × 96 = 3,840 writes a day, against a Free cap of 1,000. On Paid that is about 115k a month, inside the 1M included. **Recommendation:** keep per-source fetch state (ETag, Last-Modified, next_due_at, back-off) in **D1**, and use KV only for low-churn caches such as the Access JWKS or rendered iCal output.
- **Cost:** about 96 cron runs a day plus single-user API traffic is a tiny fraction of the included Paid usage, so the bill should be the **$5/month minimum** (estimate).
- **Design hint:** the cron is limited to 6 simultaneous outgoing connections, so use a bounded-concurrency pool (≤ 6) and spread sources across ticks by `next_due_at`. Once Paid is enabled, the account allows 250 crons, so separate schedules (for example 15 min and daily) are an option.

### A.7 Cloudflare Access: bypass paths and JWT validation

| Claim | Status | Source |
|---|---|---|
| Protect a hostname or path by creating a **self-hosted Access application** whose domain is the hostname or path. Precedence: hostname/path app → Worker-level app → account-level. | VERIFIED | https://developers.cloudflare.com/workers/configuration/cloudflare-access/ |
| "When multiple rules are set for a common root path, the more specific rule takes precedence … no rule is inherited." Wildcards: `example.com/alpha/*` covers `/alpha/one` but **not** `/alpha` itself. At most one wildcard is allowed between slashes. Query strings are not supported in app paths. | VERIFIED | https://developers.cloudflare.com/cloudflare-one/access-controls/policies/app-paths/ |
| The **Bypass** action "disables any Access enforcement". Use Include → Everyone. Bypass "requests are not logged", and identity selectors are unavailable. Bypass and Service Auth policies are evaluated first. | VERIFIED | https://developers.cloudflare.com/cloudflare-one/access-controls/policies/ |
| **Pattern for this app:** App 1 is a self-hosted app on `drops.<domain>` (whole host) with an Allow policy for the owner's email. App 2 is a self-hosted app on `drops.<domain>/ical/*` with a Bypass Everyone policy. App 3 does the same for `drops.<domain>/push-receipt/*`. The path tokens in those URLs are then the only protection, so compare them in constant time and make them rotatable. | VERIFIED for the mechanism, design is mine | sources above |
| Use a **Custom Domain**, not only `workers.dev`, for the hostname/path apps. Both are supported targets, but protecting the Worker as a whole (Worker-level app) covers *every* route, including `workers.dev` and previews. To stop Access being bypassed through the `workers.dev` URL, disable `workers_dev` or protect it too. | VERIFIED (targets); the `workers_dev` advice is my inference | https://developers.cloudflare.com/workers/configuration/cloudflare-access/ |
| Access sends a signed JWT in the `Cf-Access-Jwt-Assertion` header and the `CF_Authorization` cookie. **Validate the header**, because the cookie is not guaranteed. Keys come from `https://<team>.cloudflareaccess.com/cdn-cgi/access/certs`, rotate every 6 weeks, and old keys stay valid for 7 days. Match on `kid` and do not hard-code keys. | VERIFIED | https://developers.cloudflare.com/cloudflare-one/access-controls/applications/http-apps/authorization-cookie/validating-json/ |
| Official Worker example: `jose`'s `createRemoteJWKSet(new URL(`${TEAM_DOMAIN}/cdn-cgi/access/certs`))` plus `jwtVerify(token, JWKS, { issuer: TEAM_DOMAIN, audience: POLICY_AUD })`, returning 403 on failure. The AUD tag is under Zero Trust → Access controls → Applications → Configure → Additional settings. | VERIFIED | same |
| `jose` latest is 6.2.12 (2026-09-05). | VERIFIED (npm registry) | https://registry.npmjs.org/jose |
| **`ctx.access` (identity without parsing the JWT) is not usable here.** "Workers with Static Assets execute behind an internal router Worker … the router does not pass `ctx.access` to the user Worker." The Vite plugin may add `assets` even if the input config omits it. **Validate the JWT manually with jose in Hono middleware on `/api/*`.** | VERIFIED | https://developers.cloudflare.com/workers/configuration/cloudflare-access/ |
| Pitfall: once the Access session cookie expires, iOS Home-Screen PWAs and service-worker background fetches have to re-authenticate. That is a reason to keep the push-receipt endpoint behind a token Bypass rather than Access. | UNVERIFIED (no official doc found on PWA plus Access session behaviour) | — |

---

## B. Web Push from Workers

### B.1 Libraries (no Node crypto)

| Library | Latest | Status / notes | Source |
|---|---|---|---|
| **@block65/webcrypto-web-push** | **2.0.0** (2026-09-03; registry modified 2026-09-15), MIT | VERIFIED. Its README says it works on "NodeJS, Cloudflare Workers, Bun and Deno", encrypts with **`aes128gcm` (RFC 8291)** and authenticates with **VAPID `vapid` scheme (RFC 8292)**, "accepted by every current push service, including Apple". It pads every message to 4096 octets, so the **maximum payload is 3993 bytes**. API: `buildPushPayload(message, subscription, vapid)` then `fetch(subscription.endpoint, payload)`. **"Version 1.x sent the legacy `aesgcm` content encoding and the draft `WebPush` authorization scheme, neither of which Apple accepts."** **Pin `^2.0.0`.** | https://registry.npmjs.org/@block65/webcrypto-web-push (README) |
| @pushforge/builder | 2.0.5 (2026-04-23), MIT, zero dependencies | VERIFIED. Based on Web Crypto; its README lists Cloudflare Workers support, `npx @pushforge/builder vapid` for key generation and `buildPushHTTPRequest()`. The project's playground runs on a Cloudflare Worker. Last release about 5 months ago. | https://registry.npmjs.org/@pushforge/builder |
| web-push (Node) | 3.6.7 (2024-01-16) | VERIFIED as stale. Depends on Node crypto, and the PushForge README links to web-push issue #718 (no Workers support). **Do not use.** | https://registry.npmjs.org/web-push |
| webpush-webcrypto | 1.0.5 (2025-04-22) | VERIFIED version only, and looks unmaintained. | https://registry.npmjs.org/webpush-webcrypto |

Recommendation: **@block65/webcrypto-web-push ^2.0.0** as the primary library, with @pushforge/builder as the fallback.

### B.2 Push-service requirements (Apple)

| Claim | Status | Source |
|---|---|---|
| Web push works for Home Screen web apps on **iOS/iPadOS 16.4+** and Safari 16 on macOS 13+. | VERIFIED | https://developer.apple.com/documentation/usernotifications/sending-web-push-notifications-in-web-apps-and-browsers |
| Permission must come from a user gesture: "When the user completes the gesture, call the push subscription method immediately from the gesture's event handler code." | VERIFIED | same |
| Firewalls must allow `https://*.push.apple.com`. | VERIFIED | same |
| VAPID JWT: `sub` must be a URL or `mailto:`, `aud` the push-service origin, and `exp` no more than one day ahead. **"Don't refresh your JWT more frequently than once per hour."** The public key must match the `applicationServerKey`. | VERIFIED | same |
| Headers: `TTL` (stored for up to 30 days), `Urgency` (`very-low`/`low`/`normal`/`high`), and `Topic` (≤ 32 URL-safe base64 characters, for coalescing). | VERIFIED | same |
| Responses: **201** success, 400 bad request, **403** auth error (`BadJwtToken`, `BadVapidPublicKey`), 404 invalid `:path`, **410 "The device token has expired"**, **413** payload over **4 KB**, 429 too many requests to the same token, 500, 503. | VERIFIED | same |
| Handling: delete the subscription on **410**, and also on **404** for FCM and Mozilla endpoints (they use 404 for an unknown subscription). Retry with back-off on 429/5xx. On 403, check VAPID configuration and do not delete. | 410: VERIFIED (Apple). 404 behaviour for FCM/Mozilla: UNVERIFIED (not fetched) | — |
| Whether @block65 caches the VAPID JWT (Apple wants a refresh no more than hourly). If it signs a new JWT on every call, cache the `Authorization` header yourself for about 50 min, or confirm this is acceptable. | UNVERIFIED | — |

### B.3 iOS/iPadOS constraints

| Claim | Status | Source |
|---|---|---|
| Web push needs a **Home Screen web app**: a manifest with `display: standalone` or `fullscreen`, added through Share → Add to Home Screen. Since 16.4, third-party browsers can also add to the Home Screen. | VERIFIED | https://webkit.org/blog/13878/web-push-for-web-apps-on-ios-and-ipados/ |
| The permission request must respond to "direct user interaction — such as tapping on a 'subscribe' button". | VERIFIED | same |
| **No silent push.** `userVisibleOnly: true` is required and a notification must be shown for every push. "Violations of the userVisibleOnly promise will result in a push subscription being revoked." | VERIFIED | https://webkit.org/blog/12945/meet-web-push/ |
| Notifications integrate with Focus, and permissions are managed per web app in Settings → Notifications. | VERIFIED | https://webkit.org/blog/13878/web-push-for-web-apps-on-ios-and-ipados/ |
| **Declarative Web Push** (iOS/iPadOS 18.4+ Home Screen apps; Safari 18.5+ on macOS). A JSON payload `{"web_push": 8030, "notification": {title, body, navigate, …}, "app_badge": …}` is shown without the service worker running. The SW can still modify it, and if the SW fails the declarative payload is the fallback, with no revocation penalty. It is backwards compatible: older browsers handle the same JSON in the SW `push` handler. **Recommendation: send declarative-format JSON and parse it in the SW as well.** | VERIFIED | https://webkit.org/blog/16535/meet-declarative-web-push/ |
| Subscription expiry: Apple returns 410 when the token expires. Deleting the Home Screen app removes the subscription (inferred). `PushSubscription.expirationTime` is supported (Safari iOS 16.4). Re-subscribe on app open if `pushManager.getSubscription()` returns null or the keys differ, and also handle `pushsubscriptionchange`. | 410: VERIFIED; the rest is UNVERIFIED best practice | Apple doc above; MDN BCD 8.1.4 |

### B.4 Badging API

| Platform | Support | Status | Source |
|---|---|---|---|
| iOS/iPadOS Safari | **16.4+**, Home Screen web apps only. `setAppBadge(0)` clears the badge. The badge shows once notification permission is granted, and setting it works while the app is in the foreground or handling a push. | VERIFIED | MDN browser-compat-data 8.1.4 (`api.Navigator.setAppBadge`), https://unpkg.com/@mdn/browser-compat-data/data.json; https://webkit.org/blog/13878/web-push-for-web-apps-on-ios-and-ipados/ |
| macOS Safari | 17+ for installed web apps (Sonoma) | VERIFIED | MDN BCD |
| Chrome desktop | 81+ (Windows/macOS), ChromeOS 91+, not Linux | VERIFIED | MDN BCD |
| **Chrome Android** | **Not supported** (`version_added: false`). Android shows notification dots driven by notifications instead. | VERIFIED (BCD); the dot behaviour is UNVERIFIED | MDN BCD |
| Firefox / Samsung Internet | Not supported | VERIFIED | MDN BCD |

Treat the badge as a progressive enhancement and feature-detect `'setAppBadge' in navigator`. The unread count must also appear in the in-app notification centre.

---

## C. Sentry, Resend, Hono

### C.1 Sentry for Cloudflare Workers

| Claim | Status | Source |
|---|---|---|
| `@sentry/cloudflare` latest is **11.2.0** (2026-10-01). `@sentry/hono` is also 11.2.0. | VERIFIED (npm) | https://registry.npmjs.org/@sentry/cloudflare |
| Requires **`nodejs_compat`** and `compatibility_date` ≥ 2024-09-23 (it needs `AsyncLocalStorage`). | VERIFIED | https://docs.sentry.io/platforms/javascript/guides/cloudflare/ |
| The **recommended** setup is now the Vite plugin: `sentryCloudflareVitePlugin()` from `@sentry/cloudflare/vite`, next to `cloudflare()`. It auto-wraps the Worker entry at build time and reads options from `src/instrument.server.ts` (default export `defineCloudflareOptions((env) => ({ dsn, … }))`). Without that file, it reads `SENTRY_DSN`, `SENTRY_ENVIRONMENT` and similar from `env`. | VERIFIED | same |
| Manual alternative (plain Wrangler): `export default Sentry.withSentry((env) => ({ dsn: env.SENTRY_DSN, … }), { fetch: app.fetch, scheduled })`. | VERIFIED | https://docs.sentry.io/platforms/javascript/guides/cloudflare/install/wrangler/ |
| Hono: `@sentry/hono` middleware (`import { sentry } from "@sentry/hono/cloudflare"`) supersedes the deprecated community package `@hono/sentry`. It needs `@sentry/cloudflare` as a peer dependency at the same version. | VERIFIED | https://docs.sentry.io/platforms/javascript/guides/hono/ |
| Hono middleware only covers `fetch`. The cron handler still needs the `withSentry`/plugin wrap. **Recommendation:** use the Vite plugin (or `withSentry`) on the whole module export so both `fetch` and `scheduled` are covered. Add `@sentry/hono` only if per-route spans are wanted. | Inference from VERIFIED docs | — |
| Cron monitoring: `Sentry.withMonitor("<slug>", () => …)` or `captureCheckIn`. It alerts on missed runs, failures and timeouts. | VERIFIED | https://docs.sentry.io/platforms/javascript/guides/cloudflare/crons/ |
| Release auto-detection from `SENTRY_RELEASE` or the `CF_VERSION_METADATA` binding. Source maps: `"upload_source_maps": true` plus `npx @sentry/wizard@latest -i sourcemaps`. `dataCollection: { userInfo: false }` reduces PII. | VERIFIED | https://docs.sentry.io/platforms/javascript/guides/cloudflare/ |

### C.2 Resend (email fallback)

| Claim | Status | Source |
|---|---|---|
| Send endpoint: `POST https://api.resend.com/emails` with Bearer API key. Required fields are `from`, `to` and `subject`, plus `html` or `text`. The SDK `resend` latest is 6.32.0. A plain `fetch` also works on Workers. | VERIFIED | https://resend.com/docs/api-reference/emails/send-email ; https://registry.npmjs.org/resend |
| **Free plan: 100 emails/day and 3,000/month** (sent plus received; each recipient counts), up to 3 verified domains. | VERIFIED | https://resend.com/docs/knowledge-base/account-quotas-and-limits |
| Rate limit: **10 requests/second per team** by default. | VERIFIED | https://resend.com/docs/api-reference/rate-limit |
| A verified domain is required to send to arbitrary recipients ("You must add and verify at least one domain"). Sending from a subdomain such as `alerts.<domain>` is recommended. | VERIFIED | https://resend.com/docs/dashboard/domains/introduction |
| **Exception useful for a single user:** `onboarding@resend.dev` can send **only to the Resend account owner's own address**, and other recipients get a 403. That would allow an MVP without a domain, but deliverability and branding are weaker, so verify a domain if one is already on Cloudflare for Access. | VERIFIED | https://resend.com/docs/knowledge-base/403-error-resend-dev-domain |

### C.3 Hono

| Claim | Status | Source |
|---|---|---|
| Latest is **4.13.12** (2026-09-30). | VERIFIED (npm) | https://registry.npmjs.org/hono |
| Workers pattern: `export default { fetch: app.fetch, scheduled: async (batch, env, ctx) => {…} }`. Static files come from Workers Static Assets (`"assets": {"directory": …}`) rather than Hono middleware. | VERIFIED | https://hono.dev/docs/getting-started/cloudflare-workers |

---

## D. Claude API: cheapest model for title matching

| Claim | Status | Source |
|---|---|---|
| The cheapest current model is **Claude Haiku 4.5**: alias **`claude-haiku-4-5`**, snapshot `claude-haiku-4-5-20251001`. Described as "The fastest model with near-frontier intelligence". 200K context. | VERIFIED | https://platform.claude.com/docs/en/about-claude/models/overview |
| Pricing: **$1/MTok input, $5/MTok output**. Cache writes $1.25 (5 min) or $2 (1 h), cache hits $0.10/MTok. **Batch API: $0.50 / $2.50** (50% off). Minimum cacheable prefix is 496–588 tokens depending on the platform column. | VERIFIED | https://platform.claude.com/docs/en/about-claude/pricing |
| **Retirement: "Not sooner than October 15, 2026"**. Status Active, no deprecation notice yet. Older Haiku models (3, 3.5) are retired. → **Store the model ID in config/env, never hard-code it.** If Haiku 4.5 is deprecated, the next-cheapest current model is **Claude Sonnet 5.5** (`claude-sonnet-5-5`, $2/MTok input, $10/MTok output, cache hits $0.20). | VERIFIED | https://platform.claude.com/docs/en/about-claude/model-deprecations ; pricing page above |
| Haiku 4.5 uses `thinking: {type:"enabled", budget_tokens}` (not adaptive) and does **not** accept `effort`. For title matching, leave thinking off and use structured outputs (`output_config.format`) for JSON. | VERIFIED via the claude-api skill reference (cached 2026-09-25); not re-fetched | Anthropic claude-api skill |
| Cost estimate: about 50 ambiguous titles a day × about 1.5k tokens in and 200 out ≈ $0.075 + $0.05 per day ≈ **$4/month at most**. With prompt caching of the catalogue prefix, or the Batch API for non-urgent passes, it is cheaper still. | Estimate | — |
| `@anthropic-ai/sdk` latest is 0.131.0 and works on Workers via fetch. | VERIFIED (npm version) | https://registry.npmjs.org/@anthropic-ai/sdk |

---

## E. Gibraltar and Spain logistics (sealed trading cards)

### E.1 What changed: the UK–EU Agreement in respect of Gibraltar

| Claim | Status | Source |
|---|---|---|
| The Agreement was **signed on 14 July 2026** and has been **provisionally applied since 15 July 2026**. There are no longer entry or exit check booths at the land border. | VERIFIED | https://www.gov.uk/government/collections/uk-eu-agreement-in-respect-of-gibraltar ; https://www.gov.uk/foreign-travel-advice/spain/entry-requirements |
| It creates an **EU–Gibraltar customs union**. Gibraltar is **not** joining the EU customs territory. There are no customs duties or quotas on EU or Gibraltar goods traded between them. | VERIFIED | HMGoG Technical Notice 72/2026: https://www.gibraltar.gov.gi/uploads/Brexit%20Page/72-2026%20-%20Technical%20Notice%20%E2%80%93%20Basic%20Features%20of%20the%20Customs%20Union%20Between%20Gibraltar%20and%20the%20EU.pdf |
| Gibraltar does **not** adopt VAT ("without adopting VAT or any form of sales tax"). | VERIFIED | https://www.gov.uk/government/publications/draft-uk-eu-agreement-in-respect-of-gibraltar/summary-draft-uk-eu-agreement-in-respect-of-gibraltar-accessible |
| **Import duty ceases.** A **Transaction Tax (TT)** is charged by HM Customs on importation for goods placed on the Gibraltar market. The base is the customs value plus duties, transport, packing and insurance. **Standard rate 15%, rising annually to 17%** by year 3. Reduced 5% rate for children's clothing, bicycles, "works of art, collectors' items and antiques" (EU VAT Annex IX), and others. 0% for food, medicines, books and similar. | VERIFIED | TN 72/2026 (above); https://www.gibraltar.gov.gi/press-releases/government-corrects-transaction-tax-misinformation-2012026-11816 |
| Sealed TCG product is **not** an Annex IX "collectors' item" (that covers stamps, coins and zoological/historical collections), so expect the **15% standard rate**. | UNVERIFIED (inference) | — |
| Customs clearance for goods into Gibraltar happens at **EU Designated Customs Posts (DCP): Algeciras, La Línea, Sagunto** and one in Portugal, using T2/T2GI transit (EU goods) or T1/T1GI (non-EU goods). The DCP levies the **EU Common External Tariff** on non-EU goods (proceeds go back to Gibraltar). | VERIFIED | TN 72/2026 |
| **UK-origin goods** can enter at zero tariff under the UK–EU TCA if origin rules are met. Non-UK-origin goods exported from the UK pay EU duty at the DCP. | VERIFIED | HMGoG consolidated FAQ (TAX-07/08): https://www.gibraltar.gov.gi/uploads/_PressOffice/Consolidated%20FAQ%20Questions%20Report.pdf |
| **Air:** "only goods carried by passengers as personal luggage will be able to be transported on commercial flights operated to and from Gibraltar". Everything else is imported via the EU DCPs, which in practice means **UK parcels to GI now travel overland through Spain**. | VERIFIED | HMGoG FAQ (EXP-05) |
| Products imported from outside the EU must meet EU product rules (checked at the DCP). Toy-safety and CE checks could in principle affect TCG product. | VERIFIED (general rule); impact on TCG UNVERIFIED | HMGoG FAQ (TAX-01, COMP-01) |
| Online purchases are **not** "non-commercial" goods in personal luggage ("The same would apply to online sales"). | VERIFIED | HMGoG FAQ (CUST-06) |

### E.2 Gibraltar import charges by post

| Claim | Status | Source |
|---|---|---|
| RGPO's page still says: parcels under **£25 are exempt** (£39 for gifts between individuals). A **£4.00 import handling fee** applies at £25 or more. Duty is charged "as dictated by the Integrated Tariff Regulations 2017". Charges are on price plus postage, packing and insurance, and can be paid online or at the Mail Centre (7 Admiral Rook Place), with a £4 home-delivery option. | VERIFIED **as currently published**, but **probably stale**: the text dates from November 2020 and still refers to import duty | https://epost.egov.gi/charges-import-duty ; https://epost.egov.gi/faq |
| Before the treaty, sealed trading-card games most plausibly fell under CN **9504 40 00 "Playing cards", 12%** in the Integrated Tariff (consolidated version dated 15 Jul 2026). Chapter 49 note 1(c) excludes "Playing cards or other goods of Chapter 95". Non-game picture cards under 4911 91 00 were **Free**. | VERIFIED (tariff text); the classification of a specific product is UNVERIFIED | https://www.gibraltarlaws.gov.gi/legislations/integrated-tariff-regulations-2017-2817 (PDF `2017s190(15-07-26).pdf`) |
| **After the treaty**, the 12% import duty is replaced by 15% TT, plus EU CET duty at the DCP for non-UK/non-EU-origin goods. **I could not find an official post-treaty RGPO or HM Customs rule on low-value postal parcels** (whether any £25-style threshold or £4 fee survives). **Treat GI postal tax as UNKNOWN and ask RGPO or HM Customs.** | UNVERIFIED | — |
| EU CET rate for 9504 40 00 (relevant at the DCP for non-preferential origin) is not fetched. | UNVERIFIED | — |

### E.3 UK sellers shipping to Gibraltar

| Claim | Status | Source |
|---|---|---|
| UK VAT on exported goods is **zero-rated** if the goods leave the UK and the seller holds proof of export within 3 months. Postal proof includes Post Office forms and Parcelforce despatch records. Gibraltar is outside the UK for VAT, so direct exports to GI qualify. | VERIFIED (Notice 703 updated 2026-03-04); "Gibraltar outside UK VAT" comes from a search summary of gov.uk and the explicit sentence was not fetched, so treat that part as UNVERIFIED | https://www.gov.uk/guidance/vat-on-goods-exported-from-the-uk-notice-703 |
| Whether a given UK shop removes VAT for GI checkout is a retailer behaviour. Many show VAT-inclusive prices or refuse to ship to GI, so track it per retailer (`ships_gi`, plus a new `vat_removed_gi` flag). | UNVERIFIED (per retailer) | — |

### E.4 Spain (fallback ship-to, for example a La Línea address)

| Claim | Status | Source |
|---|---|---|
| **The EU's €150 customs-duty relief was abolished from 1 July 2026** (Council Reg. (EU) 2026/382 of 11 Feb 2026). A **temporary €3 customs duty "per item"** applies to consignments with intrinsic value ≤ €150 in distance sales and postal consignments **until 1 July 2028**. After that, normal duty rates apply. Goods claiming preferential origin (for example UK origin under the TCA) can be declared with a preference code instead, **unless IOSS was used**, in which case the €3 applies anyway. | VERIFIED | EU Commission guidance PDF: https://taxation-customs.ec.europa.eu/document/download/053e5b4e-f0be-4f20-9a23-3e3b659a6676_en?filename=Customs+Guidance+on+EUR+3+customs+duty.pdf ; news: https://taxation-customs.ec.europa.eu/news/guidance-and-legal-text-temporary-flat-fee-low-value-imports-which-will-apply-until-1-july-2028-2026-06-08_en |
| Correos: €3 "por cada tipo de producto declarado" (the same HS code, description and origin count once) for shipments from outside the EU of ≤ €150 to the Peninsula, Balearics and Canaries. Correos collects it before delivery **even if IOSS VAT was paid**. Correos also charges its own fee for "Gestión de la importación de envíos de escaso valor". Over €150 goes through an ordinary DUA (H1): duty, VAT and Correos DUA, presentation and handling fees. | VERIFIED | https://www.correos.es/es/es/atencion-al-cliente/informacion-aduanera/arancel-para-envios-de-bajo-valor-en-la-ue ; https://www.correos.es/es/es/particulares/recibir/tramitacion-aduanera-en-la-importacion/importacion-en-peninsula-y-baleares/DUA-ordinario |
| Correos low-value handling fee amount ("from €1.24 + tax" per a search snippet) | UNVERIFIED | — |
| **Import VAT** is due on all commercial imports from 1 July 2021 (the €22 exemption was removed). IOSS covers consignments ≤ €150, where the seller collects VAT at checkout and nothing more is charged at import (other than the €3 duty now). Spain's standard IVA is **21%**. | VERIFIED (AEAT guide on the €150 IOSS threshold; EU OSS page); the 21% rate is from general knowledge and the AEAT rate page was not fetched, so UNVERIFIED | https://sede.agenciatributaria.gob.es/Sede/ayuda/manuales-videos-folletos/manuales-practicos/manual-importacion-exportacion-envios-escaso-valor/3-mecanismos-recaudacion-iva/3_1-regimen-ventanilla-unica-importaciones/3_1_4-umbral-150.html ; https://vat-one-stop-shop.ec.europa.eu/one-stop-shop_en |
| From EU countries to Spain there are no customs formalities or import charges. The seller charges VAT (destination-country rate under OSS for B2C above the €10k threshold). | UNVERIFIED (well established, but no official page fetched today) | — |

### E.5 Buying to a La Línea address and carrying it into Gibraltar

| Claim | Status | Source |
|---|---|---|
| **Old regime (before 15 Jul 2026), for reference.** The £390 "other articles" passenger relief excluded anyone who "enters or returns to Gibraltar more than once in any calendar month" and required 24 h away. A resident doing a same-day La Línea pickup therefore owed import duty and was expected to declare at the frontier. | VERIFIED (Integrated Tariff, Schedule relief item 16) | Integrated Tariff PDF above |
| **Now (first 3 years of the treaty):** traveller allowance of **€300 per person by land** (€430 by sea or air, €175 for under-15s), for personal or family use or gifts. **Within the allowance the traveller pays only the tax at the place of purchase**, which is Spanish IVA. Above it, the traveller can claim back the Spanish VAT and pay Gibraltar TT instead. **"At this time, however, there will be no Customs controls at the land frontier."** After 3 years the allowance regime ends for EU↔GI travel, and any quantity is allowed if it is for personal use. | VERIFIED | HMGoG Technical Notice 86/2026: https://www.gibraltar.gov.gi/press-releases/technical-notice-temporary-allowances-regime-862026-11678 ; FAQ CUST-06 |
| Online purchases do not count as non-commercial goods in personal luggage. **Ambiguity:** an item ordered online to a Spanish address, released there with Spanish IVA paid, then carried across by the buyer looks like ordinary personal shopping in Spain, but the FAQ wording ("The same would apply to online sales") was written about resellers. **Ask HM Customs before encoding this.** | VERIFIED quote; how it applies to this case is UNVERIFIED | HMGoG FAQ CUST-06 |
| Using a Spanish (La Línea) delivery address or parcel-locker service is common among Gibraltar residents. | UNVERIFIED (no official source) | — |

### E.6 Implications for the GI/ES shipping logic (my recommendations)

1. **Remove any hard-coded "GI import duty 12%" or "£25 de minimis".** Model GI landed cost as `price + shipping` (UK VAT removed if the retailer does so), plus **TT 15%** (rate by date: 15% from 2026-07-15, 16% in 2027, 17% in 2028, all from config), plus *possible* EU CET duty for non-UK origin, plus a carrier or RGPO handling fee (unknown). Mark the GI fee as `unknown` until RGPO confirms.
2. **ES landed cost from UK shops:** price ex-UK-VAT + shipping + **21% IVA** + **€3 per distinct item line** (until 2028-07-01; ≤ €150 consignments; skipped if UK origin is claimed without IOSS) + the carrier handling fee. **From EU shops:** the checkout price (IVA included). No customs charges.
3. **ES → GI hand-carry:** within **€300 per person per crossing**, nothing more is payable (Spanish IVA already paid). Above €300 it is declarable, and GI TT applies after a Spanish VAT refund. There are no frontier controls today. Show a soft note in the UI, never a guarantee.
4. Since 15 July 2026, **direct UK→GI parcels route overland via Spain** (no air freight to GI), so expect longer UK→GI delivery estimates and possible carrier refusals. Re-check `ships_gi` per retailer.
5. Put all rates, thresholds and dates in `config/rules.yaml`, because the treaty schedules changes for 2027, 2028 and 2029 (the allowance regime ends after 3 years).

### E.7 Open questions for the owner, HM Customs or RGPO

- Does RGPO still apply a £25 exemption or £4 handling fee after 15 July 2026, and how is TT collected on parcels (RGPO, the DCP or the courier)?
- What is the official HS classification for sealed TCG boosters and ETBs (9504 40 00 vs 9504 90 80)? It matters for the EU CET at the DCP when origin is non-UK.
- Is an online order delivered to a Spanish address and hand-carried in within €300 treated as personal shopping?
