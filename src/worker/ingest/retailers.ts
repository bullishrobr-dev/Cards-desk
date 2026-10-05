import type { SourcesConfig } from '../../shared/config/schema.ts';

/** Mirrors config/sources.yaml retailers into D1 (one batched write) so SQL can join on them. */
export async function syncRetailers(db: D1Database, cfg: SourcesConfig): Promise<void> {
  if (cfg.retailers.length === 0) return;
  await db.batch(
    cfg.retailers.map((r) =>
      db
        .prepare(
          `INSERT INTO retailers (id, name, country, currency, base_url, ships_gi, ships_gi_verified_at, ships_gi_note, ships_es, ships_es_verified_at, ships_es_note, enabled)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
           ON CONFLICT (id) DO UPDATE SET name = excluded.name, country = excluded.country, currency = excluded.currency,
             base_url = excluded.base_url, ships_gi = excluded.ships_gi, ships_gi_verified_at = excluded.ships_gi_verified_at,
             ships_gi_note = excluded.ships_gi_note, ships_es = excluded.ships_es, ships_es_verified_at = excluded.ships_es_verified_at,
             ships_es_note = excluded.ships_es_note, enabled = excluded.enabled`,
        )
        .bind(r.id, r.name, r.country, r.currency, r.base_url, r.ships_gi.value, r.ships_gi.verified_at ?? null, r.ships_gi.note ?? null, r.ships_es.value, r.ships_es.verified_at ?? null, r.ships_es.note ?? null, r.enabled ? 1 : 0),
    ),
  );
}
