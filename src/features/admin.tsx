import { useLiveQuery } from 'dexie-react-hooks';
import { Fragment, useEffect, useMemo, useState, type ReactNode } from 'react';
import { Link, Navigate, useSearchParams } from 'react-router-dom';
import { normalizePrefix, PREFIX_MAX } from '../data/codes';
import { companyText, regionRanking, regionData, type RegionRef } from '../data/company';
import { buildReport, formatPln, periodOf, shiftPeriod, type Period, type PeriodKind } from '../data/reports';
import { expenses, orders, trips, visits } from '../data/repo';
import { getOwnBranch, setViewScope } from '../data/scope';
import { getRegions, getSyncState, saveRegions, type RegionInfo } from '../data/settings';
import type { SyncState } from '../data/types';
import { todayWarsaw } from '../lib/dates';
import { useFeedback } from '../ui/feedback';
import { Icon } from '../ui/icons';
import { Empty, Field, Group, Loading, Page, Row, ScopeBannerContext, Stat } from '../ui/kit';
import { useContactActions } from './common';

const supabaseApi = () => import('../data/sync/supabase');

// ---------- Blokada panelu ----------

/** Panel odblokowany na 15 minut od ostatniego użycia; po zamknięciu aplikacji znowu prosi o hasło. */
const UNLOCK_MS = 15 * 60 * 1000;
let unlockedUntil = 0;

function isUnlocked(): boolean {
  return Date.now() < unlockedUntil;
}

function touchUnlock(): void {
  if (isUnlocked()) unlockedUntil = Date.now() + UNLOCK_MS;
}

/** Logowanie do panelu: login (e-mail konta admina) i hasło, sprawdzane na serwerze. */
function AdminLogin(props: { state: SyncState; onUnlocked: () => void }) {
  const { run, toast } = useFeedback();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const submit = () =>
    run(async () => {
      // Inny e-mail podmieniłby konto zalogowane na urządzeniu, więc sprawdzamy go przed wysłaniem hasła.
      if (email.trim().toLowerCase() !== props.state.email.toLowerCase()) {
        toast('To nie jest login admina tego urządzenia.', { tone: 'error' });
        return;
      }
      setBusy(true);
      try {
        const user = await (await supabaseApi()).signIn(props.state.email, password);
        if (user.userId !== props.state.userId) throw new Error('Nieprawidłowe konto.');
        unlockedUntil = Date.now() + UNLOCK_MS;
        setPassword('');
        props.onUnlocked();
      } finally {
        setBusy(false);
      }
    });
  return (
    <form
      className="form card"
      onSubmit={(e) => {
        e.preventDefault();
        if (email.trim() && password) void submit();
      }}
    >
      <p className="field-hint">Panel admina jest chroniony. Podaj login (e-mail konta admina) i hasło. Wymaga internetu.</p>
      <Field label="Login (e-mail)">
        <input type="email" autoComplete="username" value={email} onChange={(e) => setEmail(e.target.value)} />
      </Field>
      <Field label="Hasło">
        <input type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} />
      </Field>
      <button type="submit" className="btn btn-primary btn-block" disabled={busy || !email.trim() || !password}>
        {busy ? 'Sprawdzam…' : 'Wejdź do panelu'}
      </button>
    </form>
  );
}

/** Wspólna bramka: tylko konto admina (szef) z synchronizacją, po podaniu loginu i hasła. */
function useAdminGate(): { state: SyncState | null | undefined; unlocked: boolean; unlock: () => void } {
  const state = useLiveQuery(async () => (await getSyncState()) ?? null);
  const [, setTick] = useState(0);
  return { state, unlocked: isUnlocked(), unlock: () => setTick((t) => t + 1) };
}

function NotAdmin() {
  return (
    <Page title="Panel admina" back="/wiecej">
      <Empty icon="users" title="Panel admina jest dostępny tylko na koncie admina firmy">
        <p className="field-hint">Konta techników są przypisane do swojego regionu i nie widzą innych regionów.</p>
      </Empty>
    </Page>
  );
}

// ---------- Regiony ----------

/** Regiony z serwera (oddziały) połączone z prefiksami ze wspólnych ustawień firmy. */
function useRegions(state: SyncState | null | undefined) {
  const { run, toast } = useFeedback();
  const saved = useLiveQuery(() => getRegions());
  const [server, setServer] = useState<Array<{ id: string; name: string }> | null>(null);
  const [members, setMembers] = useState<Record<string, number>>({});

  const load = async () => {
    if (!state?.orgId) return;
    const api = await supabaseApi();
    const [branches, people] = await Promise.all([api.listBranches(state.orgId), api.listMembers(state.orgId)]);
    setServer(branches);
    const count: Record<string, number> = {};
    for (const m of people) if (m.branchId && m.approved) count[m.branchId] = (count[m.branchId] ?? 0) + 1;
    setMembers(count);
  };

  useEffect(() => {
    // Bez internetu zostają regiony zapisane w ustawieniach firmy.
    void load().catch(() => undefined);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state?.orgId]);

  const regions: RegionRef[] = useMemo(() => {
    const info = saved ?? {};
    const list = server ?? Object.entries(info).map(([id, r]) => ({ id, name: r.name }));
    return list.map((b) => ({ id: b.id, name: b.name || info[b.id]?.name || 'Region', prefix: info[b.id]?.prefix ?? '' }));
  }, [saved, server]);

  const savePrefix = (id: string, name: string, prefix: string) =>
    run(async () => {
      const all = await getRegions();
      const taken = Object.entries(all).find(([other, r]) => other !== id && prefix && r.prefix === prefix);
      if (taken) {
        toast(`Prefiks ${prefix} ma już region ${taken[1].name}.`, { tone: 'error' });
        return;
      }
      await saveRegions({ ...all, [id]: { name, prefix } });
      toast(prefix ? `Region ${name}: prefiks ${prefix}` : `Region ${name}: bez prefiksu`);
    });

  const addRegion = (name: string) =>
    run(async () => {
      if (!state?.orgId) return;
      await (await supabaseApi()).createBranch(state.orgId, name);
      await load();
      toast(`Dodano region ${name}`);
    });

  // Nazwy regionów z serwera trafiają też do ustawień firmy, żeby urządzenia znały je bez internetu.
  useEffect(() => {
    if (!server || !saved) return;
    const missing = server.filter((b) => saved[b.id]?.name !== b.name);
    if (missing.length === 0) return;
    const next: Record<string, RegionInfo> = { ...saved };
    for (const b of missing) next[b.id] = { name: b.name, prefix: saved[b.id]?.prefix ?? '' };
    void saveRegions(next);
  }, [server, saved]);

  return { regions, members, loaded: saved !== undefined, online: server !== null, savePrefix, addRegion };
}

function PrefixEditor(props: { region: RegionRef; members: number; onSave: (prefix: string) => void }) {
  const [prefix, setPrefix] = useState(props.region.prefix);
  useEffect(() => setPrefix(props.region.prefix), [props.region.prefix]);
  return (
    <div className="region-edit">
      <div className="region-edit-name">
        <strong>{props.region.name}</strong>
        <span className="row-sub">Technicy: {props.members}</span>
      </div>
      <input
        className="input-short"
        value={prefix}
        maxLength={PREFIX_MAX}
        placeholder="Prefiks"
        aria-label={`Prefiks regionu ${props.region.name}`}
        autoCapitalize="characters"
        onChange={(e) => setPrefix(normalizePrefix(e.target.value))}
      />
      <button type="button" className="btn btn-sm" disabled={prefix === props.region.prefix} onClick={() => props.onSave(prefix)}>
        Zapisz
      </button>
    </div>
  );
}

// ---------- Strona główna panelu ----------

const regionLabel = (r: RegionRef) => (r.prefix ? `${r.name} (${r.prefix})` : r.name);

const periodName = (p: Period) => {
  const d = (date: string) => `${date.slice(8, 10)}.${date.slice(5, 7)}.${date.slice(0, 4)}`;
  return `${d(p.from)} – ${d(p.to)}`;
};

export function AdminPage() {
  const gate = useAdminGate();
  const { share } = useContactActions();
  const [params, setParams] = useSearchParams();
  const region = params.get('region') ?? 'all';
  const [kind, setKind] = useState<PeriodKind>('tydzien');
  const [period, setPeriod] = useState<Period>(() => periodOf('tydzien', todayWarsaw()));
  const [newRegion, setNewRegion] = useState('');
  const regionsApi = useRegions(gate.state);
  // Dane całej firmy, bez filtra regionu z ekranów technika.
  const data = useLiveQuery(async () => ({
    visits: await visits.allRegions(),
    orders: await orders.allRegions(),
    expenses: await expenses.allRegions(),
    trips: await trips.allRegions(),
  }));

  useEffect(() => touchUnlock());

  if (gate.state === undefined) return <Loading />;
  if (!gate.state || gate.state.role !== 'owner') return <NotAdmin />;
  if (!gate.unlocked) {
    return (
      <Page title="Panel admina" back="/wiecej">
        <AdminLogin state={gate.state} onUnlocked={gate.unlock} />
      </Page>
    );
  }
  if (!data || !regionsApi.loaded) return <Loading />;

  const own = getOwnBranch();
  const ranking = regionRanking(period, data, regionsApi.regions, own);
  const total = buildReport(period, data);
  const selected = regionsApi.regions.find((r) => r.id === region);
  const report = selected ? buildReport(period, regionData(data, selected.id, own)) : total;
  const setRegion = (id: string) => setParams(id === 'all' ? {} : { region: id }, { replace: true });
  const scoped = (path: string) => `/admin/${path}${region === 'all' ? '' : `?region=${region}`}`;
  const changeKind = (k: PeriodKind) => {
    setKind(k);
    setPeriod(periodOf(k, todayWarsaw()));
  };

  return (
    <Page title="Panel admina" back="/wiecej">
      <div className="chips" role="group" aria-label="Region">
        <button type="button" className={region === 'all' ? 'chip active' : 'chip'} aria-pressed={region === 'all'} onClick={() => setRegion('all')}>
          Cała firma
        </button>
        {regionsApi.regions.map((r) => (
          <button key={r.id} type="button" className={region === r.id ? 'chip active' : 'chip'} aria-pressed={region === r.id} onClick={() => setRegion(r.id)}>
            {regionLabel(r)}
          </button>
        ))}
      </div>

      <div className="chips" role="group" aria-label="Okres">
        {(
          [
            ['tydzien', 'Tydzień'],
            ['miesiac', 'Miesiąc'],
          ] as Array<[PeriodKind, string]>
        ).map(([k, label]) => (
          <button key={k} type="button" className={kind === k ? 'chip active' : 'chip'} aria-pressed={kind === k} onClick={() => changeKind(k)}>
            {label}
          </button>
        ))}
      </div>
      <div className="month-nav">
        <button type="button" className="icon-btn" aria-label="Poprzedni okres" onClick={() => setPeriod(shiftPeriod(period, -1))}>
          <Icon name="left" />
        </button>
        <strong>{periodName(period)}</strong>
        <button type="button" className="icon-btn" aria-label="Następny okres" onClick={() => setPeriod(shiftPeriod(period, 1))}>
          <Icon name="chevron" />
        </button>
      </div>

      <div className="stats">
        <Stat label="Obrót" value={formatPln(report.turnover)} />
        <Stat label="Zabiegi" value={String(report.visits.length)} />
        <Stat label="Koszty z premiami" value={formatPln(report.costs + report.bonus)} />
        <Stat label="Wynik gotówka" value={formatPln(report.cashForBoss)} tone={report.cashForBoss < 0 ? 'danger' : 'ok'} />
        <Stat label="Km służbowo" value={`${report.km.sluzbowy} km`} />
        <Stat label="Km prywatnie" value={`${report.km.prywatny} km`} />
      </div>

      {region === 'all' && (
        <Group
          title="Ranking regionów (obrót)"
          action={
            <button type="button" className="link" onClick={() => void share(companyText(total, ranking), 'Podsumowanie firmy')}>
              Wyślij podsumowanie
            </button>
          }
        >
          {ranking.length === 0 && <Empty title="Brak regionów" />}
          {ranking.map((r, i) => (
            <Row
              key={r.id || 'bez'}
              onClick={r.id ? () => setRegion(r.id) : undefined}
              lead={<span className={`rank rank-${Math.min(i + 1, 4)}`}>{i + 1}</span>}
              title={regionLabel(r)}
              sub={`Zabiegi: ${r.visits} · koszty ${formatPln(r.report.costs + r.report.bonus)} · ${r.report.km.sluzbowy + r.report.km.prywatny} km`}
              meta={`Wynik gotówka ${formatPln(r.report.cashForBoss)}`}
              trailing={<strong className="num">{formatPln(r.report.turnover)}</strong>}
            />
          ))}
        </Group>
      )}

      <Group title={selected ? `Region ${regionLabel(selected)}` : 'Cała firma'}>
        <Row to={scoped('zlecenia')} icon="clipboard" title="Zlecenia" sub="Lista, wyszukiwanie, szczegóły" />
        <Row to={scoped('kalendarz')} icon="calendar" title="Kalendarz" sub="Zabiegi wszystkich techników" />
        <Row to={scoped('raporty')} icon="chart" title="Raporty" sub="Dzień, tydzień, miesiąc w formacie technika, PDF" />
        <Row to={scoped('kilometry')} icon="car" title="Kilometrówka" sub="Przejazdy i wydruk ewidencji" />
        <Row to={scoped('koszty')} icon="receipt" title="Koszty" sub="Koszty techników z regionu" />
      </Group>

      <Group title="Regiony i prefiksy">
        {!regionsApi.online && <p className="field-hint group-pad">Bez internetu: lista z ostatniego połączenia, dodawanie regionów niedostępne.</p>}
        {regionsApi.regions.map((r) => (
          <PrefixEditor key={r.id} region={r} members={regionsApi.members[r.id] ?? 0} onSave={(prefix) => void regionsApi.savePrefix(r.id, r.name, prefix)} />
        ))}
        <form
          className="inline-add group-pad"
          onSubmit={(e) => {
            e.preventDefault();
            if (newRegion.trim()) void regionsApi.addRegion(newRegion.trim()).then(() => setNewRegion(''));
          }}
        >
          <input value={newRegion} placeholder="Nowy region, np. Pomorskie" onChange={(e) => setNewRegion(e.target.value)} disabled={!regionsApi.online} />
          <button type="submit" className="btn btn-sm" disabled={!newRegion.trim() || !regionsApi.online}>
            Dodaj
          </button>
        </form>
        <Row to="/oddzialy" icon="users" title="Technicy i zaproszenia" sub="Zatwierdzanie, przenoszenie między regionami, kody dołączenia" />
      </Group>

      <Group title="Firma">
        <Row to="/ustawienia" icon="gear" title="Ustawienia firmy" sub="Premia, zalecenia, SMS, dane do kilometrówki" />
        <Row to="/konto" icon="users" title="Konto admina" sub="Synchronizacja i wylogowanie" />
      </Group>
    </Page>
  );
}

// ---------- Ekrany technika w zakresie panelu ----------

let scopeToken = 0;

/**
 * Pokazuje zwykły ekran (zlecenia, kalendarz, raporty…) dla regionu wybranego w panelu albo całej firmy.
 * Zakres list ustawia się na czas wyświetlania; po wyjściu ekrany wracają do własnego regionu.
 */
export function AdminScoped({ children }: { children: ReactNode }) {
  const gate = useAdminGate();
  const [params] = useSearchParams();
  const region = params.get('region') ?? 'all';
  const regions = useLiveQuery(() => getRegions());
  const [token] = useState(() => ++scopeToken);
  setViewScope(region);
  useEffect(() => {
    touchUnlock();
    return () => {
      if (scopeToken === token) setViewScope(null);
    };
  }, [token]);

  if (gate.state === undefined || regions === undefined) return <Loading />;
  if (!gate.state || gate.state.role !== 'owner') return <NotAdmin />;
  if (!gate.unlocked) return <Navigate to="/admin" replace />;
  const name = region === 'all' ? 'Cała firma' : regions[region] ? regionLabel({ id: region, ...regions[region] }) : 'Region';
  const banner = (
    <Link className="scope-banner" to={region === 'all' ? '/admin' : `/admin?region=${region}`}>
      <Icon name="back" size={16} /> Panel admina · {name}
    </Link>
  );
  return (
    <ScopeBannerContext.Provider value={banner}>
      <Fragment key={region}>{children}</Fragment>
    </ScopeBannerContext.Provider>
  );
}
