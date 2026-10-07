import { Link } from '../lib.tsx';

const HIGHLIGHTS: Array<{ label: string; to: string }> = (import.meta.env.VITE_DEMO_HIGHLIGHTS ? JSON.parse(import.meta.env.VITE_DEMO_HIGHLIGHTS) : []) as Array<{ label: string; to: string }>;

/** Demo build only: says what this is, and links the parts worth a look. */
export function DemoBanner() {
  return (
    <div className="demo-banner">
      <strong>Demo</strong> · real calendars, shops and Cardmarket prices captured on {import.meta.env.VITE_DEMO_DATE ?? 'the build date'}. The watchlist, the pin and the two alerts are examples. Watch, pin and the notification switches work here but are not saved; push notifications need the deployed app.
      {HIGHLIGHTS.length ? (
        <div className="demo-links">
          {HIGHLIGHTS.map((h) => (
            <Link key={h.to} to={h.to} className="chip">
              {h.label}
            </Link>
          ))}
        </div>
      ) : null}
    </div>
  );
}
