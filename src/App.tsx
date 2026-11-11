import { Component, lazy, Suspense, useEffect, useState, type ReactNode } from 'react';
import { HashRouter, NavLink, Route, Routes, useLocation } from 'react-router-dom';
import { useRegisterSW } from 'virtual:pwa-register/react';
import { watchForUpdates } from './lib/updates';
import { AccountPage, BranchesPage, ClaimAccountPage, LoginGate, SessionLock } from './features/account';
import type { SyncState } from './data/types';
import { useLiveQuery } from 'dexie-react-hooks';
import { getSyncState } from './data/settings';
import { isSyncConfigured } from './data/sync/config';
import { AdminPage, AdminRecoveryPage, AdminScoped, AdminSecurityPage, AdminTechnicianPage } from './features/admin';
import { CostsPage } from './features/costs';
import { DashboardPage } from './features/dashboard';
import { OrderEditPage, OrderNewPage } from './features/order-form';
import { OrderDetailPage, OrdersPage } from './features/orders';
import { ReportsPage } from './features/reports';
import { BackupPage, MorePage, SettingsPage, TrashPage } from './features/settings';
import { TripsPage } from './features/trips';
import { CardPage } from './features/card';
import { AccountingOrderPage, AccountingPage, CorrectionsPage } from './features/accounting';
import { ChatButton, ChatPage, NotificationBell, NotificationsPage } from './features/communication';
import { VisitPage } from './features/visit';
import { RegionPage } from './features/regions';
import { FeedbackProvider } from './ui/feedback';
import { PullToRefresh } from './ui/pull-refresh';
import { Icon, type IconName } from './ui/icons';
import { HeaderExtraContext, Loading } from './ui/kit';

// Kalendarz jest największą zależnością ekranów, więc nie spowalnia startu aplikacji.
const CalendarPage = lazy(() => import('./features/calendar'));

const TABS: Array<{ to: string; label: string; icon: IconName; end?: boolean; also?: string[] }> = [
  { to: '/', label: 'Pulpit', icon: 'home', end: true },
  { to: '/kalendarz', label: 'Kalendarz', icon: 'calendar' },
  { to: '/zlecenia', label: 'Zlecenia', icon: 'clipboard', also: ['/zabieg'] },
  { to: '/raporty', label: 'Raporty', icon: 'chart' },
  { to: '/wiecej', label: 'Więcej', icon: 'menu', also: ['/koszty', '/kilometry', '/oddzialy', '/ustawienia', '/kopie', '/kosz', '/konto', '/czat', '/powiadomienia', '/archiwum', '/region'] },
];

/** Księgowa nie dodaje kosztów ani przejazdów: zamiast Pulpitu i Kalendarza ma swój panel. */
const ACCOUNTANT_TABS: typeof TABS = [
  { to: '/', label: 'Księgowość', icon: 'receipt', end: true, also: ['/ksiegowosc'] },
  { to: '/zlecenia', label: 'Zlecenia', icon: 'clipboard', also: ['/zabieg'] },
  { to: '/raporty', label: 'Raporty', icon: 'chart' },
  TABS[4],
];

const useRole = () => useLiveQuery(async () => (await getSyncState())?.role ?? null);

/** Strona startowa: Pulpit technika albo panel księgowej. */
function HomePage() {
  const role = useRole();
  if (role === undefined) return <Loading />;
  return role === 'ksiegowosc' ? <AccountingPage /> : <DashboardPage />;
}

function Navigation() {
  const { pathname } = useLocation();
  const role = useRole();
  const tabs = role === 'ksiegowosc' ? ACCOUNTANT_TABS : TABS;
  return (
    <nav className="tabs" aria-label="Główna nawigacja">
      <div className="tabs-brand">Pogromcy Insektów</div>
      {tabs.map((tab) => (
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
  } = useRegisterSW({ onRegisteredSW: (_url, reg) => watchForUpdates(reg) });
  if (!needRefresh) return null;
  return (
    <div className="update-bar" role="status">
      <span>Jest nowa wersja aplikacji. Dane zostają na urządzeniu.</span>
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

function AppRoutes() {
  return (
    <Routes>
      <Route path="/" element={<HomePage />} />
      <Route path="/powiadomienia" element={<NotificationsPage />} />
      <Route path="/czat" element={<ChatPage />} />
      <Route path="/ksiegowosc" element={<AccountingPage />} />
      <Route path="/ksiegowosc/poprawki" element={<CorrectionsPage />} />
      <Route path="/ksiegowosc/:id" element={<AccountingOrderPage />} />
      <Route path="/kalendarz" element={<CalendarPage />} />
      <Route path="/zlecenia" element={<OrdersPage />} />
      <Route path="/archiwum" element={<OrdersPage archive />} />
      <Route path="/zlecenia/nowe" element={<OrderNewPage />} />
      <Route path="/zlecenia/:id" element={<OrderDetailPage />} />
      <Route path="/zlecenia/:id/edycja" element={<OrderEditPage />} />
      <Route path="/zabieg/:id" element={<VisitPage />} />
      <Route path="/raporty" element={<ReportsPage />} />
      <Route path="/koszty" element={<CostsPage />} />
      <Route path="/wizytowka" element={<CardPage />} />
      <Route path="/kilometry" element={<TripsPage />} />
      <Route path="/wiecej" element={<MorePage />} />
      <Route path="/ustawienia" element={<SettingsPage />} />
      <Route path="/kopie" element={<BackupPage />} />
      <Route path="/kosz" element={<TrashPage />} />
      <Route path="/konto" element={<AccountPage />} />
      <Route path="/oddzialy" element={<BranchesPage />} />
      <Route path="/region" element={<RegionPage />} />
      <Route path="/admin" element={<AdminPage />} />
      <Route path="/admin/bezpieczenstwo" element={<AdminSecurityPage />} />
      <Route path="/admin/technik/:id" element={<AdminTechnicianPage />} />
      <Route path="/admin/odzyskiwanie" element={<AdminRecoveryPage />} />
      <Route path="/admin/zlecenia" element={<AdminScoped><OrdersPage /></AdminScoped>} />
      <Route path="/admin/kalendarz" element={<AdminScoped><CalendarPage /></AdminScoped>} />
      <Route path="/admin/raporty" element={<AdminScoped><ReportsPage /></AdminScoped>} />
      <Route path="/admin/kilometry" element={<AdminScoped><TripsPage /></AdminScoped>} />
      <Route path="/admin/koszty" element={<AdminScoped><CostsPage /></AdminScoped>} />
      <Route path="*" element={<HomePage />} />
    </Routes>
  );
}

/** Ekrany dostępne bez zalogowania: ustawienie nowego hasła z linku w e-mailu. */
const PUBLIC_PATHS = ['/admin/odzyskiwanie'];

/**
 * Czy urządzenie z kontem firmy straciło sesję logowania (np. admin usunął konto). Sprawdzane przy starcie i po każdym
 * błędzie synchronizacji; po ponownym zalogowaniu błąd znika i aplikacja się odblokowuje.
 */
function useSessionLost(state: SyncState | null | undefined): boolean {
  const [lost, setLost] = useState(false);
  const active = Boolean(isSyncConfigured && state);
  useEffect(() => {
    if (!active) {
      setLost(false);
      return;
    }
    let cancelled = false;
    let stop: (() => void) | undefined;
    void import('./data/sync/supabase').then((api) => {
      if (cancelled) return;
      const check = () => setLost(!api.sessionStored());
      check();
      stop = api.onAuthChange(check);
    });
    return () => {
      cancelled = true;
      stop?.();
    };
  }, [active, state?.userId, state?.lastError]);
  return lost;
}

/** Bez konta firmy aplikacja pokazuje tylko logowanie (przy skonfigurowanym serwerze). */
function Shell() {
  const { pathname } = useLocation();
  const state = useLiveQuery(async () => (await getSyncState()) ?? null);
  const sessionLost = useSessionLost(state);
  if (isSyncConfigured && state === undefined) return <Loading />;
  const locked = isSyncConfigured && state === null && !PUBLIC_PATHS.includes(pathname);
  // Konto z loginem tymczasowym: najpierw własny e-mail i hasło.
  if (state?.temp && !PUBLIC_PATHS.includes(pathname)) {
    return (
      <div className="shell shell-locked">
        <div className="content">
          <UpdatePrompt />
          <ClaimAccountPage state={state} />
        </div>
      </div>
    );
  }
  if (sessionLost && state && !PUBLIC_PATHS.includes(pathname)) {
    return (
      <div className="shell shell-locked">
        <div className="content">
          <UpdatePrompt />
          <SessionLock state={state} />
        </div>
      </div>
    );
  }
  if (locked) {
    return (
      <div className="shell shell-locked">
        <div className="content">
          <UpdatePrompt />
          <LoginGate />
        </div>
      </div>
    );
  }
  return (
    <div className="shell">
      <Navigation />
      <div className="content">
        <UpdatePrompt />
        <PullToRefresh />
        <HeaderExtraContext.Provider
          value={
            state ? (
              <>
                <ChatButton />
                <NotificationBell />
              </>
            ) : null
          }
        >
          <Suspense fallback={<Loading />}>
            <AppRoutes />
          </Suspense>
        </HeaderExtraContext.Provider>
      </div>
    </div>
  );
}

export function App() {
  return (
    <ErrorBoundary>
      <FeedbackProvider>
        <HashRouter>
          <Shell />
        </HashRouter>
      </FeedbackProvider>
    </ErrorBoundary>
  );
}
