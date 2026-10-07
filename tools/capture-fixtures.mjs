// One-off capture of real responses as parser fixtures. Polite: sequential, delays honoured,
// one retry after 10 s on a challenge. Usage: node tools/capture-fixtures.mjs
import { mkdirSync, writeFileSync, readFileSync } from 'node:fs';
import { parse } from 'yaml';

const UA = 'CardDeskDrops/0.1 (personal release tracker)';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const cfg = parse(readFileSync('config/sources.yaml', 'utf8'));
const today = new Date().toISOString().slice(0, 10);

async function get(url, accept) {
  for (let attempt = 0; attempt < 2; attempt++) {
    const res = await fetch(url, { headers: { 'user-agent': UA, accept } });
    const body = await res.text();
    const challenged = res.headers.get('cf-mitigated') === 'challenge' || /Just a moment|Verifying your connection|_Incapsula_Resource/.test(body.slice(0, 4000));
    if (!challenged) return { res, body };
    console.log(`  challenge (${res.status}), retrying in 10 s`);
    await sleep(10_000);
  }
  return null;
}

function trimShopify(json) {
  for (const p of json.products ?? []) if (p.body_html) p.body_html = p.body_html.slice(0, 1500);
  // Keep only the first image's address: enough for the app, a fraction of the size.
  for (const p of json.products ?? []) p.images = (p.images ?? []).slice(0, 1).map((i) => ({ src: i.src }));
  return json;
}

const jobs = [];
for (const s of cfg.sources.filter((s) => s.enabled)) {
  jobs.push({ dir: s.id, file: s.adapter === 'ecb-fx' ? 'eurofxref-daily.xml' : s.urls[0].includes('.json') || s.urls[0].includes('wp-json') ? 'response.json' : 'response.html', url: s.urls[0], delay: (s.crawl_delay_seconds ?? 2) * 1000, kind: 'raw' });
}
for (const r of cfg.retailers.filter((r) => r.enabled)) {
  const paths = r.paths ?? ['/products.json'];
  paths.forEach((p, i) => {
    const sep = p.includes('?') ? '&' : '?';
    const url = r.platform === 'woocommerce' ? `${r.base_url}${p}${sep}per_page=50&page=1` : `${r.base_url}${p}${sep}limit=50&page=1`;
    jobs.push({ dir: r.id, file: `products-${i}-page1.json`, url, delay: (r.crawl_delay_seconds ?? 2) * 1000, kind: r.platform });
  });
}

for (const j of jobs) {
  console.log(j.url);
  const got = await get(j.url, j.file.endsWith('.json') ? 'application/json' : '*/*');
  mkdirSync(`fixtures/${j.dir}`, { recursive: true });
  if (!got) { console.log('  FAILED'); continue; }
  let body = got.body;
  if (j.kind === 'shopify') body = JSON.stringify(trimShopify(JSON.parse(body)), null, 1);
  else if (j.kind === 'woocommerce') {
    const arr = JSON.parse(body);
    for (const p of arr) { if (p.description) p.description = p.description.slice(0, 1500); if (p.short_description) p.short_description = p.short_description.slice(0, 500); p.images = (p.images ?? []).slice(0, 1).map((i) => ({ src: i.src })); }
    body = JSON.stringify(arr, null, 1);
  }
  writeFileSync(`fixtures/${j.dir}/${j.file}`, body);
  const keep = ['content-type', 'etag', 'last-modified', 'cache-control', 'x-wp-total', 'x-wp-totalpages'];
  const headers = Object.fromEntries([...got.res.headers].filter(([k]) => keep.includes(k)));
  writeFileSync(`fixtures/${j.dir}/${j.file}.meta.json`, JSON.stringify({ url: j.url, captured: today, status: got.res.status, headers }, null, 1));
  console.log(`  ${got.res.status} ${body.length} bytes`);
  await sleep(Math.max(j.delay, 2000));
}
