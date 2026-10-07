import type { Confidence, Retailer, RulesConfig } from '../../shared/config/schema.ts';
import type { ListingObservation, Precision, ReleaseObservation } from '../adapters/types.ts';
import { parseDate } from '../adapters/parse-utils.ts';
import type { Classification, Classifier } from '../normalise/classify.ts';
import { matchRelease, releaseKey, type Candidate } from '../normalise/match.ts';
import { decide, decisionChanged, type DateObservation } from './decide.ts';
import { convertMinor, placeholders, sha256Hex, ulid } from './util.ts';

/**
 * Ingestion: observations in, D1 rows out. Built for the Workers Free plan, where every D1 call
 * is a subrequest (50 per invocation): each call here does a few bulk reads and ends with one
 * batched write, whatever the number of items.
 */

export interface IngestDeps {
  db: D1Database;
  classifier: Classifier;
  rules: RulesConfig;
  now: Date;
}

export interface IngestStats {
  seen: number;
  kept: number;
  changed: number;
  createdReleases: number;
  unmatched: number;
  ambiguous: number;
  excluded: Record<string, number>;
}

const newStats = (): IngestStats => ({ seen: 0, kept: 0, changed: 0, createdReleases: 0, unmatched: 0, ambiguous: 0, excluded: {} });

/** A retailer-only release is created only for pre-orders and recent listings, never old stock. */
const NEW_LISTING_DAYS = 30;
/** Shop titles name a release worse than any calendar ("… Hobby Box - Pre-Order"). */
const SHOP_NAME_PRECEDENCE = 9;
const LAST_SEEN_REFRESH_MS = 24 * 3600_000;
const MAX_BOUND = 90; // D1 allows 100 bound parameters per statement

async function selectIn<T>(db: D1Database, sql: (ph: string) => string, values: string[]): Promise<T[]> {
  const out: T[] = [];
  for (let i = 0; i < values.length; i += MAX_BOUND) {
    const chunk = values.slice(i, i + MAX_BOUND);
    const res = await db.prepare(sql(placeholders(chunk.length))).bind(...chunk).all<T>();
    out.push(...res.results);
  }
  return out;
}

interface Entry {
  hash: string;
  title: string;
  sourceId: string;
  c: Classification;
  allowCreate: boolean;
  /** Source precedence: a better (lower) one renames the release it matches. */
  precedence: number;
}

/** Resolves each entry to a release id (or null), creating releases where allowed. */
async function resolveReleases(deps: IngestDeps, entries: Entry[], stats: IngestStats, writes: D1PreparedStatement[]) {
  const { db, classifier, now } = deps;
  const ts = now.toISOString();
  const resolved = new Map<string, string | null>();
  const cached = await selectIn<{ title_hash: string; release_id: string | null }>(
    db,
    (ph) => `SELECT title_hash, release_id FROM title_matches WHERE title_hash IN (${ph})`,
    [...new Set(entries.map((e) => e.hash))],
  );
  for (const row of cached) resolved.set(row.title_hash, row.release_id);

  const pending = entries.filter((e) => !resolved.has(e.hash));
  if (pending.length === 0) return resolved;
  const namePrecedence = new Map<string, number>();

  const cats = [...new Set(pending.map((e) => e.c.category as string))];
  const candidates = new Map<string, Candidate[]>();
  for (const cat of cats) {
    const rows = await db
      .prepare('SELECT id, subject, season, name_precedence FROM releases WHERE category = ?')
      .bind(cat)
      .all<{ id: string; subject: string; season: string | null; name_precedence: number }>();
    candidates.set(cat, rows.results.map((r) => ({ id: r.id, subject: r.subject ? r.subject.split(' ') : [], season: r.season })));
    for (const r of rows.results) namePrecedence.set(r.id, r.name_precedence);
  }

  for (const e of pending) {
    if (resolved.has(e.hash)) continue; // duplicate title within this batch
    const cat = e.c.category as string;
    const list = candidates.get(cat) ?? [];
    const { series, lines } = classifier.matchTokens(cat);
    const m = matchRelease(e.c.subject, e.c.season, list, series, lines);
    let releaseId: string | null = null;
    let method: 'deterministic' | 'created' | 'unmatched' = 'unmatched';
    if (m.kind === 'match') {
      releaseId = m.id;
      method = 'deterministic';
      if (e.precedence < (namePrecedence.get(m.id) ?? 99)) {
        namePrecedence.set(m.id, e.precedence);
        writes.push(db.prepare('UPDATE releases SET name = ?, name_precedence = ?, updated_at = ? WHERE id = ?').bind(e.title, e.precedence, ts, m.id));
      }
    } else if (m.kind === 'ambiguous') {
      stats.ambiguous += 1; // left for the LLM pass, which reads unmatched title_matches rows
    } else if (e.allowCreate && e.c.subject.length > 0) {
      releaseId = ulid(now.getTime());
      method = 'created';
      stats.createdReleases += 1;
      const key = releaseKey(cat, e.c.season, e.c.subject);
      writes.push(
        db
          .prepare(
            `INSERT OR IGNORE INTO releases (id, match_key, category, publisher, season, line, tier, tier_points_pct, name, name_precedence, subject, players, scarcity, origin_source, created_at, updated_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          )
          .bind(releaseId, key, cat, e.c.publisher, e.c.season, e.c.line, e.c.tier, e.c.tierPointsPct, e.title, e.precedence, e.c.subject.join(' '), JSON.stringify(e.c.players), JSON.stringify(e.c.scarcity), e.sourceId, ts, ts),
        db
          .prepare('INSERT INTO events (type, release_id, source_id, payload, created_at) VALUES (?, ?, ?, ?, ?)')
          .bind('release_discovered', releaseId, e.sourceId, JSON.stringify({ name: e.title }), ts),
      );
      list.push({ id: releaseId, subject: e.c.subject, season: e.c.season });
      namePrecedence.set(releaseId, e.precedence);
      candidates.set(cat, list);
    }
    if (method === 'unmatched') stats.unmatched += 1;
    resolved.set(e.hash, releaseId);
    writes.push(
      db
        .prepare('INSERT OR IGNORE INTO title_matches (title_hash, raw_title, source_id, category, subject, season, release_id, method, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)')
        .bind(e.hash, e.title, e.sourceId, cat, e.c.subject.join(' '), e.c.season, releaseId, method, ts),
    );
  }
  return resolved;
}

interface ObservationInput {
  releaseId: string;
  sourceId: string;
  startsAt: string | null;
  precision: Precision;
  confidence: Confidence;
  precedence: number;
  region: string | null;
  raw: string;
  url?: string | null;
}

/** Records each source's date observation and re-decides the drop date, keeping history. */
async function applyObservations(deps: IngestDeps, inputs: ObservationInput[], stats: IngestStats, writes: D1PreparedStatement[]) {
  if (inputs.length === 0) return;
  const { db, now } = deps;
  const ts = now.toISOString();
  const releaseIds = [...new Set(inputs.map((i) => i.releaseId))];
  const drops = await selectIn<{ id: string; release_id: string; starts_at: string | null; precision: Precision; confidence: Confidence; decided_by_source: string | null }>(
    db,
    (ph) => `SELECT id, release_id, starts_at, precision, confidence, decided_by_source FROM drops WHERE kind = 'release' AND release_id IN (${ph})`,
    releaseIds,
  );
  const dropByRelease = new Map(drops.map((d) => [d.release_id, d]));
  const obsRows = await selectIn<{ drop_id: string; source_id: string; starts_at: string | null; precision: Precision; confidence: Confidence; precedence: number; region: string | null; last_seen_at: string }>(
    db,
    (ph) => `SELECT drop_id, source_id, starts_at, precision, confidence, precedence, region, last_seen_at FROM drop_observations WHERE drop_id IN (${ph})`,
    drops.map((d) => d.id),
  );
  const obsByDrop = new Map<string, Map<string, DateObservation>>();
  for (const o of obsRows) {
    const m = obsByDrop.get(o.drop_id) ?? new Map<string, DateObservation>();
    m.set(o.source_id, { sourceId: o.source_id, startsAt: o.starts_at, precision: o.precision, confidence: o.confidence, precedence: o.precedence, region: o.region, lastSeenAt: o.last_seen_at });
    obsByDrop.set(o.drop_id, m);
  }

  for (const releaseId of releaseIds) {
    let drop = dropByRelease.get(releaseId);
    const isNew = !drop;
    if (!drop) {
      drop = { id: ulid(now.getTime()), release_id: releaseId, starts_at: null, precision: 'unknown', confidence: 'rumoured', decided_by_source: null };
      dropByRelease.set(releaseId, drop);
    }
    const current = obsByDrop.get(drop.id) ?? new Map<string, DateObservation>();
    const obsWrites: D1PreparedStatement[] = [];
    for (const i of inputs.filter((x) => x.releaseId === releaseId)) {
      const prev = current.get(i.sourceId);
      current.set(i.sourceId, { sourceId: i.sourceId, startsAt: i.startsAt, precision: i.precision, confidence: i.confidence, precedence: i.precedence, region: i.region, lastSeenAt: ts });
      const same = prev && prev.startsAt === i.startsAt && prev.precision === i.precision && prev.confidence === i.confidence;
      obsWrites.push(
        db
          .prepare(
            `INSERT INTO drop_observations (drop_id, source_id, starts_at, precision, confidence, precedence, region, raw, url, first_seen_at, last_seen_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
             ON CONFLICT (drop_id, source_id) DO UPDATE SET starts_at = excluded.starts_at, precision = excluded.precision,
               confidence = excluded.confidence, precedence = excluded.precedence, region = excluded.region, raw = excluded.raw,
               url = COALESCE(excluded.url, drop_observations.url), last_seen_at = excluded.last_seen_at`,
          )
          .bind(drop.id, i.sourceId, i.startsAt, i.precision, i.confidence, i.precedence, i.region, i.raw, i.url ?? null, ts, ts),
      );
      if (prev && !same) stats.changed += 1;
    }
    obsByDrop.set(drop.id, current);

    const before = { startsAt: drop.starts_at, precision: drop.precision, confidence: drop.confidence, sourceId: drop.decided_by_source };
    const after = decide([...current.values()]);
    if (isNew) {
      writes.push(
        db
          .prepare(
            `INSERT INTO drops (id, release_id, kind, starts_at, precision, confidence, decided_by_source, status, created_at, updated_at)
             VALUES (?, ?, 'release', ?, ?, ?, ?, 'upcoming', ?, ?)`,
          )
          .bind(drop.id, releaseId, after.startsAt, after.precision, after.confidence, after.sourceId, ts, ts),
      );
    }
    // Observations reference the drop, so they go after its INSERT.
    writes.push(...obsWrites);
    if (!isNew && decisionChanged(before, after)) {
      writes.push(
        db
          .prepare('UPDATE drops SET starts_at = ?, precision = ?, confidence = ?, decided_by_source = ?, updated_at = ? WHERE id = ?')
          .bind(after.startsAt, after.precision, after.confidence, after.sourceId, ts, drop.id),
      );
    }
    if (isNew || decisionChanged(before, after)) {
      writes.push(
        db
          .prepare(
            `INSERT INTO drop_date_history (drop_id, old_starts_at, new_starts_at, old_precision, new_precision, old_confidence, new_confidence, source_id, changed_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          )
          .bind(drop.id, isNew ? null : before.startsAt, after.startsAt, isNew ? null : before.precision, after.precision, isNew ? null : before.confidence, after.confidence, after.sourceId ?? 'unknown', ts),
      );
      // "Date moved" is an event. Setting a first date, or only firming up confidence, is too.
      if (!isNew) {
        const type = before.startsAt === null ? 'date_set' : before.startsAt !== after.startsAt ? 'date_changed' : 'confidence_changed';
        writes.push(
          db
            .prepare('INSERT INTO events (type, drop_id, release_id, source_id, payload, created_at) VALUES (?, ?, ?, ?, ?, ?)')
            .bind(type, drop.id, releaseId, after.sourceId, JSON.stringify({ before, after }), ts),
        );
      }
      drop.starts_at = after.startsAt;
      drop.precision = after.precision;
      drop.confidence = after.confidence;
      drop.decided_by_source = after.sourceId;
    }
  }
}

async function titleHash(categories: string[], normalisedTitle: string) {
  return sha256Hex(`${[...categories].sort().join(',')}|${normalisedTitle}`);
}

export interface CalendarSource {
  id: string;
  categories: string[];
  precedence: number;
}

/** Calendar and official sources: every in-scope row becomes (or matches) a release with a date observation. */
export async function ingestReleases(deps: IngestDeps, source: CalendarSource, items: ReleaseObservation[]): Promise<IngestStats> {
  const stats = newStats();
  const writes: D1PreparedStatement[] = [];
  const entries: Array<Entry & { obs: ReleaseObservation }> = [];
  for (const obs of items) {
    stats.seen += 1;
    const c = deps.classifier.classify({ title: obs.title }, { categories: source.categories });
    if (!c.category) continue;
    if (c.excludedRule) {
      stats.excluded[c.excludedRule] = (stats.excluded[c.excludedRule] ?? 0) + 1;
      continue;
    }
    stats.kept += 1;
    const hash = await titleHash(source.categories, deps.classifier.normaliser.text(obs.title));
    entries.push({ hash, title: obs.title, sourceId: source.id, c, allowCreate: true, precedence: source.precedence, obs });
  }
  const resolved = await resolveReleases(deps, entries, stats, writes);
  const inputs: ObservationInput[] = [];
  for (const e of entries) {
    const releaseId = resolved.get(e.hash);
    if (!releaseId) continue;
    inputs.push({
      releaseId,
      sourceId: source.id,
      startsAt: e.obs.date,
      precision: e.obs.precision,
      confidence: e.obs.confidence,
      precedence: source.precedence,
      region: e.obs.region ?? null,
      raw: e.obs.rawDate,
      url: e.obs.url,
    });
  }
  // Several rows (e.g. Pokémon Center products of one set) may hit the same release; keep the
  // most precise per source so one release gets one observation per source.
  await applyObservations(deps, dedupeObservations(inputs), stats, writes);
  if (writes.length) await deps.db.batch(writes);
  return stats;
}

function dedupeObservations(inputs: ObservationInput[]): ObservationInput[] {
  const rank: Record<Precision, number> = { unknown: 0, month: 1, week: 2, day: 3, time: 4 };
  const best = new Map<string, ObservationInput>();
  for (const i of inputs) {
    const key = `${i.releaseId}|${i.sourceId}`;
    const prev = best.get(key);
    if (!prev || rank[i.precision] > rank[prev.precision]) best.set(key, i);
  }
  return [...best.values()];
}

/** Shop listings: classify, match to a release, then record listing, stock and price changes. */
export async function ingestListings(deps: IngestDeps, retailer: Retailer, items: ListingObservation[], shopPrecedence = 4): Promise<IngestStats> {
  const { db, classifier, rules, now } = deps;
  const ts = now.toISOString();
  const stats = newStats();
  const writes: D1PreparedStatement[] = [];

  const kept: Array<{ obs: ListingObservation; c: Classification; hash: string }> = [];
  for (const obs of items) {
    stats.seen += 1;
    const c = classifier.classify(
      { title: obs.title, variantTitle: obs.variantTitle, productType: obs.productType, tags: obs.tags, vendor: obs.vendor },
      { categories: retailer.categories, englishMarkers: retailer.english_markers, listing: true },
    );
    if (!c.category) continue;
    if (c.excludedRule) {
      stats.excluded[c.excludedRule] = (stats.excluded[c.excludedRule] ?? 0) + 1;
      continue;
    }
    stats.kept += 1;
    const hash = await titleHash(retailer.categories, classifier.normaliser.text(obs.title));
    kept.push({ obs, c, hash });
  }
  if (kept.length === 0) return stats;

  const recent = (iso: string | null) => iso !== null && now.getTime() - Date.parse(iso) < NEW_LISTING_DAYS * 86400_000;
  const entries: Entry[] = kept.map(({ obs, c, hash }) => ({
    hash,
    title: obs.title,
    sourceId: retailer.id,
    c,
    allowCreate: obs.isPreorder || recent(obs.publishedAt),
    precedence: SHOP_NAME_PRECEDENCE,
  }));
  const resolved = await resolveReleases(deps, entries, stats, writes);

  // Products (release × box type).
  const releaseIds = [...new Set([...resolved.values()].filter((x): x is string => !!x))];
  const products = await selectIn<{ id: string; release_id: string; configuration: string; rrp_minor: number | null; rrp_currency: string | null }>(
    db,
    (ph) => `SELECT id, release_id, configuration, rrp_minor, rrp_currency FROM products WHERE release_id IN (${ph})`,
    releaseIds,
  );
  const productKey = (r: string, cfg: string) => `${r}|${cfg}`;
  const productByKey = new Map(products.map((p) => [productKey(p.release_id, p.configuration), p]));
  const releaseNames = new Map(
    (await selectIn<{ id: string; name: string }>(db, (ph) => `SELECT id, name FROM releases WHERE id IN (${ph})`, releaseIds)).map((r) => [r.id, r.name]),
  );

  const fxRow = await db.prepare('SELECT date FROM fx_rates ORDER BY date DESC LIMIT 1').first<{ date: string }>();
  const rates: Record<string, number> = { EUR: 1 };
  if (fxRow) {
    const rs = await db.prepare('SELECT currency, rate FROM fx_rates WHERE date = ?').bind(fxRow.date).all<{ currency: string; rate: number }>();
    for (const r of rs.results) rates[r.currency] = r.rate;
  }

  const existing = new Map(
    (
      await selectIn<{ id: string; product_id: string | null; price_minor: number | null; available: number; is_preorder: number; release_text: string | null; purchase_limit: number | null; scarcity: string | null; image_url: string | null; last_seen_at: string; raw_title: string }>(
        db,
        (ph) => `SELECT id, product_id, price_minor, available, is_preorder, release_text, purchase_limit, scarcity, image_url, last_seen_at, raw_title FROM listings WHERE id IN (${ph})`,
        kept.map((k) => `${retailer.id}:${k.obs.externalId}`),
      )
    ).map((l) => [l.id, l]),
  );

  const observations: ObservationInput[] = [];
  for (const { obs, c, hash } of kept) {
    const releaseId = resolved.get(hash) ?? null;
    let product: { id: string; rrp_minor: number | null; rrp_currency: string | null } | null = null;
    if (releaseId) {
      const cfg = c.configuration ?? 'unknown';
      product = productByKey.get(productKey(releaseId, cfg)) ?? null;
      if (!product) {
        const known = rules.rrp.known.find((k) => k.category === c.category && k.configuration === cfg);
        const rrpMinor = known ? Math.round(known.amount * 100) : null;
        const cfgLabel = rules.categories[c.category ?? '']?.configurations.find((x) => x.id === cfg)?.label ?? 'Sealed';
        product = { id: ulid(now.getTime()), rrp_minor: rrpMinor, rrp_currency: known?.currency ?? null };
        productByKey.set(productKey(releaseId, cfg), { ...product, release_id: releaseId, configuration: cfg });
        writes.push(
          db
            .prepare(
              `INSERT OR IGNORE INTO products (id, release_id, configuration, name, rrp_minor, rrp_currency, rrp_source, created_at, updated_at)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            )
            .bind(product.id, releaseId, cfg, `${releaseNames.get(releaseId) ?? obs.title} — ${cfgLabel}`, rrpMinor, known?.currency ?? null, known ? 'config' : null, ts, ts),
        );
      }
      // A release date printed on the listing is the shop's own observation.
      if (obs.releaseText) {
        const { date, precision } = parseDate(obs.releaseText);
        observations.push({ releaseId, sourceId: retailer.id, startsAt: date, precision, confidence: 'announced', precedence: shopPrecedence, region: retailer.country, raw: obs.releaseText });
      }
    }

    const id = `${retailer.id}:${obs.externalId}`;
    const rrpInListingCurrency =
      product?.rrp_minor != null && product.rrp_currency ? convertMinor(product.rrp_minor, product.rrp_currency, obs.currency, rates) : null;
    const ratio = obs.priceMinor !== null && rrpInListingCurrency ? Math.round((obs.priceMinor / rrpInListingCurrency) * 1000) / 1000 : null;
    const priceEvent = () =>
      obs.priceMinor === null
        ? []
        : [
            db
              .prepare('INSERT INTO price_events (listing_id, at, price_minor, currency, rrp_minor, rrp_currency, ratio_to_rrp) VALUES (?, ?, ?, ?, ?, ?, ?)')
              .bind(id, ts, obs.priceMinor, obs.currency, rrpInListingCurrency, rrpInListingCurrency === null ? null : obs.currency, ratio),
          ];
    const stockEvent = () => [db.prepare('INSERT INTO stock_events (listing_id, at, available, price_minor) VALUES (?, ?, ?, ?)').bind(id, ts, obs.available ? 1 : 0, obs.priceMinor)];

    const prev = existing.get(id);
    if (!prev) {
      stats.changed += 1;
      writes.push(
        db
          .prepare(
            `INSERT INTO listings (id, retailer_id, external_id, product_id, url, raw_title, price_minor, currency, available, is_preorder, release_text, purchase_limit, scarcity, image_url, first_seen_at, last_seen_at, last_changed_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          )
          .bind(id, retailer.id, obs.externalId, product?.id ?? null, obs.url, obs.variantTitle ? `${obs.title} — ${obs.variantTitle}` : obs.title, obs.priceMinor, obs.currency, obs.available ? 1 : 0, obs.isPreorder ? 1 : 0, obs.releaseText, obs.purchaseLimit, JSON.stringify(obs.scarcity), obs.imageUrl, ts, ts, ts),
        ...stockEvent(),
        ...priceEvent(),
      );
      continue;
    }
    const priceChanged = prev.price_minor !== obs.priceMinor;
    const stockChanged = Boolean(prev.available) !== obs.available;
    const otherChanged =
      prev.product_id !== (product?.id ?? null) ||
      Boolean(prev.is_preorder) !== obs.isPreorder ||
      prev.release_text !== obs.releaseText ||
      prev.purchase_limit !== obs.purchaseLimit ||
      (prev.scarcity ?? '[]') !== JSON.stringify(obs.scarcity) ||
      // A first photo is worth a write; a CDN version bump on an existing one is not.
      (prev.image_url === null && obs.imageUrl !== null);
    if (priceChanged || stockChanged || otherChanged) {
      stats.changed += 1;
      writes.push(
        db
          .prepare('UPDATE listings SET product_id = ?, url = ?, price_minor = ?, available = ?, is_preorder = ?, release_text = ?, purchase_limit = ?, scarcity = ?, image_url = COALESCE(?, image_url), last_seen_at = ?, last_changed_at = ?, gone_at = NULL WHERE id = ?')
          .bind(product?.id ?? null, obs.url, obs.priceMinor, obs.available ? 1 : 0, obs.isPreorder ? 1 : 0, obs.releaseText, obs.purchaseLimit, JSON.stringify(obs.scarcity), obs.imageUrl, ts, ts, id),
      );
      if (priceChanged) writes.push(...priceEvent());
      if (stockChanged) {
        writes.push(...stockEvent());
        if (obs.available) {
          writes.push(
            db
              .prepare('INSERT INTO events (type, release_id, product_id, listing_id, source_id, payload, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)')
              .bind('restock', releaseId, product?.id ?? null, id, retailer.id, JSON.stringify({ price_minor: obs.priceMinor, currency: obs.currency }), ts),
          );
        }
      }
    } else if (now.getTime() - Date.parse(prev.last_seen_at) > LAST_SEEN_REFRESH_MS) {
      writes.push(db.prepare('UPDATE listings SET last_seen_at = ? WHERE id = ?').bind(ts, id));
    }
  }

  await applyObservations(deps, dedupeObservations(observations), stats, writes);
  if (writes.length) await db.batch(writes);
  return stats;
}
