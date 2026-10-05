import { DurableObject } from 'cloudflare:workers';

/** Fires exact-time alerts. Filled in with the notifications work. */
export class AlertScheduler extends DurableObject<Env> {
  override async alarm(): Promise<void> {}
}
