import { useMemo, useState } from 'react';
import type { DropDetail, DropSummary, SourceHealth } from '../shared/api-types.ts';
import { CATEGORY_LABEL, Chips, ConfidenceBadge, Countdown, DropRow, Empty, Notice, RrpNote, ShipTag } from './components.tsx';
import { dateLabel, formatMoney, formatStamp, relativeFromNow, showCountdown, TZ, weekStart } from './format.ts';
import { Link, useApi } from './lib.tsx';

export interface AppConfig {
  timezone: string;
  categories: Array<{ id: string; label: string }>;
  rules: { rrp: { tolerance: number } } & Record<string, unknown>;
}

type Region = 'any' | 'gi' | 'es';

function useFilters() {
  const params = new URLSearchParams(window.location.search);
  const [category, setCategory] = useState(params.get('category') ?? 'all');
  const [region, setRegion] = useState<Region>((params.get('region') as Region) ?? 'any');
  const query = new URLSearchParams();
  if (category !== 'all') query.set('category', category);
  if (region !== 'any') query.set('region', region);
  return { category, setCategory, region, setRegion, query: query.toString() };
}

function Filters({ config, f }: { config: AppConfig; f: ReturnType<typeof useFilters> }) {
  return (
    <div className="filters">
      <Chips label="Category" value={f.category} onChange={f.setCategory} options={[{ id: 'all', label: 'All' }, ...config.categories.map((c) => ({ id: c.id, label: CATEGORY_LABEL[c.id] ?? c.label }))]} />
      <Chips<Region> label="Ships to" value={f.region} onChange={f.setRegion} options={[{ id: 'any', label: 'Any' }, { id: 'gi', label: 'Gibraltar' }, { id: 'es', label: 'Spain' }]} />
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
      </div>
      <Filters config={config} f={f} />
      {error ? <Notice tone="error">{error}</Notice> : null}
      {data && data.length === 0 ? <Empty>Nothing is live right now.</Empty> : null}
      {data?.map((d) => <DropRow key={d.id} drop={d} tolerance={config.rules.rrp.tolerance} />)}
    </section>
  );
}

function sourceName(id: string) {
  return id.replace(/-/g, ' ');
}

export function DetailView({ id, config }: { id: string; config: AppConfig }) {
  const { data: d, error } = useApi<DropDetail>(`/api/drops/${encodeURIComponent(id)}`);
  if (error) return <Notice tone="error">{error}</Notice>;
  if (!d) return <Empty>Loading…</Empty>;
  const tolerance = config.rules.rrp.tolerance;
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
      </div>

      <h2>Where to buy</h2>
      {d.products.length === 0 ? <Empty>No shop lists this yet. It will appear here as soon as one does.</Empty> : null}
      {d.products.map((p) => (
        <div key={p.id} className="product">
          <h3>
            {p.configurationLabel}
            {p.rrp ? <span className="muted small"> · RRP {formatMoney(p.rrp)}{p.rrp.source === 'estimated' ? ' (estimated from first shop prices)' : ''}</span> : <span className="muted small"> · RRP unknown</span>}
          </h3>
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
            </div>
          ))}
        </div>
      ))}

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
      <h2>Buying rules</h2>
      <p className="small muted">These come from config/rules.yaml in the repository. Change them there; the app is rebuilt on deploy.</p>
      <pre className="rules">{JSON.stringify(config.rules, null, 2)}</pre>
    </section>
  );
}
