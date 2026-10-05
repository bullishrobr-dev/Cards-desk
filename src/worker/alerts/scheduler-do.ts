import { DurableObject } from 'cloudflare:workers';
import { rules } from '../../shared/config/index.ts';
import { runNotificationPass } from '../notify/engine.ts';
import { engineDepsFromEnv } from '../notify/env-deps.ts';

/**
 * One per owner. Runs the notification pass when poked (every cron tick, after a watch change,
 * or for a test push) and sets its own alarm for the next exact moment that matters: the next
 * lead-time alert, or the receipt deadline of a critical push. A 15-minute cron is too coarse
 * for "T-10m"; an alarm is not.
 */
export class AlertScheduler extends DurableObject<Env> {
  async tick(extra?: { title: string; body: string; url: string; critical: boolean }): Promise<{ created: number; pushed: number; emailed: number }> {
    const deps = engineDepsFromEnv(this.env, rules, new Date());
    const result = await runNotificationPass(deps, extra ? [{ dedupeKey: `test:${Date.now()}`, trigger: extra.critical ? 'test_critical' : 'test', title: extra.title, body: extra.body, url: extra.url, eventId: null }] : []);
    const current = await this.ctx.storage.getAlarm();
    if (result.nextAt && (!current || result.nextAt.getTime() < current || current < Date.now())) {
      await this.ctx.storage.setAlarm(result.nextAt.getTime());
    }
    return { created: result.created, pushed: result.pushed, emailed: result.emailed };
  }

  override async alarm(): Promise<void> {
    await this.tick();
  }
}
