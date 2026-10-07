import type { PostEnrichment } from '../adapters/collectosk-post.ts';
import { baseNormalise } from '../normalise/text.ts';
import type { IngestDeps } from './ingest.ts';
import { ulid } from './util.ts';

export interface EnrichStats {
  formats: number;
  productsCreated: number;
  rrpsSet: number;
  playersAdded: string[];
  rookies: number;
}

const parseList = (json: string | null): string[] => {
  try {
    const v = JSON.parse(json ?? '[]') as unknown;
    return Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : [];
  } catch {
    return [];
  }
};

/** Published RRP in the owner's home currency when given, else euros, else dollars. */
function pickRrp(rrp: PostEnrichment['formats'][number]['rrp']): { minor: number; currency: string } | null {
  for (const c of ['GBP', 'EUR', 'USD'] as const) {
    const v = rrp[c];
    if (v !== undefined) return { minor: v, currency: c };
  }
  return null;
}

/**
 * Applies a release's product post: its box types (creating products the shops have not listed
 * yet), each one's published RRP, watchlist players on the checklist and its rookie cards.
 *
 * RRP precedence: owner (personal table) > rules.yaml > published > estimated. A published RRP
 * replaces an estimate; it never replaces a rules.yaml RRP. Three D1 calls.
 */
export async function ingestEnrichment(deps: IngestDeps, releaseId: string, post: PostEnrichment): Promise<EnrichStats> {
  const { db, rules, classifier, now } = deps;
  const ts = now.toISOString();
  const stats: EnrichStats = { formats: post.formats.length, productsCreated: 0, rrpsSet: 0, playersAdded: [], rookies: post.rookies.length };
  const [release, products] = await Promise.all([
    db.prepare('SELECT id, category, players FROM releases WHERE id = ?').bind(releaseId).first<{ id: string; category: string; players: string | null }>(),
    db
      .prepare('SELECT id, configuration, rrp_minor, rrp_currency, rrp_source FROM products WHERE release_id = ?')
      .bind(releaseId)
      .all<{ id: string; configuration: string; rrp_minor: number | null; rrp_currency: string | null; rrp_source: string | null }>(),
  ]);
  if (!release) throw new Error(`release ${releaseId} no longer exists`);

  const writes: D1PreparedStatement[] = [];
  const byConfig = new Map(products.results.map((p) => [p.configuration, p]));
  const handled = new Set<string>();
  const rrpChanges: Array<{ configuration: string; minor: number; currency: string }> = [];
  for (const f of post.formats) {
    const c = classifier.classify({ title: f.title }, { categories: [release.category], listing: true });
    const cfg = c.configuration;
    // A format we cannot name (FDI, Hongbao …) is skipped rather than filed as "unknown".
    if (!cfg || handled.has(cfg)) continue;
    handled.add(cfg);
    const rrp = pickRrp(f.rrp);
    const existing = byConfig.get(cfg);
    if (!existing) {
      stats.productsCreated += 1;
      if (rrp) {
        stats.rrpsSet += 1;
        rrpChanges.push({ configuration: cfg, ...rrp });
      }
      writes.push(
        db
          .prepare(
            `INSERT OR IGNORE INTO products (id, release_id, configuration, name, rrp_minor, rrp_currency, rrp_source, created_at, updated_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          )
          .bind(ulid(now.getTime()), releaseId, cfg, f.title, rrp?.minor ?? null, rrp?.currency ?? null, rrp ? 'published' : null, ts, ts),
      );
    } else if (rrp && existing.rrp_source !== 'config' && (existing.rrp_minor !== rrp.minor || existing.rrp_currency !== rrp.currency || existing.rrp_source !== 'published')) {
      stats.rrpsSet += 1;
      rrpChanges.push({ configuration: cfg, ...rrp });
      writes.push(
        db
          .prepare(`UPDATE products SET rrp_minor = ?, rrp_currency = ?, rrp_source = 'published', updated_at = ? WHERE id = ? AND (rrp_source IS NULL OR rrp_source != 'config')`)
          .bind(rrp.minor, rrp.currency, ts, existing.id),
      );
    }
  }

  // Watchlist players on the checklist (accents and case ignored).
  const onChecklist = new Set(post.names.map(baseNormalise));
  const players = parseList(release.players);
  for (const p of rules.relevance.watchlist_players) {
    if (onChecklist.has(baseNormalise(p)) && !players.includes(p)) {
      players.push(p);
      stats.playersAdded.push(p);
    }
  }
  writes.push(
    db
      .prepare('UPDATE releases SET players = ?, rookies = ?, checklist_cards = ?, enriched_at = ?, updated_at = ? WHERE id = ?')
      .bind(JSON.stringify(players), JSON.stringify(post.rookies), post.cardCount || null, ts, ts, releaseId),
  );
  // A changed RRP or a newly found player can change the Desk Score: an event lets the
  // notification engine rescore (and raise "New Priority drop").
  if (rrpChanges.length || stats.playersAdded.length || stats.productsCreated) {
    writes.push(
      db
        .prepare('INSERT INTO events (type, release_id, source_id, payload, created_at) VALUES (?, ?, ?, ?, ?)')
        .bind('release_enriched', releaseId, 'collectosk', JSON.stringify({ rrp: rrpChanges, playersAdded: stats.playersAdded, productsCreated: stats.productsCreated }), ts),
    );
  }
  await db.batch(writes);
  return stats;
}
