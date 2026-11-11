import { useEffect, useState } from 'react';
import { DomainError } from '../data/domain';
import { useLiveQuery } from 'dexie-react-hooks';
import { getAppSettings, getDataKey, getProfile, getRegions, getSyncState, setSyncState } from '../data/settings';
import { expenses, orders, trips, visits } from '../data/repo';
import { buildReport, formatPln, periodOf, shiftPeriod, type Period, type PeriodKind } from '../data/reports';
import type { Member } from '../data/sync/supabase';
import { formatDate, todayWarsaw } from '../lib/dates';
import { Link, Navigate } from 'react-router-dom';
import { syncInBackground } from '../data/sync/runner';
import type { SyncState } from '../data/types';
import { useFeedback } from '../ui/feedback';
import { Icon } from '../ui/icons';
import { Badge, Empty, Field, Group, Info, Loading, Page, Row, Stat } from '../ui/kit';

const supabaseApi = () => import('../data/sync/supabase');

/**
 * Przejście do innego regionu na tym urządzeniu. Serwer zmienia aktywny region konta, a urządzenie pobiera dane
 * od nowa: rekordy innego regionu nie były tu wcześniej widoczne.
 */
export async function enterRegion(state: SyncState, branch: { id: string; name: string }): Promise<void> {
  await (await supabaseApi()).switchBranch(state.orgId, branch.id);
  const latest = (await getSyncState()) ?? state;
  await setSyncState({ ...latest, branchId: branch.id, branchName: branch.name, regionsTagged: false });
  void syncInBackground().catch(() => undefined);
}

/** Regiony konta: aktywny, przejście do innego i dołączenie do kolejnego regionu samym kodem. */
export function RegionSwitcher({ state }: { state: SyncState }) {
  const { run, toast } = useFeedback();
  const [branches, setBranches] = useState<Array<{ id: string; name: string }> | null>(null);
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const owner = state.role === 'owner';

  const load = async () => {
    // RLS: admin widzi wszystkie regiony firmy, technik tylko swoje.
    setBranches(await (await supabaseApi()).listBranches(state.orgId));
  };

  useEffect(() => {
    void load().catch(() => setBranches(null));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.orgId]);

  const join = () =>
    run(async () => {
      const key = await getDataKey();
      if (!key) throw new DomainError('Brak klucza firmy na tym urządzeniu.');
      setBusy(true);
      try {
        const ok = await (await supabaseApi()).joinAnotherRegion(code, key);
        if (!ok) {
          toast('Kod jest błędny. Sprawdź wszystkie 16 znaków.', { tone: 'error' });
          return;
        }
        setCode('');
        await load();
        toast('Dołączono do regionu. Przejdź do niego poniżej.');
      } finally {
        setBusy(false);
      }
    });

  return (
    <Group title="Regiony tego konta">
      {branches === null && <p className="field-hint group-pad">Lista regionów wymaga internetu.</p>}
      {branches?.length === 0 && <p className="field-hint group-pad">Brak regionów. {owner ? 'Utwórz region w panelu admina.' : 'Poproś admina o kod do regionu.'}</p>}
      {branches?.map((b) => (
        <Row
          key={b.id}
          icon="building"
          title={b.name}
          sub={b.id === state.branchId ? 'Aktywny na tym urządzeniu' : owner ? 'Admin może wejść do każdego regionu' : 'Masz dostęp'}
          onClick={
            b.id === state.branchId
              ? undefined
              : () =>
                  void run(async () => {
                    await enterRegion(state, b);
                    toast(`Jesteś w regionie ${b.name}`);
                  })
          }
          trailing={b.id === state.branchId ? <Badge tone="ok">Aktywny</Badge> : <Badge tone="primary">Przejdź</Badge>}
        />
      ))}
      <form
        className="form group-pad"
        onSubmit={(e) => {
          e.preventDefault();
          if (code.trim()) void join();
        }}
      >
        <Field label="Dołącz do kolejnego regionu" hint="Kod weryfikacyjny od admina. Ten sam e-mail może należeć do kilku regionów.">
          <input value={code} autoCapitalize="characters" autoComplete="off" placeholder="XXXX-XXXX-XXXX-XXXX" onChange={(e) => setCode(e.target.value)} />
        </Field>
        <button type="submit" className="btn btn-block" disabled={busy || code.trim().length < 10}>
          <Icon name="plus" /> {busy ? 'Dołączam…' : 'Dołącz kodem'}
        </button>
      </form>
    </Group>
  );
}

/**
 * Region pod powitaniem na Pulpicie. Przy jednym regionie: jego nazwa małymi literami. Przy kilku regionach (albo
 * u admina, który wchodzi do każdego) lista do szybkiego przełączenia regionu na tym telefonie.
 */
export function RegionLine() {
  const { run, toast } = useFeedback();
  const state = useLiveQuery(async () => (await getSyncState()) ?? null);
  const saved = useLiveQuery(() => getRegions());
  const [server, setServer] = useState<Array<{ id: string; name: string }> | null>(null);

  useEffect(() => {
    if (!state?.orgId) return;
    // Z internetem lista z serwera (technik: swoje regiony, admin: wszystkie); bez niego zapisane nazwy.
    void supabaseApi()
      .then((api) => api.listBranches(state.orgId))
      .then(setServer)
      .catch(() => setServer(null));
  }, [state?.orgId]);

  if (!state || state.role === 'ksiegowosc') return null;
  const fromSaved = Object.entries(saved ?? {}).map(([id, info]) => ({ id, name: info.name }));
  const list = server ?? (state.role === 'owner' ? fromSaved : fromSaved.filter((b) => b.id === state.branchId));
  const current = state.branchName || list.find((b) => b.id === state.branchId)?.name || '';
  if (list.length <= 1) return current ? (
      <Link to="/region" className="region-line region-link">
        region {current.toLowerCase()}
      </Link>
    ) : null;
  return (
    <label className="region-line region-switch">
      <span>region</span>
      <select
        value={state.branchId ?? ''}
        aria-label="Przełącz region"
        onChange={(e) => {
          const target = list.find((b) => b.id === e.target.value);
          if (!target) return;
          void run(async () => {
            await enterRegion(state, target);
            toast(`Jesteś w regionie ${target.name}`);
          });
        }}
      >
        {!state.branchId && <option value="">wybierz region</option>}
        {list.map((b) => (
          <option key={b.id} value={b.id}>
            {b.name.toLowerCase()}
          </option>
        ))}
      </select>
    </label>
  );
}

const PERIODS: Array<[PeriodKind, string]> = [
  ['dzien', 'Dzień'],
  ['tydzien', 'Tydzień'],
  ['miesiac', 'Miesiąc'],
];

const ROLE_NAME: Record<string, string> = { owner: 'Admin', technik: 'Technik', ksiegowosc: 'Księgowa' };

/**
 * Ekran regionu dla technika: kto w nim pracuje, kto jest adminem (szef), podsumowanie dnia, tygodnia i miesiąca
 * oraz podstawowe informacje. Konto i synchronizacja mają osobny ekran.
 */
export function RegionPage() {
  const state = useLiveQuery(async () => (await getSyncState()) ?? null);
  const data = useLiveQuery(async () => ({
    regions: await getRegions(),
    settings: await getAppSettings(),
    me: (await getProfile()).userId,
    orders: await orders.all(),
    visits: await visits.all(),
    expenses: await expenses.all(),
    trips: await trips.all(),
  }));
  const [people, setPeople] = useState<Member[] | null | 'offline'>(null);
  const [kind, setKind] = useState<PeriodKind>('dzien');
  const [period, setPeriod] = useState<Period>(() => periodOf('dzien', todayWarsaw()));
  const orgId = state?.orgId;
  const branchId = state?.branchId ?? null;

  useEffect(() => {
    if (!orgId) return;
    void (async () => {
      try {
        const api = await supabaseApi();
        const [members, access] = await Promise.all([api.listMembers(orgId), api.listMemberBranches(orgId).catch(() => [])]);
        const inRegion = new Set(access.filter((a) => a.branchId === branchId).map((a) => a.userId));
        setPeople(members.filter((m) => m.approved && !m.suspended && (m.role === 'owner' || m.branchId === branchId || inRegion.has(m.userId))));
      } catch {
        setPeople('offline');
      }
    })();
  }, [orgId, branchId]);

  if (state === undefined || !data) return <Loading />;
  if (!state) return <Navigate to="/konto" replace />;

  const info = branchId ? data.regions[branchId] : undefined;
  const name = state.branchName || info?.name || 'bez regionu';
  const report = buildReport(period, data);
  const today = todayWarsaw();
  const planned = data.visits.filter((v) => v.status === 'zaplanowany' || v.status === 'w_trakcie');
  const todayCount = planned.filter((v) => v.start?.slice(0, 10) === today).length;
  const list = Array.isArray(people) ? people : [];
  const admins = list.filter((m) => m.role === 'owner');
  const team = list.filter((m) => m.role !== 'owner');
  const label = (m: Member) => `${m.displayName || m.email || 'Bez imienia'}${m.userId === data.me ? ' (Ty)' : ''}`;

  return (
    <Page title={`Region ${name}`} back="/wiecej">
      <Group title="Informacje">
        <Info label="Region">{name}</Info>
        <Info label="Kody zleceń">{info?.prefix ? `${info.prefix}-0001, ${info.prefix}-0002…` : 'Bez prefiksu'}</Info>
        <Info label="Twoja rola">{ROLE_NAME[state.role ?? 'technik'] ?? 'Technik'}</Info>
        <Info label="Gotówkę rozliczasz z">{data.settings.bossName}</Info>
        <Info label="Do zrobienia">{`${planned.length} zabiegów, dziś ${todayCount}`}</Info>
        {Array.isArray(people) && <Info label="Osoby w regionie">{String(team.length)}</Info>}
      </Group>

      <Group title="Szef (admin)">
        {people === null && <p className="field-hint group-pad">Wczytuję…</p>}
        {people === 'offline' && <p className="field-hint group-pad">Lista osób wymaga internetu.</p>}
        {Array.isArray(people) && admins.length === 0 && <p className="field-hint group-pad">Admin firmy: rozliczasz się z {data.settings.bossName}.</p>}
        {admins.map((m) => (
          <Row key={m.userId} icon="users" title={label(m)} sub={m.email} trailing={<Badge tone="primary">Admin</Badge>} />
        ))}
      </Group>

      <Group title={`Kto jest w regionie${Array.isArray(people) ? ` (${team.length})` : ''}`}>
        {people === 'offline' && <p className="field-hint group-pad">Lista osób wymaga internetu.</p>}
        {Array.isArray(people) && team.length === 0 && <Empty icon="users" title="Nikogo poza adminem" />}
        {team.map((m) => (
          <Row key={m.userId} icon="users" title={label(m)} sub={m.email} trailing={<Badge tone={m.role === 'ksiegowosc' ? 'info' : 'muted'}>{ROLE_NAME[m.role] ?? m.role}</Badge>} />
        ))}
      </Group>

      <Group title="Podsumowanie regionu">
        <div className="group-pad form">
          <div className="chips" role="group" aria-label="Okres">
            {PERIODS.map(([k, text]) => (
              <button
                key={k}
                type="button"
                className={kind === k ? 'chip active' : 'chip'}
                aria-pressed={kind === k}
                onClick={() => {
                  setKind(k);
                  setPeriod(periodOf(k, todayWarsaw()));
                }}
              >
                {text}
              </button>
            ))}
          </div>
          <div className="month-nav">
            <button type="button" className="icon-btn" aria-label="Poprzedni okres" onClick={() => setPeriod(shiftPeriod(period, -1))}>
              <Icon name="left" />
            </button>
            <strong>{period.from === period.to ? formatDate(period.from) : `${formatDate(period.from)} – ${formatDate(period.to)}`}</strong>
            <button type="button" className="icon-btn" aria-label="Następny okres" onClick={() => setPeriod(shiftPeriod(period, 1))}>
              <Icon name="chevron" />
            </button>
          </div>
          <div className="stats">
            <Stat label="Zabiegi" value={String(report.visits.length)} />
            <Stat label="Obrót" value={formatPln(report.turnover)} />
            <Stat label="Gotówka" value={formatPln(report.byMethod.gotowka)} />
            <Stat label={`Wynik gotówka dla ${data.settings.bossName}`} value={formatPln(report.cashForBoss)} tone={report.cashForBoss < 0 ? 'danger' : 'ok'} />
            <Stat label="Km służbowo (VAT)" value={`${report.km.sluzbowy} km`} />
            <Stat label="Koszty" value={formatPln(report.costs)} />
          </div>
          <p className="field-hint">Cały region: wszyscy technicy z tego regionu.</p>
        </div>
      </Group>

      <RegionSwitcher state={state} />
    </Page>
  );
}
