import type { ReactNode } from 'react';
import type { Confidence, DeskScore, DropSummary, ShipFlag } from '../shared/api-types.ts';
import { CONFIDENCE_LABEL, countdown, dateLabel, formatMoney, percentVsRrp, rrpLabel, showCountdown } from './format.ts';
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

export function DropRow({ drop, tolerance }: { drop: DropSummary; tolerance: number }) {
  const failed = drop.desk.gates.find((g) => !g.pass);
  return (
    <Link to={`/drop/${drop.id}`} className={drop.desk.gated ? 'drop-row gated' : 'drop-row'}>
      <div className="drop-main">
        <div className="drop-name">
          {drop.pinned ? <span className="pin" aria-label="Pinned">📌 </span> : null}
          {drop.watched ? <span className="star" aria-label="Watching">★ </span> : null}
          {drop.name}
        </div>
        <div className="drop-meta">
          <span className={`cat cat-${drop.category}`}>{CATEGORY_LABEL[drop.category] ?? drop.category}</span>
          {showCountdown(drop.precision, drop.confidence) && drop.liveAt ? <Countdown to={drop.liveAt} /> : <span>{dateLabel(drop.startsAt, drop.precision)}</span>}
          <ConfidenceBadge confidence={drop.confidence} />
          <ScoreBadge desk={drop.desk} />
        </div>
        {failed ? <div className="small gate-note">{failed.detail}</div> : null}
      </div>
      <div className="drop-side">
        {drop.bestPrice ? (
          <div className="price">
            {drop.configurations.length > 1 ? <span className="muted small">from </span> : null}
            {formatMoney(drop.bestPrice)}
          </div>
        ) : (
          <div className="muted small">{drop.shopCount ? 'No price' : 'No shop yet'}</div>
        )}
        <div className="ships">
          <ShipTag region="GI" value={drop.shopCount ? drop.shipsGi : 'unknown'} />
          <ShipTag region="ES" value={drop.shopCount ? drop.shipsEs : 'unknown'} />
        </div>
        {/* A failed gate already explains itself; a second RRP note for another box type would contradict it. */}
        {failed ? null : <RrpNote ratio={drop.priceVsRrp} tolerance={tolerance} />}
      </div>
    </Link>
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
