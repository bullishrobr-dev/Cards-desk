import { beforeEach, describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { rules } from '../../shared/config/index.ts';
import { createClassifier } from '../normalise/classify.ts';
import { createTestD1 } from '../testing/sqlite-d1.ts';
import { parseCollectosk } from '../adapters/calendars.ts';
import type { ReleaseObservation } from '../adapters/types.ts';
import { ingestReleases } from './ingest.ts';
import { llmMatchPending, type LlmMatchDeps } from './llm-match.ts';

const classifier = createClassifier(rules);
let db: D1Database;
let sccId: string;

/** A stand-in for client.messages.parse that records prompts and returns a scripted answer. */
function fakeClient(answer: (prompt: string) => { release_id: string | null; confidence: 'high' | 'low' }) {
  const prompts: string[] = [];
  const client = {
    parse: async (req: { messages: Array<{ content: string }> }) => {
      const prompt = req.messages[0]?.content ?? '';
      prompts.push(prompt);
      return { stop_reason: 'end_turn', parsed_output: answer(prompt) };
    },
  } as unknown as LlmMatchDeps['client'];
  return { client, prompts };
}

const deps = (client: LlmMatchDeps['client']): LlmMatchDeps => ({ db, model: 'claude-haiku-4-5', client, now: new Date('2026-10-05T09:00:00Z') });

async function addUnmatched(hash: string, title: string) {
  const c = classifier.classify({ title, tags: ['Fútbol'] }, { categories: ['football', 'f1'], listing: true });
  await db
    .prepare(`INSERT INTO title_matches (title_hash, raw_title, source_id, category, subject, season, release_id, method, created_at) VALUES (?, ?, 'sportcardscenter', ?, ?, ?, NULL, 'unmatched', ?)`)
    .bind(hash, title, c.category, c.subject.join(' '), c.season, '2026-10-05T08:00:00Z')
    .run();
}

beforeEach(async () => {
  db = createTestD1();
  const now = new Date('2026-10-05T08:00:00Z');
  await ingestReleases({ db, classifier, rules, now }, { id: 'collectosk', categories: ['football', 'f1'], precedence: 2 }, parseCollectosk(readFileSync('fixtures/collectosk/response.json', 'utf8'), 'confirmed_date').items as ReleaseObservation[]);
  sccId = (await db.prepare(`SELECT id FROM releases WHERE name LIKE '%Stadium Club Chrome%'`).first<{ id: string }>())?.id ?? '';
});

describe('LLM matching pass', () => {
  it('applies a high-confidence pick from the shortlist and caches it', async () => {
    await addUnmatched('h1', 'Topps Stadium Club Kromo Liga de Campeones 2025/26 Caja Hobby');
    const { client, prompts } = fakeClient(() => ({ release_id: sccId, confidence: 'high' }));
    expect(await llmMatchPending(deps(client))).toEqual({ asked: 1, matched: 1 });
    expect(prompts[0]).toContain(`id ${sccId}`);
    const row = await db.prepare(`SELECT release_id, method FROM title_matches WHERE title_hash = 'h1'`).first();
    expect(row).toEqual({ release_id: sccId, method: 'llm' });
    // Cached: a second run asks nothing.
    expect(await llmMatchPending(deps(client))).toEqual({ asked: 0, matched: 0 });
  });

  it('ignores ids that were not on the shortlist', async () => {
    await addUnmatched('h2', 'Topps Stadium Club Kromo Liga de Campeones 2025/26 Caja Hobby');
    const { client } = fakeClient(() => ({ release_id: 'made-up-id', confidence: 'high' }));
    expect((await llmMatchPending(deps(client))).matched).toBe(0);
    expect(await db.prepare(`SELECT method FROM title_matches WHERE title_hash = 'h2'`).first('method')).toBe('unmatched');
  });

  it('treats low confidence as no match', async () => {
    await addUnmatched('h3', 'Topps Stadium Club Kromo Liga de Campeones 2025/26 Caja Hobby');
    const { client } = fakeClient(() => ({ release_id: sccId, confidence: 'low' }));
    expect((await llmMatchPending(deps(client))).matched).toBe(0);
  });
});
