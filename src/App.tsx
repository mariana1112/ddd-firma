import { Component, lazy, Suspense, type ReactNode } from 'react';
import { HashRouter, NavLink, Route, Routes, useLocation } from 'react-router-dom';
import { useRegisterSW } from 'virtual:pwa-register/react';
import { ClientDetailPage, ClientEditPage, ClientNewPage, ClientsPage, SiteEditPage, SiteNewPage } from './features/clients';
import { AccountPage } from './features/account';
import { DashboardPage } from './features/dashboard';
import { FinancePage } from './features/finance';
import { JobCompletePage, JobDetailPage, JobEditPage, JobNewPage, JobsPage } from './features/jobs';
import { BackupPage, MorePage, SettingsPage, TrashPage } from './features/settings';
import { PreparationDetailPage, PreparationEditPage, PreparationNewPage, PreparationsPage, ServicesPage, UsagePage } from './features/stock';
import { FeedbackProvider } from './ui/feedback';
import { Icon, type IconName } from './ui/icons';
import { Loading } from './ui/kit';

// Kalendarz jest największą zależnością ekranów, więc nie spowalnia startu aplikacji.
const CalendarPage = lazy(() => import('./features/calendar'));

const TABS: Array<{ to: string; label: string; icon: IconName; end?: boolean; also?: string[] }> = [
  { to: '/', label: 'Pulpit', icon: 'home', end: true },
  { to: '/kalendarz', label: 'Kalendarz', icon: 'calendar' },
  { to: '/zlecenia', label: 'Zlecenia', icon: 'clipboard' },
  { to: '/klienci', label: 'Klienci', icon: 'users', also: ['/obiekty'] },
  { to: '/wiecej', label: 'Więcej', icon: 'menu', also: ['/cennik', '/preparaty', '/ewidencja', '/finanse', '/ustawienia', '/kopie', '/kosz', '/konto'] },
];

function Navigation() {
  const { pathname } = useLocation();
  return (
    <nav className="tabs" aria-label="Główna nawigacja">
      <div className="tabs-brand">DDD Firma</div>
      {TABS.map((tab) => (
        <NavLink
          key={tab.to}
          to={tab.to}
          end={tab.end}
          className={({ isActive }) =>
            isActive || tab.also?.some((p) => pathname.startsWith(p)) ? 'tab active' : 'tab'
          }
        >
          <Icon name={tab.icon} size={24} />
          <span>{tab.label}</span>
        </NavLink>
      ))}
    </nav>
  );
}

function UpdatePrompt() {
  const {
    needRefresh: [needRefresh],
    updateServiceWorker,
  } = useRegisterSW();
  if (!needRefresh) return null;
  return (
    <div className="update-bar" role="status">
      <span>Jest nowa wersja aplikacji.</span>
      <button type="button" onClick={() => updateServiceWorker(true)}>
        Odśwież
      </button>
    </div>
  );
}

class ErrorBoundary extends Component<{ children: ReactNode }, { error: Error | null }> {
  state = { error: null as Error | null };

  static getDerivedStateFromError(error: Error) {
    return { error };
  }

  render() {
    if (!this.state.error) return this.props.children;
    return (
      <div className="fatal">
        <h1>Coś poszło nie tak</h1>
        <p>Dane są zapisane na urządzeniu i nie zostały usunięte. Załaduj aplikację ponownie.</p>
        <p className="fatal-detail">{this.state.error.message}</p>
        <button type="button" className="btn btn-primary" onClick={() => window.location.reload()}>
          Załaduj ponownie
        </button>
      </div>
    );
  }
}

export function App() {
  return (
    <ErrorBoundary>
      <FeedbackProvider>
        <HashRouter>
          <div className="shell">
            <Navigation />
            <div className="content">
              <UpdatePrompt />
              <Suspense fallback={<Loading />}>
                <Routes>
                  <Route path="/" element={<DashboardPage />} />
                  <Route path="/kalendarz" element={<CalendarPage />} />
                  <Route path="/zlecenia" element={<JobsPage />} />
                  <Route path="/zlecenia/nowe" element={<JobNewPage />} />
                  <Route path="/zlecenia/:id" element={<JobDetailPage />} />
                  <Route path="/zlecenia/:id/edycja" element={<JobEditPage />} />
                  <Route path="/zlecenia/:id/protokol" element={<JobCompletePage />} />
                  <Route path="/klienci" element={<ClientsPage />} />
                  <Route path="/klienci/nowy" element={<ClientNewPage />} />
                  <Route path="/klienci/:id" element={<ClientDetailPage />} />
                  <Route path="/klienci/:id/edycja" element={<ClientEditPage />} />
                  <Route path="/klienci/:id/obiekty/nowy" element={<SiteNewPage />} />
                  <Route path="/obiekty/:id/edycja" element={<SiteEditPage />} />
                  <Route path="/wiecej" element={<MorePage />} />
                  <Route path="/cennik" element={<ServicesPage />} />
                  <Route path="/preparaty" element={<PreparationsPage />} />
                  <Route path="/preparaty/nowy" element={<PreparationNewPage />} />
                  <Route path="/preparaty/:id" element={<PreparationDetailPage />} />
                  <Route path="/preparaty/:id/edycja" element={<PreparationEditPage />} />
                  <Route path="/ewidencja" element={<UsagePage />} />
                  <Route path="/finanse" element={<FinancePage />} />
                  <Route path="/ustawienia" element={<SettingsPage />} />
                  <Route path="/kopie" element={<BackupPage />} />
                  <Route path="/kosz" element={<TrashPage />} />
                  <Route path="/konto" element={<AccountPage />} />
                  <Route path="*" element={<DashboardPage />} />
                </Routes>
              </Suspense>
            </div>
          </div>
        </HashRouter>
      </FeedbackProvider>
    </ErrorBoundary>
  );
}
