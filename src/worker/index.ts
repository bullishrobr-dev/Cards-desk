import { Hono } from 'hono';
import * as Sentry from '@sentry/cloudflare';
import { rules, sources } from '../shared/config/index.ts';
import { createClassifier } from './normalise/classify.ts';
import { dispatch } from './jobs/scheduler.ts';
import { runFetchJob } from './jobs/runner.ts';
import { runMaintenance } from './jobs/maintenance.ts';
import { syncRetailers } from './ingest/retailers.ts';
import { createAnthropicClient, llmMatchPending } from './ingest/llm-match.ts';
import type { JobMessage } from './jobs/types.ts';
import { api } from './api/routes.ts';

export { AlertScheduler } from './alerts/scheduler-do.ts';
import { sentryOptions } from './sentry.ts';

// Built once per isolate: compiling the rules is the expensive part, not using them.
const classifier = createClassifier(rules);

const app = new Hono<{ Bindings: Env }>();

app.get('/api/health', (c) => c.json({ ok: true, env: c.env.APP_ENV }));
app.route('/api', api);

async function handleJob(msg: JobMessage, env: Env): Promise<void> {
  const now = new Date();
  if (msg.type === 'fetch') {
    await runFetchJob({ db: env.DB, kv: env.KV, queue: env.JOBS, rules, sources, classifier, now }, msg);
  } else if (msg.type === 'maintenance') {
    await syncRetailers(env.DB, sources);
    await runMaintenance(env.DB, rules, now);
  } else if (msg.type === 'llm' && env.ANTHROPIC_API_KEY) {
    await llmMatchPending({ db: env.DB, model: env.CLAUDE_MATCH_MODEL, client: createAnthropicClient(env.ANTHROPIC_API_KEY), now });
  }
}

const handler = {
  fetch: app.fetch,
  async scheduled(controller, env, ctx) {
    await dispatch({ db: env.DB, queue: env.JOBS, rules, sources, now: new Date(controller.scheduledTime), llmEnabled: Boolean(env.ANTHROPIC_API_KEY) });
    // Safety net for alerts: event-driven notifications every 15 min; exact times come from the alarm.
    ctx.waitUntil(env.ALARMS.get(env.ALARMS.idFromName('owner_1')).tick().then(() => undefined));
  },
  async queue(batch, env) {
    // Batch size is 1 (wrangler.jsonc), so each job gets the invocation's whole CPU budget.
    for (const message of batch.messages) {
      await handleJob(message.body as JobMessage, env);
      message.ack();
    }
  },
} satisfies ExportedHandler<Env>;

// Errors go to Sentry when SENTRY_DSN is set; without it the wrapper does nothing.
export default Sentry.withSentry(sentryOptions, handler);
