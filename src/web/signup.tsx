import { useEffect, useState } from 'react';
import type { DropDetail } from '../shared/api-types.ts';
import { formatStamp } from './format.ts';

const dateOnly = new Intl.DateTimeFormat('en-GB', { timeZone: 'UTC', day: 'numeric', month: 'short', year: 'numeric' });

/**
 * Where to get on the list for a drop (official pages only), whether you have, and your notes:
 * which email, raffle number, when the window opens.
 */
export function SignupPanel({ drop, onChange }: { drop: DropDetail; onChange: () => void }) {
  const [note, setNote] = useState(drop.note ?? '');
  const [signedUp, setSignedUp] = useState(Boolean(drop.signedUpAt));
  const [state, setState] = useState<'idle' | 'saving' | 'saved' | string>('idle');
  useEffect(() => {
    setNote(drop.note ?? '');
    setSignedUp(Boolean(drop.signedUpAt));
  }, [drop.note, drop.signedUpAt]);
  const put = async (body: Record<string, unknown>) => {
    setState('saving');
    const res = await fetch(`/api/releases/${encodeURIComponent(drop.releaseId)}/note`, { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
    const j = (await res.json().catch(() => ({}))) as { error?: string };
    setState(res.ok ? 'saved' : (j.error ?? `The server answered ${res.status}.`));
    if (res.ok) onChange();
    return res.ok;
  };
  const toggle = async () => {
    const next = !signedUp;
    setSignedUp(next);
    if (!(await put({ signedUp: next }))) setSignedUp(!next);
  };
  return (
    <section className="signup">
      <h2>Get on the list</h2>
      {drop.officialSignups.length ? (
        drop.officialSignups.map((o) => (
          <a key={o.url} className="signup-link" href={o.url} target="_blank" rel="noopener noreferrer">
            <span className="signup-label">{o.label} ↗</span>
            <span className="small">{o.how}</span>
            <span className="small muted">Official page · checked {dateOnly.format(new Date(`${o.verifiedAt}T12:00:00Z`))}</span>
          </a>
        ))
      ) : (
        <p className="small muted">No official sign-up page is known for this publisher yet. Shops below may offer an email alert on the product page.</p>
      )}
      <label className="toggle signed">
        <input type="checkbox" checked={signedUp} onChange={toggle} />
        <span>
          <strong>I've signed up</strong>
          {signedUp && drop.signedUpAt ? <span className="small muted"> · since {formatStamp(drop.signedUpAt)}</span> : null}
        </span>
      </label>
      <form
        className="note-form"
        onSubmit={(e) => {
          e.preventDefault();
          put({ note: note.trim() ? note : null });
        }}
      >
        <label htmlFor="drop-note" className="small muted">
          Your notes
        </label>
        <textarea id="drop-note" rows={3} maxLength={2000} value={note} onChange={(e) => (setNote(e.target.value), setState('idle'))} placeholder="Which email you used, raffle number, when the pre-order window opens…" />
        <div className="note-actions">
          <button type="submit" className="btn" disabled={state === 'saving' || note === (drop.note ?? '')}>
            Save note
          </button>
          {state === 'saved' ? <span className="small ok-text">Saved</span> : state !== 'idle' && state !== 'saving' ? <span className="small error-text">{state}</span> : null}
        </div>
      </form>
    </section>
  );
}
