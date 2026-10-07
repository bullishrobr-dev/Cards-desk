import { useEffect, useState } from 'react';
import type { NotificationPref } from '../shared/api-types.ts';
import type { RulesConfig } from '../shared/config/schema.ts';
import { formatMinor } from './format.ts';
import { useApi } from './lib.tsx';

/** One switch per trigger, grouped. Critical ones say they also fall back to email. */
export function NotificationToggles() {
  const { data } = useApi<NotificationPref[]>('/api/notification-prefs');
  const [prefs, setPrefs] = useState<NotificationPref[] | null>(null);
  useEffect(() => setPrefs(data), [data]);
  if (!prefs) return null;
  const toggle = async (id: NotificationPref['id'], enabled: boolean) => {
    setPrefs((p) => p?.map((x) => (x.id === id ? { ...x, enabled } : x)) ?? null);
    const res = await fetch(`/api/notification-prefs/${id}`, { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ enabled }) });
    if (!res.ok) setPrefs((p) => p?.map((x) => (x.id === id ? { ...x, enabled: !enabled } : x)) ?? null);
  };
  const groups = [...new Set(prefs.map((p) => p.group))];
  return (
    <div className="card">
      <h3>What to be told about</h3>
      {groups.map((g) => (
        <div key={g}>
          <h4>{g}</h4>
          {prefs
            .filter((p) => p.group === g)
            .map((p) => (
              <label key={p.id} className="toggle">
                <input type="checkbox" checked={p.enabled} onChange={(e) => toggle(p.id, e.target.checked)} />
                <span>
                  {p.label}
                  {p.critical ? <span className="small muted"> · critical: email if the push is not confirmed</span> : null}
                </span>
              </label>
            ))}
        </div>
      ))}
      <p className="small muted">Switched-off alerts are not stored or sent. Gated drops never alert unless you watch them.</p>
    </div>
  );
}

const pct = (n: number) => `${n}%`;

/** The buying rules, readable. The raw config stays one tap away. */
export function RulesViewer({ rules }: { rules: RulesConfig }) {
  return (
    <div className="rules-view">
      <div className="card">
        <h3>Labels and hard rules</h3>
        <ul className="notes">
          <li>
            <strong>Priority</strong> from {rules.labels.priority_min}, <strong>Watch</strong> from {rules.labels.watch_min}, otherwise Ignore.
          </li>
          <li>Must ship to Gibraltar or Spain (unknown passes, flagged).</li>
          <li>
            Price at most RRP × {rules.rrp.tolerance} ({pct(Math.round((rules.rrp.tolerance - 1) * 100))} over). Above that: "Above RRP — buy singles instead".
          </li>
          <li>RRP order: yours, then rules, then published (collectosk), then estimated from the first shop prices.</li>
        </ul>
      </div>
      {Object.entries(rules.categories).map(([id, c]) => (
        <div key={id} className={c.enabled ? 'card' : 'card off'}>
          <h3>
            {c.label} {c.enabled ? null : <span className="small muted">(switched off)</span>}
          </h3>
          {c.enabled ? (
            <>
              <p className="small">
                Points: tier {c.weights.tier} · box {c.weights.configuration} · scarcity {c.weights.scarcity} · relevance {c.weights.relevance}
              </p>
              <h4>Product tiers</h4>
              <ul className="notes small">
                {c.tiers.map((t) => (
                  <li key={t.tier}>
                    <strong>{t.tier}</strong> ({pct(t.points_pct)}): {t.lines.join(', ')}
                  </li>
                ))}
              </ul>
              <h4>Box types</h4>
              <ul className="notes small">
                {c.configurations.map((cfg) => (
                  <li key={cfg.id}>
                    {cfg.label} ({pct(cfg.points_pct)})
                  </li>
                ))}
              </ul>
              {c.publishers.length ? <p className="small muted">Publishers: {c.publishers.map((p) => rules.publishers[p]?.label ?? p).join(', ')}</p> : null}
            </>
          ) : null}
        </div>
      ))}
      <div className="card">
        <h3>Relevance and scarcity</h3>
        <p className="small">
          <strong>Watchlist players</strong> ({pct(rules.relevance.watchlist_player_points_pct)}): {rules.relevance.watchlist_players.join(', ')}
        </p>
        <p className="small">
          Rookie cards on the checklist: {pct(rules.relevance.rookie_class_points_pct)}. Your own tags: {pct(rules.relevance.manual_tag_points_pct)}.
        </p>
        <ul className="notes small">
          {rules.scarcity.signals.map((s) => (
            <li key={s.id}>
              {s.label} ({pct(s.points_pct)})
            </li>
          ))}
        </ul>
      </div>
      <div className="card">
        <h3>Known RRPs</h3>
        <ul className="notes small">
          {rules.rrp.known.map((k) => (
            <li key={`${k.category}-${k.configuration}`}>
              {rules.categories[k.category]?.configurations.find((c) => c.id === k.configuration)?.label ?? k.configuration}: {formatMinor(Math.round(k.amount * 100), k.currency)}{' '}
              <span className="muted">(checked {String(k.verified_at)})</span>
            </li>
          ))}
        </ul>
      </div>
      <details className="card">
        <summary className="small">Raw rules (config/rules.yaml)</summary>
        <pre className="rules">{JSON.stringify(rules, null, 2)}</pre>
      </details>
    </div>
  );
}
