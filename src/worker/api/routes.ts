import { Hono } from 'hono';
import { rules, sources } from '../../shared/config/index.ts';
import { requireAccess, type AccessIdentity } from './access.ts';
import { dropDetail, listDrops, sourceHealth } from './queries.ts';

export const api = new Hono<{ Bindings: Env; Variables: { identity: AccessIdentity } }>();

api.use('*', requireAccess());

api.get('/drops', async (c) => {
  const view = c.req.query('view') === 'live' ? 'live' : 'upcoming';
  const category = c.req.query('category') || null;
  const regionParam = c.req.query('region');
  const region = regionParam === 'gi' || regionParam === 'es' ? regionParam : null;
  if (category && !rules.categories[category]) return c.json({ error: 'Unknown category' }, 400);
  return c.json(await listDrops(c.env.DB, rules, { view, category, region }, new Date()));
});

api.get('/drops/:id', async (c) => {
  const detail = await dropDetail(c.env.DB, rules, sources, c.req.param('id'));
  return detail ? c.json(detail) : c.json({ error: 'Not found' }, 404);
});

api.get('/sources/health', async (c) => c.json(await sourceHealth(c.env.DB, sources)));

/** Read-only view of the rules and the categories the UI can filter by. */
api.get('/config', (c) =>
  c.json({
    timezone: rules.owner.timezone,
    shipTo: rules.owner.ship_to,
    categories: Object.entries(rules.categories)
      .filter(([, cat]) => cat.enabled)
      .map(([id, cat]) => ({ id, label: cat.label })),
    rules,
  }),
);

api.get('/me', (c) => c.json(c.get('identity')));
