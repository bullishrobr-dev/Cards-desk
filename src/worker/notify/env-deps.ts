import type { RulesConfig } from '../../shared/config/schema.ts';
import type { EngineDeps } from './engine.ts';

const DEFAULT_FROM = 'Card Desk Drops <onboarding@resend.dev>';

/** Builds engine dependencies from the Worker environment. Missing secrets disable a channel. */
export function engineDepsFromEnv(env: Env, rules: RulesConfig, now: Date, ownerId = 'owner_1'): EngineDeps {
  return {
    db: env.DB,
    rules,
    ownerId,
    now,
    appUrl: (env.APP_URL ?? '').replace(/\/$/, ''),
    vapid: env.VAPID_PUBLIC_KEY && env.VAPID_PRIVATE_KEY && env.VAPID_SUBJECT ? { subject: env.VAPID_SUBJECT, publicKey: env.VAPID_PUBLIC_KEY, privateKey: env.VAPID_PRIVATE_KEY } : null,
    email: env.RESEND_API_KEY && env.ALERT_EMAIL ? { apiKey: env.RESEND_API_KEY, to: env.ALERT_EMAIL, from: env.RESEND_FROM ?? DEFAULT_FROM } : null,
  };
}

/** Constant-time comparison for path tokens. */
export function tokenMatches(given: string | undefined, expected: string | undefined): boolean {
  if (!given || !expected || given.length !== expected.length) return false;
  let diff = 0;
  for (let i = 0; i < given.length; i++) diff |= given.charCodeAt(i) ^ expected.charCodeAt(i);
  return diff === 0;
}
