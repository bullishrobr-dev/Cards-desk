# Deploying Card Desk Drops

Everything runs on Cloudflare's **free** plans to start. A script does the work. You only need to make a few clicks that require you personally: creating the account, choosing a subdomain, creating a token and turning on Access.

There are two Workers:

| Worker | What it serves | Protection |
|---|---|---|
| `card-desk-drops` | The app, its API, the 15-minute scheduler and the alert alarms | Cloudflare Access (only you) |
| `card-desk-public` | Push delivery receipts and the iCal feed, nothing else | Long random tokens in the path |

## 1. One-time setup in the Cloudflare dashboard (about 10 minutes)

1. **Create a free Cloudflare account** at dash.cloudflare.com. No card is needed for Workers Free.
2. **Choose your workers.dev subdomain.** Open **Workers & Pages** once; Cloudflare asks you to pick one. The app will live at `https://card-desk-drops.<subdomain>.workers.dev`.
3. **Create an API token** for the deploy script.
   - Go to **My Profile → API Tokens → Create Token → Create Custom Token**.
   - Give it these **account** permissions:
     - Workers Scripts: Edit
     - Workers KV Storage: Edit
     - D1: Edit
     - Queues: Edit
     - Account Settings: Read
   - Copy the token. Never commit it.
4. **Find your Account ID.** It is on the right of the Workers & Pages overview page.

## 2. Deploy

Run this from the repo, or give the token and account ID to Claude in a session and it will run it:

```bash
npm install
CLOUDFLARE_API_TOKEN=<token> CLOUDFLARE_ACCOUNT_ID=<account id> \
ALERT_EMAIL=<your email> RESEND_API_KEY=<optional> ANTHROPIC_API_KEY=<optional> SENTRY_DSN=<optional> \
node tools/deploy.mjs
```

The script does the following:

- Creates the database, key-value store and queue, or reuses them if they already exist.
- Writes their IDs into `wrangler.jsonc`. These IDs are not secret.
- Applies the schema.
- Builds and deploys both Workers.
- Generates and stores the push (VAPID) keys and the two private path tokens.

Re-running it is safe. It keeps the existing tokens and keys unless you set `ROTATE=1`.

## 3. Protect the app with Cloudflare Access

Until this step is done, the app's API answers **503 for every request**. That is deliberate: it never runs unprotected.

1. **Enable Zero Trust.** In the dashboard, open **Zero Trust**, pick a team name and choose the **Free** plan.
   - Cloudflare asks for payment details even on Free; you are not charged.
   - Your team domain becomes `<team>.cloudflareaccess.com`.
2. **Protect the app Worker.** Go to **Workers & Pages → card-desk-drops → Access** tab → **Protect this Worker behind Access** → **All traffic**.
   - In the policy, allow only your email address.
   - **Do not** protect `card-desk-public`.
3. **Set a long session.** In the Access application, set the session duration to **1 month**, so the Home Screen app doesn't ask you to sign in every day.
4. **Copy the Application Audience (AUD) tag** from the application's overview in Zero Trust, then re-run the script with Access details:

```bash
ACCESS_TEAM_DOMAIN=<team>.cloudflareaccess.com ACCESS_AUD=<aud tag> \
CLOUDFLARE_API_TOKEN=<token> CLOUDFLARE_ACCOUNT_ID=<account id> node tools/deploy.mjs
```

## 3b. Turn on the daily Cardmarket import (2 minutes)

The first deploy prints `CARD_DESK_PUBLIC_URL` and `CARD_DESK_INGEST_TOKEN` once.

1. On GitHub, open the repository, then **Settings → Secrets and variables → Actions → New repository secret**.
2. Add both values under exactly those names.
3. Open **Actions → Cardmarket import → Run workflow** to try it straight away. After that it runs every day at 03:17 UTC.

Until both secrets are set, the job does nothing and still passes. Once imports have started, a feed that stops for more than 50 hours shows as failing in Source health and raises an alert. If you lose the token, re-run the deploy with `ROTATE=1` and update the GitHub secret.

## 4. On your iPhone

1. Open the app URL in Safari and sign in with the emailed code.
2. Tap **Share → Add to Home Screen**.
3. Open **Drops** from the Home Screen, go to **Settings → Turn on notifications** and allow them.
4. Tap **Test critical (email fallback)**.
   - You should get a push straight away.
   - If the push isn't confirmed within 5 minutes, the email copy follows. That only happens once Resend is configured.
5. Optionally, copy the **Calendar** feed address into your calendar app.

## 5. First checks after deploy

- **Topps reachability.** Open `/api/diagnostics/topps` in the signed-in browser.
  - If it shows 200s, Topps can be added as a source.
  - If it still shows "blocked by bot protection", Topps stays covered by collectosk and the shops.
- **Sources** tab: within an hour every source should show a last success. A source that fails twice in a row raises an alert.

## Optional services

| Service | Needed for | Without it |
|---|---|---|
| Resend (`RESEND_API_KEY`, `ALERT_EMAIL`) | Email fallback for critical alerts and dead-subscription notices | Push only. Without a verified domain, Resend can only send to the email you signed up with, which is all this app needs. |
| Anthropic (`ANTHROPIC_API_KEY`) | The cheap LLM pass for titles the matcher can't place (model in `CLAUDE_MATCH_MODEL`) | Those titles stay unmatched |
| Sentry (`SENTRY_DSN`) | Error reports | Errors appear only in Cloudflare's logs |
| GitHub Actions secrets (`CARD_DESK_PUBLIC_URL`, `CARD_DESK_INGEST_TOKEN`) | Daily Cardmarket prices for Pokémon sealed (step 3b) | No market prices |

## Free plan limits to watch

The design keeps each run small:

- One job per catalogue page.
- Bulk database reads and one batched write per job.
- At most about 3,000 queued jobs a day.

If the Sources tab starts showing CPU-limit failures, upgrading to Workers Paid ($5/month) removes the limits. That is a billing change only, with no code changes.
