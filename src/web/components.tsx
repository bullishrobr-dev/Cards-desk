import { useState, type MouseEvent, type ReactNode } from 'react';
import type { Confidence, DeskScore, DropSummary, ShipFlag } from '../shared/api-types.ts';
import { cardDate, CONFIDENCE_LABEL, countdown, dateLabel, formatMoney, percentVsRrp, rrpLabel, showCountdown } from './format.ts';
import { Link, useNow } from './lib.tsx';

export const CATEGORY_LABEL: Record<string, string> = { football: 'Football', f1: 'F1', pokemon: 'Pokémon' };

export function ConfidenceBadge({ confidence }: { confidence: Confidence }) {
  return <span className={`badge conf-${confidence}`}>{CONFIDENCE_LABEL[confidence]}</span>;
}

export function ShipTag({ region, value, title }: { region: 'GI' | 'ES'; value: ShipFlag | boolean; title?: string }) {
  const v: ShipFlag = typeof value === 'boolean' ? (value ? 'yes' : 'no') : value;
  const word = v === 'yes' ? 'ships' : v === 'no' ? 'no' : 'unknown';
  return (
    <span className={`ship ship-${v}`} title={title ?? `${region === 'GI' ? 'Gibraltar' : 'Spain'}: ${word}`}>
      {region} {v === 'yes' ? '✓' : v === 'no' ? '✕' : '?'}
    </span>
  );
}

export function Countdown({ to }: { to: string }) {
  const now = useNow(1000);
  const target = new Date(to);
  return <span className="countdown">{target <= now ? 'Live now' : countdown(target, now)}</span>;
}

export function RrpNote({ ratio, tolerance, estimated }: { ratio: number | null; tolerance: number; estimated?: boolean }) {
  const label = rrpLabel(ratio, tolerance);
  if (!label || ratio === null) return null;
  return (
    <span className={`rrp rrp-${label.tone}`} title={estimated ? 'RRP estimated from the first prices shops listed' : undefined}>
      {label.text} · {percentVsRrp(ratio)}
      {estimated ? ' (est.)' : ''}
    </span>
  );
}

/** Score and label; a drop failing a hard gate is shown greyed with the reason. */
export function ScoreBadge({ desk }: { desk: DeskScore }) {
  const failed = desk.gates.find((g) => !g.pass);
  return (
    <span className={`score score-${desk.label.toLowerCase()}${desk.gated ? ' score-gated' : ''}`} title={failed ? failed.detail : desk.overridden ? `Your score (rules say ${desk.rawScore})` : undefined}>
      {desk.score} {desk.label}
      {desk.overridden ? ' ✎' : ''}
    </span>
  );
}

const BOX_WORD: Record<string, string> = { football: 'Football', f1: 'Formula 1', pokemon: 'Pokémon' };

/** The box photo, or a designed stand-in naming the category when no photo exists yet. */
export function DropImage({ drop, large }: { drop: Pick<DropSummary, 'imageUrl' | 'category' | 'name' | 'publisher'>; large?: boolean }) {
  const [failed, setFailed] = useState(false);
  if (drop.imageUrl && !failed) {
    return <img className="drop-img" src={drop.imageUrl} alt={drop.name} loading={large ? 'eager' : 'lazy'} decoding="async" referrerPolicy="no-referrer" onError={() => setFailed(true)} />;
  }
  return (
    <div className={`drop-ph ph-${drop.category}`} aria-hidden="true">
      <span className="ph-cat">{BOX_WORD[drop.category] ?? drop.category}</span>
      <span className="ph-note">No photo yet</span>
    </div>
  );
}

/** "Notify me": watching a drop is what turns on its alerts. Works from a card without opening it. */
export function NotifyButton({ releaseId, watched, compact }: { releaseId: string; watched: boolean; compact?: boolean }) {
  const [on, setOn] = useState(watched);
  const click = async (e: MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    const next = !on;
    setOn(next);
    const res = await fetch(`/api/watch/${encodeURIComponent(releaseId)}`, { method: next ? 'POST' : 'DELETE' });
    if (!res.ok) setOn(!next);
  };
  return (
    <button type="button" className={on ? 'notify on' : 'notify'} aria-pressed={on} onClick={click}>
      <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true">
        <path d="M12 3a6 6 0 0 0-6 6v3.6L4.3 15.4A1 1 0 0 0 5.2 17h13.6a1 1 0 0 0 .9-1.6L18 12.6V9a6 6 0 0 0-6-6Zm0 19a3 3 0 0 0 2.8-2H9.2A3 3 0 0 0 12 22Z" fill="currentColor" />
      </svg>
      {on ? (compact ? 'On' : 'Notifying') : 'Notify me'}
    </button>
  );
}

function CardWhen({ drop }: { drop: DropSummary }) {
  const now = useNow(1000);
  if (drop.status === 'live') return <div className="card-when hot">Live now</div>;
  if (showCountdown(drop.precision, drop.confidence) && drop.liveAt) {
    const at = new Date(drop.liveAt);
    if (at > now) return <div className="card-when hot">Drops in {countdown(at, now)}</div>;
  }
  return <div className="card-when">{cardDate(drop.startsAt, drop.precision)}</div>;
}

/** A drop as a release-calendar card: photo, when, name, the buying verdict, Notify me. */
export function DropCard({ drop }: { drop: DropSummary }) {
  const failed = drop.desk.gates.find((g) => !g.pass);
  const tag = drop.status === 'live' ? 'Live' : drop.preorder ? 'Pre-order' : null;
  return (
    <article className={drop.desk.gated ? 'dcard gated' : 'dcard'}>
      <Link to={`/drop/${drop.id}`} className="dcard-link">
        <div className="dcard-media">
          <DropImage drop={drop} />
          {tag ? <span className="media-tag">{tag}</span> : null}
          {drop.pinned ? <span className="media-pin" aria-label="Pinned">Pinned</span> : null}
          <span className={`media-score score-${drop.desk.label.toLowerCase()}`}>
            {drop.desk.score}
            <small>{drop.desk.label}</small>
          </span>
        </div>
        <CardWhen drop={drop} />
        <h3 className="dcard-title">{drop.name}</h3>
        <div className="dcard-meta">
          <span className={`cat cat-${drop.category}`}>{CATEGORY_LABEL[drop.category] ?? drop.category}</span>
          {drop.bestPrice ? (
            <span className="price">
              {drop.configurations.length > 1 ? 'from ' : ''}
              {formatMoney(drop.bestPrice)}
            </span>
          ) : (
            <span className="muted">{drop.shopCount ? 'No price yet' : 'No shop yet'}</span>
          )}
        </div>
        {failed ? <div className="dcard-verdict bad">{shortReason(failed.id, failed.detail)}</div> : drop.priceVsRrp !== null && drop.priceVsRrp <= 1.05 ? <div className="dcard-verdict ok">At RRP</div> : null}
      </Link>
      <div className="dcard-actions">
        <NotifyButton releaseId={drop.releaseId} watched={drop.watched} />
        {drop.shopCount ? (
          <span className="ships">
            <ShipTag region="GI" value={drop.shipsGi} />
            <ShipTag region="ES" value={drop.shipsEs} />
          </span>
        ) : null}
      </div>
    </article>
  );
}

/** One line on a card for a failed hard rule; the drop page has the full sentence. */
function shortReason(id: string, detail: string): string {
  if (id === 'price') return detail.replace(/^Above RRP — buy singles instead \(cheapest is (\d+)% over\)$/, 'Above RRP (+$1%) — buy singles');
  if (id === 'purchasable') return 'Does not ship to you';
  return 'Out of scope';
}

/** Topps-style switch between Dropping soon and Live now. */
export function ViewSwitch({ current }: { current: 'upcoming' | 'live' }) {
  return (
    <div className="switch" role="tablist" aria-label="Drops">
      <Link to="/" className={current === 'upcoming' ? 'switch-on' : ''}>
        Dropping soon
      </Link>
      <Link to="/live" className={current === 'live' ? 'switch-on' : ''}>
        Live now
      </Link>
    </div>
  );
}

export function Chips<T extends string>({ value, options, onChange, label }: { value: T; options: Array<{ id: T; label: string }>; onChange: (v: T) => void; label: string }) {
  return (
    <div className="chips" role="radiogroup" aria-label={label}>
      {options.map((o) => (
        <button key={o.id} type="button" role="radio" aria-checked={o.id === value} className={o.id === value ? 'chip on' : 'chip'} onClick={() => onChange(o.id)}>
          {o.label}
        </button>
      ))}
    </div>
  );
}

export function Notice({ tone, children }: { tone: 'info' | 'error'; children: ReactNode }) {
  return <div className={`notice notice-${tone}`}>{children}</div>;
}

export function Empty({ children }: { children: ReactNode }) {
  return <p className="empty">{children}</p>;
}
