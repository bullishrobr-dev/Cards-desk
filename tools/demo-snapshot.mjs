/**
 * Snapshots the local app's API (npm run dev, after npm run seed:local) into
 * src/web/demo/snapshot.json for the static demo build (vite.demo.config.ts).
 *   node tools/demo-snapshot.mjs [extra drop ids…]
 */
import { writeFileSync } from 'node:fs';

const BASE = process.env.BASE ?? 'http://localhost:5173';
const out = {};
const get = async (path) => {
  const res = await fetch(BASE + path);
  if (!res.ok) throw new Error(`${path}: HTTP ${res.status}`);
  out[path] = await res.json();
  return out[path];
};

for (const p of ['/api/config', '/api/me', '/api/notifications', '/api/push/status', '/api/push/config', '/api/calendar', '/api/notification-prefs', '/api/sources/health', '/api/brief', '/api/watch']) await get(p);
for (const d of [7, 30, 90]) await get(`/api/signals?days=${d}`);
const ids = new Set(process.argv.slice(2));
for (const v of ['upcoming', 'live', 'watchlist']) for (const d of await get(`/api/drops?view=${v}`)) ids.add(d.id);
for (const d of out['/api/brief'].drops) ids.add(d.id);
for (const m of out['/api/signals?days=90'].moves) if (m.dropId) ids.add(m.dropId);
for (const id of ids) await get(`/api/drops/${id}`);
writeFileSync('src/web/demo/snapshot.json', JSON.stringify(out));
console.log(`${Object.keys(out).length} responses, ${ids.size} drops, ${(JSON.stringify(out).length / 1024).toFixed(0)} KB`);
