#!/usr/bin/env node
/**
 * One-command deploy to Cloudflare (Workers Free plan is enough to start).
 *
 *   CLOUDFLARE_API_TOKEN=… CLOUDFLARE_ACCOUNT_ID=… node tools/deploy.mjs
 *
 * Optional, set as env vars before running (all can be added later with `wrangler secret put`):
 *   ALERT_EMAIL, RESEND_API_KEY, ANTHROPIC_API_KEY, SENTRY_DSN, ACCESS_TEAM_DOMAIN, ACCESS_AUD
 *
 * Idempotent: re-running reuses existing resources and keeps existing tokens and push keys
 * unless ROTATE=1 is set. Nothing secret is written to the repository.
 */
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const { CLOUDFLARE_API_TOKEN: token, CLOUDFLARE_ACCOUNT_ID: account } = process.env;
if (!token || !account) {
  console.error('Set CLOUDFLARE_API_TOKEN and CLOUDFLARE_ACCOUNT_ID first (see docs/deploy.md).');
  process.exit(1);
}

const run = (args, opts = {}) => execFileSync('npx', ['wrangler', ...args], { encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'], ...opts });
const tryRun = (args) => {
  try {
    return { ok: true, out: run(args) };
  } catch (e) {
    return { ok: false, out: `${e.stdout ?? ''}${e.stderr ?? ''}` };
  }
};
async function cf(path, init = {}) {
  const res = await fetch(`https://api.cloudflare.com/client/v4/accounts/${account}${path}`, { ...init, headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json', ...(init.headers ?? {}) } });
  const json = await res.json();
  if (!json.success) throw new Error(`${path}: ${JSON.stringify(json.errors)}`);
  return json.result;
}
const b64url = (bytes) => Buffer.from(bytes).toString('base64url');
const step = (msg) => console.log(`\n▸ ${msg}`);

// 1. Resources ------------------------------------------------------------------------------
step('D1 database');
let db = (await cf('/d1/database?name=card_desk')).find((d) => d.name === 'card_desk');
if (!db) db = await cf('/d1/database', { method: 'POST', body: JSON.stringify({ name: 'card_desk' }) });
console.log(`  card_desk = ${db.uuid}`);

step('KV namespace');
let kv = (await cf('/storage/kv/namespaces?per_page=100')).find((n) => n.title === 'card-desk-kv');
if (!kv) kv = await cf('/storage/kv/namespaces', { method: 'POST', body: JSON.stringify({ title: 'card-desk-kv' }) });
console.log(`  card-desk-kv = ${kv.id}`);

step('Queue');
const queues = await cf('/queues');
if (!queues.find((q) => q.queue_name === 'card-desk-jobs')) await cf('/queues', { method: 'POST', body: JSON.stringify({ queue_name: 'card-desk-jobs' }) });
console.log('  card-desk-jobs ready');

step('workers.dev subdomain');
const { subdomain } = await cf('/workers/subdomain').catch(() => ({ subdomain: null }));
if (!subdomain) {
  console.error('  Your account has no workers.dev subdomain yet. Open Workers & Pages in the dashboard once (it asks you to pick one), then re-run.');
  process.exit(1);
}
const appUrl = `https://card-desk-drops.${subdomain}.workers.dev`;
const publicUrl = `https://card-desk-public.${subdomain}.workers.dev`;
console.log(`  app:    ${appUrl}\n  public: ${publicUrl}`);

// 2. Config (IDs and URLs are not secrets; they are committed) --------------------------------
step('Writing IDs and URLs into wrangler configs');
for (const file of ['wrangler.jsonc', 'wrangler.public.jsonc']) {
  let text = readFileSync(file, 'utf8');
  text = text.replace(/("database_id": )"[^"]*"/, `$1"${db.uuid}"`).replace(/("kv_namespaces": \[\{ "binding": "KV", "id": )"[^"]*"/, `$1"${kv.id}"`);
  text = text.replace(/("APP_URL": )"[^"]*"/, `$1"${appUrl}"`).replace(/("PUBLIC_BASE_URL": )"[^"]*"/, `$1"${publicUrl}"`);
  writeFileSync(file, text);
}

// 3. Schema -------------------------------------------------------------------------------------
step('Applying database migrations');
console.log(run(['d1', 'migrations', 'apply', 'card_desk', '--remote']).split('\n').slice(-6).join('\n'));

// 4. Deploy -------------------------------------------------------------------------------------
step('Building and deploying the app Worker');
execFileSync('npm', ['run', 'build'], { stdio: 'inherit' });
console.log(run(['deploy']).split('\n').filter((l) => /workers\.dev|Uploaded|Deployed|schedule/i.test(l)).join('\n'));
step('Deploying the public Worker (receipts + calendar feed)');
console.log(run(['deploy', '--config', 'wrangler.public.jsonc']).split('\n').filter((l) => /workers\.dev|Uploaded|Deployed/i.test(l)).join('\n'));

// 5. Secrets --------------------------------------------------------------------------------------
step('Secrets');
const existing = new Set(JSON.parse(tryRun(['secret', 'list', '--format', 'json']).out || '[]').map((s) => s.name));
const rotate = process.env.ROTATE === '1';
const mainSecrets = {};
const publicSecrets = {};
if (rotate || !existing.has('RECEIPT_TOKEN')) {
  mainSecrets.RECEIPT_TOKEN = publicSecrets.RECEIPT_TOKEN = b64url(crypto.getRandomValues(new Uint8Array(32)));
  mainSecrets.ICAL_TOKEN = publicSecrets.ICAL_TOKEN = b64url(crypto.getRandomValues(new Uint8Array(32)));
}
if (rotate || !existing.has('VAPID_PRIVATE_KEY')) {
  const pair = await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify']);
  mainSecrets.VAPID_PUBLIC_KEY = b64url(new Uint8Array(await crypto.subtle.exportKey('raw', pair.publicKey)));
  mainSecrets.VAPID_PRIVATE_KEY = (await crypto.subtle.exportKey('jwk', pair.privateKey)).d;
}
mainSecrets.VAPID_SUBJECT = `mailto:${process.env.ALERT_EMAIL ?? 'owner@example.invalid'}`;
for (const k of ['ALERT_EMAIL', 'RESEND_API_KEY', 'ANTHROPIC_API_KEY', 'SENTRY_DSN', 'ACCESS_TEAM_DOMAIN', 'ACCESS_AUD']) {
  if (process.env[k]) mainSecrets[k] = process.env[k];
}
const dir = mkdtempSync(join(tmpdir(), 'cdd-'));
try {
  writeFileSync(join(dir, 'main.json'), JSON.stringify(mainSecrets));
  run(['secret', 'bulk', join(dir, 'main.json')]);
  if (Object.keys(publicSecrets).length) {
    writeFileSync(join(dir, 'public.json'), JSON.stringify(publicSecrets));
    run(['secret', 'bulk', join(dir, 'public.json'), '--config', 'wrangler.public.jsonc']);
  }
} finally {
  rmSync(dir, { recursive: true, force: true });
}
console.log(`  set: ${Object.keys(mainSecrets).join(', ')}`);

console.log(`
Done.
  App:    ${appUrl}
  Public: ${publicUrl}

Until Cloudflare Access is set up, the app's API refuses every request (by design).
Next: follow "Protect the app with Cloudflare Access" in docs/deploy.md, then run
  ACCESS_TEAM_DOMAIN=<team>.cloudflareaccess.com ACCESS_AUD=<aud> CLOUDFLARE_API_TOKEN=… CLOUDFLARE_ACCOUNT_ID=… node tools/deploy.mjs
`);
