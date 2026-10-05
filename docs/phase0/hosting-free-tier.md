# Phase 0: can it run on free tiers?

Researched on **2026-10-05**. Official pages were fetched live with curl through the session proxy: Cloudflare docs as `<url>/index.md`, Vercel docs as `<url>.md`, Supabase docs as `<url>.md` (plus `supabase.com/pricing.md` and `llms-full.txt`). The measurements in §8 were taken today in this container.

Status markers (same as `platform-and-logistics.md`):

- **VERIFIED** means an official page was fetched today and the statement is a direct reading of it.
- **UNVERIFIED** means it is inference, the docs are silent or contradict each other, or no official page was found. Confirm it before relying on it.

This file asks a narrower question than `platform-and-logistics.md` §A.6 (which concluded "Workers Paid is required"). Here the question is whether the brief's design can run on **Workers Free** with a fan-out pattern, and how Vercel Hobby and Supabase Free compare.

---

## 1. Cloudflare Workers Free: core limits

Sources: https://developers.cloudflare.com/workers/platform/limits/ (last updated 5 Sep 2026), https://developers.cloudflare.com/workers/platform/pricing/ (last updated 2 Oct 2026), https://developers.cloudflare.com/workers/runtime-apis/bindings/service-bindings/, https://developers.cloudflare.com/workers/configuration/cron-triggers/

| Claim | Status |
|---|---|
| Requests: **100,000/day** on Free, "resetting at midnight UTC". Beyond that the Worker returns **Error 1027** (fail closed) or is bypassed (fail open), depending on the route setting. | VERIFIED (limits) |
| Static asset requests "are free and unlimited". | VERIFIED (pricing, footnote 3) |
| CPU per **HTTP request** (fetch handler): **10 ms** on Free (Paid: 5 min, default 30 s). | VERIFIED (limits, "CPU time" table) |
| CPU per **Cron Trigger**: **10 ms** on Free (Paid: 30 s for <1 h intervals, 15 min for ≥1 h intervals). | VERIFIED (limits) |
| CPU per **Queue consumer** invocation on Free: **10 ms**. The pricing page says Free is "10 milliseconds of CPU time per invocation". The Queues limits page says consumers "share the same per invocation CPU limits as any Workers do". Neither page has a Free-specific consumer row, so 10 ms is the reading of those two statements. | VERIFIED (pricing + queues limits), the consumer-specific figure is inferred |
| Wall-clock limits: HTTP has no limit (`waitUntil()` adds up to 30 s after the response). Cron Trigger, Queue consumer and DO alarm each have **15 min**. | VERIFIED (limits, "Duration") |
| Waiting on I/O does not count: "Waiting on network requests (such as `fetch()` calls, KV reads, or database queries) does **not** count toward CPU time." | VERIFIED (limits) |
| **Burst leniency** exists but is not specified. Quote: *"Each isolate has some built-in flexibility to allow for cases where your Worker infrequently runs over the configured limit. If your Worker starts hitting the limit consistently, its execution will be terminated according to the limit configured."* No numbers are given. Do not design around it. | VERIFIED (quote); the size of the allowance is UNVERIFIED (undocumented) |
| Subrequests: **50 per invocation** on Free (Paid: 10,000). A subrequest is "any request a Worker makes using the Fetch API or to Cloudflare services like R2, KV, or D1". Each hop in a redirect chain counts. | VERIFIED (limits) |
| There is a separate row for **"Subrequests to internal services": 1,000 on Free**. | VERIFIED (limits) |
| **Conflict:** the D1 limits page says "Queries per Worker invocation: 1000 (Workers Paid) / 50 (Free)", but the Workers limits page gives internal services 1,000 on Free. Assume **50 D1 queries per invocation** until tested. Batching with `db.batch()` reduces the count (whether a batch counts as one query is UNVERIFIED). | VERIFIED (both pages); which one is enforced is UNVERIFIED |
| KV: "Within a single invocation, a Worker can make up to 1,000 operations to external services (for example, 500 Workers KV reads and 500 R2 reads)." | VERIFIED (https://developers.cloudflare.com/kv/platform/limits/) |
| Cache API calls "share the same quota as subrequests" (50 per request on Free). | VERIFIED (limits) |
| Service bindings: "Each request to a Worker via a Service binding counts toward your subrequest limit". There is a cap of "32 Worker invocations" per request. | VERIFIED (service-bindings) |
| Queue `send()`/`sendBatch()` count toward the **six simultaneous connections** limit. Whether they count toward the 50-subrequest limit is not stated. | VERIFIED (limits); counting toward subrequests is UNVERIFIED |
| Cron Triggers: **5 per account** on Free (Paid: 250). The table row is "Number of Cron Triggers per account". The cron page refers to "the maximum number of Cron Triggers per Worker" but links to the same table. | VERIFIED |
| Cron syntax supports sub-15-minute intervals (the docs' own example is `"*/3 * * * *"`). No minimum interval for Free is documented. | VERIFIED (example); Free minimum interval is UNVERIFIED |
| Cron changes "may take several minutes (up to 15 minutes) to propagate". Cron runs "on underutilized machines". | VERIFIED |
| Memory is 128 MB per isolate. | VERIFIED |

## 2. Cloudflare Queues on Free

Sources: https://developers.cloudflare.com/queues/platform/limits/ (21 Apr 2026), https://developers.cloudflare.com/queues/platform/pricing/, https://developers.cloudflare.com/workers/platform/pricing/#queues

| Claim | Status |
|---|---|
| **Queues are available on Workers Free.** The pricing table has a Workers Free column: **10,000 operations/day included**. | VERIFIED |
| An operation is each 64 KB written, read or deleted. Operations are counted **per message, not per batch**. A delivered message usually costs **3 ops** (write, read and delete), so 10,000 ops/day ≈ **3,333 messages/day** ≈ **34 messages per 15-minute tick**. Each retry adds a read. | VERIFIED (ops rules); the arithmetic is mine |
| Message retention on Free is **24 hours, non-configurable**. | VERIFIED |
| Maximum consumer batch size is **100**. `sendBatch` takes at most 100 messages or 256 KB. Maximum batch wait is 60 s. Message size is 128 KB. | VERIFIED |
| Concurrent consumer invocations: **250** (push-based). The limits page says these apply "to both Workers Paid and Workers Free plans" except retention. | VERIFIED |
| `delaySeconds` on send or retry: up to 24 h. | VERIFIED |
| Consumer wall time is 15 min. Consumer CPU is per invocation (10 ms on Free; see §1). | VERIFIED / inferred as in §1 |
| **Each consumer invocation gets its own CPU and subrequest budget.** CPU and subrequest limits are stated "per invocation", and a consumer batch is one invocation. So with `max_batch_size = 1`, each message gets its own 10 ms CPU and 50 subrequests. | Per-invocation wording VERIFIED; applying it to each consumer batch is UNVERIFIED (inference, test it) |
| **Fan-out from the scheduled handler works in principle.** The cron handler picks the due sources and calls `QUEUE.sendBatch()` with one message per source or page (up to 100 per call). The consumer (`max_batch_size: 1`) fetches, parses and upserts one source. | Design inference, UNVERIFIED until prototyped |

## 3. Other fan-out options on Free

### 3a. Durable Objects (SQLite-backed) and alarms

Sources: https://developers.cloudflare.com/durable-objects/platform/limits/, https://developers.cloudflare.com/workers/platform/pricing/#durable-objects, https://developers.cloudflare.com/durable-objects/api/alarms/

| Claim | Status |
|---|---|
| Durable Objects are available on Workers Free, **SQLite storage backend only**. | VERIFIED |
| Free allowances: **100,000 requests/day** (alarm invocations count as requests on Paid; the Free row does not break this down), **13,000 GB-s/day** duration, 5M rows read and 100k rows written per day, and 5 GB total SQL storage. "Each `setAlarm()` is billed as a single row written." | VERIFIED |
| A DO alarm handler has **15 min** wall time. | VERIFIED (Workers limits "Duration") |
| DO CPU: the DO limits table says "30 seconds (default) / configurable to 5 minutes" with no Free column. The FAQ says DOs "have the same per invocation CPU limits as any Workers do". On Free that most likely means **10 ms per request or alarm**. | Quotes VERIFIED; the Free figure is UNVERIFIED (the docs are ambiguous) |
| Alarms: "Each Durable Object is able to schedule a single alarm at a time". Alarms have "guaranteed at-least-once execution" and are retried with exponential back-off (up to 6 retries). Many events can be scheduled by storing a schedule and re-arming the alarm from the `alarm()` handler. Because delivery is at least once, alert sends must be idempotent. | VERIFIED (alarms API page) |
| **Conflict on cron count:** the alarms page says "A Worker can have up to three Cron Triggers configured at once", while the Workers limits table says 5 per account on Free. Plan for ≤ 3 per Worker. | VERIFIED (both texts) |
| **Precise timing is possible.** An alarm fires at a set timestamp, so a single "scheduler" DO can hold the next T-24h, T-1h or T-10m deadline and wake exactly then. Cron cannot do this at a 15-minute cadence. | Alarm semantics VERIFIED (alarms API page); the use is a design inference |

### 3b. Workflows

Sources: https://developers.cloudflare.com/workflows/reference/limits/ (21 Sep 2026), https://developers.cloudflare.com/workers/platform/pricing/#workflows

| Claim | Status |
|---|---|
| Workflows are available on Free. Free limits: **10 ms CPU per step**, unlimited wall-clock per step, **3,000 steps/day**, 100,000 executions/day (shared with the Workers request limit), 100 concurrent running instances, 3-day retention of completed state, 1,024 steps per Workflow, and "50/request" subrequests per instance. | VERIFIED |
| Each step has its own 10 ms CPU budget. 3,000 steps/day ≈ **31 steps per 15-minute tick**. | VERIFIED (per-step limit); the arithmetic is mine |
| Cron Triggers can also be attached directly to Workflows via `schedules` on the binding. | VERIFIED (cron-triggers page) |
| The limits page contradicts itself: the table says 100 concurrent on Free, but the prose mentions "the 10,000 concurrent instance limit". | VERIFIED (both texts) |
| Whether the 50-subrequest cap is per step or per instance is unclear ("per Workflow instance ... 50/request"). | UNVERIFIED |
| Step and storage billing has not started yet ("Cloudflare will not bill step and storage usage before the start date announced"). | VERIFIED |

### 3c. Service binding to self

| Claim | Status |
|---|---|
| A service binding targets "a Worker on your account". The docs neither allow nor forbid binding a Worker to itself. | VERIFIED (silence); self-binding is UNVERIFIED |
| Each call counts toward the caller's subrequest limit. There is a hard cap of **32 Worker invocations per top-level request**. Workers called via service bindings "share the same connection limit". | VERIFIED |
| Whether the callee gets a **fresh CPU budget** is not documented. | UNVERIFIED |
| Verdict: self-binding at best gives ≤ 31 extra invocations per tick, and its CPU isolation is undocumented. Queues or DO alarms are the documented routes. | Inference |

## 4. Storage free limits

| Claim | Status | Source |
|---|---|---|
| **D1 Free:** 5M rows read/day, **100,000 rows written/day**, 5 GB total storage, **500 MB maximum per database**, 10 databases, and 7-day Time Travel. Limits reset at 00:00 UTC. Index updates count as extra rows written. | VERIFIED | https://developers.cloudflare.com/workers/platform/pricing/#d1, https://developers.cloudflare.com/d1/platform/limits/ |
| **KV Free:** 100,000 reads/day, **1,000 writes/day** (also 1,000 deletes and 1,000 lists), and 1 GB storage. The same key can be written at most once per second. Over-limit operations "fail with an error". | VERIFIED | https://developers.cloudflare.com/kv/platform/limits/, Workers pricing |
| **R2 free tier:** 10 GB-month storage, 1M Class A and 10M Class B operations per month, and free egress (Standard storage only). | VERIFIED | https://developers.cloudflare.com/r2/pricing/ |
| **R2 needs a subscription checkout:** "You need a Cloudflare account with an R2 subscription … Complete the checkout flow to add an R2 subscription to your account." The page does **not** say outright that a payment method is required. | VERIFIED (quote); "card required" is UNVERIFIED (the docs only say "checkout flow"; widely reported, but not confirmed today) | https://developers.cloudflare.com/r2/get-started/ |
| Implication: per-tick ETag/Last-Modified state must go in **D1**, not KV (25+ sources × 96 ticks would exceed 1,000 KV writes/day). D1 writes must be **diff-only**. Upserting about 2,000 products every tick would be about 192k rows/day, over the 100k cap. | Inference | |

## 5. Cloudflare Access / Zero Trust Free without a custom domain

Sources: https://developers.cloudflare.com/cloudflare-one/setup/, https://developers.cloudflare.com/workers/configuration/cloudflare-access/ (18 Aug 2026), https://developers.cloudflare.com/workers/configuration/routing/workers-dev/, https://developers.cloudflare.com/cloudflare-one/access-controls/policies/app-paths/, https://developers.cloudflare.com/cloudflare-one/access-controls/policies/, https://developers.cloudflare.com/cloudflare-one/access-controls/applications/http-apps/self-hosted-public-app/

| Claim | Status |
|---|---|
| **Zero Trust onboarding asks for payment details even on Free:** "Complete your onboarding by selecting a subscription plan and entering your payment details. If you chose the **Zero Trust Free plan**, this step is still needed but you will not be charged." | VERIFIED |
| **Access can protect a Worker's `workers.dev` URL with no custom domain.** "Access can protect one Worker's production `workers.dev` URL, preview URLs, or both." The dashboard path is Workers & Pages > Worker > **Access** tab > "Protect this Worker behind Access", choosing Previews only or All traffic. | VERIFIED |
| **Worker-level protection is all-or-nothing:** it "automatically protects every domain associated with the Worker, including its routes, Custom Domains, `workers.dev` hostname, and previews". It also "protects the entire Worker regardless of how it is accessed". The page documents no path exclusion for this mode. The only bypass it describes is a Worker-level bypass that makes the **whole** Worker public. | VERIFIED |
| Hostname or path apps: the Workers Access page says a self-hosted app can protect "a `workers.dev` hostname … or a path", for example `my-worker.example.workers.dev`. Access path rules follow "the more specific rule takes precedence", and Bypass is a policy action. On paper, then, the pattern is: app A = `<worker>.<sub>.workers.dev` (Allow: owner email), apps B and C = `<worker>.<sub>.workers.dev/ical/*` and `/push-receipt/*` (Bypass: Everyone). | Each quote VERIFIED |
| **Conflict:** the self-hosted-app page says the domain "must belong to an active zone in your Cloudflare account" and lists "An active domain on Cloudflare" as a prerequisite. Whether the Zero Trust Applications UI accepts a `workers.dev` hostname with a path is therefore unclear. | VERIFIED (conflict); whether path bypass works on `workers.dev` is **UNVERIFIED**. Test it in the dashboard |
| A bypassed request gets no identity, and "requests are not logged". | VERIFIED |
| With Static Assets, "the router does not pass `ctx.access` to the user Worker", so the Worker must verify the `Cf-Access-Jwt-Assertion` itself (as already noted in `platform-and-logistics.md` §A.7). | VERIFIED |
| Zero Trust Free seat count was not confirmed (the plans page is JS-rendered). One user is very likely within it. | UNVERIFIED |

**Options without a custom domain if the path bypass on `workers.dev` doesn't work:**

1. **Two Workers.** `cdd-app` (UI and API) is Access-protected with Worker-level protection. `cdd-public` is unprotected and serves only `/ical/<token>` and `/push-receipt/<token>`, reading the same D1. Inference; uses documented features only. **Recommended fallback.** It costs one more Worker (the limit is 100 on Free).
2. Skip Access and use in-app auth: a long-lived signed session cookie set by a one-time magic link. This contradicts the brief's "no auth system", so the owner would have to decide.
3. Buy a cheap domain and use hostname-based Access apps with path Bypass, which is the fully documented path. This costs money.

## 6. Vercel Hobby

Sources: https://vercel.com/docs/cron-jobs/usage-and-pricing (15 Jul 2026), https://vercel.com/docs/functions/limitations, https://vercel.com/docs/deployment-protection, https://vercel.com/docs/deployment-protection/methods-to-protect-deployments/vercel-authentication, https://vercel.com/docs/plans/hobby

| Claim | Status |
|---|---|
| **Cron is limited to once per day on Hobby.** "Expressions like `0 * * * *` … or `*/30 * * * *` … will fail deployment" with "Hobby accounts are limited to daily cron jobs." | VERIFIED |
| Timing precision on Hobby is "Per-hour (±59 min)". A `0 1 * * *` job fires "anywhere between 1:00 am and 1:59 am". | VERIFIED |
| Up to **100 cron jobs per project** (all plans). | VERIFIED |
| Function max duration on Hobby is **300 s default and maximum** (fluid compute; Node, Bun and Python). | VERIFIED |
| Hobby monthly allowances include **4 CPU-hrs Active CPU** and **1,000,000 function invocations**. | VERIFIED (plans/hobby) |
| **Deployment Protection covers production on Hobby.** "All Deployments" is "available on all plans" and "all URLs are protected, including your production domain … and generated URLs like `my-project-1234.vercel.app`". "Vercel Authentication for All Deployments … do[es] not require a paid add-on." Password Protection is not available on Hobby. | VERIFIED |
| Per-path exceptions (to leave `/ical/*` public) were not found in the fetched pages. | UNVERIFIED |
| Hobby "restricts users to non-commercial, personal use only". A personal tracker fits. | VERIFIED |
| A 15-minute cadence on Hobby would need an **external scheduler** calling a protected endpoint. That scheduler was not researched here. | Inference |

## 7. Supabase Free

Sources: https://supabase.com/docs/guides/functions/limits, https://supabase.com/docs/guides/cron, https://supabase.com/docs/guides/functions/schedule-functions, https://supabase.com/docs/guides/database/extensions/pg_net, https://supabase.com/docs/guides/platform/billing-on-supabase, https://supabase.com/pricing (pricing.md), https://supabase.com/docs/guides/platform/free-project-pausing, https://supabase.com/docs/guides/platform/database-size

| Claim | Status |
|---|---|
| **pg_cron** (Supabase Cron) "can run anywhere from every second to once a year". No Free-plan restriction is stated. Recommendation: "no more than 8 Jobs run concurrently. Each Job should run no more than 10 minutes." | VERIFIED |
| **pg_net** is available as an extension (the API is "in beta"). The official recipe is pg_cron + pg_net + Vault invoking an Edge Function on a schedule (the example runs every minute). | VERIFIED |
| Edge Functions: **2 s CPU** per request, wall clock **150 s on Free** (400 s on paid plans), 150 s request idle timeout, 256 MB memory, 100 functions per project on Free. | VERIFIED |
| Edge Function invocations: **500,000 included on Free** (billing quota table). | VERIFIED |
| Edge Functions **cannot serve HTML without a custom domain** ("GET requests that return `text/html` will be rewritten to `text/plain`"). The PWA would need a separate static host. | VERIFIED |
| Database size is **500 MB per project**. Over that the project goes **read-only**. There are 2 active free projects. | VERIFIED |
| **Pausing:** "Free projects are paused after 1 week of inactivity." Inactivity is defined as follows: "A Free plan project is considered inactive if it does not receive sufficient user database activity over the past week … Typically a few user requests to the database each day over the previous week is enough." A warning email arrives about a week before the pause. | VERIFIED |
| Whether pg_cron's own internal jobs count as "user database activity" is not stated. If the project pauses, the cron stops and alerts fail silently. | UNVERIFIED (material risk) |

## 8. Measurement: Shopify `products.json` parse cost

Method: one `curl` per URL, UA `CardDeskDrops/0.1 (personal release tracker; research)`, 3 s gap, no 429s. Then in Node v22.22.0 (Intel Xeon @ 2.80 GHz, 4 vCPU): `JSON.parse` + `products.map(p => ({title, variants: variants.map(v => ({price, available}))}))`. 3 warm-up runs, then the median of 30. Files were deleted afterwards; nothing was saved to the repo.

| Page | HTTP | Bytes | Products | Median parse+map (warm) | p90 | Cold first run | Median incl. `TextDecoder` (≈ `res.text()`) |
|---|---|---|---|---|---|---|---|
| sportscardsdirect `limit=250` | 200 | 902,651 | 250 | **4.32 ms** | 6.50 ms | 9.04 ms | **7.58 ms** |
| sportscardsdirect `limit=50` | 200 | 205,433 | 50 | **0.84 ms** | 1.08 ms | 1.71 ms | 1.78 ms |
| zatu booster-boxes-pokemon `limit=250` | 200 | 177,030 | 94 (whole collection) | **0.76 ms** | 0.90 ms | 1.36 ms | 1.51 ms |
| zatu booster-boxes-pokemon `limit=50` | 200 | 100,980 | 50 | **0.42 ms** | 0.46 ms | 0.72 ms | 0.89 ms |

Notes:

- Both stores return a weak `ETag` and `cdn-cache-control: no-cache, no-store`. Whether `If-None-Match` actually yields a 304 was not tested.
- Most of the cost is `JSON.parse`. Bytes, not product count, drive it: `body_html` dominates, at about 3.6 KB per product on sportscardsdirect.
- These are local V8 numbers. Workers run V8 too, but a cold isolate, gzip decoding and the D1 diff will add to them. **A full 250-product page (~0.9 MB) costs 7–9 ms cold, which is at or over the 10 ms Free budget by itself.** A `limit=50` page costs about 1–2 ms, so 2–4 small pages fit per invocation with headroom for the diff and DB calls.
- Web Push payload encryption (ECDH + AES-GCM + ES256 JWT) runs in WebCrypto. Whether that counts toward CPU time, and how much, was not measured. UNVERIFIED.

---

## Verdict

**Workers Free: feasible but tight. It needs fan-out, and the brief's single 15-minute cron that "does everything" will not fit.** A single 10 ms cron invocation with 50 subrequests cannot fetch and parse about 25 calendars plus several retailer feeds; one sportscardsdirect 250-page alone is close to 10 ms. A design that fits the documented limits:

1. **Cron (`*/15`) as dispatcher only.** It reads the due sources from D1 (one query) and calls `sendBatch` with one message per *page* (use `limit=50` pages, not 250).
2. **Queue consumer with `max_batch_size = 1`.** Each message gets its own invocation: fetch with conditional GET, parse, then a **diff-only** D1 write. Budget about 10 ms CPU and 50 subrequests per page. Watch the Free cap of **10,000 queue ops/day ≈ 34 messages per tick**. The brief's adaptive cadence (most sources less often than every 15 min) is what makes this fit. If it doesn't, poll some retailers hourly.
3. **T-10m alerts come from a Durable Object alarm, not the cron.** A 15-minute cron can be up to 15 minutes late for T-10m; a DO alarm fires at the exact timestamp. A second cron at `*/5` is a simpler but less precise alternative (5 crons per account are allowed). DO CPU on Free is very likely 10 ms per alarm (UNVERIFIED), which is enough to send a few pushes.
4. **Workflows** (10 ms per step, 3,000 steps/day) are a viable alternative to Queues with similar headroom. A **self service binding** is not recommended (undocumented CPU isolation, cap of 32 invocations).
5. Keep state out of KV (1,000 writes/day). D1's 100k writes/day is fine only if writes are diff-only.
6. **Risks:** the 10 ms CPU is enforced, with undocumented leniency for occasional overruns. D1 queries per invocation are 50 or 1,000 (the docs conflict). Path bypass for `/ical/*` and `/push-receipt/*` on `workers.dev` is unverified, so use the two-Worker fallback. Zero Trust Free still asks for payment details at onboarding.

Upgrading to Workers Paid ($5/month) removes almost all of this complexity (30 s CPU per cron, 10,000 subrequests). That remains the recommendation in `platform-and-logistics.md`. The Free design above is a workable stopgap if the owner accepts more moving parts.

**Vercel Hobby is unsuitable as the scheduler.** Cron is limited to once a day with ±59 min precision, so a 15-minute cadence and T-10m alerts are impossible without an external trigger. Functions (300 s) and Deployment Protection on production are fine. It would only work as a UI host, and the Cloudflare Worker already does that for free.

**Supabase Free can do the cadence but carries a reliability risk.** pg_cron + pg_net can tick every minute and Edge Functions get 2 s CPU (200× Workers Free), so T-10m alerts are easy. The drawbacks: free projects pause after about a week of low "user database activity" (it is unverified whether cron traffic counts, and a pause kills alerts silently), the database is 500 MB, and Edge Functions can't serve the PWA's HTML without a custom domain. Supabase also has no Access-equivalent, so auth would have to be built. Of the three, it is the strongest *compute* fit, but it means rewriting away from the brief's Cloudflare stack.
