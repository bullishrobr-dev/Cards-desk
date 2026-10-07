// One-off: adds each product's first image address to the saved shop fixtures, read live from
// the same catalogue URLs (matched by product id; products no longer on page 1 stay without).
// Usage: node tools/backfill-fixture-images.mjs
import { readFileSync, writeFileSync, readdirSync, existsSync } from 'node:fs';

const UA = 'CardDeskDrops/0.1 (personal release tracker)';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
for (const dir of readdirSync('fixtures')) {
  for (const f of readdirSync(`fixtures/${dir}`).filter((x) => /^products-\d+-page1\.json$/.test(x))) {
    const metaFile = `fixtures/${dir}/${f}.meta.json`;
    if (!existsSync(metaFile)) continue;
    const { url } = JSON.parse(readFileSync(metaFile, 'utf8'));
    const fixture = JSON.parse(readFileSync(`fixtures/${dir}/${f}`, 'utf8'));
    const res = await fetch(url, { headers: { 'user-agent': UA, accept: 'application/json' } });
    let live;
    try {
      live = await res.json();
    } catch {
      console.log(`${dir}/${f}: not JSON (${res.status}), skipped`);
      continue;
    }
    const liveList = Array.isArray(live) ? live : live.products ?? [];
    const src = new Map(liveList.map((p) => [p.id, (p.images ?? [])[0]?.src ?? null]));
    const list = Array.isArray(fixture) ? fixture : fixture.products ?? [];
    let n = 0;
    for (const p of list) {
      const s = src.get(p.id);
      if (s) {
        p.images = [{ src: s }];
        n += 1;
      }
    }
    writeFileSync(`fixtures/${dir}/${f}`, JSON.stringify(fixture, null, 1));
    console.log(`${dir}/${f}: ${n}/${list.length} images`);
    await sleep(3000);
  }
}
