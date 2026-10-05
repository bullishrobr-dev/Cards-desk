import Anthropic from '@anthropic-ai/sdk';
import { zodOutputFormat } from '@anthropic-ai/sdk/helpers/zod';
import { z } from 'zod';
import { placeholders } from './util.ts';

/**
 * The cheap LLM pass: only for titles the deterministic matcher left unmatched or ambiguous,
 * a few per run, every answer cached. The model picks from a shortlist the code built; it
 * never invents a release. Low-confidence answers are cached as "no match".
 */

const Answer = z.object({
  release_id: z.string().nullable().describe('The id of the matching release, or null if none matches'),
  confidence: z.enum(['high', 'low']),
});

const SYSTEM = `You match retail product titles for sealed trading-card products to the release they belong to.
A release is a product line for one season or set, for example "2026 Topps Chrome Formula 1" or "Pokémon TCG: Mega Evolution—Delta Reign".
The title may be in English, Spanish, French or Italian and may name a box type (hobby box, ETB, booster box). Box types do not matter; the release does.
Different product lines are different releases even when they share words: "Topps Chrome" is not "Topps Chrome Sapphire", "Topps Finest" or "Topps Chrome Black".
Different seasons are different releases: 2025-26 is not 2026-27.
Answer with the id of the single matching candidate. If none clearly matches, answer null. Use confidence "high" only when you are sure.`;

export interface LlmMatchDeps {
  db: D1Database;
  model: string;
  client: Pick<Anthropic['messages'], 'parse'>;
  now: Date;
}

export function createAnthropicClient(apiKey: string) {
  return new Anthropic({ apiKey, maxRetries: 1 }).messages;
}

const SHORTLIST = 15;
const PER_RUN = 8;

export async function llmMatchPending(deps: LlmMatchDeps): Promise<{ asked: number; matched: number }> {
  const { db, model, client, now } = deps;
  const ts = now.toISOString();
  const pending = await db
    .prepare(
      `SELECT tm.title_hash, tm.raw_title, tm.category, tm.subject FROM title_matches tm
       LEFT JOIN llm_match_cache c ON c.title_hash = tm.title_hash
       WHERE tm.method = 'unmatched' AND c.title_hash IS NULL
       ORDER BY tm.created_at DESC LIMIT ?`,
    )
    .bind(PER_RUN)
    .all<{ title_hash: string; raw_title: string; category: string; subject: string }>();

  let matched = 0;
  const writes: D1PreparedStatement[] = [];
  for (const row of pending.results) {
    // Shortlist by token overlap so the prompt stays small and the model can only pick real ids.
    // Category and subject were stored when the title was first classified, with the shop's tags.
    const tokens = row.subject.split(' ').filter((t) => t.length > 2);
    if (tokens.length === 0) continue;
    const like = tokens.map(() => 'subject LIKE ?').join(' OR ');
    const rows = await db
      .prepare(`SELECT id, name, season, subject FROM releases WHERE category = ? AND (${like})`)
      .bind(row.category, ...tokens.map((t) => `%${t}%`))
      .all<{ id: string; name: string; season: string | null; subject: string }>();
    const shortlist = rows.results
      .map((r) => ({ ...r, overlap: r.subject.split(' ').filter((t) => tokens.includes(t)).length }))
      .sort((a, b) => b.overlap - a.overlap)
      .slice(0, SHORTLIST);
    if (shortlist.length === 0) {
      writes.push(db.prepare('INSERT OR IGNORE INTO llm_match_cache (title_hash, model, response, created_at) VALUES (?, ?, ?, ?)').bind(row.title_hash, 'none', '{"release_id":null,"confidence":"high","reason":"no candidates"}', ts));
      continue;
    }

    const response = await client.parse({
      model,
      max_tokens: 256,
      system: SYSTEM,
      messages: [
        {
          role: 'user',
          content: `Title: ${row.raw_title}\n\nCandidates:\n${shortlist.map((s) => `- id ${s.id}: ${s.name}${s.season ? ` (season ${s.season})` : ''}`).join('\n')}`,
        },
      ],
      output_config: { format: zodOutputFormat(Answer) },
    });
    const answer = response.stop_reason === 'refusal' ? null : response.parsed_output;
    const valid = answer && answer.confidence === 'high' && answer.release_id && shortlist.some((s) => s.id === answer.release_id);
    writes.push(
      db.prepare('INSERT OR IGNORE INTO llm_match_cache (title_hash, model, response, created_at) VALUES (?, ?, ?, ?)').bind(row.title_hash, model, JSON.stringify(answer ?? { refusal: true }), ts),
    );
    if (valid && answer?.release_id) {
      matched += 1;
      writes.push(db.prepare(`UPDATE title_matches SET release_id = ?, method = 'llm' WHERE title_hash = ?`).bind(answer.release_id, row.title_hash));
    }
  }
  if (writes.length) await db.batch(writes);
  return { asked: pending.results.length, matched };
}

/** Exposed for tests and the source-health view. */
export async function cachedAnswers(db: D1Database, hashes: string[]) {
  if (hashes.length === 0) return [];
  return (await db.prepare(`SELECT * FROM llm_match_cache WHERE title_hash IN (${placeholders(hashes.length)})`).bind(...hashes).all()).results;
}
