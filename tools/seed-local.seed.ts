/**
 * Builds a realistic local database from the saved fixtures and writes it as SQL for
 * `wrangler d1 execute card_desk --local --file .wrangler/seed.sql`. Run with `npm run seed:local`.
 */
import { it } from 'vitest';
import { readFileSync, readdirSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { rules, sources } from '../src/shared/config/index.ts';
import { createClassifier } from '../src/worker/normalise/classify.ts';
import { createTestD1 } from '../src/worker/testing/sqlite-d1.ts';
import { syncRetailers } from '../src/worker/ingest/retailers.ts';
import { ingestListings, ingestReleases } from '../src/worker/ingest/ingest.ts';
import { runMaintenance } from '../src/worker/jobs/maintenance.ts';
import { calendarRootUnit, parseCalendar, parseRetailer, retailerRootUnits } from '../src/worker/adapters/registry.ts';
import type { ListingObservation, ReleaseObservation } from '../src/worker/adapters/types.ts';
import { parseCollectoskPost } from '../src/worker/adapters/collectosk-post.ts';
import { ingestEnrichment } from '../src/worker/ingest/enrich.ts';
import { ingestMarketPrices } from '../src/worker/ingest/market.ts';
import { selectSealed } from '../src/shared/cardmarket.ts';

it('seed', async () => {
  const db = createTestD1();
  const now = new Date();
  const deps = { db, classifier: createClassifier(rules), rules, now };
  await syncRetailers(db, sources);
  for (const s of sources.sources.filter((x) => x.enabled)) {
    const file = readdirSync(`fixtures/${s.id}`).find((f) => /^(response\.(json|html)|eurofxref-daily\.xml)$/.test(f));
    if (!file) continue;
    const parsed = parseCalendar(s, calendarRootUnit(s), readFileSync(`fixtures/${s.id}/${file}`, 'utf8'));
    const fx = parsed.items.find((i) => i.kind === 'fx');
    if (fx?.kind === 'fx') await db.batch(Object.entries(fx.rates).map(([c, r]) => db.prepare('INSERT OR REPLACE INTO fx_rates VALUES (?, ?, ?)').bind(fx.date, c, r)));
    const rel = parsed.items.filter((i): i is ReleaseObservation => i.kind === 'release');
    if (rel.length) await ingestReleases(deps, { id: s.id, categories: s.categories, precedence: s.precedence }, rel);
  }
  // Release pages saved under fixtures/collectosk-post/<slug>.json.
  const posts = await db
    .prepare(`SELECT o.url, d.release_id FROM drop_observations o JOIN drops d ON d.id = o.drop_id WHERE o.source_id = 'collectosk' AND o.url IS NOT NULL`)
    .all<{ url: string; release_id: string }>();
  for (const p of posts.results) {
    const slug = new URL(p.url).pathname.split('/').filter(Boolean).pop();
    const f = `fixtures/collectosk-post/${slug}.json`;
    if (existsSync(f)) await ingestEnrichment(deps, p.release_id, parseCollectoskPost(readFileSync(f, 'utf8')));
  }
  for (const r of sources.retailers.filter((x) => x.enabled)) {
    const units = retailerRootUnits(r);
    for (let i = 0; i < units.length; i++) {
      const f = `fixtures/${r.id}/products-${i}-page1.json`;
      if (!existsSync(f)) continue;
      const unit = units[i];
      if (!unit) continue;
      const parsed = parseRetailer(r, unit, readFileSync(f, 'utf8'));
      await ingestListings(deps, r, parsed.items.filter((x): x is ListingObservation => x.kind === 'listing'));
    }
  }
  // Cardmarket: the saved subset of the real price file.
  const cm = JSON.parse(readFileSync('fixtures/cardmarket/products_nonsingles_6.subset.json', 'utf8'));
  const cmPrices = JSON.parse(readFileSync('fixtures/cardmarket/price_guide_6.subset.json', 'utf8'));
  const rows = selectSealed(cm.products, cmPrices.priceGuides, '2023-10-01');
  for (let i = 0; i < rows.length; i += 50) await ingestMarketPrices(deps, { source: 'cardmarket', asOf: new Date(cmPrices.createdAt).toISOString(), rows: rows.slice(i, i + 50) });
  await runMaintenance(db, rules, now);

  const tables = ['retailers', 'releases', 'products', 'title_matches', 'drops', 'drop_observations', 'drop_date_history', 'events', 'listings', 'stock_events', 'price_events', 'fx_rates', 'market_prices', 'market_price_history', 'source_state', 'source_runs'];
  const lines: string[] = ['PRAGMA foreign_keys = OFF;'];
  for (const t of [...tables].reverse()) lines.push(`DELETE FROM ${t};`);
  const q = (v: unknown) => (v === null || v === undefined ? 'NULL' : typeof v === 'number' ? String(v) : `'${String(v).replace(/'/g, "''")}'`);
  for (const t of tables) {
    const rows = (await db.prepare(`SELECT * FROM ${t}`).all<Record<string, unknown>>()).results;
    for (const row of rows) lines.push(`INSERT INTO ${t} (${Object.keys(row).join(', ')}) VALUES (${Object.values(row).map(q).join(', ')});`);
  }
  mkdirSync('.wrangler', { recursive: true });
  writeFileSync('.wrangler/seed.sql', lines.join('\n'));
});
