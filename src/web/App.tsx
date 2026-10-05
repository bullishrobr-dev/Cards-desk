import { Notice } from './components.tsx';
import { Link, useApi, usePath } from './lib.tsx';
import { DetailView, LiveView, SettingsView, SourcesView, UpcomingView, type AppConfig } from './views.tsx';

const TABS = [
  { to: '/', label: 'Upcoming', match: (p: string) => p === '/' || p.startsWith('/drop/') },
  { to: '/live', label: 'Live', match: (p: string) => p.startsWith('/live') },
  { to: '/sources', label: 'Sources', match: (p: string) => p.startsWith('/sources') },
  { to: '/settings', label: 'Settings', match: (p: string) => p.startsWith('/settings') },
];

export function App() {
  const path = usePath();
  const pathname = path.split('?')[0] ?? '/';
  const { data: config, error } = useApi<AppConfig>('/api/config');

  let view = null;
  if (config) {
    const drop = pathname.match(/^\/drop\/([^/]+)$/);
    if (drop?.[1]) view = <DetailView id={decodeURIComponent(drop[1])} config={config} />;
    else if (pathname === '/live') view = <LiveView config={config} />;
    else if (pathname === '/sources') view = <SourcesView />;
    else if (pathname === '/settings') view = <SettingsView config={config} />;
    else view = <UpcomingView key={path} config={config} />;
  }

  return (
    <div className="app">
      <header className="top">
        <Link to="/" className="brand">Card Desk Drops</Link>
      </header>
      <main>{error ? <Notice tone="error">{error}</Notice> : view}</main>
      <nav className="tabs" aria-label="Main">
        {TABS.map((t) => (
          <Link key={t.to} to={t.to} className={t.match(pathname) ? 'tab on' : 'tab'}>
            {t.label}
          </Link>
        ))}
      </nav>
    </div>
  );
}
