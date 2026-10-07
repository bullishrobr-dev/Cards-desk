import { useState, type FormEvent } from 'react';
import type { DropDetail, ProductView } from '../shared/api-types.ts';
import { ScoreBadge } from './components.tsx';

async function send(method: string, url: string, body?: unknown): Promise<string | null> {
  const res = await fetch(url, { method, headers: { 'content-type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) });
  if (res.ok) return null;
  const j = (await res.json().catch(() => ({}))) as { error?: string };
  return j.error ?? `The server answered ${res.status}.`;
}

/** The Desk Score explained: the three gates, every point, and your tags and override. */
export function DeskPanel({ drop, onChange }: { drop: DropDetail; onChange: () => void }) {
  const { desk } = drop;
  const [tag, setTag] = useState('');
  const [score, setScore] = useState(desk.overridden ? String(desk.score) : '');
  const [note, setNote] = useState(desk.overrideNote ?? '');
  const [error, setError] = useState<string | null>(null);
  const rel = `/api/releases/${encodeURIComponent(drop.releaseId)}`;
  const run = async (p: Promise<string | null>) => {
    const e = await p;
    setError(e);
    if (!e) onChange();
  };
  const addTag = (e: FormEvent) => {
    e.preventDefault();
    if (!tag.trim()) return;
    run(send('POST', `${rel}/tags`, { tag })).then(() => setTag(''));
  };
  const saveOverride = (e: FormEvent) => {
    e.preventDefault();
    run(send('PUT', `${rel}/override`, { score: Number(score), note }));
  };
  return (
    <div className="desk">
      <h2>Desk Score</h2>
      <div className="desk-head">
        <ScoreBadge desk={desk} />
        {desk.overridden ? <span className="small muted">Your score. The rules say {desk.rawScore}.</span> : null}
        {desk.gated ? <span className="small gate-note">Greyed out: it fails a hard rule and only alerts if you watch it.</span> : null}
      </div>
      <ul className="gates">
        {desk.gates.map((g) => (
          <li key={g.id} className={!g.pass ? 'gate fail' : g.flagged ? 'gate flag' : 'gate pass'}>
            <span aria-hidden="true">{!g.pass ? '✕' : g.flagged ? '?' : '✓'}</span> <strong>{g.label}:</strong> {g.detail}
          </li>
        ))}
      </ul>
      <table className="table breakdown">
        <tbody>
          {desk.breakdown.map((b) => (
            <tr key={b.id}>
              <td>{b.label}</td>
              <td className="pts">
                {b.points}/{b.max}
              </td>
              <td className="small muted">{b.reason}</td>
            </tr>
          ))}
        </tbody>
      </table>

      <h3>Your tags</h3>
      <p className="small muted">Tag a chase card, player or set you care about. Any tag gives full relevance points.</p>
      <div className="chips">
        {drop.tags.map((t) => (
          <button key={t} type="button" className="chip on" title="Remove tag" onClick={() => run(send('DELETE', `${rel}/tags?tag=${encodeURIComponent(t)}`))}>
            {t} ✕
          </button>
        ))}
      </div>
      <form className="inline-form" onSubmit={addTag}>
        <input value={tag} onChange={(e) => setTag(e.target.value)} maxLength={60} placeholder="e.g. Bearman rookie auto" aria-label="New tag" />
        <button type="submit" className="btn">Add tag</button>
      </form>

      <h3>Override the score</h3>
      <form className="inline-form" onSubmit={saveOverride}>
        <input type="number" min={0} max={100} step={1} value={score} onChange={(e) => setScore(e.target.value)} placeholder="0–100" aria-label="Your score" className="num" />
        <input value={note} onChange={(e) => setNote(e.target.value)} maxLength={200} placeholder="Why (optional)" aria-label="Note" />
        <button type="submit" className="btn" disabled={score === ''}>Save</button>
        {desk.overridden ? (
          <button type="button" className="btn" onClick={() => run(send('DELETE', `${rel}/override`)).then(() => setScore(''))}>
            Use the rules
          </button>
        ) : null}
      </form>
      {error ? <p className="small error-text">{error}</p> : null}
    </div>
  );
}

/** Set your own RRP for a box type when the rules have none or the estimate looks wrong. */
export function RrpEditor({ product, onChange }: { product: ProductView; onChange: () => void }) {
  const [open, setOpen] = useState(false);
  const [amount, setAmount] = useState('');
  const [currency, setCurrency] = useState<'GBP' | 'EUR' | 'USD'>('GBP');
  const [error, setError] = useState<string | null>(null);
  const url = `/api/products/${encodeURIComponent(product.id)}/rrp`;
  const save = async (e: FormEvent) => {
    e.preventDefault();
    const minor = Math.round(Number(amount) * 100);
    const err = await send('PUT', url, { minor, currency });
    setError(err);
    if (!err) {
      setOpen(false);
      onChange();
    }
  };
  if (!open) {
    return (
      <div className="small">
        <button type="button" className="link-btn" onClick={() => setOpen(true)}>
          {product.rrp?.source === 'owner' ? 'Change your RRP' : 'Set your own RRP'}
        </button>
        {product.rrp?.source === 'owner' ? (
          <>
            {' · '}
            <button type="button" className="link-btn" onClick={() => send('DELETE', url).then(onChange)}>
              Use the default
            </button>
          </>
        ) : null}
      </div>
    );
  }
  return (
    <form className="inline-form" onSubmit={save}>
      <select value={currency} onChange={(e) => setCurrency(e.target.value as typeof currency)} aria-label="Currency">
        <option value="GBP">£</option>
        <option value="EUR">€</option>
        <option value="USD">$</option>
      </select>
      <input type="number" min={0.01} step={0.01} value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="RRP" aria-label="RRP" className="num" />
      <button type="submit" className="btn" disabled={!(Number(amount) > 0)}>Save</button>
      <button type="button" className="btn" onClick={() => setOpen(false)}>Cancel</button>
      {error ? <span className="small error-text">{error}</span> : null}
    </form>
  );
}
