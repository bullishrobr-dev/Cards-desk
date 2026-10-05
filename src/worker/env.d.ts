// Secrets set with `wrangler secret put` (and .dev.vars locally). Optional so a missing secret
// degrades one feature loudly instead of failing type checks or the whole Worker.
interface Env {
  ACCESS_TEAM_DOMAIN?: string;
  ACCESS_AUD?: string;
  VAPID_PUBLIC_KEY?: string;
  VAPID_PRIVATE_KEY?: string;
  VAPID_SUBJECT?: string;
  RESEND_API_KEY?: string;
  ALERT_EMAIL?: string;
  SENTRY_DSN?: string;
  ANTHROPIC_API_KEY?: string;
  RECEIPT_TOKEN?: string;
  ICAL_TOKEN?: string;
  /** Resend sender; defaults to onboarding@resend.dev, which only delivers to the Resend account's own address. */
  RESEND_FROM?: string;
}
