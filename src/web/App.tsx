import { useEffect } from 'react';
import { Notice } from './components.tsx';
import { Link, useApi, usePath } from './lib.tsx';
import { refreshReceiptUrl, registerServiceWorker, setBadge } from './push.ts';
import { DetailView, LiveView, NotificationsView, SettingsView, SourcesView, UpcomingView, type AppConfig } from './views.tsx';

const TABS = [
  { to: '/', label: 'Upcoming', match: (p: string) => p === '/' || p.startsWith('/drop/') },
  { to: '/live', label: 'Live', match: (p: string) => p.startsWith('/live') },
  { to: '/notifications', label: 'Alerts', match: (p: string) => p.startsWith('/notifications') },
  { to: '/sources', label: 'Sources', match: (p: string) => p.startsWith('/sources') },
  { to: '/settings', label: 'Settings', match: (p: string) => p.startsWith('/settings') },
];

export function App() {
  const path = usePath();
  const pathname = path.split('?')[0] ?? '/';
  const { data: config, error } = useApi<AppConfig>('/api/config');
  const unread = useApi<{ unread: number }>('/api/notifications');
  const push = useApi<{ subscriptions: Array<{ status: string }> }>('/api/push/status');
  useEffect(() => {
    registerServiceWorker().then(() => refreshReceiptUrl());
    const id = window.setInterval(unread.reload, 60_000);
    return () => window.clearInterval(id);
  }, [unread.reload]);
  useEffect(() => {
    if (unread.data) setBadge(unread.data.unread);
  }, [unread.data]);
  const subs = push.data?.subscriptions ?? [];
  const pushDied = subs.length > 0 && !subs.some((s) => s.status === 'active');

  let view = null;
  if (config) {
    const drop = pathname.match(/^\/drop\/([^/]+)$/);
    if (drop?.[1]) view = <DetailView id={decodeURIComponent(drop[1])} config={config} />;
    else if (pathname === '/live') view = <LiveView config={config} />;
    else if (pathname === '/sources') view = <SourcesView />;
    else if (pathname === '/notifications') view = <NotificationsView onRead={unread.reload} />;
    else if (pathname === '/settings') view = <SettingsView config={config} />;
    else view = <UpcomingView key={path} config={config} />;
  }

  return (
    <div className="app">
      <header className="top">
        <Link to="/" className="brand">Card Desk Drops</Link>
      </header>
      <main>
        {pushDied ? (
          <Notice tone="error">
            Push notifications have stopped reaching your device. <Link to="/settings">Turn them back on</Link>.
          </Notice>
        ) : null}
        {error ? <Notice tone="error">{error}</Notice> : view}
      </main>
      <nav className="tabs" aria-label="Main">
        {TABS.map((t) => (
          <Link key={t.to} to={t.to} className={t.match(pathname) ? 'tab on' : 'tab'}>
            {t.label}
            {t.to === '/notifications' && unread.data?.unread ? <span className="count">{unread.data.unread}</span> : null}
          </Link>
        ))}
      </nav>
    </div>
  );
}
