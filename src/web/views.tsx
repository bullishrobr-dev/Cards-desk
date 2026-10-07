import { useEffect, useMemo, useState } from 'react';
import type { DropDetail, DropSummary, ListingView, NotificationItem, SectorSignals, SourceHealth, WeeklyBrief } from '../shared/api-types.ts';
import { CATEGORY_LABEL, Chips, ConfidenceBadge, Countdown, DropRow, Empty, Notice, RrpNote, ScoreBadge, ShipTag } from './components.tsx';
import { DeskPanel, RrpEditor } from './desk.tsx';
import { dateLabel, formatMinor as formatMinorText, formatMoney, formatStamp, relativeFromNow, showCountdown, TZ, weekStart } from './format.ts';
import { Link, navigate, useApi } from './lib.tsx';
import { pushState, setBadge, turnOnPush, type PushState } from './push.ts';

export interface AppConfig {
  timezone: string;
  categories: Array<{ id: string; label: string }>;
  rules: { rrp: { tolerance: number } } & Record<string, unknown>;
}

type Region = 'any' | 'gi' | 'es';
type LabelFilter = 'all' | 'watch' | 'priority';
const LABEL_QUERY: Record<LabelFilter, string | null> = { all: null, watch: 'Priority,Watch', priority: 'Priority' };

function useFilters() {
  const params = new URLSearchParams(window.location.search);
  const [category, setCategory] = useState(params.get('category') ?? 'all');
  const [region, setRegion] = useState<Region>((params.get('region') as Region) ?? 'any');
  const [label, setLabel] = useState<LabelFilter>((params.get('rank') as LabelFilter) ?? 'all');
  const query = new URLSearchParams();
  if (category !== 'all') query.set('category', category);
  if (region !== 'any') query.set('region', region);
  const labels = LABEL_QUERY[label];
  if (labels) query.set('label', labels);
  return { category, setCategory, region, setRegion, label, setLabel, query: query.toString() };
}

function Filters({ config, f }: { config: AppConfig; f: ReturnType<typeof useFilters> }) {
  return (
    <div className="filters">
      <Chips label="Category" value={f.category} onChange={f.setCategory} options={[{ id: 'all', label: 'All' }, ...config.categories.map((c) => ({ id: c.id, label: CATEGORY_LABEL[c.id] ?? c.label }))]} />
      <Chips<Region> label="Ships to" value={f.region} onChange={f.setRegion} options={[{ id: 'any', label: 'Any' }, { id: 'gi', label: 'Gibraltar' }, { id: 'es', label: 'Spain' }]} />
      <Chips<LabelFilter> label="Desk Score" value={f.label} onChange={f.setLabel} options={[{ id: 'all', label: 'Everything' }, { id: 'watch', label: 'Watch and up' }, { id: 'priority', label: 'Priority only' }]} />
    </div>
  );
}

const groupFmt = new Intl.DateTimeFormat('en-GB', { timeZone: 'UTC', day: 'numeric', month: 'short' });
const monthFmt = new Intl.DateTimeFormat('en-GB', { timeZone: 'UTC', month: 'long', year: 'numeric' });

function groupByWeek(drops: DropSummary[]) {
  const groups = new Map<string, DropSummary[]>();
  for (const d of drops) {
    // Month-level dates get a month heading: filing them under a week would claim false precision.
    const key = !d.startsAt ? 'tbd' : d.precision === 'month' ? `month:${d.startsAt.slice(0, 7)}` : weekStart(d.startsAt);
    groups.set(key, [...(groups.get(key) ?? []), d]);
  }
  return [...groups.entries()].map(([key, items]) => ({
    key,
    title:
      key === 'tbd'
        ? 'Date to be confirmed'
        : key.startsWith('month:')
          ? `Sometime in ${monthFmt.format(new Date(`${key.slice(6)}-15T12:00:00Z`))}`
          : `Week of ${groupFmt.format(new Date(`${key}T12:00:00Z`))}`,
    items,
  }));
}

function Calendar({ drops }: { drops: DropSummary[] }) {
  const [offset, setOffset] = useState(0);
  const today = new Date();
  const first = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth() + offset, 1));
  const days = new Date(Date.UTC(first.getUTCFullYear(), first.getUTCMonth() + 1, 0)).getUTCDate();
  const lead = (first.getUTCDay() + 6) % 7;
  const byDay = new Map<string, DropSummary[]>();
  for (const d of drops) if (d.startsAt && (d.precision === 'day' || d.precision === 'time')) byDay.set(d.startsAt.slice(0, 10), [...(byDay.get(d.startsAt.slice(0, 10)) ?? []), d]);
  const monthName = new Intl.DateTimeFormat('en-GB', { timeZone: 'UTC', month: 'long', year: 'numeric' }).format(first);
  const todayKey = new Intl.DateTimeFormat('en-CA', { timeZone: TZ }).format(today);
  return (
    <div className="calendar">
      <div className="cal-head">
        <button type="button" className="chip" onClick={() => setOffset(offset - 1)} aria-label="Previous month">‹</button>
        <strong>{monthName}</strong>
        <button type="button" className="chip" onClick={() => setOffset(offset + 1)} aria-label="Next month">›</button>
      </div>
      <div className="cal-grid">
        {['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].map((d) => (
          <div key={d} className="cal-dow">{d}</div>
        ))}
        {Array.from({ length: lead }, (_, i) => <div key={`l${i}`} />)}
        {Array.from({ length: days }, (_, i) => {
          const key = `${first.toISOString().slice(0, 8)}${String(i + 1).padStart(2, '0')}`;
          const items = byDay.get(key) ?? [];
          return (
            <div key={key} className={`cal-day${key === todayKey ? ' today' : ''}${items.length ? ' has' : ''}`}>
              <span className="cal-num">{i + 1}</span>
              {items.slice(0, 3).map((d) => (
                <Link key={d.id} to={`/drop/${d.id}`} className={`cal-item cat-${d.category}`}>{d.name}</Link>
              ))}
              {items.length > 3 ? <span className="small muted">+{items.length - 3}</span> : null}
            </div>
          );
        })}
      </div>
      <p className="small muted">Only drops with a confirmed day appear on the calendar. Month-level and unconfirmed dates are in the list.</p>
    </div>
  );
}

export function UpcomingView({ config }: { config: AppConfig }) {
  const f = useFilters();
  const [mode, setMode] = useState<'list' | 'calendar'>('list');
  const { data, error, loading } = useApi<DropSummary[]>(`/api/drops?view=upcoming${f.query ? `&${f.query}` : ''}`);
  const groups = useMemo(() => groupByWeek(data ?? []), [data]);
  return (
    <section>
      <div className="view-head">
        <h1>Upcoming</h1>
        <Link to="/brief" className="chip">Weekly brief</Link>
        <Chips<'list' | 'calendar'> label="View" value={mode} onChange={setMode} options={[{ id: 'list', label: 'List' }, { id: 'calendar', label: 'Calendar' }]} />
      </div>
      <Filters config={config} f={f} />
      {error ? <Notice tone="error">{error}</Notice> : null}
      {loading && !data ? <Empty>Loading…</Empty> : null}
      {data && data.length === 0 ? <Empty>Nothing upcoming matches these filters.</Empty> : null}
      {data && mode === 'calendar' ? <Calendar drops={data} /> : null}
      {data && mode === 'list'
        ? groups.map((g) => (
            <div key={g.key} className="group">
              <h2>{g.title}</h2>
              {g.items.map((d) => <DropRow key={d.id} drop={d} tolerance={config.rules.rrp.tolerance} />)}
            </div>
          ))
        : null}
    </section>
  );
}

export function LiveView({ config }: { config: AppConfig }) {
  const f = useFilters();
  const { data, error } = useApi<DropSummary[]>(`/api/drops?view=live${f.query ? `&${f.query}` : ''}`);
  return (
    <section>
      <div className="view-head">
        <h1>Live now</h1>
        <Link to="/signals" className="chip">Market signals</Link>
      </div>
      <Filters config={config} f={f} />
      {error ? <Notice tone="error">{error}</Notice> : null}
      {data && data.length === 0 ? <Empty>Nothing is live right now.</Empty> : null}
      {data?.map((d) => <DropRow key={d.id} drop={d} tolerance={config.rules.rrp.tolerance} />)}
    </section>
  );
}

const briefDay = new Intl.DateTimeFormat('en-GB', { timeZone: 'UTC', weekday: 'short', day: 'numeric', month: 'short' });

export function BriefView({ config }: { config: AppConfig }) {
  const { data, error } = useApi<WeeklyBrief>('/api/brief');
  const day = (ymd: string) => briefDay.format(new Date(`${ymd}T12:00:00Z`));
  const open = data?.drops.filter((d) => !d.desk.gated) ?? [];
  const gated = data?.drops.filter((d) => d.desk.gated) ?? [];
  return (
    <section>
      <div className="view-head">
        <h1>Weekly brief</h1>
      </div>
      {error ? <Notice tone="error">{error}</Notice> : null}
      {data ? (
        <p className="small muted">
          {day(data.from)} to {day(data.to)}, ranked by Desk Score. {data.priority} Priority, {data.watch} Watch. A push arrives every Sunday at 18:00.
        </p>
      ) : null}
      {data && data.drops.length === 0 ? <Empty>Nothing has a confirmed day in the next two weeks.</Empty> : null}
      {open.map((d) => <DropRow key={d.id} drop={d} tolerance={config.rules.rrp.tolerance} />)}
      {gated.length ? <h2>Failing a hard rule</h2> : null}
      {gated.map((d) => <DropRow key={d.id} drop={d} tolerance={config.rules.rrp.tolerance} />)}
    </section>
  );
}

const signedPct = (ratio: number) => {
  const p = Math.round((ratio - 1) * 100);
  return `${p > 0 ? '+' : ''}${p}%`;
};

/** "Trend +12% over 30 days" from the oldest to the newest point. */
function trendChange(history: Array<{ date: string; trendMinor: number | null }>): string {
  const pts = history.filter((h) => h.trendMinor !== null);
  const first = pts[0];
  const last = pts[pts.length - 1];
  if (!first || !last || first === last || !first.trendMinor || !last.trendMinor) return '';
  const days = Math.round((Date.parse(last.date) - Date.parse(first.date)) / 86_400_000);
  return `Trend ${signedPct(last.trendMinor / first.trendMinor)} over ${days} day${days === 1 ? '' : 's'}`;
}

const KIND_LABEL: Record<SectorSignals['moves'][number]['kind'], string> = { sold_out: 'Sold out', restock: 'Restock', price_up: 'Price up', price_down: 'Price down' };

function hoursLabel(h: number | null): string {
  if (h === null) return '—';
  return h < 48 ? `${Math.round(h)} h` : `${Math.round(h / 24)} days`;
}

/** Sell-out speed, prices against RRP and recent moves, from what the shops have shown us. */
export function SignalsView() {
  const [days, setDays] = useState<'7' | '30' | '90'>('30');
  const { data, error } = useApi<SectorSignals>(`/api/signals?days=${days}`);
  return (
    <section>
      <div className="view-head">
        <h1>Market signals</h1>
        <Chips<'7' | '30' | '90'> label="Window" value={days} onChange={setDays} options={[{ id: '7', label: '7 days' }, { id: '30', label: '30 days' }, { id: '90', label: '90 days' }]} />
      </div>
      <p className="small muted">From the shops this app watches: stock changes and price changes since each box was first seen. Shop asking prices, not sold prices.</p>
      {error ? <Notice tone="error">{error}</Notice> : null}
      {data ? (
        <table className="table signals">
          <thead>
            <tr>
              <th />
              <th>Sell-outs</th>
              <th>Typical time to sell out</th>
              <th>Typical price vs RRP</th>
            </tr>
          </thead>
          <tbody>
            {data.categories.map((c) => (
              <tr key={c.category}>
                <td>{CATEGORY_LABEL[c.category] ?? c.label}</td>
                <td>{c.soldOut}</td>
                <td>{hoursLabel(c.medianHoursToSellOut)}</td>
                <td>
                  {c.medianRatio === null ? '—' : signedPct(c.medianRatio)}
                  {c.aboveTolerance !== null ? <div className="small muted">{Math.round(c.aboveTolerance * 100)}% of {c.pricedListings} above RRP</div> : null}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : null}
      <h2>Recent moves</h2>
      {data && data.moves.length === 0 ? <Empty>No sell-outs, restocks or price moves of 10% or more in this window.</Empty> : null}
      {data?.moves.map((m, i) => {
        const body = (
          <>
            <div className="small muted">
              {formatStamp(m.at)} · {m.retailer}
            </div>
            <div>
              <span className={`move move-${m.kind}`}>{KIND_LABEL[m.kind]}</span> {m.release}
            </div>
            <div className="small">{m.detail}</div>
          </>
        );
        return m.dropId ? (
          <Link key={i} to={`/drop/${m.dropId}`} className="move-row">
            {body}
          </Link>
        ) : (
          <div key={i} className="move-row">
            {body}
          </div>
        );
      })}
    </section>
  );
}

/** A listing's price and stock changes, newest last, folded away by default. */
function PriceHistory({ listing }: { listing: ListingView }) {
  if (listing.history.length < 2) return null;
  let lastPrice: number | null = null;
  return (
    <details className="history-fold">
      <summary className="small">Price and stock history ({listing.history.length})</summary>
      <ol className="history small">
        {listing.history.map((h) => {
          const parts: string[] = [];
          if (h.priceMinor !== null && h.priceMinor !== lastPrice) {
            parts.push(`${formatMinorText(h.priceMinor, listing.price?.currency ?? 'GBP')}${h.ratio ? ` (${signedPct(h.ratio)} vs RRP)` : ''}`);
            lastPrice = h.priceMinor;
          }
          if (h.available !== null) parts.push(h.available ? 'in stock' : 'out of stock');
          return (
            <li key={h.at}>
              <span className="muted">{formatStamp(h.at)}</span> {parts.join(', ')}
            </li>
          );
        })}
      </ol>
    </details>
  );
}

export function WatchlistView({ config }: { config: AppConfig }) {
  const { data, error } = useApi<DropSummary[]>('/api/drops?view=watchlist');
  return (
    <section>
      <div className="view-head">
        <h1>Watchlist</h1>
      </div>
      {error ? <Notice tone="error">{error}</Notice> : null}
      {data && data.length === 0 ? <Empty>Nothing watched or pinned yet. Open a drop and tap Watch or Pin.</Empty> : null}
      {data?.map((d) => <DropRow key={d.id} drop={d} tolerance={config.rules.rrp.tolerance} />)}
      <p className="small muted">Watched drops alert 24 hours, 1 hour and 10 minutes before they go live, when they go live, and if the date moves. Pinned drops sort first everywhere.</p>
    </section>
  );
}

function sourceName(id: string) {
  return id.replace(/-/g, ' ');
}

export function DetailView({ id, config }: { id: string; config: AppConfig }) {
  const { data: d, error, reload } = useApi<DropDetail>(`/api/drops/${encodeURIComponent(id)}`);
  const [watched, setWatched] = useState<boolean | null>(null);
  const [pinned, setPinned] = useState<boolean | null>(null);
  useEffect(() => {
    setWatched(d?.watched ?? null);
    setPinned(d?.pinned ?? null);
  }, [d]);
  if (error) return <Notice tone="error">{error}</Notice>;
  if (!d) return <Empty>Loading…</Empty>;
  const tolerance = config.rules.rrp.tolerance;
  const toggleWatch = async () => {
    const next = !watched;
    setWatched(next);
    const res = await fetch(`/api/watch/${encodeURIComponent(d.releaseId)}`, { method: next ? 'POST' : 'DELETE' });
    if (!res.ok) setWatched(!next);
  };
  const togglePin = async () => {
    const next = !pinned;
    setPinned(next);
    const res = await fetch(`/api/pins/${encodeURIComponent(d.id)}`, { method: next ? 'POST' : 'DELETE' });
    if (!res.ok) setPinned(!next);
  };
  return (
    <article className="detail">
      <Link to="/" className="back">‹ Upcoming</Link>
      <h1>{d.name}</h1>
      <div className="detail-when">
        {showCountdown(d.precision, d.confidence) && d.liveAt ? (
          <>
            <Countdown to={d.liveAt} />
            <span className="muted">{dateLabel(d.startsAt, d.precision)}</span>
          </>
        ) : (
          <span className="when">{d.status === 'live' ? 'Live now' : dateLabel(d.startsAt, d.precision)}</span>
        )}
        <ConfidenceBadge confidence={d.confidence} />
      </div>
      <div className="drop-meta">
        <span className={`cat cat-${d.category}`}>{CATEGORY_LABEL[d.category] ?? d.category}</span>
        {d.season ? <span>{d.season}</span> : null}
        {d.tier ? <span>{d.tier} line</span> : null}
        <ScoreBadge desk={d.desk} />
      </div>
      <div className="actions">
        <button type="button" className={watched ? 'btn on' : 'btn'} aria-pressed={Boolean(watched)} onClick={toggleWatch}>
          {watched ? '★ Watching' : '☆ Watch'}
        </button>
        <button type="button" className={pinned ? 'btn on' : 'btn'} aria-pressed={Boolean(pinned)} onClick={togglePin}>
          {pinned ? '📌 Pinned' : 'Pin'}
        </button>
        {d.startsAt && (d.precision === 'day' || d.precision === 'time') ? (
          <a className="btn" href={`/api/drops/${encodeURIComponent(d.id)}/ics`}>Add to calendar</a>
        ) : null}
      </div>
      {watched ? <p className="small muted">You will be alerted 24 hours, 1 hour and 10 minutes before, when it goes live, and if the date moves.</p> : null}

      <DeskPanel drop={d} onChange={reload} />

      {d.checklist ? (
        <>
          <h2>Checklist</h2>
          <p className="small">
            {d.checklist.cards ? `${d.checklist.cards} checklist entries` : 'No checklist published yet'}
            {d.checklist.players.length ? <> · <strong>Your players: {d.checklist.players.join(', ')}</strong></> : null}
          </p>
          {d.checklist.rookies.length ? (
            <p className="small">
              Rookie cards ({d.checklist.rookies.length}): {d.checklist.rookies.slice(0, 12).join(', ')}
              {d.checklist.rookies.length > 12 ? ` and ${d.checklist.rookies.length - 12} more` : ''}
            </p>
          ) : null}
          <p className="small muted">
            Read {formatStamp(d.checklist.readAt)}
            {d.checklist.url ? (
              <>
                {' '}from{' '}
                <a href={d.checklist.url} target="_blank" rel="noopener noreferrer">
                  collectosk
                </a>
              </>
            ) : null}
            .
          </p>
        </>
      ) : null}

      <h2>Where to buy</h2>
      {d.products.length === 0 ? <Empty>No shop lists this yet. It will appear here as soon as one does.</Empty> : null}
      {d.products.map((p) => (
        <div key={p.id} className="product">
          <h3>
            {p.configurationLabel}
            {p.rrp ? <span className="muted small"> · RRP {formatMoney(p.rrp)}{p.rrp.source === 'estimated' ? ' (estimated from first shop prices)' : p.rrp.source === 'owner' ? ' (yours)' : p.rrp.source === 'published' ? ' (published, via collectosk)' : ''}</span> : <span className="muted small"> · RRP unknown</span>}
          </h3>
          <RrpEditor product={p} onChange={reload} />
          {p.listings.map((l) => (
            <div key={l.id} className="listing">
              <div className="listing-main">
                <div>
                  <strong>{l.retailer}</strong> <span className="muted small">{l.country}</span>
                </div>
                <div className="small muted">{l.title}</div>
                <div className="ships">
                  <ShipTag region="GI" value={l.shipsGi.value} title={`Gibraltar: ${l.shipsGi.note ?? l.shipsGi.value}${l.shipsGi.verifiedAt ? ` (checked ${l.shipsGi.verifiedAt})` : ''}`} />
                  <ShipTag region="ES" value={l.shipsEs.value} title={`Spain: ${l.shipsEs.note ?? l.shipsEs.value}${l.shipsEs.verifiedAt ? ` (checked ${l.shipsEs.verifiedAt})` : ''}`} />
                  <span className={l.available ? 'stock in' : 'stock out'}>{l.isPreorder ? (l.available ? 'Pre-order open' : 'Pre-order unavailable') : l.available ? 'In stock' : 'Out of stock'}</span>
                </div>
              </div>
              <div className="listing-side">
                {l.price ? <div className="price">{formatMoney(l.price)}</div> : null}
                <RrpNote ratio={l.priceVsRrp} tolerance={tolerance} estimated={p.rrp?.source === 'estimated'} />
                <a className="shop-link" href={l.url} target="_blank" rel="noopener noreferrer">View at shop ↗</a>
              </div>
              <PriceHistory listing={l} />
            </div>
          ))}
        </div>
      ))}

      {d.market.length ? (
        <>
          <h2>Market price (Cardmarket, EU)</h2>
          <p className="small muted">
            What the box sells for on Cardmarket, all language editions. Trend and average come from sales; low is the cheapest listing. For context only: it never changes the Desk Score.
          </p>
          <table className="table market">
            <tbody>
              {d.market.map((m) => (
                <tr key={m.name}>
                  <td>
                    {m.configurationLabel}
                    <div className="small muted">{m.name}</div>
                  </td>
                  <td>
                    {m.trend ? <strong>{formatMoney(m.trend)}</strong> : '—'} <span className="small muted">trend</span>
                    {m.low ? <div className="small">from {formatMoney(m.low)}</div> : null}
                    {m.trendVsRrp !== null ? <div className="small muted">{signedPct(m.trendVsRrp)} vs RRP</div> : null}
                    {m.history.length > 1 ? <div className="small muted">{trendChange(m.history)}</div> : null}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <p className="small muted">
            Prices of {formatStamp(d.market[0]?.asOf ?? null)} from{' '}
            <a href="https://www.cardmarket.com/" target="_blank" rel="noopener noreferrer">
              Cardmarket
            </a>
            .
          </p>
        </>
      ) : null}

      <h2>Costs to bear in mind</h2>
      <ul className="notes">
        {d.costNotes.map((n) => (
          <li key={`${n.region}-${n.from}`}>
            <strong>{n.region === 'gi' ? 'Gibraltar' : 'Spain'}:</strong> {n.text}{' '}
            <a href={n.source} target="_blank" rel="noopener noreferrer" className="small">source</a>
          </li>
        ))}
      </ul>

      <h2>What each source says</h2>
      <table className="table">
        <tbody>
          {d.observations.map((o) => (
            <tr key={o.sourceId}>
              <td>{o.sourceLabel}</td>
              <td>{o.raw || '—'}{o.region ? ` (${o.region})` : ''}</td>
              <td><ConfidenceBadge confidence={o.confidence} /></td>
            </tr>
          ))}
        </tbody>
      </table>

      <h2>Date history</h2>
      <ol className="history">
        {d.history.map((h, i) => (
          <li key={i}>
            <span className="muted small">{formatStamp(h.changedAt)}</span>{' '}
            {h.oldStartsAt === null && i === 0 ? 'First seen:' : 'Changed:'} {h.oldStartsAt && i > 0 ? `${h.oldStartsAt} → ` : ''}
            {h.newStartsAt ?? 'TBD'} <span className="muted small">({sourceName(h.sourceId)})</span>
          </li>
        ))}
      </ol>
    </article>
  );
}

export function SourcesView() {
  const { data, error } = useApi<SourceHealth[]>('/api/sources/health');
  const order: Record<SourceHealth['status'], number> = { failing: 0, degraded: 1, never_run: 2, ok: 3 };
  const sorted = [...(data ?? [])].filter((s) => s.enabled).sort((a, b) => order[a.status] - order[b.status] || a.label.localeCompare(b.label));
  return (
    <section>
      <div className="view-head">
        <h1>Source health</h1>
      </div>
      {error ? <Notice tone="error">{error}</Notice> : null}
      {sorted.some((s) => s.status === 'failing') ? <Notice tone="error">Some sources are failing. Their data may be out of date.</Notice> : null}
      {sorted.map((s) => (
        <div key={s.id} className={`source source-${s.status}`}>
          <div>
            <span className={`dot dot-${s.status}`} aria-hidden="true" /> <strong>{s.label}</strong> <span className="muted small">{s.kind}</span>
          </div>
          <div className="small">
            Last success {relativeFromNow(s.lastSuccessAt)} · {s.itemCount} items
            {s.consecutiveFailures ? ` · ${s.consecutiveFailures} failure${s.consecutiveFailures > 1 ? 's' : ''} in a row` : ''}
          </div>
          {s.lastError && s.status !== 'ok' ? <div className="small error-text">{s.lastError}</div> : null}
        </div>
      ))}
    </section>
  );
}

export function SettingsView({ config }: { config: AppConfig }) {
  return (
    <section>
      <div className="view-head">
        <h1>Settings</h1>
      </div>
      <PushSettings />
      <CalendarSettings />
      <div className="card">
        <h3>Sources</h3>
        <p className="small">Which calendars and shops are being read, and whether any are failing.</p>
        <div className="actions">
          <Link to="/sources" className="btn">Source health</Link>
        </div>
      </div>
      <h2>Buying rules</h2>
      <p className="small muted">These come from config/rules.yaml in the repository. Change them there; the app is rebuilt on deploy.</p>
      <pre className="rules">{JSON.stringify(config.rules, null, 2)}</pre>
    </section>
  );
}

export function NotificationsView({ onRead }: { onRead: () => void }) {
  const { data, error, reload } = useApi<{ unread: number; items: NotificationItem[] }>('/api/notifications');
  useEffect(() => {
    if (data) setBadge(data.unread);
  }, [data]);
  const markAll = async () => {
    await fetch('/api/notifications/read', { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' });
    reload();
    onRead();
  };
  const open = async (n: NotificationItem) => {
    if (!n.read_at) {
      await fetch('/api/notifications/read', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ id: n.id }) });
      onRead();
    }
    const path = n.url ? new URL(n.url, window.location.origin).pathname : '/';
    navigate(path);
  };
  return (
    <section>
      <div className="view-head">
        <h1>Alerts</h1>
        {data?.unread ? (
          <button type="button" className="chip" onClick={markAll}>
            Mark all read
          </button>
        ) : null}
      </div>
      {error ? <Notice tone="error">{error}</Notice> : null}
      {data && data.items.length === 0 ? <Empty>No alerts yet. Watch a drop to get alerts before it goes live.</Empty> : null}
      {data?.items.map((n) => (
        <button key={n.id} type="button" className={`alert-row${n.read_at ? '' : ' unread'}${n.critical ? ' critical' : ''}`} onClick={() => open(n)}>
          <div className="alert-title">{n.title}</div>
          <div className="small">{n.body}</div>
          <div className="small muted">{formatStamp(n.created_at)}</div>
        </button>
      ))}
    </section>
  );
}

interface PushStatus {
  subscriptions: Array<{ id: string; status: 'active' | 'dead'; user_agent: string | null; created_at: string; last_sent_at: string | null; last_confirmed_at: string | null; dead_at: string | null }>;
  emailFallback: boolean;
}

function deviceName(ua: string | null): string {
  if (!ua) return 'Unknown device';
  if (/iPhone/.test(ua)) return 'iPhone';
  if (/iPad/.test(ua)) return 'iPad';
  if (/Android/.test(ua)) return 'Android';
  if (/Macintosh/.test(ua)) return 'Mac';
  if (/Windows/.test(ua)) return 'Windows';
  return 'Browser';
}

function PushSettings() {
  const [state, setState] = useState<PushState | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const status = useApi<PushStatus>('/api/push/status');
  useEffect(() => {
    pushState().then(setState);
  }, []);
  const enable = async () => {
    setMessage(null);
    const r = await turnOnPush();
    setMessage(r.ok ? 'Notifications are on for this device.' : r.message);
    setState(await pushState());
    status.reload();
  };
  const test = async (critical: boolean) => {
    const res = await fetch(`/api/push/test${critical ? '?critical=1' : ''}`, { method: 'POST' });
    const r = (await res.json()) as { pushed?: number; emailed?: number };
    setMessage(res.ok ? `Test sent: ${r.pushed ?? 0} push, ${r.emailed ?? 0} email.` : 'The test could not be sent.');
    window.setTimeout(status.reload, 4000);
  };
  const subs = status.data?.subscriptions ?? [];
  return (
    <div className="card">
      <h3>Notifications</h3>
      {state === 'needs-home-screen' ? (
        <Notice tone="info">
          On iPhone and iPad, notifications only work from the Home Screen app. Tap the Share button, choose <strong>Add to Home Screen</strong>, then open Card Desk Drops from your Home Screen and come back here.
        </Notice>
      ) : null}
      {state === 'denied' ? <Notice tone="error">Notifications are blocked for this app in your device settings.</Notice> : null}
      {state === 'unsupported' ? <Notice tone="error">This browser cannot receive push notifications.</Notice> : null}
      {state === 'off' || state === 'on' ? (
        <div className="actions">
          <button type="button" className={state === 'on' ? 'btn' : 'btn primary'} onClick={enable}>
            {state === 'on' ? 'Re-register this device' : 'Turn on notifications'}
          </button>
          {state === 'on' ? (
            <>
              <button type="button" className="btn" onClick={() => test(false)}>Send a test</button>
              <button type="button" className="btn" onClick={() => test(true)}>Test critical (email fallback)</button>
            </>
          ) : null}
        </div>
      ) : null}
      {message ? <p className="small">{message}</p> : null}
      <h4>Devices</h4>
      {subs.length === 0 ? <p className="small muted">No device is subscribed yet.</p> : null}
      {subs.map((s) => (
        <div key={s.id} className="small device">
          <span className={`dot dot-${s.status === 'active' ? 'ok' : 'failing'}`} aria-hidden="true" /> {s.status === 'active' ? 'Subscribed' : 'Dead: re-subscribe on that device'} ·{' '}
          {deviceName(s.user_agent)} · last confirmed delivery {relativeFromNow(s.last_confirmed_at)}
        </div>
      ))}
      <p className="small muted">Email fallback for critical alerts: {status.data?.emailFallback ? 'on' : 'not configured'}.</p>
    </div>
  );
}

function CalendarSettings() {
  const { data } = useApi<{ feedUrl: string | null }>('/api/calendar');
  const [copied, setCopied] = useState(false);
  if (!data) return null;
  return (
    <div className="card">
      <h3>Calendar</h3>
      {data.feedUrl ? (
        <>
          <p className="small">Subscribe to this address in your calendar app to see watched drops. Events move when dates slip.</p>
          <code className="feed">{data.feedUrl}</code>
          <div className="actions">
            <button type="button" className="btn" onClick={() => navigator.clipboard.writeText(data.feedUrl ?? '').then(() => setCopied(true))}>{copied ? 'Copied' : 'Copy address'}</button>
            <a className="btn" href={data.feedUrl.replace(/^https:/, 'webcal:')}>Subscribe</a>
          </div>
          <p className="small muted">Keep this address private: anyone with it can read your watched drops.</p>
        </>
      ) : (
        <p className="small muted">The calendar feed is not configured yet.</p>
      )}
    </div>
  );
}
