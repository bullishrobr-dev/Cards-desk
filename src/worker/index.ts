import { Hono } from 'hono';

export { AlertScheduler } from './alerts/scheduler-do.ts';

const app = new Hono<{ Bindings: Env }>();

app.get('/api/health', (c) => c.json({ ok: true, env: c.env.APP_ENV }));

export default {
  fetch: app.fetch,
  async scheduled(_controller, _env, _ctx) {
    // Dispatcher lands in the scheduler commit.
  },
  async queue(_batch, _env) {
    // Job runner lands in the scheduler commit.
  },
} satisfies ExportedHandler<Env>;
