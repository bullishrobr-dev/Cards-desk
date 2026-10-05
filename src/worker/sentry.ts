/** Sentry options shared by the Worker and the Durable Object. No DSN, no Sentry (and no PII by default). */
export function sentryOptions(env: Env) {
  return { dsn: env.SENTRY_DSN ?? '', enabled: Boolean(env.SENTRY_DSN), environment: env.APP_ENV, tracesSampleRate: 0 };
}
