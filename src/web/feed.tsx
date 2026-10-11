import { useEffect, useMemo, useState, type ReactNode } from 'react';
import type { DropSummary } from '../shared/api-types.ts';
import { CATEGORY_LABEL, DropCard, DropImage, NotifyButton, StockTag } from './components.tsx';
export { DateStamp } from './components.tsx';
import { cardDate, countdown, formatMoney, showCountdown, TZ, weekStart } from './format.ts';
import { Link, useNow } from './lib.tsx';

const MONTH = new Intl.DateTimeFormat('en-GB', { timeZone: 'UTC', month: 'short' });

/**
 * The one drop to show first, from the soonest dated drops that pass your rules and are not sold
 * out: one you watch, else one scoring Watch or better, else the soonest with a photo.
 */
export function pickHero(drops: DropSummary[]): DropSummary | null {
  const ok = drops.filter((d) => d.startsAt && d.precision !== 'month' && !d.desk.gated && d.stock !== 'sold_out');
  return ok.find((d) => d.watched) ?? ok.find((d) => d.desk.label !== 'Ignore') ?? ok.find((d) => d.imageUrl) ?? null;
}

export function HeroDrop({ drop }: { drop: DropSummary }) {
  const now = useNow(1000);
  const at = drop.liveAt ? new Date(drop.liveAt) : null;
  const counting = showCountdown(drop.precision, drop.confidence) && at && at > now;
  return (
    <article className="hero">
      <Link to={`/drop/${drop.id}`} className="hero-link">
        <div className="hero-media">
          <DropImage drop={drop} large />
          <StockTag drop={drop} />
        </div>
        <div className="hero-body">
          <span className="eyebrow">{drop.watched ? 'Next on your watchlist' : drop.desk.label !== 'Ignore' ? 'Next drop worth a look' : 'Next drop'}</span>
          <h2 className="hero-title">{drop.name}</h2>
          <div className={counting ? 'hero-when hot' : 'hero-when'}>{counting && at ? `Drops in ${countdown(at, now)}` : cardDate(drop.startsAt, drop.precision)}</div>
          <div className="hero-facts">
            <span className={`cat cat-${drop.category}`}>{CATEGORY_LABEL[drop.category] ?? drop.category}</span>
            <span className={`score-pill score-${drop.desk.label.toLowerCase()}`}>
              {drop.desk.score} {drop.desk.label}
            </span>
            {drop.bestPrice ? <span className="price">from {formatMoney(drop.bestPrice)}</span> : null}
          </div>
        </div>
      </Link>
      <div className="hero-actions">
        <NotifyButton releaseId={drop.releaseId} watched={drop.watched} />
      </div>
    </article>
  );
}

export interface WeekGroup {
  key: string;
  title: string;
  /** "This week", "Next week", or null. */
  relative: string | null;
  items: DropSummary[];
}

const monthFmt = new Intl.DateTimeFormat('en-GB', { timeZone: 'UTC', month: 'long', year: 'numeric' });
const shortDay = new Intl.DateTimeFormat('en-GB', { timeZone: 'UTC', day: 'numeric', month: 'short' });

export function groupByWeek(drops: DropSummary[], weekRange: (k: string) => string, now = new Date()): WeekGroup[] {
  const thisWeek = weekStart(new Intl.DateTimeFormat('en-CA', { timeZone: TZ }).format(now));
  const nextWeek = new Date(Date.parse(`${thisWeek}T12:00:00Z`) + 7 * 86_400_000).toISOString().slice(0, 10);
  const groups = new Map<string, DropSummary[]>();
  for (const d of drops) {
    // Month-level dates get a month heading: filing them under a week would claim false precision.
    const key = !d.startsAt ? 'tbd' : d.precision === 'month' ? `month:${d.startsAt.slice(0, 7)}` : weekStart(d.startsAt);
    groups.set(key, [...(groups.get(key) ?? []), d]);
  }
  return [...groups.entries()].map(([key, items]) => ({
    key,
    title: key === 'tbd' ? 'Date to be confirmed' : key.startsWith('month:') ? `Sometime in ${monthFmt.format(new Date(`${key.slice(6)}-15T12:00:00Z`))}` : weekRange(key),
    relative: key === thisWeek ? 'This week' : key === nextWeek ? 'Next week' : null,
    items,
  }));
}

/** A row of week chips: tap to jump; the chip shows a dot when the week has a Priority drop. */
export function WeekStrip({ groups }: { groups: WeekGroup[] }) {
  if (groups.length < 3) return null;
  const jump = (key: string) => document.getElementById(`week-${key}`)?.scrollIntoView({ behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth', block: 'start' });
  return (
    <nav className="week-strip" aria-label="Jump to week">
      {groups.map((g) => (
        <button key={g.key} type="button" className="week-chip" onClick={() => jump(g.key)}>
          <span>{g.relative ?? (g.key === 'tbd' ? 'TBC' : g.key.startsWith('month:') ? MONTH.format(new Date(`${g.key.slice(6)}-15T12:00:00Z`)) : shortDay.format(new Date(`${g.key}T12:00:00Z`)))}</span>
          <small>
            {g.items.length}
            {g.items.some((d) => d.desk.label === 'Priority' && !d.desk.gated) ? <i className="dot-priority" aria-label="has a Priority drop" /> : null}
          </small>
        </button>
      ))}
    </nav>
  );
}

/** One week: a sticky heading with its count, then the cards. */
export function WeekSection({ group }: { group: WeekGroup }) {
  return (
    <section className="group" id={`week-${group.key}`}>
      <header className="week-head">
        <h2 className="range">
          {group.relative ? <span className="rel">{group.relative}</span> : null}
          {group.title}
        </h2>
        <span className="week-count">
          {group.items.length} drop{group.items.length === 1 ? '' : 's'}
        </span>
      </header>
      <div className="grid">{group.items.map((d) => <DropCard key={d.id} drop={d} />)}</div>
    </section>
  );
}

/** A sheet that rises from the bottom; closes on the backdrop, Escape or Done. */
export function Sheet({ open, title, onClose, children }: { open: boolean; title: string; onClose: () => void; children: ReactNode }) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);
  if (!open) return null;
  return (
    <div className="sheet-wrap" role="dialog" aria-modal="true" aria-label={title}>
      <button type="button" className="sheet-backdrop" aria-label="Close" onClick={onClose} />
      <div className="sheet">
        <div className="sheet-grip" aria-hidden="true" />
        <div className="sheet-head">
          <h3>{title}</h3>
          <button type="button" className="btn primary" onClick={onClose}>
            Done
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}

/** Grey shapes in the exact card geometry while the first load is under way. */
export function SkeletonGrid({ count = 4 }: { count?: number }) {
  const [show, setShow] = useState(false);
  useEffect(() => {
    const id = window.setTimeout(() => setShow(true), 300); // only for waits long enough to notice
    return () => window.clearTimeout(id);
  }, []);
  const cells = useMemo(() => Array.from({ length: count }, (_, i) => i), [count]);
  if (!show) return null;
  return (
    <div className="grid" aria-busy="true" aria-label="Loading">
      {cells.map((i) => (
        <div key={i} className="skel">
          <div className="skel-media" />
          <div className="skel-line w40" />
          <div className="skel-line w90" />
          <div className="skel-line w70" />
        </div>
      ))}
    </div>
  );
}
